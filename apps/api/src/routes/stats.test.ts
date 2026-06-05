import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { setupTestDb } from "../test/testDb.js";
import { buildApp, type AppDeps } from "../app.js";
import { JobService } from "../jobs/jobService.js";
import type { Converter } from "../convert/types.js";

let db: ReturnType<typeof setupTestDb>;
let userId: string;
let jobs: JobService;
const engine: Converter = { name: "x", async convert() { return Buffer.from(""); } };

function makeApp(authed = true) {
  const deps: AppDeps = {
    registry: { forFormat: () => engine },
    storage: { put: vi.fn(), get: vi.fn() },
    jobs,
    getSessionUser: async () => (authed ? { id: userId, email: "u@x.c" } : null),
  };
  return buildApp(deps);
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
  for (const f of ["a", "b", "c"]) {
    const j = await jobs.create(userId, base(`${f}.docx`));
    await jobs.markSuccess(j.id, { engine: "g", durationMs: 1, outputKey: `o/${f}` });
  }
  const fail = await jobs.create(userId, base("d.docx"));
  await jobs.markFailed(fail.id, { engine: "g", durationMs: 1, error: "x" });
});
afterAll(() => db.cleanup());

describe("GET /api/stats", () => {
  it("returns counts and success rate", async () => {
    const res = await makeApp().inject({ method: "GET", url: "/api/stats" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 4, success: 3, failed: 1, pending: 0, successRate: 0.75 });
  });

  it("401 without a session", async () => {
    const res = await makeApp(false).inject({ method: "GET", url: "/api/stats" });
    expect(res.statusCode).toBe(401);
  });
});
