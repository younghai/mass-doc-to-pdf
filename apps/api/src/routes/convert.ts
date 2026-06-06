import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { fileMeta } from "../detect/detectFormat.js";
import { ConversionError, type Converter } from "../convert/types.js";
import type { AppDeps } from "../app.js";

function errorMessage(err: unknown): string {
  if (err instanceof ConversionError) return err.message;
  if (err instanceof Error) return err.message;
  return "unknown conversion failure";
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
    data: Buffer;
    engine: Converter;
  },
): Promise<void> {
  const started = Date.now();
  try {
    const pdf = await input.engine.convert({ filename: input.filename, data: input.data });
    const outputKey = `${input.userId}/out/${input.jobId}.pdf`;
    await deps.storage.put(outputKey, pdf, "application/pdf");
    await deps.jobs.markSuccess(input.jobId, {
      engine: input.engine.name,
      durationMs: Date.now() - started,
      outputKey,
    });
  } catch (err) {
    await deps.jobs.markFailed(input.jobId, {
      engine: input.engine.name,
      durationMs: Date.now() - started,
      error: errorMessage(err),
    });
  }
}

export function registerConvert(app: FastifyInstance, deps: AppDeps) {
  app.post("/api/convert", async (req, reply) => {
    const user = await deps.getSessionUser(req);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

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
    });

    const engine = deps.registry.forFormat(meta.format);
    const running = await deps.jobs.markRunning(job.id, { engine: engine.name });
    void finishConversion(deps, {
      jobId: job.id,
      userId: user.id,
      filename: file.filename,
      data,
      engine,
    });
    return reply.code(202).send(running);
  });
}
