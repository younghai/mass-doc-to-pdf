import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ExtractedPdf, PdfTextExtractor } from "./types.js";

const execFileAsync = promisify(execFile);
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_TEXT_BYTES = 16 * 1024 * 1024;
const MAX_PAGES = 2_000;
const EXTRACTION_TIMEOUT_MS = 60_000;

export class PdfTextExtractionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PdfTextExtractionError";
  }
}

export class PopplerTextExtractor implements PdfTextExtractor {
  async extract(pdf: Buffer): Promise<ExtractedPdf> {
    if (pdf.length === 0 || pdf.length > MAX_PDF_BYTES) {
      throw new PdfTextExtractionError("PDF must be between 1 byte and 50 MiB");
    }
    if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new PdfTextExtractionError("Input is not a PDF document");
    }

    const dir = await mkdtemp(join(tmpdir(), "hwptopdf-text-"));
    const inputPath = join(dir, "input.pdf");
    try {
      await writeFile(inputPath, pdf);
      const { stdout } = await execFileAsync(
        "pdftotext",
        ["-layout", "-enc", "UTF-8", inputPath, "-"],
        {
          encoding: "utf8",
          timeout: EXTRACTION_TIMEOUT_MS,
          killSignal: "SIGKILL",
          maxBuffer: MAX_TEXT_BYTES,
        },
      );
      return this.parsePages(stdout);
    } catch (cause) {
      if (cause instanceof PdfTextExtractionError) throw cause;
      throw new PdfTextExtractionError("pdftotext extraction failed", { cause });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private parsePages(output: string): ExtractedPdf {
    const normalized = output.replaceAll("\r\n", "\n");
    const rawPages = normalized.split("\f");
    if (normalized.endsWith("\f")) rawPages.pop();
    if (rawPages.length > MAX_PAGES) {
      throw new PdfTextExtractionError(`PDF exceeds the ${MAX_PAGES}-page extraction limit`);
    }
    const pages: { readonly pageNumber: number; readonly text: string }[] = [];
    const omittedPages: number[] = [];
    rawPages.forEach((raw, index) => {
      const text = raw.trim();
      const pageNumber = index + 1;
      if (text.length > 0) pages.push({ pageNumber, text });
      else omittedPages.push(pageNumber);
    });
    return { totalPages: rawPages.length, pages, omittedPages };
  }
}
