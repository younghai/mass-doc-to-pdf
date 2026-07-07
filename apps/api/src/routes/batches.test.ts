import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BatchDTO, JobStatus } from "@hwptopdf/shared";
import { buildApp, type AppDeps } from "../app.js";
import type { Converter } from "../convert/types.js";
import { JobService } from "../jobs/jobService.js";
import { setupTestDb } from "../test/testDb.js";

let db: ReturnType<typeof setupTestDb>;
let jobs: JobService;
let ownerId: string;
let otherId: string;

const noEngine: Converter = { name: "x", async convert() { return Buffer.from(""); } };

const base = (filename: string) => ({
  filename,
  format: "office" as const,
  extension: "docx",
  mimeType: "application/octet-stream",
  sizeBytes: 10,
  sourceKey: `src/${filename}`,
});

function makeApp(userId: string) {
  const deps: AppDeps = {
    registry: { forFormat: () => noEngine },
    storage: { put: vi.fn(), get: vi.fn(), delete: vi.fn() },
    jobs,
    webOrigin: "http://localhost",
    getSessionUser: async () => ({ id: userId, email: "u@x.c" }),
  };
  return buildApp(deps);
}

async function createJob(userId: string, batchId: string, status: JobStatus, filename: string) {
  const created = await jobs.create(userId, { ...base(filename), batchId });
  switch (status) {
    case "pending":
      return created;
    case "queued":
      return db.prisma.conversionJob.update({ where: { id: created.id }, data: { status: "queued" } });
    case "running":
      return jobs.markRunning(created.id, { engine: "gotenberg" });
    case "success":
      return jobs.markSuccess(created.id, { engine: "gotenberg", durationMs: 10, outputKey: `out/${filename}` });
    case "failed":
      return jobs.markFailed(created.id, { engine: "gotenberg", durationMs: 10, error: "boom" });
    default:
      throw new Error(`unhandled status: ${status satisfies never}`);
  }
}

beforeAll(async () => {
  db = setupTestDb();
  jobs = new JobService(db.prisma);
  const owner = await db.prisma.user.create({ data: { email: "batch-owner@x.c" } });
  const other = await db.prisma.user.create({ data: { email: "batch-other@x.c" } });
  ownerId = owner.id;
  otherId = other.id;
});

afterAll(() => db.cleanup());

beforeEach(async () => {
  await db.prisma.conversionJob.deleteMany({});
});

describe("GET /api/batches/:id", () => {
  it("aggregates owner-scoped jobs by batchId", async () => {
    await createJob(ownerId, "batch-1", "pending", "pending.docx");
    await createJob(ownerId, "batch-1", "queued", "queued.docx");
    await createJob(ownerId, "batch-1", "running", "running.docx");
    await createJob(ownerId, "batch-1", "success", "success.docx");
    await createJob(ownerId, "batch-1", "failed", "failed.docx");
    await createJob(ownerId, "other-batch", "success", "ignored.docx");

    const res = await makeApp(ownerId).inject({ method: "GET", url: "/api/batches/batch-1" });

    expect(res.statusCode).toBe(200);
    const batch = res.json() as BatchDTO;
    expect(batch).toMatchObject({
      id: "batch-1",
      status: "active",
      total: 5,
      pending: 1,
      queued: 1,
      running: 1,
      success: 1,
      failed: 1,
    });
    expect(new Date(batch.createdAt).toString()).not.toBe("Invalid Date");
  });

  it("does not expose another user's batch jobs", async () => {
    await createJob(ownerId, "private-batch", "success", "private.docx");

    const res = await makeApp(otherId).inject({ method: "GET", url: "/api/batches/private-batch" });

    expect(res.statusCode).toBe(404);
  });
});
