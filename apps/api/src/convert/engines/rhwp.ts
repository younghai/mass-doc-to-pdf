import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { ConversionError, type ConvertInput, type Converter } from "../types.js";

const execFileAsync = promisify(execFile);
const LAYOUT_OVERFLOW_RE = /\bLAYOUT_OVERFLOW\b/;

export interface RhwpConfig {
  readonly enabled: boolean;
  readonly pythonPath: string;
  readonly workerScript?: string;
  readonly timeoutMs: number;
  readonly fontPaths: readonly string[];
}

export interface RhwpCliConfig {
  readonly enabled: boolean;
  readonly cliPath: string;
  readonly timeoutMs: number;
  readonly fontPaths: readonly string[];
  readonly mode: "pdf" | "raster";
}

function defaultWorkerScript(): string {
  return join(process.cwd(), "src/convert/workers/rhwp_worker.py");
}

function assertNoLayoutOverflow(engine: string, output: string): void {
  if (LAYOUT_OVERFLOW_RE.test(output)) {
    throw new ConversionError(engine, "rhwp reported layout overflow");
  }
}

// Mirror the rhwp-cli convention: expose fonts as ttfs/hwp/* symlinks in the run
// dir so the rhwp core (CLI and Python) can discover them relative to cwd.
async function linkFontPaths(dir: string, fontPaths: readonly string[]): Promise<void> {
  if (fontPaths.length === 0) return;
  const fontDir = join(dir, "ttfs", "hwp");
  await mkdir(fontDir, { recursive: true });
  await Promise.all(
    fontPaths.map((fontPath, index) =>
      symlink(fontPath, join(fontDir, `${index}-${basename(fontPath)}`)),
    ),
  );
}

export class RhwpConverter implements Converter {
  readonly name = "rhwp";

  constructor(private readonly cfg: RhwpConfig) {}

  async convert(input: ConvertInput): Promise<Buffer> {
    if (!this.cfg.enabled) {
      throw new ConversionError(this.name, "rhwp worker is disabled");
    }

    const dir = await mkdtemp(join(tmpdir(), "hwptopdf-rhwp-"));
    const inputPath = join(dir, basename(input.filename) || "document.hwp");
    const outputPath = join(dir, "output.pdf");

    try {
      await writeFile(inputPath, input.data);
      await linkFontPaths(dir, this.cfg.fontPaths);
      const result = await execFileAsync(
        this.cfg.pythonPath,
        [this.cfg.workerScript ?? defaultWorkerScript(), inputPath, outputPath],
        {
          timeout: this.cfg.timeoutMs,
          // Match the CLI ceiling: documents that emit many warnings can exceed 1MB
          // of stdio, which would kill an otherwise successful conversion.
          maxBuffer: 4 * 1024 * 1024,
          encoding: "utf8",
          // The rhwp core reads ttfs/hwp relative to cwd (same convention as the CLI).
          cwd: dir,
          env: {
            ...process.env,
            ...(this.cfg.fontPaths.length > 0
              ? { RHWP_FONT_PATHS: this.cfg.fontPaths.join(":") }
              : {}),
          },
        },
      );
      assertNoLayoutOverflow(this.name, `${result.stdout}\n${result.stderr}`);
      return Buffer.from(await readFile(outputPath));
    } catch (cause) {
      if (cause instanceof ConversionError) throw cause;
      throw new ConversionError(this.name, "rhwp conversion failed", cause);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

export class RhwpCliConverter implements Converter {
  readonly name: string;

  constructor(private readonly cfg: RhwpCliConfig) {
    this.name = cfg.mode === "raster" ? "rhwp-cli-raster" : "rhwp-cli-pdf";
  }

  async convert(input: ConvertInput): Promise<Buffer> {
    if (!this.cfg.enabled) {
      throw new ConversionError(this.name, "rhwp CLI renderer is disabled");
    }
    if (this.cfg.mode === "raster") {
      throw new ConversionError(this.name, "rhwp CLI raster PDF mode is not implemented yet");
    }

    const dir = await mkdtemp(join(tmpdir(), "hwptopdf-rhwp-cli-"));
    const inputPath = join(dir, basename(input.filename) || "document.hwp");
    const outputPath = join(dir, "output.pdf");

    try {
      await writeFile(inputPath, input.data);
      await linkFontPaths(dir, this.cfg.fontPaths);
      const result = await execFileAsync(this.cfg.cliPath, this.args(inputPath, outputPath), {
        timeout: this.cfg.timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        encoding: "utf8",
        cwd: dir,
      });
      assertNoLayoutOverflow(this.name, `${result.stdout}\n${result.stderr}`);
      const pdf = await readFile(outputPath);
      if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
        throw new ConversionError(this.name, "rhwp CLI output is not a PDF");
      }
      return Buffer.from(pdf);
    } catch (cause) {
      if (cause instanceof ConversionError) throw cause;
      throw new ConversionError(this.name, "rhwp CLI conversion failed", cause);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private args(inputPath: string, outputPath: string): readonly string[] {
    return ["export-pdf", inputPath, "-o", outputPath];
  }
}
