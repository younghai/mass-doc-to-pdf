import { describe, it, expect, vi } from "vitest";
import { buildApp, type AppDeps } from "./app.js";
import type { JobService } from "./jobs/jobService.js";
import type { Converter } from "./convert/types.js";

const engine: Converter = { name: "x", async convert() { return Buffer.from(""); } };

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
});
