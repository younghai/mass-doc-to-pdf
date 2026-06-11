import type { JobService } from "../jobs/jobService.js";
import { JobQueue } from "./jobQueue.js";
import { processConversion, type WorkerDeps } from "./processConversion.js";

export interface WorkerRuntimeDeps extends WorkerDeps {
  readonly jobs: JobService;
  readonly queue: JobQueue;
}

/**
 * Process at most one job. Returns true if a job was handled, false if the
 * queue was empty (so the loop can back off). Conversion failures are routed
 * through the queue's retry policy; permanent failures are marked failed.
 */
export async function runWorkerOnce(deps: WorkerRuntimeDeps, workerId: string): Promise<boolean> {
  const job = await deps.queue.claimNext(workerId);
  if (!job) return false;

  const result = await processConversion(deps, job);
  if (result.ok) {
    await deps.queue.release(job.id);
    return true;
  }

  const { willRetry } = await deps.queue.retryOrGiveUp(job.id);
  if (!willRetry) {
    await deps.jobs.markFailed(job.id, {
      engine: result.engine,
      durationMs: result.durationMs,
      error: result.error,
    });
  }
  return true;
}

export interface WorkerLoopOptions {
  readonly workerId: string;
  readonly idlePollMs?: number;
  readonly staleSweepMs?: number;
  /** Backoff after an unexpected iteration error (DB/storage outage). */
  readonly errorBackoffMs?: number;
  /** Stop signal — when it resolves, the loop exits after the current job. */
  readonly stop?: Promise<void>;
}

/**
 * Long-running worker loop: claims and processes jobs, backing off when idle and
 * periodically requeuing stale (crashed-worker) jobs.
 */
export async function runWorkerLoop(deps: WorkerRuntimeDeps, opts: WorkerLoopOptions): Promise<void> {
  const idlePollMs = opts.idlePollMs ?? 1000;
  const staleSweepMs = opts.staleSweepMs ?? 60_000;
  const errorBackoffMs = opts.errorBackoffMs ?? 5_000;
  let stopped = false;
  void opts.stop?.then(() => {
    stopped = true;
  });

  let lastSweep = 0;
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  while (!stopped) {
    try {
      const nowMs = Date.now();
      if (nowMs - lastSweep > staleSweepMs) {
        await deps.queue.requeueStale();
        lastSweep = nowMs;
      }
      const didWork = await runWorkerOnce(deps, opts.workerId);
      if (!didWork) await wait(idlePollMs);
    } catch (err) {
      // A single poisoned job or a transient DB/storage outage must not kill
      // the worker: exiting puts systemd/compose into a claim -> crash ->
      // restart loop on the same job. Log, back off, keep serving the queue.
      console.error(`worker ${opts.workerId} iteration failed:`, err);
      await wait(errorBackoffMs);
    }
  }
}
