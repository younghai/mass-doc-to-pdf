import {
  ConversionError,
  toFilePart,
  type Converter,
  type ConvertInput,
  type FetchFn,
} from "../types.js";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function builtinOfficeScript(): string {
  return join(process.cwd(), "src/convert/workers/builtin_office.py");
}

export class H2OrestartConverter implements Converter {
  readonly name = "h2orestart";
  constructor(
    private readonly baseUrl: string,
    private readonly fetchFn: FetchFn = fetch,
    // Slightly above the sidecar's internal soffice timeout (120s) so the
    // sidecar's own 422 wins over a client-side abort, and a hung sidecar
    // (network black hole) cannot stall the worker for undici's ~10min default.
    private readonly timeoutMs = 150_000,
  ) {}

  async convert({ filename, data }: ConvertInput): Promise<Buffer> {
    const form = new FormData();
    form.append("file", new File([toFilePart(data)], filename));
    const url = `${this.baseUrl}/convert`;
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      if (cause instanceof Error && cause.name === "TimeoutError") {
        throw new ConversionError(
          this.name,
          `request to ${url} timed out after ${this.timeoutMs}ms`,
          cause,
        );
      }
      throw new ConversionError(this.name, `request to ${url} failed`, cause);
    }
    if (!res.ok) {
      throw new ConversionError(
        this.name,
        `backend ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`,
      );
    }
    return Buffer.from(await res.arrayBuffer());
  }
}

export class BuiltinOfficeConverter implements Converter {
  readonly name = "builtin-office";
  // Chrome headless inside the script is the hang risk; SIGKILL because a hung
  // Chrome can ignore the default SIGTERM and leave the worker stuck forever.
  constructor(private readonly timeoutMs = 120_000) {}

  async convert(input: ConvertInput): Promise<Buffer> {
    const dir = await mkdtemp(join(tmpdir(), "hwptopdf-office-"));
    const inputPath = join(dir, basename(input.filename) || "document");
    const outputPath = join(dir, "output.pdf");

    try {
      await writeFile(inputPath, input.data);
      await execFileAsync("python3", [builtinOfficeScript(), inputPath, outputPath], {
        maxBuffer: 8 * 1024 * 1024,
        timeout: this.timeoutMs,
        killSignal: "SIGKILL",
      });
      return Buffer.from(await readFile(outputPath));
    } catch (cause) {
      throw new ConversionError(this.name, "builtin conversion failed", cause);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
