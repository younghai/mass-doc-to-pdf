import { describe, it, expect, vi } from "vitest";
import { loadEngineConfig, loadAppConfig } from "./config.js";

describe("loadEngineConfig", () => {
  it("reads defaults for the free backends", () => {
    const cfg = loadEngineConfig({});
    expect(cfg.gotenbergUrl).toBe("http://localhost:3000");
    expect(cfg.hwpSidecarUrl).toBe("http://localhost:8080");
    expect(cfg.officeEngine).toBe("gotenberg");
    expect(cfg.rhwp).toEqual({ enabled: true, pythonPath: "python3", timeoutMs: 120_000 });
    expect(cfg.rhwpCli).toEqual({
      enabled: false,
      cliPath: "rhwp",
      timeoutMs: 120_000,
      fontPaths: [],
      mode: "pdf",
    });
    expect(cfg.hancom).toBeUndefined();
    expect(cfg.aspose).toBeUndefined();
  });

  it("reads rhwp Rust CLI renderer config", () => {
    const cfg = loadEngineConfig({
      RHWP_CLI_ENABLED: "1",
      RHWP_CLI_PATH: "/opt/rhwp/bin/rhwp",
      RHWP_CLI_TIMEOUT_MS: "180000",
      RHWP_FONT_PATHS: "/opt/fonts/hwp:/opt/fonts/nanum",
    });
    expect(cfg.rhwpCli).toEqual({
      enabled: true,
      cliPath: "/opt/rhwp/bin/rhwp",
      timeoutMs: 180_000,
      fontPaths: ["/opt/fonts/hwp", "/opt/fonts/nanum"],
      mode: "pdf",
    });
  });

  it("falls back to pdf and emits a warning when RHWP_CLI_VISUAL_MODE=raster is requested", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cfg = loadEngineConfig({ RHWP_CLI_VISUAL_MODE: "raster" });
    expect(cfg.rhwpCli.mode).toBe("pdf");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("raster"));
    warn.mockRestore();
  });

  it("reads rhwp worker config", () => {
    const cfg = loadEngineConfig({
      RHWP_ENABLED: "0",
      RHWP_PYTHON: "/opt/rhwp/bin/python",
      RHWP_WORKER_SCRIPT: "/srv/rhwp_worker.py",
      RHWP_TIMEOUT_MS: "90000",
    });
    expect(cfg.rhwp).toEqual({
      enabled: false,
      pythonPath: "/opt/rhwp/bin/python",
      workerScript: "/srv/rhwp_worker.py",
      timeoutMs: 90_000,
    });
  });

  it("routes office conversion to the sidecar when configured for standalone mode", () => {
    const cfg = loadEngineConfig({ OFFICE_ENGINE: "hwp-sidecar" });
    expect(cfg.officeEngine).toBe("hwp-sidecar");
  });

  it("routes office conversion to the builtin engine for source-only deployments", () => {
    const cfg = loadEngineConfig({ OFFICE_ENGINE: "builtin" });
    expect(cfg.officeEngine).toBe("builtin");
  });

  it("includes commercial config only when fully specified", () => {
    const cfg = loadEngineConfig({
      HANCOM_BASE_URL: "http://hancom",
      HANCOM_API_KEY: "k",
      ASPOSE_BASE_URL: "http://aspose",
      ASPOSE_CLIENT_ID: "c",
      // ASPOSE_CLIENT_SECRET missing -> aspose stays undefined
    });
    expect(cfg.hancom).toEqual({ baseUrl: "http://hancom", apiKey: "k" });
    expect(cfg.aspose).toBeUndefined();
  });
});

describe("loadAppConfig", () => {
  it("composes engines + s3 + auth + webOrigin with defaults", () => {
    const cfg = loadAppConfig({ AUTH_SECRET: "s" });
    expect(cfg.engines.gotenbergUrl).toBe("http://localhost:3000");
    expect(cfg.s3.bucket).toBe("hwptopdf");
    expect(cfg.storage).toEqual({ kind: "s3" });
    expect(cfg.webOrigin).toBe("http://localhost:5173");
    expect(cfg.auth.secret).toBe("s");
    expect(cfg.auth.devAuth).toBe(false);
  });

  it("uses local file storage when configured for source-only deployment", () => {
    const cfg = loadAppConfig({
      AUTH_SECRET: "s",
      STORAGE_DRIVER: "local",
      LOCAL_STORAGE_ROOT: "/srv/hwptopdf/objects",
    });
    expect(cfg.storage).toEqual({ kind: "local", root: "/srv/hwptopdf/objects" });
  });

  it("enables local operations auth when DEV_AUTH=1", () => {
    const cfg = loadAppConfig({ AUTH_SECRET: "s", DEV_AUTH: "1" });
    expect(cfg.auth.devAuth).toBe(true);
  });

  it("throws when AUTH_SECRET is missing", () => {
    expect(() => loadAppConfig({})).toThrow(/AUTH_SECRET/);
  });

  it("refuses DEV_AUTH=1 in production without ALLOW_DEV_AUTH", () => {
    expect(() =>
      loadAppConfig({ AUTH_SECRET: "s", NODE_ENV: "production", DEV_AUTH: "1" }),
    ).toThrow(/DEV_AUTH/);
  });

  it("allows DEV_AUTH=1 in production when ALLOW_DEV_AUTH=1", () => {
    const cfg = loadAppConfig({
      AUTH_SECRET: "s",
      NODE_ENV: "production",
      DEV_AUTH: "1",
      ALLOW_DEV_AUTH: "1",
    });
    expect(cfg.auth.devAuth).toBe(true);
  });

  it("refuses production Google OAuth when operation login is not ready", () => {
    expect(() =>
      loadAppConfig({
        AUTH_SECRET: "s",
        NODE_ENV: "production",
        DEV_AUTH: "0",
        WEB_ORIGIN: "http://172.19.1.151:8081",
      }),
    ).toThrow(/Google OAuth operation login is not ready/);
  });
});
