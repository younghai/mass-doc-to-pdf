import type { FastifyInstance } from "fastify";
import type { ConversionMode, DocFormat, ConversionFailureReason, QualityReport } from "@hwptopdf/shared";
import { randomUUID } from "node:crypto";
import { fileMeta } from "../detect/detectFormat.js";
import { normalizeQualityReport, reportObjectKey } from "../convert/quality.js";
import {
  ConversionError,
  isReportingConverter,
  type Converter,
  type ConversionResult,
} from "../convert/types.js";
import type { AppDeps } from "../app.js";

function rawErrorMessage(err: unknown): string {
  if (err instanceof ConversionError) return err.message;
  if (err instanceof Error) return err.message;
  return "unknown conversion failure";
}

function failureReason(message: string): ConversionFailureReason {
  const lower = message.toLowerCase();
  if (lower.includes("password") || lower.includes("encrypted") || message.includes("암호")) return "password_protected";
  if (lower.includes("enametoolong") || lower.includes("filename") || message.includes("파일명")) return "unknown";
  if (lower.includes("quality gate") || message.includes("품질 게이트")) return "quality_gate_failed";
  if (lower.includes("unsupported") || lower.includes("not supported") || lower.includes("not available")) return "unsupported_format";
  if (lower.includes("timeout") || lower.includes("timed out")) return "timeout";
  if (lower.includes("corrupt") || lower.includes("invalid")) return "corrupt_file";
  return "engine_error";
}

function errorMessage(err: unknown): string {
  const message = rawErrorMessage(err);
  switch (failureReason(message)) {
    case "password_protected":
      return `암호 문서: 암호를 해제한 파일로 다시 업로드하세요. (${message})`;
    case "unsupported_format":
      return `엔진 미지원: 현재 변환 엔진이 이 문서 구조를 지원하지 않습니다. (${message})`;
    case "timeout":
      return `렌더링 시간 초과: 파일을 나누거나 정밀 변환으로 다시 시도하세요. (${message})`;
    case "corrupt_file":
      return `파일 손상 의심: 원본을 다시 저장한 뒤 업로드하세요. (${message})`;
    case "too_large":
      return `파일 크기 초과: 파일을 나눠 업로드하세요. (${message})`;
    case "unknown":
      return `파일명 길이 또는 문서 구조 문제: 파일명을 짧게 바꾸고 다시 시도하세요. (${message})`;
    case "engine_error":
      return `렌더링 실패: 다른 품질 모드로 재시도하거나 원본 문서를 다시 저장하세요. (${message})`;
    case "quality_gate_failed":
      return `품질 게이트 실패: PDF가 생성됐지만 원본 서식 보존 엔진 결과가 아니어서 다운로드를 막았습니다. LibreOffice/H2Orestart 또는 정밀 엔진을 연결한 뒤 재시도하세요. (${message})`;
  }
}

class QualityGateError extends ConversionError {
  constructor(public readonly report: QualityReport) {
    super(report.selectedEngine, `품질 게이트 실패: ${report.recommendedAction ?? "원본 서식 보존 엔진으로 재시도하세요."}`);
  }
}

function shouldRejectQuality(report: QualityReport): boolean {
  return report.format === "office" && report.mode === "precise" && report.grade === "fallback";
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

function sourceObjectKey(userId: string, extension: string): string {
  const suffix = extension.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return `${userId}/src/${Date.now()}-${randomUUID()}.${suffix}`;
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
    await deps.jobs.markSuccess(input.jobId, {
      engine: report.selectedEngine,
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
    await deps.jobs.markFailed(input.jobId, {
      engine: err instanceof QualityGateError ? err.report.selectedEngine : input.engine.name,
      durationMs: Date.now() - started,
      error: errorMessage(err),
    });
  }
}

export function registerConvert(app: FastifyInstance, deps: AppDeps) {
  app.post("/api/convert", async (req, reply) => {
    const user = await deps.getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const qualityMode = parseQualityMode((req.query as { readonly qualityMode?: string }).qualityMode);
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "field 'file' required" });
    const data = await file.toBuffer();

    let meta;
    try {
      meta = fileMeta(file.filename, data.subarray(0, 8));
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
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
