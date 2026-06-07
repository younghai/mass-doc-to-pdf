import { buildApp } from "./app.js";
import { authPlugin } from "./auth/plugin.js";
import { devAuthPlugin } from "./auth/devPlugin.js";
import { ensureDevAuthUser } from "./auth/devAuth.js";
import { buildAuthConfig } from "./auth/authConfig.js";
import { buildRegistry } from "./convert/registry.js";
import { JobService } from "./jobs/jobService.js";
import { JobQueue } from "./queue/jobQueue.js";
import { LocalFileStorage, S3Storage, makeS3Client, type Storage } from "./storage/s3.js";
import { loadAppConfig } from "./config.js";
import { prisma } from "./db.js";

const cfg = loadAppConfig(process.env);

const authConfig = buildAuthConfig({
  prisma,
  googleId: cfg.auth.googleId,
  googleSecret: cfg.auth.googleSecret,
  secret: cfg.auth.secret,
});

const storage: Storage =
  cfg.storage.kind === "local"
    ? new LocalFileStorage(cfg.storage.root)
    : new S3Storage(makeS3Client(cfg.s3), cfg.s3.bucket);
const jobs = new JobService(prisma);
const registry = buildRegistry(cfg.engines);
// Opt-in durable queue: when enabled, the API enqueues and the worker process
// (worker-main) performs conversions. Default keeps the inline conversion path.
const queue = process.env.USE_QUEUE === "1" ? new JobQueue(prisma) : undefined;

const app = buildApp({
  registry,
  storage,
  jobs,
  queue,
  getSessionUser: (req) => app.getSessionUser(req),
});

if (cfg.auth.devAuth) {
  const devUser = await ensureDevAuthUser(prisma);
  await app.register(devAuthPlugin, { user: devUser });
} else {
  // Mount Auth.js routes + the getSessionUser decorator onto the same instance.
  await app.register(authPlugin, { config: authConfig });
}

app
  .listen({ port: cfg.port, host: "0.0.0.0" })
  .then((addr) => app.log.info(`hwptopdf api listening on ${addr}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
