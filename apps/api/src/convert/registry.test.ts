import { describe, it, expect } from "vitest";
import { QualityFallbackConverter } from "./engines/qualityFallback.js";
import { buildRegistry, type EngineConfig } from "./registry.js";

describe("buildRegistry", () => {
  const base: EngineConfig = {
    gotenbergUrl: "http://g",
    hwpSidecarUrl: "http://h",
    officeEngine: "gotenberg",
    rhwp: { enabled: true, pythonPath: "python3", timeoutMs: 120_000 },
    rhwpCli: {
      enabled: false,
      cliPath: "rhwp",
      timeoutMs: 120_000,
      fontPaths: [],
      mode: "pdf",
    },
  };
  it("defaults office->gotenberg, hwp->quality fallback chain", () => {
    const r = buildRegistry(base);
    expect(r.forFormat("office").name).toBe("gotenberg");
    expect(r.forFormat("hwp").name).toBe("hwp-quality-chain");
  });
  it("uses commercial engines inside the precise HWP chain when configured", () => {
    const r = buildRegistry({
      ...base,
      hancom: { baseUrl: "h", apiKey: "k" },
      aspose: { baseUrl: "a", clientId: "c", clientSecret: "s" },
    });
    expect(r.forFormat("hwp").name).toBe("hwp-quality-chain");
    expect(r.forFormat("office").name).toBe("aspose");
  });
  it("supports a quick HWP mode for throughput-first batches", () => {
    const r = buildRegistry(base);
    expect(r.forFormat("hwp", { qualityMode: "quick" }).name).toBe("hwp-quick-chain");
  });
  it("places the rhwp Rust CLI renderer before the Python rhwp worker in precise mode", () => {
    const c = buildRegistry(base).forFormat("hwp");
    expect(c).toBeInstanceOf(QualityFallbackConverter);
    if (c instanceof QualityFallbackConverter) {
      expect(c.engineNames()).toEqual([
        "rhwp-cli-pdf",
        "rhwp",
        "h2orestart",
        "builtin-office",
      ]);
    }
  });
  it("adds the optional visual-preservation raster attempt after rhwp CLI PDF", () => {
    const c = buildRegistry({ ...base, rhwpCli: { ...base.rhwpCli, mode: "raster" } }).forFormat("hwp");
    expect(c).toBeInstanceOf(QualityFallbackConverter);
    if (c instanceof QualityFallbackConverter) {
      expect(c.engineNames()).toEqual([
        "rhwp-cli-pdf",
        "rhwp-cli-raster",
        "rhwp",
        "h2orestart",
        "builtin-office",
      ]);
    }
  });
  it("can route office documents to the LibreOffice sidecar for standalone deployment", () => {
    const r = buildRegistry({ ...base, officeEngine: "hwp-sidecar" });
    expect(r.forFormat("office").name).toBe("h2orestart");
    expect(r.forFormat("hwp").name).toBe("hwp-quality-chain");
  });
  it("routes precise office documents through a quality-gated chain when builtin is configured", () => {
    const r = buildRegistry({ ...base, officeEngine: "builtin" });
    expect(r.forFormat("office").name).toBe("office-quality-chain");
  });
  it("can route quick office documents to the builtin source-only converter", () => {
    const r = buildRegistry({ ...base, officeEngine: "builtin" });
    expect(r.forFormat("office", { qualityMode: "quick" }).name).toBe("builtin-office");
  });
  it("routes hwp documents through the quality fallback chain when sidecar is not used", () => {
    const r = buildRegistry({ ...base, officeEngine: "builtin" });
    expect(r.forFormat("hwp").name).toBe("hwp-quality-chain");
  });
  it("accepts overrides for tests", () => {
    const fake = { name: "FAKE", async convert() { return Buffer.from("x"); } };
    expect(buildRegistry(base, { office: fake }).forFormat("office").name).toBe("FAKE");
  });
});
