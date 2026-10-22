import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "../test/testDb.js";
import { JobQueue } from "./jobQueue.js";

let db: ReturnType<typeof setupTestDb>;
let userId: string;

async function seedJob(filename: string, createdAt?: Date, ownerId?: string): Promise<string> {
  const job = await db.prisma.conversionJob.create({
    data: {
      userId: ownerId ?? userId,
      filename,
      format: "hwp",
      extension: "hwp",
      mimeType: "application/x-hwp",
      sizeBytes: 10,
      sourceKey: `src/${filename}`,
      qualityMode: "precise",
      status: "pending",
      ...(createdAt ? { createdAt } : {}),
    },
  });
  return job.id;
}

beforeAll(async () => {
  db = setupTestDb();
  const u = await db.prisma.user.create({ data: { email: "q@x.c" } });
  userId = u.id;
});
afterAll(() => db.cleanup());
beforeEach(async () => {
  await db.prisma.conversionJob.deleteMany({});
});

describe("JobQueue", () => {
  it("enqueue moves a job to queued; claimNext locks it as running", async () => {
    const q = new JobQueue(db.prisma);
    const id = await seedJob("a.hwp");
    await q.enqueue(id);

    const claimed = await q.claimNext("worker-1");
    expect(claimed?.id).toBe(id);
    expect(claimed?.qualityMode).toBe("precise");
    expect(claimed?.attempts).toBe(0); // a claim is a lease, not a conversion attempt

    const row = await db.prisma.conversionJob.findUnique({ where: { id } });
    expect(row?.status).toBe("running");
    expect(row?.lockedBy).toBe("worker-1");
  });

  it("returns null when nothing is queued", async () => {
    const q = new JobQueue(db.prisma);
    expect(await q.claimNext("w")).toBeNull();
  });

  it("claims the oldest job first (FIFO)", async () => {
    const q = new JobQueue(db.prisma);
    const older = await seedJob("old.hwp", new Date(2026, 0, 1));
    const newer = await seedJob("new.hwp", new Date(2026, 0, 2));
    await q.enqueue(older);
    await q.enqueue(newer);
    expect((await q.claimNext("w"))?.id).toBe(older);
    expect((await q.claimNext("w"))?.id).toBe(newer);
  });

  it("round-robins queued jobs across users so a bulk batch cannot starve a single upload", async () => {
    const q = new JobQueue(db.prisma);
    const u2 = await db.prisma.user.create({ data: { email: "q2@x.c" } });

    // u1 uploads a bulk batch of 3 (all older than u2's single upload).
    const u1a = await seedJob("u1-a.hwp", new Date(2026, 0, 1));
    const u1b = await seedJob("u1-b.hwp", new Date(2026, 0, 2));
    const u1c = await seedJob("u1-c.hwp", new Date(2026, 0, 3));
    // u2 uploads a single file last (newest createdAt of all four).
    const u2a = await seedJob("u2-a.hwp", new Date(2026, 0, 4), u2.id);
    for (const id of [u1a, u1b, u1c, u2a]) await q.enqueue(id);

    const order = [
      (await q.claimNext("w"))?.id,
      (await q.claimNext("w"))?.id,
      (await q.claimNext("w"))?.id,
      (await q.claimNext("w"))?.id,
    ];

    // Round-robin: each user's 1st job (oldest user first) before any 2nd job,
    // FIFO within a user. u2's single upload is served 2nd — under global FIFO
    // (the old behaviour) it would have been dead last, behind the whole batch.
    expect(order).toEqual([u1a, u2a, u1b, u1c]);
    expect(order[1]).toBe(u2a); // not starved behind u1's bulk batch
  });

  it("does not double-claim the same job", async () => {
    const q = new JobQueue(db.prisma);
    const id = await seedJob("a.hwp");
    await q.enqueue(id);
    const [a, b] = await Promise.all([q.claimNext("w1"), q.claimNext("w2")]);
    const claimedIds = [a?.id, b?.id].filter(Boolean);
    expect(claimedIds).toEqual([id]); // exactly one worker got it
  });

  it("retries until maxAttempts, then gives up", async () => {
    const q = new JobQueue(db.prisma, { maxAttempts: 2 });
    const id = await seedJob("a.hwp");
    await q.enqueue(id);

    await q.claimNext("w");
    expect((await q.retryOrGiveUp(id)).willRetry).toBe(true); // attempts→1, requeued
    expect((await db.prisma.conversionJob.findUnique({ where: { id } }))?.status).toBe("queued");

    await q.claimNext("w");
    expect((await q.retryOrGiveUp(id)).willRetry).toBe(false); // attempts→2, give up
  });

  it("crash reclaims do not burn retry budget — only real failures count", async () => {
    const q = new JobQueue(db.prisma, { maxAttempts: 2, visibilityTimeoutMs: 1000 });
    const id = await seedJob("a.hwp");
    await q.enqueue(id);

    // Two crash-reclaims (visibility timeout expiry) must not increment attempts.
    await q.claimNext("worker-crashed-1");
    await q.requeueStale(new Date(Date.now() + 5000));
    await q.claimNext("worker-crashed-2");
    await q.requeueStale(new Date(Date.now() + 5000));

    const row = await db.prisma.conversionJob.findUnique({ where: { id } });
    expect(row?.attempts).toBe(0);
    expect(row?.status).toBe("queued");

    // First real conversion failure → retry.
    await q.claimNext("worker-real");
    expect((await q.retryOrGiveUp(id)).willRetry).toBe(true);
    expect((await db.prisma.conversionJob.findUnique({ where: { id } }))?.attempts).toBe(1);

    // Second real failure at maxAttempts=2 → give up.
    await q.claimNext("worker-real");
    expect((await q.retryOrGiveUp(id)).willRetry).toBe(false);
    expect((await db.prisma.conversionJob.findUnique({ where: { id } }))?.attempts).toBe(2);
  });

  it("recovers crashed workers via requeueStale and stale claim", async () => {
    const q = new JobQueue(db.prisma, { visibilityTimeoutMs: 1000 });
    const id = await seedJob("a.hwp");
    await q.enqueue(id);
    await q.claimNext("crashed-worker");

    // No recovery while the lock is fresh.
    expect(await q.requeueStale(new Date(Date.now()))).toBe(0);

    // After the visibility timeout, the lock is reclaimable.
    const later = new Date(Date.now() + 5000);
    expect(await q.requeueStale(later)).toBe(1);
    expect((await db.prisma.conversionJob.findUnique({ where: { id } }))?.status).toBe("queued");
  });

  it("release clears the lock", async () => {
    const q = new JobQueue(db.prisma);
    const id = await seedJob("a.hwp");
    await q.enqueue(id);
    await q.claimNext("w");
    await q.release(id);
    const row = await db.prisma.conversionJob.findUnique({ where: { id } });
    expect(row?.lockedAt).toBeNull();
    expect(row?.lockedBy).toBeNull();
  });
});
