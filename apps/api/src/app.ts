import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type FastifyServerOptions,
} from "fastify";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
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
  /** Fastify logger option. server.ts enables pino in deployments; tests omit it. */
  logger?: FastifyServerOptions["logger"];
  /** Per-IP request ceiling per minute (default 300). */
  rateLimitMax?: number;
  getSessionUser(req: FastifyRequest): Promise<SessionUser | null>;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: deps.logger ?? false,
    // nginx terminates TLS and forwards X-Forwarded-Proto/-For. Trusting it keeps
    // req.protocol and req.ip correct for Auth.js callback URLs, Secure cookies,
    // and per-IP rate limiting. Deployments never expose the API port directly.
    trustProxy: true,
  });
  app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES } });
  app.register(rateLimit, {
    max: deps.rateLimitMax ?? 300,
    timeWindow: "1 minute",
    allowList: (req) => req.url === "/health",
  });

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

  // Fastify routes capture their hook chain at registration time, so routes must
  // register after the rate-limit plugin boots or its onRequest hook is skipped.
  app.after(() => {
    app.get("/health", async () => ({ status: "ok" }));
    registerConvert(app, deps);
    registerJobs(app, deps);
    registerStats(app, deps);
  });
  return app;
}
