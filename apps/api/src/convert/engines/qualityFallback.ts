import type { ConversionMode, DocFormat, QualityAttempt } from "@hwptopdf/shared";
import {
  ConversionError,
  isReportingConverter,
  type ConversionResult,
  type ConvertInput,
  type Converter,
  type ReportingConverter,
} from "../types.js";
import { buildQualityReport } from "../quality.js";

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "unknown conversion failure";
}

export class QualityFallbackConverter implements ReportingConverter {
  constructor(
    public readonly name: string,
    private readonly format: DocFormat,
    private readonly mode: ConversionMode,
    private readonly engines: readonly Converter[],
  ) {}

  async convert(input: ConvertInput): Promise<Buffer> {
    return (await this.convertWithReport(input)).pdf;
  }

  engineNames(): readonly string[] {
    return this.engines.map((engine) => engine.name);
  }

  async convertWithReport(input: ConvertInput): Promise<ConversionResult> {
    const attempts: QualityAttempt[] = [];
    const warnings: string[] = [];
    let reviewResult: ConversionResult | undefined;

    for (const engine of this.engines) {
      const started = Date.now();
      try {
        const result = isReportingConverter(engine)
          ? await engine.convertWithReport(input)
          : { pdf: await engine.convert(input) };
        const durationMs = Date.now() - started;
        attempts.push({ engine: engine.name, status: "success", durationMs });
        const report = buildQualityReport({
          jobId: "",
          filename: input.filename,
          format: this.format,
          mode: this.mode,
          selectedEngine: engine.name,
          pdf: result.pdf,
          sourceBytes: input.data.byteLength,
          attempts: [...attempts],
          warnings: [...warnings, ...(result.report?.warnings ?? [])],
          createdAt: result.report?.createdAt,
        });
        const conversionResult = {
          pdf: result.pdf,
          report,
        };
        if (this.mode === "precise" && report.status === "review") {
          reviewResult ??= conversionResult;
          continue;
        }
        return conversionResult;
      } catch (err) {
        const message = errorMessage(err);
        attempts.push({ engine: engine.name, status: "failed", durationMs: Date.now() - started, error: message });
        warnings.push(`${engine.name} failed: ${message}`);
      }
    }

    if (reviewResult) return reviewResult;
    throw new ConversionError(this.name, `all converters failed: ${warnings.join(" | ")}`);
  }
}
