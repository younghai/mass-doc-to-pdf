import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { buildApp, type AppDeps } from "./app.js";
import { JobService } from "./jobs/jobService.js";
import type { Converter } from "./convert/types.js";
import { multipartPayload } from "./test/multipart.js";
import { setupTestDb } from "./test/testDb.js";

const engine: Converter = { name: "x", async convert() { return Buffer.from(""); } };
let db: ReturnType<typeof setupTestDb>;
let userId: string;

beforeAll(async () => {
  db = setupTestDb();
  const user = await db.prisma.user.create({ data: { email: "u@x.c" } });
  userId = user.id;
});

afterAll(() => db.cleanup());

function makeApp(rateLimitMax: number) {
  const deps: AppDeps = {
    registry: { forFormat: () => engine },
    storage: { put: vi.fn(), get: vi.fn(), delete: vi.fn() },
    jobs: {} as JobService,
    webOrigin: "http://localhost",
    rateLimitMax,
    getSessionUser: async () => null,
  };
  return buildApp(deps);
}

function makeConvertApp() {
  const convertEngine: Converter = { name: "gotenberg", convert: async () => new Promise<Buffer>(() => {}) };
  const deps: AppDeps = {
    registry: { forFormat: () => convertEngine },
    storage: { put: vi.fn(async () => {}), get: vi.fn(), delete: vi.fn() },
    jobs: new JobService(db.prisma),
    pdfPreview: { renderFirstPagePng: vi.fn(async () => Buffer.from("\x89PNG")) },
    webOrigin: "http://localhost",
    rateLimitMax: 100,
    getSessionUser: async () => ({ id: userId, email: "u@x.c" }),
  };
  return buildApp(deps);
}

function multipartPayloadWithFieldCount(fieldCount: number) {
  const boundary = "----testboundary";
  const chunks: Buffer[] = [];
  for (let i = 0; i < fieldCount; i += 1) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="field${i}"\r\n\r\nx\r\n`));
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="r.docx"\r\n` +
        "Content-Type: application/octet-stream\r\n\r\n",
    ),
    Buffer.from("docbytes"),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return { body: Buffer.concat(chunks), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

describe("per-IP rate limiting", () => {
  it("returns 429 once the per-minute ceiling is exceeded", async () => {
    const app = makeApp(3);
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({ method: "GET", url: "/api/stats" });
      expect(res.statusCode).toBe(401); // under the limit: auth rejects, limiter does not
    }
    const res = await app.inject({ method: "GET", url: "/api/stats" });
    expect(res.statusCode).toBe(429);
  });

  it("never limits /health so container healthchecks cannot starve", async () => {
    const app = makeApp(1);
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
    }
  });

  it("keys forwarded requests by the trusted hop instead of spoofed leftmost XFF entries", async () => {
    const app = makeApp(3);
    const spoofedChains = [
      "198.51.100.10, 203.0.113.77",
      "198.51.100.11, 203.0.113.77",
      "198.51.100.12, 203.0.113.77",
    ];
    for (const forwardedFor of spoofedChains) {
      const res = await app.inject({ method: "GET", url: "/api/stats", headers: { "x-forwarded-for": forwardedFor } });
      expect(res.statusCode).toBe(401);
    }

    const res = await app.inject({
      method: "GET",
      url: "/api/stats",
      headers: { "x-forwarded-for": "198.51.100.13, 203.0.113.77" },
    });

    expect(res.statusCode).toBe(429);
  });
});

describe("multipart request limits", () => {
  it("accepts a normal single-file conversion request", async () => {
    const app = makeConvertApp();
    const { body, headers } = multipartPayload("r.docx", Buffer.from("docbytes"));

    const res = await app.inject({ method: "POST", url: "/api/convert", headers, payload: body });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ filename: "r.docx", status: "running" });
  });

  it("rejects multipart requests with more than twelve parts", async () => {
    const app = makeConvertApp();
    const beforeCount = await db.prisma.conversionJob.count();
    const { body, headers } = multipartPayloadWithFieldCount(12);

    const res = await app.inject({ method: "POST", url: "/api/convert", headers, payload: body });

    expect(res.statusCode).toBe(413);
    await expect(db.prisma.conversionJob.count()).resolves.toBe(beforeCount);
  });
});

describe("GET /health/engines", () => {
  it("returns the injected preflight, live network probes, and chain names", async () => {
    const deps: AppDeps = {
      registry: { forFormat: () => engine },
      storage: { put: vi.fn(), get: vi.fn(), delete: vi.fn() },
      jobs: {} as JobService,
      webOrigin: "http://localhost",
      enginePreflight: {
        rhwp: { available: false, reason: "ModuleNotFoundError: No module named 'rhwp'" },
        rhwpCli: { available: false, reason: "binary not found: rhwp" },
        builtin: { available: false, reason: "google chrome/chromium not found" },
      },
      // 127.0.0.1:1 refuses immediately (ECONNREFUSED), so the live probe
      // resolves to unavailable fast without a real backend.
      engineEndpoints: { hwpSidecarUrl: "http://127.0.0.1:1", gotenbergUrl: "http://127.0.0.1:1" },
      getSessionUser: async () => null,
    };
    const app = buildApp(deps);
    const res = await app.inject({ method: "GET", url: "/health/engines" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.preflight.rhwp.available).toBe(false);
    expect(body.live.sidecar.available).toBe(false);
    expect(body.live.gotenberg.available).toBe(false);
    expect(Array.isArray(body.chains.hwpPrecise)).toBe(true);
    expect(body.chains.hwpPrecise).toEqual(["x"]);
  });
});
