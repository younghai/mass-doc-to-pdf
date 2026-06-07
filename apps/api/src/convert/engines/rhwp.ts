import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { ConversionError, type ConvertInput, type Converter } from "../types.js";

const execFileAsync = promisify(execFile);

export interface RhwpConfig {
  readonly enabled: boolean;
  readonly pythonPath: string;
  readonly workerScript?: string;
  readonly timeoutMs: number;
}

function defaultWorkerScript(): string {
  return join(process.cwd(), "src/convert/workers/rhwp_worker.py");
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
      await execFileAsync(
        this.cfg.pythonPath,
        [this.cfg.workerScript ?? defaultWorkerScript(), inputPath, outputPath],
        {
          timeout: this.cfg.timeoutMs,
          maxBuffer: 1024 * 1024,
          encoding: "utf8",
        },
      );
      return Buffer.from(await readFile(outputPath));
    } catch (cause) {
      throw new ConversionError(this.name, "rhwp conversion failed", cause);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
