import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { JobStatus } from "@hwptopdf/shared";
import type { AppDeps } from "../app.js";
import { previewObjectKey, reportObjectKey } from "../convert/quality.js";
import { defaultPreviewRenderer, PdfPreviewError } from "../pdf/preview.js";

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

type PdfDisposition = "attachment" | "inline";
type ConvertedPdf = {
  readonly filename: string;
  readonly bytes: Buffer;
};

function pdfDisposition(filename: string, disposition: PdfDisposition): string {
  const pdfName = pdfNameFrom(filename);
  return `${disposition}; filename="${asciiFallback(pdfName)}"; filename*=UTF-8''${encodeRFC5987Value(pdfName)}`;
}

function isMissingObject(err: unknown): boolean {
  if (err instanceof Error && "code" in err) {
    return err.code === "ENOENT" || err.code === "NoSuchKey";
  }
  return false;
}

export function registerJobs(app: FastifyInstance, deps: AppDeps) {
  const pdfPreview = deps.pdfPreview ?? defaultPreviewRenderer();

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

  // Auth + ownership + status gate shared by every converted-output route. Sends
  // the matching error reply and returns null when the caller must not proceed;
  // on success it yields the user id plus the validated raw job (status ===
  // "success" with an outputKey). The preview.png route reuses this so serving a
  // pre-rendered PNG never skips the same authorization checks the PDF routes run.
  const readConvertedRaw = async (
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<{ readonly userId: string; readonly filename: string; readonly outputKey: string } | null> => {
    const user = await auth(req, reply);
    if (!user) return null;
    const raw = await deps.jobs.getRaw(user.id, (req.params as { id: string }).id);
    if (!raw) {
      reply.code(404).send({ error: "not found" });
      return null;
    }
    if (raw.status !== "success" || !raw.outputKey) {
      reply.code(409).send({ error: "not converted" });
      return null;
    }
    return { userId: user.id, filename: raw.filename, outputKey: raw.outputKey };
  };

  const readConvertedPdf = async (req: FastifyRequest, reply: FastifyReply): Promise<ConvertedPdf | null> => {
    const raw = await readConvertedRaw(req, reply);
    if (!raw) return null;
    const bytes = await deps.storage.get(raw.outputKey);
    return { filename: raw.filename, bytes: Buffer.from(bytes) };
  };

  const sendPdf = async (req: FastifyRequest, reply: FastifyReply, disposition: PdfDisposition) => {
    const pdf = await readConvertedPdf(req, reply);
    if (!pdf) return;
    return reply
      .header("content-type", "application/pdf")
      .header("content-disposition", pdfDisposition(pdf.filename, disposition))
      .header("x-content-type-options", "nosniff")
      .send(pdf.bytes);
  };

  app.get("/api/jobs/:id/download", async (req, reply) => {
    return sendPdf(req, reply, "attachment");
  });

  app.get("/api/jobs/:id/preview", async (req, reply) => {
    return sendPdf(req, reply, "inline");
  });

  const sendPng = (reply: FastifyReply, image: Buffer | Uint8Array) =>
    reply
      .header("content-type", "image/png")
      .header("cache-control", "private, max-age=600")
      .header("x-content-type-options", "nosniff")
      .send(Buffer.from(image));

  app.get("/api/jobs/:id/preview.png", async (req, reply) => {
    const raw = await readConvertedRaw(req, reply);
    if (!raw) return;

    // Conversions pre-render the first-page PNG, so the common path is a cheap
    // object fetch with no renderer process. Authorization already passed above.
    const id = (req.params as { id: string }).id;
    const key = previewObjectKey(raw.userId, id);
    try {
      const stored = await deps.storage.get(key);
      return sendPng(reply, stored);
    } catch (err) {
      if (!isMissingObject(err)) throw err;
    }

    // Older jobs (converted before pre-rendering) have no stored PNG: render once
    // on demand, then best-effort store it so subsequent requests hit the fast path.
    let pdfBytes: Uint8Array;
    try {
      pdfBytes = await deps.storage.get(raw.outputKey);
    } catch (err) {
      if (isMissingObject(err)) return reply.code(409).send({ error: "not converted" });
      throw err;
    }
    try {
      const image = await pdfPreview.renderFirstPagePng(Buffer.from(pdfBytes));
      await deps.storage.put(key, image, "image/png").catch(() => {});
      return sendPng(reply, image);
    } catch (err) {
      if (err instanceof PdfPreviewError) {
        return reply.code(503).send({ error: "preview image unavailable" });
      }
      throw err;
    }
  });

  app.delete("/api/jobs/:id", async (req, reply) => {
    const user = await auth(req, reply);
    if (!user) return;
    const id = (req.params as { id: string }).id;
    const raw = await deps.jobs.getRaw(user.id, id);
    if (!raw) return reply.code(404).send({ error: "not found" });
    const keys = [
      raw.sourceKey,
      raw.outputKey,
      reportObjectKey(user.id, id),
      previewObjectKey(user.id, id),
    ].filter((k): k is string => k != null);
    await Promise.allSettled(keys.map((key) => deps.storage.delete(key)));
    await deps.jobs.delete(user.id, id);
    return reply.code(204).send();
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
