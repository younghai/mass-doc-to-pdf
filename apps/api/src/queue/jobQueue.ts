import type { PrismaClient } from "@prisma/client";
import type { ConversionMode, DocFormat } from "@hwptopdf/shared";

export interface QueuedJob {
  readonly id: string;
  readonly userId: string;
  readonly filename: string;
  readonly format: DocFormat;
  readonly extension: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sourceKey: string;
  readonly qualityMode: ConversionMode;
  readonly attempts: number;
}

export interface JobQueueOptions {
  /** A locked (running) job whose lock is older than this is treated as crashed and reclaimable. */
  readonly visibilityTimeoutMs?: number;
  /** Maximum number of attempts before a failure is permanent. */
  readonly maxAttempts?: number;
}

type JobRow = {
  id: string;
  userId: string;
  filename: string;
  format: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  sourceKey: string;
  qualityMode: string | null;
  attempts: number;
  status: string;
  lockedAt: Date | null;
};

function toQueuedJob(row: JobRow): QueuedJob {
  return {
    id: row.id,
    userId: row.userId,
    filename: row.filename,
    format: row.format as DocFormat,
    extension: row.extension,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    sourceKey: row.sourceKey,
    qualityMode: (row.qualityMode as ConversionMode) ?? "precise",
    attempts: row.attempts,
  };
}

/**
 * Durable, DB-backed job queue (P1). Works with SQLite or Postgres via Prisma —
 * no Redis dependency, so it fits the no-Docker standalone deployment.
 *
 * Lifecycle: enqueue -> claimNext (atomic lock) -> release (success) | retryOrGiveUp (failure).
 * Crashed workers are recovered by requeueStale()/claimNext picking up expired locks.
 */
export class JobQueue {
  private readonly visibilityTimeoutMs: number;
  private readonly maxAttempts: number;

  constructor(
    private readonly prisma: PrismaClient,
    opts: JobQueueOptions = {},
  ) {
    // Above the engine-chain worst case (rhwp-cli + rhwp + h2orestart + builtin
    // can exceed 5 min on a pathological file) so a slow-but-alive worker is not
    // reclaimed mid-conversion and double-processed.
    this.visibilityTimeoutMs = opts.visibilityTimeoutMs ?? 15 * 60_000;
    this.maxAttempts = opts.maxAttempts ?? 3;
  }

  /** Move a created/failed job into the queue. */
  async enqueue(jobId: string): Promise<void> {
    await this.prisma.conversionJob.update({
      where: { id: jobId },
      data: { status: "queued", lockedAt: null, lockedBy: null, error: null },
    });
  }

  /**
   * Atomically claim the oldest queued job (or a crashed running job whose lock
   * has expired). Returns null when nothing is available.
   */
  async claimNext(workerId: string, now: Date = new Date()): Promise<QueuedJob | null> {
    const staleBefore = new Date(now.getTime() - this.visibilityTimeoutMs);

    for (let guard = 0; guard < 25; guard++) {
      const candidate = (await this.prisma.conversionJob.findFirst({
        where: {
          OR: [{ status: "queued" }, { status: "running", lockedAt: { lt: staleBefore } }],
        },
        orderBy: { createdAt: "asc" },
      })) as JobRow | null;
      if (!candidate) return null;

      // Optimistic guard: only claim if the row is still exactly as observed.
      // NOTE: attempts is NOT incremented here — a claim is a lease, not a
      // conversion attempt. Counting claims would let crash/visibility-timeout
      // reclaims (infra failures) burn the retry budget without a single
      // conversion ever failing. The counter is bumped only on real failures in
      // retryOrGiveUp().
      const res = await this.prisma.conversionJob.updateMany({
        where: { id: candidate.id, status: candidate.status, lockedAt: candidate.lockedAt },
        data: {
          status: "running",
          lockedAt: now,
          lockedBy: workerId,
        },
      });
      if (res.count === 1) {
        const claimed = (await this.prisma.conversionJob.findUnique({
          where: { id: candidate.id },
        })) as JobRow | null;
        return claimed ? toQueuedJob(claimed) : null;
      }
      // Lost the race to another worker — try the next candidate.
    }
    return null;
  }

  /** Clear the lock after a successful conversion (status is set via JobService.markSuccess). */
  async release(jobId: string): Promise<void> {
    await this.prisma.conversionJob.update({
      where: { id: jobId },
      data: { lockedAt: null, lockedBy: null },
    });
  }

  /**
   * Record a real conversion failure and decide its fate. Increments attempts
   * (this is the only place attempts grows), re-queues until maxAttempts is
   * reached, otherwise clears the lock so the caller can mark it permanently
   * failed.
   */
  async retryOrGiveUp(jobId: string): Promise<{ willRetry: boolean }> {
    const job = (await this.prisma.conversionJob.findUnique({
      where: { id: jobId },
    })) as JobRow | null;
    if (!job) return { willRetry: false };

    const attempts = job.attempts + 1;
    if (attempts < this.maxAttempts) {
      await this.prisma.conversionJob.update({
        where: { id: jobId },
        data: { status: "queued", lockedAt: null, lockedBy: null, attempts },
      });
      return { willRetry: true };
    }
    await this.prisma.conversionJob.update({
      where: { id: jobId },
      data: { lockedAt: null, lockedBy: null, attempts },
    });
    return { willRetry: false };
  }

  /** Requeue jobs stuck in running with an expired lock (e.g. after a worker crash). */
  async requeueStale(now: Date = new Date()): Promise<number> {
    const staleBefore = new Date(now.getTime() - this.visibilityTimeoutMs);
    const res = await this.prisma.conversionJob.updateMany({
      where: { status: "running", lockedAt: { lt: staleBefore } },
      data: { status: "queued", lockedAt: null, lockedBy: null },
    });
    return res.count;
  }

  /** Number of jobs currently waiting to be processed. */
  async depth(): Promise<number> {
    return this.prisma.conversionJob.count({ where: { status: "queued" } });
  }
}
