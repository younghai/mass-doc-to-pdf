import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildQualityReport, pdfPageCount, pdfTextChars } from "./quality.js";

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

  it("flags rhwp HWP PDFs with a page but no text layer for manual review", () => {
    const imageOnlyPdf = Buffer.concat([
      Buffer.from("%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n"),
      Buffer.alloc(40 * 1024, " "),
      Buffer.from("\n%%EOF\n"),
    ]);
    const report = buildQualityReport({
      jobId: "job-3",
      filename: "scan.hwp",
      format: "hwp",
      mode: "precise",
      selectedEngine: "rhwp-cli-pdf",
      pdf: imageOnlyPdf,
      sourceBytes: 500_000,
      attempts: [{ engine: "rhwp-cli-pdf", status: "success", durationMs: 10 }],
      warnings: [],
      createdAt: "2026-06-08T00:00:00.000Z",
    });

    expect(report.checks.textChars).toBe(0);
    expect(report.warnings).toContain("pdf_text_empty_review");
    expect(report.status).toBe("review");
  });
});

describe("pdfPageCount", () => {
  it("ignores the Outlines /Count and reads the /Type /Pages /Count", () => {
    const pdf = Buffer.from(
      "%PDF-1.5\n" +
        "1 0 obj << /Type /Outlines /Count 99 >> endobj\n" +
        "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 3 >> endobj\n" +
        "%%EOF\n",
    );
    expect(pdfPageCount(pdf)).toBe(3);
  });

  it("matches /Count when it precedes /Type /Pages in the dictionary", () => {
    const pdf = Buffer.from("%PDF-1.5\n1 0 obj << /Count 4 /Type /Pages >> endobj\n%%EOF\n");
    expect(pdfPageCount(pdf)).toBe(4);
  });
});

describe("pdfTextChars", () => {
  it("returns undefined for non-PDF buffers", () => {
    expect(pdfTextChars(Buffer.from("not a pdf"))).toBeUndefined();
  });

  it("counts glyphs in an uncompressed literal Tj show", () => {
    const pdf = Buffer.from("%PDF-1.4\nBT (Hello) Tj ET\n%%EOF\n");
    expect(pdfTextChars(pdf)).toBe(5);
  });

  it("counts literals inside a TJ kerning array", () => {
    const pdf = Buffer.from("%PDF-1.4\nBT [(He) -120 (llo)] TJ ET\n%%EOF\n");
    expect(pdfTextChars(pdf)).toBe(5);
  });

  it("counts 2-byte CID glyphs in a hex show", () => {
    const pdf = Buffer.from("%PDF-1.4\nBT <00480065> Tj ET\n%%EOF\n");
    expect(pdfTextChars(pdf)).toBe(2);
  });

  it("counts glyphs inside a FlateDecode content stream", () => {
    const stream = deflateSync(Buffer.from("BT (Hi) Tj ET"));
    const pdf = Buffer.concat([
      Buffer.from("%PDF-1.5\n1 0 obj << /Length 12 >>\nstream\n"),
      stream,
      Buffer.from("\nendstream\nendobj\n%%EOF\n"),
    ]);
    expect(pdfTextChars(pdf)).toBe(2);
  });
});
