import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestDb } from "../test/testDb.js";
import { multipartPayload } from "../test/multipart.js";
import { buildApp, type AppDeps } from "../app.js";
import { JobService } from "../jobs/jobService.js";
import { JobQueue } from "../queue/jobQueue.js";
import { runWorkerOnce } from "../queue/worker.js";
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

const engine: Converter = { name: "rhwp", async convert() { return Buffer.from("%PDF-1.7"); } };
const registry: Registry = { forFormat: () => engine };

beforeAll(async () => {
  db = setupTestDb();
  jobs = new JobService(db.prisma);
  const u = await db.prisma.user.create({ data: { email: "cq@x.c" } });
  userId = u.id;
});
afterAll(() => db.cleanup());
beforeEach(async () => {
  await db.prisma.conversionJob.deleteMany({});
});

describe("POST /api/convert (durable queue path)", () => {
  it("enqueues instead of converting inline; worker completes it", async () => {
    const storage = new MemoryStorage();
    const queue = new JobQueue(db.prisma);
    const deps: AppDeps = {
      registry,
      storage,
      jobs,
      queue,
      getSessionUser: async () => ({ id: userId, email: "cq@x.c" }),
    };
    const app = buildApp(deps);

    const { body, headers } = multipartPayload("r.docx", Buffer.from("docbytes"));
    const res = await app.inject({ method: "POST", url: "/api/convert", headers, payload: body });

    expect(res.statusCode).toBe(202);
    const job = res.json() as { id: string; status: string };
    expect(job.status).toBe("queued");
    // Source stored, but no output yet (worker has not run).
    expect([...storage.map.keys()].some((k) => k.includes("/src/"))).toBe(true);
    expect([...storage.map.keys()].some((k) => k.includes("/out/"))).toBe(false);

    // Worker picks it up and finishes it.
    const handled = await runWorkerOnce({ registry, storage, jobs, queue }, "w1");
    expect(handled).toBe(true);
    const done = await jobs.get(userId, job.id);
    expect(done?.status).toBe("success");
    expect(storage.map.has(`${userId}/out/${job.id}.pdf`)).toBe(true);
  });
});
