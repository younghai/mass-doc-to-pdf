import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb } from "../test/testDb.js";
import { JobService } from "../jobs/jobService.js";
import { JobQueue } from "./jobQueue.js";
import { processConversion } from "./processConversion.js";
import { runWorkerLoop, runWorkerOnce, type WorkerRuntimeDeps } from "./worker.js";
import type { QueuedJob } from "./jobQueue.js";
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
  async delete(key: string): Promise<void> {
    this.map.delete(key);
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
  it("converts a claimed job, stores pdf + report + preview, marks success", async () => {
    const storage = new MemoryStorage();
    const queue = new JobQueue(db.prisma);
    const engine: Converter = { name: "rhwp", async convert() { return Buffer.from("%PDF-1.7"); } };
    // Stub renderer so the post-success preview pre-render is deterministic and
    // never shells out to pdftoppm/LibreOffice during the test.
    const pdfPreview = { renderFirstPagePng: vi.fn(async () => Buffer.from("\x89PNG")) };
    const deps: WorkerRuntimeDeps = { registry: registryWith(engine), storage, jobs, queue, pdfPreview };

    const id = await seedQueued(storage, queue);
    expect(await runWorkerOnce(deps, "w1")).toBe(true);

    const job = await jobs.get(userId, id);
    expect(job?.status).toBe("success");
    expect(job?.engine).toBe("rhwp");
    expect(storage.map.has(`${userId}/out/${id}.pdf`)).toBe(true);
    expect(storage.map.has(`${userId}/report/${id}.json`)).toBe(true);
    // The first-page PNG is pre-rendered at conversion time for the preview route.
    expect(pdfPreview.renderFirstPagePng).toHaveBeenCalledTimes(1);
    expect(storage.map.has(`${userId}/preview/${id}.png`)).toBe(true);

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

  it("permanently fails password-protected jobs without burning retries", async () => {
    const storage = new MemoryStorage();
    const queue = new JobQueue(db.prisma);
    const engine: Converter = {
      name: "rhwp",
      async convert() { throw new Error("password protected document"); },
    };
    const deps: WorkerRuntimeDeps = { registry: registryWith(engine), storage, jobs, queue };

    const id = await seedQueued(storage, queue);
    expect(await runWorkerOnce(deps, "w")).toBe(true);

    const job = await jobs.get(userId, id);
    expect(job?.status).toBe("failed");
    expect(job?.error).toMatch(/암호 문서/);

    // A deterministic failure must not consume the retry budget: the job is
    // marked failed on the first pass and attempts stays at 0 (no re-queue).
    const row = await db.prisma.conversionJob.findUnique({ where: { id } });
    expect(row?.attempts).toBe(0);
    expect(row?.lockedAt).toBeNull();
  });

  it("still retries transient failures (e.g. sidecar down)", async () => {
    const storage = new MemoryStorage();
    const queue = new JobQueue(db.prisma);
    const engine: Converter = {
      name: "rhwp",
      async convert() { throw new Error("sidecar connection refused"); },
    };
    const deps: WorkerRuntimeDeps = { registry: registryWith(engine), storage, jobs, queue };

    const id = await seedQueued(storage, queue);
    expect(await runWorkerOnce(deps, "w")).toBe(true);

    // Transient: re-queued for another attempt, retry budget consumed.
    expect((await jobs.get(userId, id))?.status).toBe("queued");
    const row = await db.prisma.conversionJob.findUnique({ where: { id } });
    expect(row?.attempts).toBe(1);
  });
});

describe("processConversion", () => {
  it("returns a failure result instead of throwing when the source object is missing", async () => {
    const storage: Storage = {
      async get() {
        throw Object.assign(new Error("NoSuchKey"), { code: "NoSuchKey" });
      },
      async put() {},
      async delete() {},
    };
    const engine: Converter = { name: "rhwp", async convert() { return Buffer.from("%PDF-1.7"); } };
    const job: QueuedJob = {
      id: "j1",
      userId,
      filename: "a.hwp",
      format: "hwp",
      extension: "hwp",
      mimeType: "application/x-hwp",
      sizeBytes: 9,
      sourceKey: `${userId}/src/missing.hwp`,
      qualityMode: "precise",
      attempts: 0,
    };

    const result = await processConversion({ registry: registryWith(engine), storage, jobs }, job);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/NoSuchKey/);
    }
  });
});

describe("runWorkerLoop", () => {
  it("survives an unexpected iteration error and keeps polling", async () => {
    let claimCalls = 0;
    // Iteration 1 throws (transient DB/storage outage); later iterations return
    // null so the loop idles. A crash here would mimic the systemd/compose
    // claim -> crash -> restart loop the catch is meant to prevent.
    const queue = {
      async claimNext() {
        claimCalls += 1;
        if (claimCalls === 1) throw new Error("transient db outage");
        return null;
      },
      async requeueStale() { return 0; },
    } as unknown as JobQueue;
    const engine: Converter = { name: "x", async convert() { return Buffer.from(""); } };
    const deps: WorkerRuntimeDeps = { registry: registryWith(engine), storage: new MemoryStorage(), jobs, queue };

    let resolveStop: () => void = () => {};
    const stop = new Promise<void>((resolve) => { resolveStop = resolve; });

    const loop = runWorkerLoop(deps, { workerId: "w-loop", errorBackoffMs: 1, idlePollMs: 1, stop });

    // Give the loop a few iterations past the initial throw, then ask it to stop.
    await new Promise((resolve) => setTimeout(resolve, 50));
    resolveStop();

    await expect(loop).resolves.toBeUndefined();
    expect(claimCalls).toBeGreaterThanOrEqual(2);
  });
});
