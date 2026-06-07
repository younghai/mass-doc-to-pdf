import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { setupTestDb } from "../test/testDb.js";
import { multipartPayload } from "../test/multipart.js";
import { buildApp, type AppDeps } from "../app.js";
import { JobService } from "../jobs/jobService.js";
import {
  ConversionError,
  type Converter,
  type ReportingConverter,
  type ConversionResult,
} from "../convert/types.js";

let db: ReturnType<typeof setupTestDb>;
let userId: string;

beforeAll(async () => {
  db = setupTestDb();
  const u = await db.prisma.user.create({ data: { email: "u@x.c" } });
  userId = u.id;
});
afterAll(() => db.cleanup());

function makeApp(engine: Converter, authed = true) {
  const put = vi.fn(async (_key: string, _body: Buffer, _contentType: string) => {});
  const get = vi.fn(async (_key: string) => new Uint8Array());
  const forFormat = vi.fn(() => engine);
  const storage = {
    put,
    get,
  };
  const deps: AppDeps = {
    registry: { forFormat },
    storage,
    jobs: new JobService(db.prisma),
    getSessionUser: async () => (authed ? { id: userId, email: "u@x.c" } : null),
  };
  return { app: buildApp(deps), storage, forFormat };
}

function deferred<T>() {
  let resolveValue: (value: T) => void = () => {};
  let rejectValue: (reason: Error) => void = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });
  return { promise, resolve: resolveValue, reject: rejectValue };
}

async function waitForJob(id: string, status: string) {
  for (let i = 0; i < 20; i += 1) {
    const raw = await db.prisma.conversionJob.findUnique({ where: { id } });
    if (raw?.status === status) return raw;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`job ${id} did not reach ${status}`);
}

describe("POST /api/convert", () => {
  it("returns a running DOCX job, then stores output and records success", async () => {
    const output = deferred<Buffer>();
    const engine: Converter = { name: "gotenberg", convert: async () => output.promise };
    const { app, storage } = makeApp(engine);
    const { body, headers } = multipartPayload("r.docx", Buffer.from("docbytes"));
    const res = await app.inject({ method: "POST", url: "/api/convert", headers, payload: body });
    expect(res.statusCode).toBe(202);
    const running = res.json() as { id: string };
    expect(running).toMatchObject({ filename: "r.docx", status: "running", engine: "gotenberg" });
    expect(storage.put).toHaveBeenCalledTimes(1);
    output.resolve(Buffer.from("%PDF-1.7"));
    await waitForJob(running.id, "success");
    expect(storage.put).toHaveBeenCalledTimes(3);
  });

  it("stores a quality report when the converter provides one", async () => {
    const output = deferred<ConversionResult>();
    const engine: ReportingConverter = {
      name: "hwp-quality-chain",
      convert: async (input) => (await output.promise).pdf,
      convertWithReport: async () => output.promise,
    };
    const { app, storage } = makeApp(engine);
    const { body, headers } = multipartPayload("r.docx", Buffer.from("docbytes"));

    const res = await app.inject({ method: "POST", url: "/api/convert", headers, payload: body });

    expect(res.statusCode).toBe(202);
    const running = res.json() as { id: string };
    output.resolve({
      pdf: Buffer.from("%PDF-1.7"),
      report: {
        version: 1,
        jobId: running.id,
        filename: "r.docx",
        format: "office",
        selectedEngine: "rhwp",
        grade: "good",
        checks: { pdfBytes: 8, pageCount: 1 },
        attempts: [{ engine: "rhwp", status: "success", durationMs: 10 }],
        warnings: [],
        createdAt: new Date(2026, 0, 1).toISOString(),
      },
    });
    await waitForJob(running.id, "success");
    const reportPut = vi
      .mocked(storage.put)
      .mock.calls.find(([key]) => key === `${userId}/report/${running.id}.json`);
    expect(reportPut?.[2]).toBe("application/json");
  });

  it("marks precise office fallback output as failed instead of downloadable success", async () => {
    const output = deferred<ConversionResult>();
    const engine: ReportingConverter = {
      name: "office-quality-chain",
      convert: async () => (await output.promise).pdf,
      convertWithReport: async () => output.promise,
    };
    const { app, storage } = makeApp(engine);
    const { body, headers } = multipartPayload("deck.pptx", Buffer.from("pptbytes"));

    const res = await app.inject({ method: "POST", url: "/api/convert", headers, payload: body });

    expect(res.statusCode).toBe(202);
    const running = res.json() as { id: string };
    output.resolve({
      pdf: Buffer.from("%PDF-1.7 text-only"),
      report: {
        version: 1,
        jobId: running.id,
        filename: "deck.pptx",
        format: "office",
        mode: "precise",
        selectedEngine: "builtin-office",
        grade: "fallback",
        status: "review",
        recommendedAction: "원본과 첫 페이지를 비교하고 정밀 변환으로 재시도하세요.",
        checks: { pdfBytes: 18, pageCount: 1 },
        attempts: [{ engine: "builtin-office", status: "success", durationMs: 10 }],
        warnings: [],
        createdAt: new Date(2026, 0, 1).toISOString(),
      },
    });

    const failed = await waitForJob(running.id, "failed");
    expect(failed?.engine).toBe("builtin-office");
    expect(failed?.error).toMatch(/품질 게이트 실패/);
    expect(
      vi.mocked(storage.put).mock.calls.some(([key]) => key === `${userId}/out/${running.id}.pdf`),
    ).toBe(false);
  });

  it("passes the requested quality mode to the registry", async () => {
    const output = deferred<Buffer>();
    const engine: Converter = { name: "hwp-quality-chain", convert: async () => output.promise };
    const { app, forFormat } = makeApp(engine);
    const hwpOleHeader = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]);
    const { body, headers } = multipartPayload("sample.hwp", hwpOleHeader);

    const res = await app.inject({
      method: "POST",
      url: "/api/convert?qualityMode=quick",
      headers,
      payload: body,
    });

    expect(res.statusCode).toBe(202);
    expect(forFormat).toHaveBeenCalledWith("hwp", { qualityMode: "quick" });
    output.resolve(Buffer.from("%PDF-1.7"));
    const running = res.json() as { id: string };
    await waitForJob(running.id, "success");
  });

  it("returns a running job, then records failure when the engine throws", async () => {
    const engine: Converter = {
      name: "gotenberg",
      async convert() { throw new ConversionError("gotenberg", "backend 500"); },
    };
    const { app } = makeApp(engine);
    const { body, headers } = multipartPayload("r.docx", Buffer.from("x"));
    const res = await app.inject({ method: "POST", url: "/api/convert", headers, payload: body });
    expect(res.statusCode).toBe(202);
    const running = res.json() as { id: string };
    expect(running).toMatchObject({ status: "running" });
    const failed = await waitForJob(running.id, "failed");
    expect(failed?.error).toMatch(/backend/);
  });

  it("stores long Korean HWP filenames under a bounded object key", async () => {
    const output = deferred<Buffer>();
    const engine: Converter = { name: "builtin-office", convert: async () => output.promise };
    const { app, storage } = makeApp(engine);
    const filename = `${"붙임_인공지능_전환_컨설팅_지원사업_참여기업_모집_재공고문_".repeat(8)}.hwp`;
    const hwpOleHeader = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]);
    const { body, headers } = multipartPayload(filename, hwpOleHeader);

    const res = await app.inject({ method: "POST", url: "/api/convert", headers, payload: body });

    expect(res.statusCode).toBe(202);
    const running = res.json() as { id: string; filename: string };
    expect(running.filename).toBe(filename);
    const sourceKey = vi.mocked(storage.put).mock.calls[0]?.[0];
    expect(sourceKey).toMatch(new RegExp(`^${userId}/src/\\d+-[a-f0-9-]+\\.hwp$`));
    expect(sourceKey.length).toBeLessThan(120);
    output.resolve(Buffer.from("%PDF-1.7"));
    await waitForJob(running.id, "success");
  });

  it("returns 400 for unsupported extension", async () => {
    const engine: Converter = { name: "x", async convert() { return Buffer.from("x"); } };
    const { app } = makeApp(engine);
    const { body, headers } = multipartPayload("photo.png", Buffer.from("x"));
    const res = await app.inject({ method: "POST", url: "/api/convert", headers, payload: body });
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a session", async () => {
    const engine: Converter = { name: "x", async convert() { return Buffer.from("x"); } };
    const { app } = makeApp(engine, false);
    const { body, headers } = multipartPayload("r.docx", Buffer.from("x"));
    const res = await app.inject({ method: "POST", url: "/api/convert", headers, payload: body });
    expect(res.statusCode).toBe(401);
  });
});
