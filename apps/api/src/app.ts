import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import { MAX_UPLOAD_BYTES } from "@hwptopdf/shared";
import type { Registry } from "./convert/registry.js";
import type { Storage } from "./storage/s3.js";
import type { JobService } from "./jobs/jobService.js";
import type { JobQueue } from "./queue/jobQueue.js";
import type { SessionUser } from "./auth/plugin.js";
import type { PdfPreviewRenderer } from "./pdf/preview.js";
import { registerConvert } from "./routes/convert.js";
import { registerJobs } from "./routes/jobs.js";
import { registerStats } from "./routes/stats.js";

export interface AppDeps {
  registry: Registry;
  storage: Storage;
  jobs: JobService;
  /** When provided, conversions are enqueued for the worker instead of run inline. */
  queue?: JobQueue;
  pdfPreview?: PdfPreviewRenderer;
  /** Allowed browser origin for CSRF checks (e.g. "https://pdf.example.com"). */
  webOrigin: string;
  getSessionUser(req: FastifyRequest): Promise<SessionUser | null>;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES } });

  // CSRF origin guard: reject state-changing browser requests from unexpected origins.
  app.addHook("onRequest", async (req, reply) => {
    const method = req.method;
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
    if (req.url.startsWith("/api/auth/")) return; // Auth.js manages its own CSRF
    const origin = req.headers.origin;
    if (!origin) return; // no Origin → direct API call / same-origin form
    if (origin !== deps.webOrigin) {
      return reply.code(403).send({ error: "forbidden" });
    }
  });

  app.get("/health", async () => ({ status: "ok" }));
  registerConvert(app, deps);
  registerJobs(app, deps);
  registerStats(app, deps);
  return app;
}
