import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { setupTestDb } from "../test/testDb.js";
import { multipartPayload } from "../test/multipart.js";
import { buildApp, type AppDeps } from "../app.js";
import { JobService } from "../jobs/jobService.js";
import { ConversionError, type Converter } from "../convert/types.js";

let db: ReturnType<typeof setupTestDb>;
let userId: string;

beforeAll(async () => {
  db = setupTestDb();
  const u = await db.prisma.user.create({ data: { email: "u@x.c" } });
  userId = u.id;
});
afterAll(() => db.cleanup());

function makeApp(engine: Converter, authed = true) {
  const storage = {
    put: vi.fn(async () => {}),
    get: vi.fn(async () => new Uint8Array()),
  };
  const deps: AppDeps = {
    registry: { forFormat: () => engine },
    storage,
    jobs: new JobService(db.prisma),
    getSessionUser: async () => (authed ? { id: userId, email: "u@x.c" } : null),
  };
  return { app: buildApp(deps), storage };
}

describe("POST /api/convert", () => {
  it("converts a DOCX, stores source+output, records success", async () => {
    const engine: Converter = { name: "gotenberg", async convert() { return Buffer.from("%PDF-1.7"); } };
    const { app, storage } = makeApp(engine);
    const { body, headers } = multipartPayload("r.docx", Buffer.from("docbytes"));
    const res = await app.inject({ method: "POST", url: "/api/convert", headers, payload: body });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ filename: "r.docx", status: "success", engine: "gotenberg" });
    expect(storage.put).toHaveBeenCalledTimes(2);
  });

  it("records a failed job when the engine throws", async () => {
    const engine: Converter = {
      name: "gotenberg",
      async convert() { throw new ConversionError("gotenberg", "backend 500"); },
    };
    const { app } = makeApp(engine);
    const { body, headers } = multipartPayload("r.docx", Buffer.from("x"));
    const res = await app.inject({ method: "POST", url: "/api/convert", headers, payload: body });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: "failed", error: expect.stringMatching(/backend/) });
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
