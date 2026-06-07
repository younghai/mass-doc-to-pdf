import { randomUUID } from "node:crypto";
import { buildRegistry } from "../convert/registry.js";
import { JobService } from "../jobs/jobService.js";
import { LocalFileStorage, S3Storage, makeS3Client, type Storage } from "../storage/s3.js";
import { loadAppConfig } from "../config.js";
import { prisma } from "../db.js";
import { JobQueue } from "./jobQueue.js";
import { runWorkerLoop } from "./worker.js";

// Standalone worker process: claims queued conversion jobs and runs them,
// decoupled from the HTTP API so restarts/crashes never lose work.
const cfg = loadAppConfig(process.env);

const storage: Storage =
  cfg.storage.kind === "local"
    ? new LocalFileStorage(cfg.storage.root)
    : new S3Storage(makeS3Client(cfg.s3), cfg.s3.bucket);
const jobs = new JobService(prisma);
const registry = buildRegistry(cfg.engines);
const queue = new JobQueue(prisma, {
  visibilityTimeoutMs: Number(process.env.WORKER_VISIBILITY_TIMEOUT_MS ?? 5 * 60_000),
  maxAttempts: Number(process.env.WORKER_MAX_ATTEMPTS ?? 3),
});

const workerId = `${process.env.WORKER_ID ?? "worker"}-${randomUUID().slice(0, 8)}`;

let resolveStop: () => void = () => {};
const stop = new Promise<void>((resolve) => {
  resolveStop = resolve;
});
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => resolveStop());
}

console.log(`hwptopdf worker ${workerId} started`);
runWorkerLoop(
  { registry, storage, jobs, queue },
  { workerId, idlePollMs: Number(process.env.WORKER_IDLE_POLL_MS ?? 1000), stop },
)
  .then(async () => {
    console.log(`hwptopdf worker ${workerId} stopped`);
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
