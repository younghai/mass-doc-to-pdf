import { normalizeQualityReport, previewObjectKey, reportObjectKey } from "../convert/quality.js";
import { isReportingConverter, type ConversionResult } from "../convert/types.js";
import { errorMessage as localizedErrorMessage } from "../convert/failure.js";
import { defaultPreviewRenderer, type PdfPreviewRenderer } from "../pdf/preview.js";
import type { Registry } from "../convert/registry.js";
import type { Storage } from "../storage/s3.js";
import type { JobService } from "../jobs/jobService.js";
import type { QueuedJob } from "./jobQueue.js";

export interface WorkerDeps {
  readonly registry: Registry;
  readonly storage: Storage;
  readonly jobs: JobService;
  readonly pdfPreview?: PdfPreviewRenderer;
}

export type ProcessResult =
  | { readonly ok: true; readonly engine: string; readonly durationMs: number }
  | { readonly ok: false; readonly engine: string; readonly durationMs: number; readonly error: string };

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
    // Pre-render the first-page PNG once at conversion time so the preview route
    // never has to spawn a renderer per request. Best-effort: a preview failure
    // must never fail the conversion (the route falls back to on-demand render).
    try {
      const renderer = deps.pdfPreview ?? defaultPreviewRenderer();
      const png = await renderer.renderFirstPagePng(result.pdf);
      await deps.storage.put(previewObjectKey(job.userId, job.id), png, "image/png");
    } catch {
      // best-effort only
    }
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
      error: localizedErrorMessage(err),
    };
  }
}
