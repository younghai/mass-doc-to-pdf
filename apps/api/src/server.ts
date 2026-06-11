import { buildApp } from "./app.js";
import { authPlugin } from "./auth/plugin.js";
import { devAuthPlugin } from "./auth/devPlugin.js";
import { ensureDevAuthUser } from "./auth/devAuth.js";
import { buildAuthConfig } from "./auth/authConfig.js";
import { buildRegistry } from "./convert/registry.js";
import { applyPreflight, logEnginePreflight, probeEngines } from "./convert/preflight.js";
import { previewObjectKey, reportObjectKey } from "./convert/quality.js";
import { JobService } from "./jobs/jobService.js";
import { JobQueue } from "./queue/jobQueue.js";
import { LocalFileStorage, S3Storage, makeS3Client, type Storage } from "./storage/s3.js";
import { loadAppConfig } from "./config.js";
import { prisma, initSqlitePragmas } from "./db.js";

const cfg = loadAppConfig(process.env);
await initSqlitePragmas();

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
// Probe local runtime engines once at boot and drop the unavailable ones from
// the conversion chains, so a missing python/rhwp/chrome can't strand every job
// in `review` with a "disabled" failure attempt.
const preflight = await probeEngines(cfg.engines);
logEnginePreflight(preflight, cfg.engines);
const registry = buildRegistry(applyPreflight(cfg.engines, preflight));
// Opt-in durable queue: when enabled, the API enqueues and the worker process
// (worker-main) performs conversions. Default keeps the inline conversion path.
const queue = process.env.USE_QUEUE === "1" ? new JobQueue(prisma) : undefined;

// Inline mode has no worker to recover crashed conversions, so the API process
// reaps jobs stranded in `running` past a generous deadline and marks them
// failed (otherwise the UI polls a "변환 중" spinner forever). In queue mode the
// worker's requeueStale owns recovery, so we don't double up here.
if (!queue) {
  const reapIntervalMs = Number(process.env.REAPER_INTERVAL_MS ?? 60_000);
  const runningDeadlineMs = Number(process.env.RUNNING_DEADLINE_MS ?? 15 * 60_000);
  setInterval(() => {
    void jobs
      .reapStaleRunning(new Date(Date.now() - runningDeadlineMs))
      .then((n) => {
        if (n > 0) console.warn(`reaped ${n} stuck running job(s)`);
      })
      .catch((err) => console.error("reaper failed:", err));
  }, reapIntervalMs).unref();
}

const app = buildApp({
  registry,
  storage,
  jobs,
  queue,
  webOrigin: cfg.webOrigin,
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 300),
  enginePreflight: preflight,
  engineEndpoints: { hwpSidecarUrl: cfg.engines.hwpSidecarUrl, gotenbergUrl: cfg.engines.gotenbergUrl },
  getSessionUser: (req) => app.getSessionUser(req),
});

// Data retention sweep: delete jobs and their storage objects older than DATA_RETENTION_DAYS.
const retentionDays = Number(process.env.DATA_RETENTION_DAYS ?? 30);
const sweepIntervalMs = Number(process.env.RETENTION_SWEEP_INTERVAL_MS ?? 60 * 60_000);
setInterval(async () => {
  try {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60_000);
    const expired = await prisma.conversionJob.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true, userId: true, sourceKey: true, outputKey: true },
    });
    for (const job of expired) {
      const keys = [
        job.sourceKey,
        job.outputKey,
        reportObjectKey(job.userId, job.id),
        previewObjectKey(job.userId, job.id),
      ].filter((k): k is string => k != null);
      await Promise.allSettled(keys.map((key) => storage.delete(key)));
      await prisma.conversionJob.delete({ where: { id: job.id } });
    }
    if (expired.length > 0) console.info(`retention sweep: deleted ${expired.length} expired job(s)`);
  } catch (err) {
    console.error("retention sweep failed:", err);
  }
}, sweepIntervalMs).unref();

if (cfg.auth.devAuth) {
  const devUser = await ensureDevAuthUser(prisma);
  await app.register(devAuthPlugin, { user: devUser });
} else {
  // Mount Auth.js routes + the getSessionUser decorator onto the same instance.
  await app.register(authPlugin, {
    config: authConfig,
    rateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 60),
  });
}

app
  .listen({ port: cfg.port, host: "0.0.0.0" })
  .then((addr) => app.log.info(`hwptopdf api listening on ${addr}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
