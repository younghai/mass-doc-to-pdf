import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_STDIO_BYTES = 1024 * 1024;

export interface PdfPreviewRenderer {
  renderFirstPagePng(pdf: Buffer): Promise<Buffer>;
}

export class PdfPreviewError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, cause ? { cause } : undefined);
    this.name = "PdfPreviewError";
  }
}

export interface LibreOfficePdfPreviewRendererOptions {
  readonly executable?: string;
  readonly timeoutMs?: number;
}

function timeoutFromEnv(): number {
  const parsed = Number(process.env.PDF_PREVIEW_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function renderError(err: unknown): PdfPreviewError {
  if (err instanceof PdfPreviewError) return err;
  if (err instanceof Error) return new PdfPreviewError(`pdf preview render failed: ${err.message}`, err);
  return new PdfPreviewError("pdf preview render failed");
}

export class LibreOfficePdfPreviewRenderer implements PdfPreviewRenderer {
  private readonly executable: string;
  private readonly timeoutMs: number;

  constructor(options: LibreOfficePdfPreviewRendererOptions = {}) {
    this.executable = options.executable ?? process.env.LIBREOFFICE_PATH ?? process.env.SOFFICE_PATH ?? "libreoffice";
    this.timeoutMs = options.timeoutMs ?? timeoutFromEnv();
  }

  async renderFirstPagePng(pdf: Buffer): Promise<Buffer> {
    const dir = await mkdtemp(join(tmpdir(), "hwptopdf-preview-"));
    const profile = join(dir, "lo-profile");
    const input = join(dir, "preview.pdf");
    const output = join(dir, "preview.png");

    try {
      await writeFile(input, pdf);
      await execFileAsync(
        this.executable,
        [
          "--headless",
          "--nologo",
          "--nofirststartwizard",
          "--nodefault",
          "--nolockcheck",
          `-env:UserInstallation=${pathToFileURL(profile).href}`,
          "--convert-to",
          "png",
          "--outdir",
          dir,
          input,
        ],
        { timeout: this.timeoutMs, maxBuffer: MAX_STDIO_BYTES },
      );
      return await readFile(output);
    } catch (err) {
      throw renderError(err);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
