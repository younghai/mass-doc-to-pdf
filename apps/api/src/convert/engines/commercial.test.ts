import { describe, it, expect } from "vitest";
import { HancomConverter } from "./hancom.js";
import { AsposeConverter } from "./aspose.js";
import { ConversionError } from "../types.js";

describe("commercial adapters (no credentials)", () => {
  it("HancomConverter throws a configuration ConversionError when unconfigured", async () => {
    const conv = new HancomConverter({ baseUrl: "", apiKey: "" });
    await expect(
      conv.convert({ filename: "a.hwp", data: Buffer.from("x") }),
    ).rejects.toMatchObject({ name: "ConversionError", engine: "hancom" });
  });

  it("AsposeConverter throws a configuration ConversionError when unconfigured", async () => {
    const conv = new AsposeConverter({ baseUrl: "", clientId: "", clientSecret: "" });
    await expect(
      conv.convert({ filename: "a.docx", data: Buffer.from("x") }),
    ).rejects.toBeInstanceOf(ConversionError);
  });

  const hancomConfigured = !!process.env.HANCOM_BASE_URL && !!process.env.HANCOM_API_KEY;
  (hancomConfigured ? it : it.skip)("Hancom converts a real HWP when configured", async () => {
    const conv = new HancomConverter({
      baseUrl: process.env.HANCOM_BASE_URL!,
      apiKey: process.env.HANCOM_API_KEY!,
    });
    const out = await conv.convert({ filename: "sample.hwp", data: Buffer.from("...") });
    expect(out.subarray(0, 4).toString()).toBe("%PDF");
  });
});
