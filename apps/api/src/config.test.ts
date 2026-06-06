import { describe, it, expect } from "vitest";
import { loadEngineConfig, loadAppConfig } from "./config.js";

describe("loadEngineConfig", () => {
  it("reads defaults for the free backends", () => {
    const cfg = loadEngineConfig({});
    expect(cfg.gotenbergUrl).toBe("http://localhost:3000");
    expect(cfg.hwpSidecarUrl).toBe("http://localhost:8080");
    expect(cfg.officeEngine).toBe("gotenberg");
    expect(cfg.hancom).toBeUndefined();
    expect(cfg.aspose).toBeUndefined();
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
});
