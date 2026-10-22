import { describe, expect, it } from "vitest";
import type { Converter, ConvertInput } from "../types.js";
import { QualityFallbackConverter } from "./qualityFallback.js";

const REVIEW_PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n%%EOF\n");
const PASSED_PDF = Buffer.concat([
  Buffer.from("%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n"),
  Buffer.alloc(40 * 1024, " "),
  Buffer.from("\n%%EOF\n"),
]);

class StaticConverter implements Converter {
  constructor(
    readonly name: string,
    private readonly pdf: Buffer,
  ) {}

  async convert(_input: ConvertInput): Promise<Buffer> {
    return this.pdf;
  }
}

class CountingConverter implements Converter {
  calls = 0;
  constructor(
    readonly name: string,
    private readonly pdf: Buffer,
  ) {}

  async convert(_input: ConvertInput): Promise<Buffer> {
    this.calls += 1;
    return this.pdf;
  }
}

class FailingConverter implements Converter {
  constructor(readonly name: string) {}

  async convert(): Promise<Buffer> {
    throw new Error("engine unavailable");
  }
}

describe("QualityFallbackConverter", () => {
  it("keeps trying precise engines when the first success needs review", async () => {
    const converter = new QualityFallbackConverter("hwp-quality-chain", "hwp", "precise", [
      new StaticConverter("rhwp-cli-pdf", REVIEW_PDF),
      new StaticConverter("rhwp", REVIEW_PDF),
      new StaticConverter("h2orestart", PASSED_PDF),
    ]);

    const result = await converter.convertWithReport({
      filename: "form.hwp",
      data: Buffer.alloc(500_000),
    });

    expect(result.report?.selectedEngine).toBe("h2orestart");
    expect(result.report?.status).toBe("passed");
    expect(result.report?.attempts.map((attempt) => attempt.engine)).toEqual([
      "rhwp-cli-pdf",
      "rhwp",
      "h2orestart",
    ]);
  });

  it("returns a review result when every precise engine needs review", async () => {
    const converter = new QualityFallbackConverter("hwp-quality-chain", "hwp", "precise", [
      new StaticConverter("rhwp-cli-pdf", REVIEW_PDF),
    ]);

    const result = await converter.convertWithReport({
      filename: "form.hwp",
      data: Buffer.alloc(500_000),
    });

    expect(result.report?.selectedEngine).toBe("rhwp-cli-pdf");
    expect(result.report?.status).toBe("review");
  });

  it("stops the chain once a failed attempt makes passed unreachable", async () => {
    const builtin = new CountingConverter("builtin-office", PASSED_PDF);
    const converter = new QualityFallbackConverter("hwp-quality-chain", "hwp", "precise", [
      new FailingConverter("rhwp"),
      new StaticConverter("h2orestart", PASSED_PDF),
      builtin,
    ]);

    const result = await converter.convertWithReport({
      filename: "form.hwp",
      data: Buffer.alloc(500_000),
    });

    expect(result.report?.selectedEngine).toBe("h2orestart");
    expect(result.report?.status).toBe("review");
    expect(builtin.calls).toBe(0);
    expect(result.report?.attempts).toEqual([
      expect.objectContaining({ engine: "rhwp", status: "failed" }),
      expect.objectContaining({ engine: "h2orestart", status: "success" }),
    ]);
  });

  it("returns early when only fallback-grade engines remain", async () => {
    const builtin = new CountingConverter("builtin-office", PASSED_PDF);
    const converter = new QualityFallbackConverter("hwp-quality-chain", "hwp", "precise", [
      new StaticConverter("rhwp", REVIEW_PDF),
      builtin,
    ]);

    const result = await converter.convertWithReport({
      filename: "form.hwp",
      data: Buffer.alloc(500_000),
    });

    expect(result.report?.selectedEngine).toBe("rhwp");
    expect(result.report?.status).toBe("review");
    expect(builtin.calls).toBe(0);
  });

  it("keeps trying while an acceptable-grade engine could still pass", async () => {
    const h2orestart = new CountingConverter("h2orestart", PASSED_PDF);
    const converter = new QualityFallbackConverter("hwp-quality-chain", "hwp", "precise", [
      new StaticConverter("rhwp", REVIEW_PDF),
      h2orestart,
    ]);

    const result = await converter.convertWithReport({
      filename: "form.hwp",
      data: Buffer.alloc(500_000),
    });

    expect(result.report?.selectedEngine).toBe("h2orestart");
    expect(result.report?.status).toBe("passed");
    expect(h2orestart.calls).toBe(1);
  });
});
