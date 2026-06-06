import { describe, it, expect } from "vitest";
import { buildRegistry, type EngineConfig } from "./registry.js";

describe("buildRegistry", () => {
  const base: EngineConfig = {
    gotenbergUrl: "http://g",
    hwpSidecarUrl: "http://h",
    officeEngine: "gotenberg",
  };
  it("defaults office->gotenberg, hwp->h2orestart", () => {
    const r = buildRegistry(base);
    expect(r.forFormat("office").name).toBe("gotenberg");
    expect(r.forFormat("hwp").name).toBe("h2orestart");
  });
  it("prefers commercial when configured", () => {
    const r = buildRegistry({
      ...base,
      hancom: { baseUrl: "h", apiKey: "k" },
      aspose: { baseUrl: "a", clientId: "c", clientSecret: "s" },
    });
    expect(r.forFormat("hwp").name).toBe("hancom");
    expect(r.forFormat("office").name).toBe("aspose");
  });
  it("can route office documents to the LibreOffice sidecar for standalone deployment", () => {
    const r = buildRegistry({ ...base, officeEngine: "hwp-sidecar" });
    expect(r.forFormat("office").name).toBe("h2orestart");
    expect(r.forFormat("hwp").name).toBe("h2orestart");
  });
  it("can route office documents to the builtin source-only converter", () => {
    const r = buildRegistry({ ...base, officeEngine: "builtin" });
    expect(r.forFormat("office").name).toBe("builtin-office");
  });
  it("accepts overrides for tests", () => {
    const fake = { name: "FAKE", async convert() { return Buffer.from("x"); } };
    expect(buildRegistry(base, { office: fake }).forFormat("office").name).toBe("FAKE");
  });
});
