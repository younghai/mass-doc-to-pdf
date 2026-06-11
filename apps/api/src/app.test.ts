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
