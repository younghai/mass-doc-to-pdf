import {
  normalizeQualityReport,
  previewObjectKey,
  qualityGateReason,
  reportObjectKey,
  shouldRejectQuality,
} from "../convert/quality.js";
import { ConversionError, isReportingConverter, type ConversionResult } from "../convert/types.js";
import { errorMessage as localizedErrorMessage, isPermanentFailure, rawErrorMessage } from "../convert/failure.js";
import { defaultPreviewRenderer, type PdfPreviewRenderer } from "../pdf/preview.js";
import type { Registry } from "../convert/registry.js";
import type { Storage } from "../storage/s3.js";
import type { JobService } from "../jobs/jobService.js";
import type { QueuedJob } from "./jobQueue.js";
import type { QualityStatus } from "@hwptopdf/shared";

export interface WorkerDeps {
  readonly registry: Registry;
  readonly storage: Storage;
  readonly jobs: JobService;
  readonly pdfPreview?: PdfPreviewRenderer;
}

export type ProcessResult =
  | { readonly ok: true; readonly engine: string; readonly durationMs: number }
  | {
      readonly ok: false;
      readonly engine: string;
      readonly qualityStatus: QualityStatus;
      readonly durationMs: number;
      readonly error: string;
      readonly permanent: boolean;
    };

function logRawConversionFailure(jobId: string, err: unknown): void {
  console.warn("worker conversion failed", { jobId, rawError: rawErrorMessage(err) });
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

    // Quality gate — shared with the inline /api/convert path via shouldRejectQuality.
    // A rejected report means the PDF lost the original layout, so it must not be
    // published as a success. Persist the report so the job detail can explain the
    // verdict, then fail deterministically. The error is classified as
    // quality_gate_failed → isPermanentFailure() → the worker fails it immediately
    // instead of burning the retry budget re-running the identical engine chain.
    if (shouldRejectQuality(report)) {
      await deps.storage.put(
        reportObjectKey(job.userId, job.id),
        Buffer.from(JSON.stringify(report)),
        "application/json",
      );
      const err = new ConversionError(report.selectedEngine, qualityGateReason(report));
      logRawConversionFailure(job.id, err);
      return {
        ok: false,
        engine: report.selectedEngine,
        qualityStatus: report.status,
        durationMs,
        error: localizedErrorMessage(err),
        permanent: isPermanentFailure(rawErrorMessage(err)),
      };
    }

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
    } catch (err) {
      const rawError = err instanceof Error ? err.message : rawErrorMessage(err);
      console.warn("worker preview pre-render failed", { jobId: job.id, rawError });
    }
    await deps.jobs.markSuccess(job.id, {
      engine: report.selectedEngine,
      qualityStatus: report.status,
      durationMs,
      outputKey,
    });
    return { ok: true, engine: report.selectedEngine, durationMs };
  } catch (err) {
    const rawError = err instanceof Error ? err.message : rawErrorMessage(err);
    logRawConversionFailure(job.id, err);
    return {
      ok: false,
      engine: engineName,
      qualityStatus: "failed",
      durationMs: Date.now() - started,
      error: localizedErrorMessage(err),
      permanent: isPermanentFailure(rawError),
    };
  }
}
