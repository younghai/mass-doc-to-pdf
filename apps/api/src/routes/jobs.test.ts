import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { setupTestDb } from "../test/testDb.js";
import { buildApp, type AppDeps } from "../app.js";
import { JobService } from "../jobs/jobService.js";
import type { Converter } from "../convert/types.js";
import type { QualityReport } from "@hwptopdf/shared";

let db: ReturnType<typeof setupTestDb>;
let userId: string;
let jobs: JobService;
const pdf = Buffer.from("%PDF-1.7 output");

const noEngine: Converter = { name: "x", async convert() { return Buffer.from(""); } };

function makeApp() {
  const report: QualityReport = {
    version: 1,
    jobId: "1",
    filename: "ok.docx",
    format: "office",
    selectedEngine: "rhwp",
    grade: "good",
    checks: { pdfBytes: 15, pageCount: 1 },
    attempts: [{ engine: "rhwp", status: "success", durationMs: 42 }],
    warnings: [],
    createdAt: new Date(2026, 0, 1).toISOString(),
  };
  const storage = {
    put: vi.fn(async () => {}),
    get: vi.fn(async (key: string) =>
      key.includes("/report/")
        ? new TextEncoder().encode(JSON.stringify(report))
        : new Uint8Array(pdf),
    ),
  };
  const deps: AppDeps = {
    registry: { forFormat: () => noEngine },
    storage,
    jobs,
    getSessionUser: async () => ({ id: userId, email: "u@x.c" }),
  };
  return { app: buildApp(deps), storage };
}

beforeAll(async () => {
  db = setupTestDb();
  jobs = new JobService(db.prisma);
  const u = await db.prisma.user.create({ data: { email: "u@x.c" } });
  userId = u.id;
  const base = (f: string) => ({
    filename: f, format: "office" as const, extension: "docx",
    mimeType: "application/octet-stream", sizeBytes: 10, sourceKey: `src/${f}`,
  });
  const ok = await jobs.create(userId, base("ok.docx"));
  await jobs.markSuccess(ok.id, { engine: "gotenberg", durationMs: 100, outputKey: "out/ok" });
  const bad = await jobs.create(userId, base("bad.docx"));
  await jobs.markFailed(bad.id, { engine: "gotenberg", durationMs: 50, error: "boom" });
});
afterAll(() => db.cleanup());

describe("jobs routes", () => {
  it("GET /api/jobs lists all jobs newest first", async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: "GET", url: "/api/jobs" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });

  it("GET /api/jobs?status=failed returns only failed", async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: "GET", url: "/api/jobs?status=failed" });
    const list = res.json() as Array<{ status: string }>;
    expect(list.length).toBe(1);
    expect(list[0].status).toBe("failed");
  });

  it("GET /api/jobs/:id returns the DTO; 404 for unknown", async () => {
    const { app } = makeApp();
    const all = (await app.inject({ method: "GET", url: "/api/jobs" })).json() as Array<{ id: string }>;
    const one = await app.inject({ method: "GET", url: `/api/jobs/${all[0].id}` });
    expect(one.statusCode).toBe(200);
    const missing = await app.inject({ method: "GET", url: "/api/jobs/nope" });
    expect(missing.statusCode).toBe(404);
  });

  it("download returns PDF for a successful job, 409 for a failed one", async () => {
    const { app } = makeApp();
    const list = (await app.inject({ method: "GET", url: "/api/jobs" })).json() as Array<{ id: string; status: string }>;
    const okJob = list.find((j) => j.status === "success")!;
    const badJob = list.find((j) => j.status === "failed")!;
    const dl = await app.inject({ method: "GET", url: `/api/jobs/${okJob.id}/download` });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers["content-type"]).toContain("application/pdf");
    const bad = await app.inject({ method: "GET", url: `/api/jobs/${badJob.id}/download` });
    expect(bad.statusCode).toBe(409);
  });

  it("download supports Korean PPT filenames in content disposition", async () => {
    const { app } = makeApp();
    const created = await jobs.create(userId, {
      filename: "발표자료.pptx",
      format: "office",
      extension: "pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      sizeBytes: 10,
      sourceKey: "src/발표자료.pptx",
    });
    await jobs.markSuccess(created.id, {
      engine: "gotenberg",
      durationMs: 100,
      outputKey: "out/발표자료",
    });

    const dl = await app.inject({ method: "GET", url: `/api/jobs/${created.id}/download` });

    expect(dl.statusCode).toBe(200);
    expect(dl.headers["content-disposition"]).toContain('filename="download.pdf"');
    expect(dl.headers["content-disposition"]).toContain("filename*=UTF-8''");
    expect(dl.body.slice(0, 5)).toBe("%PDF-");
  });

  it("returns quality report for a successful job", async () => {
    const { app } = makeApp();
    const list = (await app.inject({ method: "GET", url: "/api/jobs" })).json() as Array<{
      id: string;
      status: string;
    }>;
    const okJob = list.find((j) => j.status === "success");
    if (!okJob) throw new Error("missing successful job");

    const res = await app.inject({ method: "GET", url: `/api/jobs/${okJob.id}/quality` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      selectedEngine: "rhwp",
      grade: "good",
      checks: { pageCount: 1 },
    });
  });
});
