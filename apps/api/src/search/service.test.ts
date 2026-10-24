import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Readable } from "node:stream";
import { setupTestDb } from "../test/testDb.js";
import { DocumentSearchService } from "./service.js";
import type { ExtractedPdf, PdfTextExtractor } from "./types.js";
import type { ProviderHit, SearchProvider } from "./types.js";

let db: ReturnType<typeof setupTestDb>;
let userId: string;

function fakeExtractor(pages: number): PdfTextExtractor {
  return {
    async extract(): Promise<ExtractedPdf> {
      return {
        totalPages: pages,
        pages: Array.from({ length: pages }, (_, i) => ({ pageNumber: i + 1, text: `page ${i + 1} 내용` })),
        omittedPages: [],
      };
    },
  };
}

function fakeProvider(scope = "test-scope"): SearchProvider {
  return {
    scope,
    async checkConfiguration() {},
    async ensureItem(key: string) { return { id: `item-${key}` }; },
    async itemStatus() { return "ready" as const; },
    async deleteKey() {},
    async search(input: { query: string }): Promise<readonly ProviderHit[]> {
      return [{ key: "k", text: input.query, score: 1 }];
    },
    async answer() { return "답 [S1]"; },
  };
}

function storageStub(pdfBytes: Uint8Array) {
  return {
    async put() {},
    async get() { return pdfBytes; },
    async delete() {},
    getStream() { return Promise.resolve(Readable.from([pdfBytes])); },
  };
}

beforeAll(async () => {
  db = setupTestDb();
  const u = await db.prisma.user.create({ data: { email: "search@x.c" } });
  userId = u.id;
});
afterAll(() => db.cleanup());

async function seedSuccessfulJob(outputKey: string) {
  const job = await db.prisma.conversionJob.create({
    data: {
      userId,
      filename: "doc.hwp",
      format: "hwp",
      extension: "hwp",
      mimeType: "application/x-hwp",
      sizeBytes: 10,
      sourceKey: `${userId}/src/x.hwp`,
      status: "success",
      qualityStatus: "passed",
      outputKey,
    },
  });
  return job.id;
}

describe("DocumentSearchService.runOnce", () => {
  it("bulk-writes extracted pages in one pass and reports work", async () => {
    const jobId = await seedSuccessfulJob(`${userId}/out/${Date.now()}-1.pdf`);
    const service = new DocumentSearchService(
      db.prisma,
      storageStub(new TextEncoder().encode("%PDF-1.7")),
      fakeExtractor(3),
      fakeProvider(),
    );

    const registered = await service.register(userId, jobId, false);
    expect(registered.status).toBe("queued");

    const worked = await service.runOnce();
    expect(worked).toBe(true);

    const pages = await db.prisma.searchPage.findMany({ where: { jobId }, orderBy: { pageNumber: "asc" } });
    expect(pages).toHaveLength(3);
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);
    const doc = await db.prisma.searchDocument.findUnique({ where: { jobId } });
    expect(doc?.status).toBe("indexing");
    expect(doc?.totalPages).toBe(3);
  });

  it("replaces pages wholesale on re-extract (no duplicates)", async () => {
    const jobId = await seedSuccessfulJob(`${userId}/out/${Date.now()}-2.pdf`);
    const service = new DocumentSearchService(
      db.prisma,
      storageStub(new TextEncoder().encode("%PDF-1.7")),
      fakeExtractor(2),
      fakeProvider(),
    );
    await service.register(userId, jobId, false);
    expect(await service.runOnce()).toBe(true);
    // Simulate a re-extract with a different page count: bulk rewrite must not
    // leave stale rows behind the way a naive append would.
    await db.prisma.searchDocument.update({ where: { jobId }, data: { status: "queued" } });
    const reService = new DocumentSearchService(
      db.prisma,
      storageStub(new TextEncoder().encode("%PDF-1.7")),
      fakeExtractor(5),
      fakeProvider(),
    );
    expect(await reService.runOnce()).toBe(true);
    const pages = await db.prisma.searchPage.findMany({ where: { jobId } });
    expect(pages).toHaveLength(5);
  });

  it("returns false when there is nothing to do", async () => {
    // Neutralize docs left active by the earlier tests in this shared DB.
    await db.prisma.searchDocument.updateMany({ data: { status: "ready" } });
    const service = new DocumentSearchService(
      db.prisma,
      storageStub(new TextEncoder().encode("%PDF-1.7")),
      fakeExtractor(1),
      fakeProvider(),
    );
    expect(await service.runOnce()).toBe(false);
  });
});
