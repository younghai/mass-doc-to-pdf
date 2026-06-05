import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupTestDb } from "./test/testDb.js";

let db: ReturnType<typeof setupTestDb>;
beforeAll(() => {
  db = setupTestDb();
});
afterAll(() => db.cleanup());

describe("schema", () => {
  it("persists a user and a conversion job", async () => {
    const u = await db.prisma.user.create({ data: { email: "a@b.c" } });
    const j = await db.prisma.conversionJob.create({
      data: {
        userId: u.id,
        filename: "a.docx",
        format: "office",
        extension: "docx",
        mimeType: "application/...",
        sizeBytes: 10,
        sourceKey: "src/a",
      },
    });
    expect(j.status).toBe("pending");
    expect((await db.prisma.conversionJob.findMany({ where: { userId: u.id } })).length).toBe(1);
  });
});
