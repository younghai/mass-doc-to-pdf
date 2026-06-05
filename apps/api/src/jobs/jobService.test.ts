import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestDb } from "../test/testDb.js";
import { JobService, type CreateInput } from "./jobService.js";
import type { DocFormat } from "@hwptopdf/shared";

let db: ReturnType<typeof setupTestDb>;
let svc: JobService;
let userId: string;

const baseInput = (filename: string, format: DocFormat = "office"): CreateInput => ({
  filename,
  format,
  extension: filename.split(".").pop()!,
  mimeType: "application/octet-stream",
  sizeBytes: 123,
  sourceKey: `src/${filename}`,
});

beforeAll(async () => {
  db = setupTestDb();
  svc = new JobService(db.prisma);
  const u = await db.prisma.user.create({ data: { email: "u@x.c" } });
  userId = u.id;
});
afterAll(() => db.cleanup());

describe("JobService", () => {
  it("creates a pending job and lists it as a DTO without storage keys", async () => {
    const job = await svc.create(userId, baseInput("a.hwp", "hwp"));
    expect(job.status).toBe("pending");
    const list = await svc.list(userId, {});
    expect(list[0]).toMatchObject({ id: job.id, filename: "a.hwp", status: "pending" });
    expect(list[0]).not.toHaveProperty("sourceKey");
  });

  it("marks success/failure and computes success rate", async () => {
    const a = await svc.create(userId, baseInput("a.docx"));
    const b = await svc.create(userId, baseInput("b.docx"));
    await svc.markSuccess(a.id, { engine: "gotenberg", durationMs: 900, outputKey: "out/a" });
    await svc.markFailed(b.id, { engine: "gotenberg", durationMs: 200, error: "backend 500" });
    const stats = await svc.stats(userId);
    expect(stats.success).toBeGreaterThanOrEqual(1);
    expect(stats.failed).toBeGreaterThanOrEqual(1);
    expect(stats.successRate).toBeGreaterThan(0);
    expect(stats.successRate).toBeLessThanOrEqual(1);
  });

  it("filters list by status", async () => {
    const failed = await svc.list(userId, { status: "failed" });
    expect(failed.every((j) => j.status === "failed")).toBe(true);
  });

  it("get returns null for another user's job", async () => {
    const other = await db.prisma.user.create({ data: { email: "other@x.c" } });
    const mine = await svc.create(userId, baseInput("mine.docx"));
    expect(await svc.get(other.id, mine.id)).toBeNull();
  });
});
