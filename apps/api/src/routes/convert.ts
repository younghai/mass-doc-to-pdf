import type { FastifyInstance } from "fastify";
import type { Multipart } from "@fastify/multipart";
import type { ConversionMode, DocFormat, QualityReport } from "@hwptopdf/shared";
import { randomUUID } from "node:crypto";
import { fileMeta } from "../detect/detectFormat.js";
import {
  normalizeQualityReport,
  previewObjectKey,
  qualityGateReason,
  reportObjectKey,
  shouldRejectQuality,
} from "../convert/quality.js";
import { errorMessage, rawErrorMessage } from "../convert/failure.js";
import { defaultPreviewRenderer } from "../pdf/preview.js";
import {
  ConversionError,
  isReportingConverter,
  type Converter,
  type ConversionResult,
} from "../convert/types.js";
import type { AppDeps } from "../app.js";

class QualityGateError extends ConversionError {
  constructor(public readonly report: QualityReport) {
    super(report.selectedEngine, qualityGateReason(report));
  }
}

function parseQualityMode(value: string | undefined): ConversionMode {
  switch (value) {
    case "quick":
      return "quick";
    case "precise":
    default:
      return "precise";
  }
}

function cleanOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function multipartFieldString(field: Multipart | Multipart[] | undefined): string | undefined {
  const part = Array.isArray(field) ? field[0] : field;
  if (!part || part.type !== "field" || typeof part.value !== "string") return undefined;
  return cleanOptionalString(part.value);
}

function sourceObjectKey(userId: string, extension: string): string {
  const suffix = extension.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return `${userId}/src/${Date.now()}-${randomUUID()}.${suffix}`;
}

function logRawConversionFailure(jobId: string, err: unknown): void {
  console.warn("conversion failed", { jobId, rawError: rawErrorMessage(err) });
}

async function finishConversion(
  deps: AppDeps,
  input: {
    jobId: string;
    userId: string;
    filename: string;
    format: DocFormat;
    mode: ConversionMode;
    data: Buffer;
    engine: Converter;
  },
): Promise<void> {
  const started = Date.now();
  try {
    const result: ConversionResult = isReportingConverter(input.engine)
      ? await input.engine.convertWithReport({ filename: input.filename, data: input.data })
      : { pdf: await input.engine.convert({ filename: input.filename, data: input.data }) };
    const durationMs = Date.now() - started;
    const report = normalizeQualityReport({
      report: result.report,
      jobId: input.jobId,
      filename: input.filename,
      format: input.format,
      mode: input.mode,
      fallbackEngine: input.engine.name,
      pdf: result.pdf,
      sourceBytes: input.data.byteLength,
      durationMs,
    });
    const outputKey = `${input.userId}/out/${input.jobId}.pdf`;
    if (shouldRejectQuality(report)) {
      throw new QualityGateError(report);
    }
    await deps.storage.put(outputKey, result.pdf, "application/pdf");
    await deps.storage.put(
      reportObjectKey(input.userId, input.jobId),
      Buffer.from(JSON.stringify(report)),
      "application/json",
    );
    // Pre-render the first-page PNG once so the preview route serves a stored
    // image instead of spawning a renderer per request. Best-effort only.
    try {
      const renderer = deps.pdfPreview ?? defaultPreviewRenderer();
      const png = await renderer.renderFirstPagePng(result.pdf);
      await deps.storage.put(previewObjectKey(input.userId, input.jobId), png, "image/png");
    } catch (err) {
      const rawError = err instanceof Error ? err.message : rawErrorMessage(err);
      console.warn("preview pre-render failed", { jobId: input.jobId, rawError });
    }
    await deps.jobs.markSuccess(input.jobId, {
      engine: report.selectedEngine,
      qualityStatus: report.status,
      durationMs,
      outputKey,
    });
  } catch (err) {
    if (err instanceof QualityGateError) {
      await deps.storage.put(
        reportObjectKey(input.userId, input.jobId),
        Buffer.from(JSON.stringify(err.report)),
        "application/json",
      );
    }
    logRawConversionFailure(input.jobId, err);
    await deps.jobs.markFailed(input.jobId, {
      engine: err instanceof QualityGateError ? err.report.selectedEngine : input.engine.name,
      qualityStatus: err instanceof QualityGateError ? err.report.status : "failed",
      durationMs: Date.now() - started,
      error: errorMessage(err),
    });
  }
}

export function registerConvert(app: FastifyInstance, deps: AppDeps) {
  const maxActiveJobsPerUser = deps.maxActiveJobsPerUser ?? 50;

  app.post("/api/jobs/:id/retry", async (req, reply) => {
    const user = await deps.getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const id = (req.params as { id: string }).id;
    const raw = await deps.jobs.getRaw(user.id, id);
    if (!raw) return reply.code(404).send({ error: "not found" });
    if (raw.status !== "failed") return reply.code(409).send({ error: "only failed jobs can be retried" });

    if (deps.queue) {
      await deps.queue.enqueue(id);
      return reply.code(202).send(await deps.jobs.get(user.id, id));
    }

    const data = Buffer.from(await deps.storage.get(raw.sourceKey));
    const mode = parseQualityMode(raw.qualityMode ?? undefined);
    const format = raw.format as DocFormat;
    const engine = deps.registry.forFormat(format, { qualityMode: mode });
    const running = await deps.jobs.markRunning(id, { engine: engine.name });
    void finishConversion(deps, { jobId: id, userId: user.id, filename: raw.filename, format, mode, data, engine });
    return reply.code(202).send(running);
  });

  app.post<{ Querystring: { readonly qualityMode?: string; readonly batchId?: string } }>("/api/convert", async (req, reply) => {
    const user = await deps.getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const activeCount = await deps.jobs.countActive(user.id);
    if (activeCount >= maxActiveJobsPerUser) {
      return reply.code(429).send({ error: "변환 대기 한도 초과. 완료된 작업을 확인 후 재시도하세요." });
    }

    const qualityMode = parseQualityMode(req.query.qualityMode);
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "field 'file' required" });
    const data = await file.toBuffer();
    const batchId = cleanOptionalString(req.query.batchId) ?? multipartFieldString(file.fields.batchId);

    let meta;
    try {
      meta = fileMeta(file.filename, data.subarray(0, 8));
    } catch (err) {
      if (err instanceof Error) return reply.code(400).send({ error: err.message });
      throw err;
    }

    const sourceKey = sourceObjectKey(user.id, meta.extension);
    await deps.storage.put(sourceKey, data, meta.mimeType);
    const job = await deps.jobs.create(user.id, {
      filename: file.filename,
      format: meta.format,
      extension: meta.extension,
      mimeType: meta.mimeType,
      sizeBytes: data.length,
      sourceKey,
      qualityMode,
      ...(batchId ? { batchId } : {}),
    });

    // Durable path: hand the job to the worker queue (survives API restarts).
    if (deps.queue) {
      await deps.queue.enqueue(job.id);
      const queued = await deps.jobs.get(user.id, job.id);
      return reply.code(202).send(queued ?? { ...job, status: "queued" });
    }

    // Inline path (default): convert within the request lifecycle.
    const engine = deps.registry.forFormat(meta.format, { qualityMode });
    const running = await deps.jobs.markRunning(job.id, { engine: engine.name });
    void finishConversion(deps, {
      jobId: job.id,
      userId: user.id,
      filename: file.filename,
      format: meta.format,
      mode: qualityMode,
      data,
      engine,
    });
    return reply.code(202).send(running);
  });
}
