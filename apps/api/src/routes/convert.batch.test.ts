import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp, type AppDeps } from "../app.js";
import type { Converter } from "../convert/types.js";
import { JobService } from "../jobs/jobService.js";
import { JobQueue } from "../queue/jobQueue.js";
import { multipartPayload } from "../test/multipart.js";
import { setupTestDb } from "../test/testDb.js";

let db: ReturnType<typeof setupTestDb>;
let userId: string;

const engine: Converter = { name: "gotenberg", async convert() { return Buffer.from("%PDF-1.7"); } };

beforeAll(async () => {
  db = setupTestDb();
  const user = await db.prisma.user.create({ data: { email: "batch-convert@x.c" } });
  userId = user.id;
});

afterAll(() => db.cleanup());

beforeEach(async () => {
  await db.prisma.conversionJob.deleteMany({});
});

function makeApp() {
  const deps: AppDeps = {
    registry: { forFormat: () => engine },
    storage: { put: vi.fn(async () => {}), get: vi.fn(), delete: vi.fn() },
    jobs: new JobService(db.prisma),
    queue: new JobQueue(db.prisma),
    webOrigin: "http://localhost",
    getSessionUser: async () => ({ id: userId, email: "batch-convert@x.c" }),
  };
  return buildApp(deps);
}

describe("POST /api/convert batchId persistence", () => {
  it("stores the optional batchId query parameter on the created job", async () => {
    const { body, headers } = multipartPayload("batched.docx", Buffer.from("docbytes"));

    const res = await makeApp().inject({
      method: "POST",
      url: "/api/convert?qualityMode=quick&batchId=batch-query-1",
      headers,
      payload: body,
    });

    expect(res.statusCode).toBe(202);
    const queued = res.json() as { id: string };
    const raw = await db.prisma.conversionJob.findUnique({ where: { id: queued.id } });
    expect(raw?.batchId).toBe("batch-query-1");
  });

  it("stores the optional batchId multipart field on the created job", async () => {
    const { body, headers } = multipartPayload("batched-field.docx", Buffer.from("docbytes"), {
      fields: { batchId: "batch-field-1" },
    });

    const res = await makeApp().inject({
      method: "POST",
      url: "/api/convert?qualityMode=quick",
      headers,
      payload: body,
    });

    expect(res.statusCode).toBe(202);
    const queued = res.json() as { id: string };
    const raw = await db.prisma.conversionJob.findUnique({ where: { id: queued.id } });
    expect(raw?.batchId).toBe("batch-field-1");
  });
});
