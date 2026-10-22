import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Readable } from "node:stream";
import type { AppDeps } from "../app.js";
import type { Storage } from "../storage/s3.js";
import { streamZip, type ZipSource } from "../zip/streamZip.js";

export function registerBatches(app: FastifyInstance, deps: AppDeps) {
  const auth = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await deps.getSessionUser(req);
    if (!user) {
      reply.code(401).send({ error: "unauthenticated" });
      return null;
    }
    return user;
  };

  app.get<{ Params: { readonly id: string } }>("/api/batches/:id", async (req, reply) => {
    const user = await auth(req, reply);
    if (!user) return;
    const batch = await deps.jobs.getBatch(user.id, req.params.id);
    if (!batch) return reply.code(404).send({ error: "not found" });
    return batch;
  });

  app.get<{ Params: { readonly id: string } }>("/api/batches/:id/download", async (req, reply) => {
    const user = await auth(req, reply);
    if (!user) return;
    const outputs = await deps.jobs.listBatchOutputs(user.id, req.params.id);
    if (!outputs) return reply.code(404).send({ error: "not found" });
    if (outputs.length === 0) return reply.code(404).send({ error: "no successful jobs" });

    const entryNames = uniquePdfEntryNames(outputs.map((output) => output.filename));
    const sources: ZipSource[] = outputs.map((output, index) => ({
      name: entryNames[index] ?? "document.pdf",
      open: () => storageStream(deps.storage, output.outputKey),
    }));
    return reply
      .header("content-type", "application/zip")
      .header("content-disposition", `attachment; filename="${batchZipFilename(req.params.id)}"`)
      .header("x-content-type-options", "nosniff")
      .send(streamZip(sources));
  });
}

async function storageStream(storage: Storage, key: string) {
  if (storage.getStream) return storage.getStream(key);
  return Readable.from(await storage.get(key));
}

function batchZipFilename(id: string): string {
  const safeId = id.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[.-]+/, "").trim();
  return `batch-${safeId || "download"}.pdf.zip`;
}

function uniquePdfEntryNames(filenames: readonly string[]): string[] {
  const used = new Set<string>();
  return filenames.map((filename) => {
    const candidate = pdfEntryName(filename);
    const suffixIndex = candidate.toLowerCase().endsWith(".pdf") ? candidate.length - 4 : candidate.length;
    const base = candidate.slice(0, suffixIndex);
    const extension = candidate.slice(suffixIndex);
    let unique = candidate;
    let collision = 1;
    while (used.has(unique)) {
      unique = `${base}-${collision}${extension}`;
      collision += 1;
    }
    used.add(unique);
    return unique;
  });
}

function pdfEntryName(filename: string): string {
  const leaf = filename.split(/[\\/]+/).filter(Boolean).at(-1) ?? "document";
  const base = leaf.replace(/\.[^.]+$/, "").replace(/[\u0000-\u001f\u007f]/g, "_").trim();
  return `${base || "document"}.pdf`;
}
