import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import { MAX_UPLOAD_BYTES } from "@hwptopdf/shared";
import type { Registry } from "./convert/registry.js";
import type { Storage } from "./storage/s3.js";
import type { JobService } from "./jobs/jobService.js";
import type { JobQueue } from "./queue/jobQueue.js";
import type { SessionUser } from "./auth/plugin.js";
import { registerConvert } from "./routes/convert.js";
import { registerJobs } from "./routes/jobs.js";
import { registerStats } from "./routes/stats.js";

export interface AppDeps {
  registry: Registry;
  storage: Storage;
  jobs: JobService;
  /** When provided, conversions are enqueued for the worker instead of run inline. */
  queue?: JobQueue;
  getSessionUser(req: FastifyRequest): Promise<SessionUser | null>;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES } });
  app.get("/health", async () => ({ status: "ok" }));
  registerConvert(app, deps);
  registerJobs(app, deps);
  registerStats(app, deps);
  return app;
}
