import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { JobStatus } from "@hwptopdf/shared";
import type { AppDeps } from "../app.js";
import { reportObjectKey } from "../convert/quality.js";

const CONTROL_OR_QUOTE_RE = /[\u0000-\u001f\u007f"\\]/g;
const NON_ASCII_RE = /[^\x20-\x7e]/g;
const RFC5987_EXTRA_RE = /['()*]/g;

function pdfNameFrom(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "").trim();
  return `${base || "download"}.pdf`;
}

function asciiFallback(filename: string): string {
  const sanitized = filename
    .normalize("NFKD")
    .replace(NON_ASCII_RE, "")
    .replace(CONTROL_OR_QUOTE_RE, "_")
    .trim();
  const base = sanitized.replace(/\.[^.]+$/, "").trim();
  return `${base || "download"}.pdf`;
}

function encodeRFC5987Value(value: string): string {
  return encodeURIComponent(value).replace(RFC5987_EXTRA_RE, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function downloadDisposition(filename: string): string {
  const pdfName = pdfNameFrom(filename);
  return `attachment; filename="${asciiFallback(pdfName)}"; filename*=UTF-8''${encodeRFC5987Value(pdfName)}`;
}

function isMissingObject(err: unknown): boolean {
  if (err instanceof Error && "code" in err) {
    return err.code === "ENOENT" || err.code === "NoSuchKey";
  }
  return false;
}

export function registerJobs(app: FastifyInstance, deps: AppDeps) {
  const auth = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = await deps.getSessionUser(req);
    if (!user) {
      reply.code(401).send({ error: "unauthenticated" });
      return null;
    }
    return user;
  };

  app.get("/api/jobs", async (req, reply) => {
    const user = await auth(req, reply);
    if (!user) return;
    const status = (req.query as { status?: JobStatus }).status;
    return deps.jobs.list(user.id, { status });
  });

  app.get("/api/jobs/:id", async (req, reply) => {
    const user = await auth(req, reply);
    if (!user) return;
    const job = await deps.jobs.get(user.id, (req.params as { id: string }).id);
    if (!job) return reply.code(404).send({ error: "not found" });
    return job;
  });

  app.get("/api/jobs/:id/download", async (req, reply) => {
    const user = await auth(req, reply);
    if (!user) return;
    const raw = await deps.jobs.getRaw(user.id, (req.params as { id: string }).id);
    if (!raw) return reply.code(404).send({ error: "not found" });
    if (raw.status !== "success" || !raw.outputKey) {
      return reply.code(409).send({ error: "not converted" });
    }
    const bytes = await deps.storage.get(raw.outputKey);
    return reply
      .header("content-type", "application/pdf")
      .header("content-disposition", downloadDisposition(raw.filename))
      .send(Buffer.from(bytes));
  });

  app.get("/api/jobs/:id/quality", async (req, reply) => {
    const user = await auth(req, reply);
    if (!user) return;
    const id = (req.params as { id: string }).id;
    const raw = await deps.jobs.getRaw(user.id, id);
    if (!raw) return reply.code(404).send({ error: "not found" });
    if (raw.status !== "success") return reply.code(409).send({ error: "not converted" });

    try {
      const bytes = await deps.storage.get(reportObjectKey(user.id, id));
      return reply.header("content-type", "application/json").send(Buffer.from(bytes));
    } catch (err) {
      if (isMissingObject(err)) return reply.code(404).send({ error: "quality report not found" });
      throw err;
    }
  });
}
