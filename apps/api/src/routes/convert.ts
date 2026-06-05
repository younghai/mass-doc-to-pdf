import type { FastifyInstance } from "fastify";
import { fileMeta } from "../detect/detectFormat.js";
import { ConversionError } from "../convert/types.js";
import type { AppDeps } from "../app.js";

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

    const sourceKey = `${user.id}/src/${Date.now()}-${file.filename}`;
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
    const started = Date.now();
    try {
      const pdf = await engine.convert({ filename: file.filename, data });
      const outputKey = `${user.id}/out/${job.id}.pdf`;
      await deps.storage.put(outputKey, pdf, "application/pdf");
      const done = await deps.jobs.markSuccess(job.id, {
        engine: engine.name,
        durationMs: Date.now() - started,
        outputKey,
      });
      return reply.code(201).send(done);
    } catch (err) {
      const msg = err instanceof ConversionError ? err.message : (err as Error).message;
      const failed = await deps.jobs.markFailed(job.id, {
        engine: engine.name,
        durationMs: Date.now() - started,
        error: msg,
      });
      return reply.code(201).send(failed);
    }
  });
}
