import { normalizeQualityReport, reportObjectKey } from "../convert/quality.js";
import { isReportingConverter, type ConversionResult } from "../convert/types.js";
import type { Registry } from "../convert/registry.js";
import type { Storage } from "../storage/s3.js";
import type { JobService } from "../jobs/jobService.js";
import type { QueuedJob } from "./jobQueue.js";

export interface WorkerDeps {
  readonly registry: Registry;
  readonly storage: Storage;
  readonly jobs: JobService;
}

export type ProcessResult =
  | { readonly ok: true; readonly engine: string; readonly durationMs: number }
  | { readonly ok: false; readonly engine: string; readonly durationMs: number; readonly error: string };

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "unknown conversion failure";
}

/**
 * Convert one claimed job: read its source from storage, run the engine chain,
 * persist the PDF + quality report, and mark success. On failure it returns the
 * error (the worker decides retry vs. permanent failure). This is durable —
 * everything it needs is in storage + the DB, not the original HTTP request.
 *
 * Contract: this function never throws on any input or infrastructure error
 * (e.g. a missing source object or a transient storage outage) — it always
 * resolves to a ProcessResult, because the worker loop's survival depends on it.
 */
export async function processConversion(deps: WorkerDeps, job: QueuedJob): Promise<ProcessResult> {
  let engineName = "unknown";
  const started = Date.now();
  try {
    const data = Buffer.from(await deps.storage.get(job.sourceKey));
    const engine = deps.registry.forFormat(job.format, { qualityMode: job.qualityMode });
    engineName = engine.name;
    const result: ConversionResult = isReportingConverter(engine)
      ? await engine.convertWithReport({ filename: job.filename, data })
      : { pdf: await engine.convert({ filename: job.filename, data }) };
    const durationMs = Date.now() - started;

    const report = normalizeQualityReport({
      report: result.report,
      jobId: job.id,
      filename: job.filename,
      format: job.format,
      mode: job.qualityMode,
      fallbackEngine: engine.name,
      pdf: result.pdf,
      sourceBytes: data.byteLength,
      durationMs,
    });

    const outputKey = `${job.userId}/out/${job.id}.pdf`;
    await deps.storage.put(outputKey, result.pdf, "application/pdf");
    await deps.storage.put(
      reportObjectKey(job.userId, job.id),
      Buffer.from(JSON.stringify(report)),
      "application/json",
    );
    await deps.jobs.markSuccess(job.id, {
      engine: report.selectedEngine,
      durationMs,
      outputKey,
    });
    return { ok: true, engine: report.selectedEngine, durationMs };
  } catch (err) {
    return {
      ok: false,
      engine: engineName,
      durationMs: Date.now() - started,
      error: errorMessage(err),
    };
  }
}
