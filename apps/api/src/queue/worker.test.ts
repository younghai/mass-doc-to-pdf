import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "../test/testDb.js";
import { JobService } from "../jobs/jobService.js";
import { JobQueue } from "./jobQueue.js";
import { runWorkerOnce, type WorkerRuntimeDeps } from "./worker.js";
import type { Storage } from "../storage/s3.js";
import type { Converter } from "../convert/types.js";
import type { Registry } from "../convert/registry.js";

let db: ReturnType<typeof setupTestDb>;
let userId: string;
let jobs: JobService;

class MemoryStorage implements Storage {
  readonly map = new Map<string, Buffer>();
  async put(key: string, body: Buffer): Promise<void> {
    this.map.set(key, body);
  }
  async get(key: string): Promise<Uint8Array> {
    const v = this.map.get(key);
    if (!v) throw Object.assign(new Error("not found"), { code: "ENOENT" });
    return v;
  }
}

function registryWith(converter: Converter): Registry {
  return { forFormat: () => converter };
}

async function seedQueued(storage: MemoryStorage, queue: JobQueue): Promise<string> {
  const sourceKey = `${userId}/src/a.hwp`;
  await storage.put(sourceKey, Buffer.from("hwp-bytes"));
  const job = await db.prisma.conversionJob.create({
    data: {
      userId,
      filename: "a.hwp",
      format: "hwp",
      extension: "hwp",
      mimeType: "application/x-hwp",
      sizeBytes: 9,
      sourceKey,
      qualityMode: "precise",
      status: "pending",
    },
  });
  await queue.enqueue(job.id);
  return job.id;
}

beforeAll(async () => {
  db = setupTestDb();
  jobs = new JobService(db.prisma);
  const u = await db.prisma.user.create({ data: { email: "w@x.c" } });
  userId = u.id;
});
afterAll(() => db.cleanup());
beforeEach(async () => {
  await db.prisma.conversionJob.deleteMany({});
});

describe("runWorkerOnce", () => {
  it("converts a claimed job, stores pdf + report, marks success", async () => {
    const storage = new MemoryStorage();
    const queue = new JobQueue(db.prisma);
    const engine: Converter = { name: "rhwp", async convert() { return Buffer.from("%PDF-1.7"); } };
    const deps: WorkerRuntimeDeps = { registry: registryWith(engine), storage, jobs, queue };

    const id = await seedQueued(storage, queue);
    expect(await runWorkerOnce(deps, "w1")).toBe(true);

    const job = await jobs.get(userId, id);
    expect(job?.status).toBe("success");
    expect(job?.engine).toBe("rhwp");
    expect(storage.map.has(`${userId}/out/${id}.pdf`)).toBe(true);
    expect(storage.map.has(`${userId}/report/${id}.json`)).toBe(true);

    const row = await db.prisma.conversionJob.findUnique({ where: { id } });
    expect(row?.lockedAt).toBeNull();
  });

  it("returns false when the queue is empty", async () => {
    const storage = new MemoryStorage();
    const queue = new JobQueue(db.prisma);
    const engine: Converter = { name: "x", async convert() { return Buffer.from(""); } };
    expect(await runWorkerOnce({ registry: registryWith(engine), storage, jobs, queue }, "w")).toBe(false);
  });

  it("requeues a failed job until maxAttempts, then marks it failed", async () => {
    const storage = new MemoryStorage();
    const queue = new JobQueue(db.prisma, { maxAttempts: 2 });
    const engine: Converter = {
      name: "rhwp",
      async convert() { throw new Error("boom"); },
    };
    const deps: WorkerRuntimeDeps = { registry: registryWith(engine), storage, jobs, queue };

    const id = await seedQueued(storage, queue);

    await runWorkerOnce(deps, "w"); // attempt 1 -> requeue
    expect((await jobs.get(userId, id))?.status).toBe("queued");

    await runWorkerOnce(deps, "w"); // attempt 2 -> give up
    const job = await jobs.get(userId, id);
    expect(job?.status).toBe("failed");
    expect(job?.error).toMatch(/boom/);
  });
});
