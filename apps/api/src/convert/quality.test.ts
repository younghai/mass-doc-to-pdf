import { describe, expect, it } from "vitest";
import { buildQualityReport } from "./quality.js";

const MINIMAL_PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n%%EOF\n");

describe("buildQualityReport", () => {
  it("marks very small rhwp-cli HWP PDFs for manual review", () => {
    const report = buildQualityReport({
      jobId: "job-1",
      filename: "form.hwp",
      format: "hwp",
      mode: "precise",
      selectedEngine: "rhwp-cli-pdf",
      pdf: MINIMAL_PDF,
      sourceBytes: 500_000,
      attempts: [{ engine: "rhwp-cli-pdf", status: "success", durationMs: 10 }],
      warnings: [],
      createdAt: "2026-06-08T00:00:00.000Z",
    });

    expect(report.grade).toBe("good");
    expect(report.status).toBe("review");
    expect(report.warnings).toContain("rhwp_small_pdf_review");
    expect(report.warnings).toContain("rhwp_low_bytes_per_page_review");
  });

  it("marks very small Python rhwp HWP PDFs for manual review", () => {
    const report = buildQualityReport({
      jobId: "job-2",
      filename: "form.hwp",
      format: "hwp",
      mode: "precise",
      selectedEngine: "rhwp",
      pdf: MINIMAL_PDF,
      sourceBytes: 500_000,
      attempts: [{ engine: "rhwp", status: "success", durationMs: 10 }],
      warnings: [],
      createdAt: "2026-06-08T00:00:00.000Z",
    });

    expect(report.status).toBe("review");
    expect(report.warnings).toContain("rhwp_small_pdf_review");
    expect(report.warnings).toContain("rhwp_low_bytes_per_page_review");
  });
});
