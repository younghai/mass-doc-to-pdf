import type { PrismaClient } from "@prisma/client";
import type { BatchDTO, BatchStatus, DocFormat, JobDTO, JobStatus, QualityStatus, StatsDTO } from "@hwptopdf/shared";

export interface CreateInput {
  filename: string;
  format: DocFormat;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  sourceKey: string;
  qualityMode?: string;
  batchId?: string;
}

function toDTO(j: {
  id: string;
  filename: string;
  format: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  qualityStatus: string | null;
  engine: string | null;
  durationMs: number | null;
  error: string | null;
  createdAt: Date;
}): JobDTO {
  return {
    id: j.id,
    filename: j.filename,
    format: j.format as DocFormat,
    extension: j.extension,
    mimeType: j.mimeType,
    sizeBytes: j.sizeBytes,
    status: j.status as JobStatus,
    engine: j.engine ?? null,
    ...(j.qualityStatus ? { qualityStatus: j.qualityStatus as QualityStatus } : {}),
    durationMs: j.durationMs ?? null,
    error: j.error ?? null,
    createdAt: j.createdAt.toISOString(),
  };
}

type QualityStatusPatch = {
  readonly qualityStatus?: QualityStatus;
};

type SuccessInput = QualityStatusPatch & {
  readonly engine: string;
  readonly durationMs: number;
  readonly outputKey: string;
};

type FailureInput = QualityStatusPatch & {
  readonly engine: string;
  readonly durationMs: number;
  readonly error: string;
};

type ListInput = {
  readonly status?: JobStatus;
  readonly qualityStatus?: QualityStatus;
  readonly take?: number;
};

function batchStatusFromCounts(pending: number, queued: number, running: number): BatchStatus {
  return pending + queued + running > 0 ? "active" : "completed";
}

export class JobService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(userId: string, input: CreateInput): Promise<JobDTO> {
    return toDTO(await this.prisma.conversionJob.create({ data: { userId, ...input } }));
  }

  async markSuccess(id: string, p: SuccessInput) {
    return toDTO(
      await this.prisma.conversionJob.update({
        where: { id },
        data: {
          status: "success",
          engine: p.engine,
          durationMs: p.durationMs,
          outputKey: p.outputKey,
          ...(p.qualityStatus ? { qualityStatus: p.qualityStatus } : {}),
        },
      }),
    );
  }

  async markRunning(id: string, p: { engine: string }) {
    return toDTO(
      await this.prisma.conversionJob.update({
        where: { id },
        // lockedAt doubles as a "running since" marker so the inline-mode reaper
        // (reapStaleRunning) can detect conversions stranded by an API crash.
        data: { status: "running", engine: p.engine, qualityStatus: null, error: null, lockedAt: new Date() },
      }),
    );
  }

  async markFailed(id: string, p: FailureInput) {
    return toDTO(
      await this.prisma.conversionJob.update({
        where: { id },
        data: {
          status: "failed",
          engine: p.engine,
          durationMs: p.durationMs,
          error: p.error,
          qualityStatus: p.qualityStatus ?? "failed",
          lockedAt: null,
          lockedBy: null,
        },
      }),
    );
  }

  /**
   * Inline-mode crash recovery: mark jobs stranded in `running` past a deadline
   * as failed so they don't spin the UI forever. Keyed off lockedAt ("running
   * since"), so a job that hasn't been marked running is never touched. Queue
   * mode uses JobQueue.requeueStale instead and must not call this.
   */
  async reapStaleRunning(staleBefore: Date): Promise<number> {
    const res = await this.prisma.conversionJob.updateMany({
      where: { status: "running", lockedAt: { lt: staleBefore } },
      data: {
        status: "failed",
        qualityStatus: "failed",
        error: "변환이 완료되기 전에 처리 프로세스가 중단됐습니다. 다시 시도하세요.",
        lockedAt: null,
        lockedBy: null,
      },
    });
    return res.count;
  }

  async countActive(userId: string): Promise<number> {
    return this.prisma.conversionJob.count({
      where: { userId, status: { in: ["pending", "queued", "running"] } },
    });
  }

  async markPending(id: string) {
    return toDTO(
      await this.prisma.conversionJob.update({
        where: { id },
        data: { status: "pending", qualityStatus: null, error: null, lockedAt: null, lockedBy: null },
      }),
    );
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const res = await this.prisma.conversionJob.deleteMany({ where: { id, userId } });
    return res.count > 0;
  }

  async get(userId: string, id: string): Promise<JobDTO | null> {
    const j = await this.prisma.conversionJob.findFirst({ where: { id, userId } });
    return j ? toDTO(j) : null;
  }

  /** Internal: includes storage keys for download/convert flows. */
  async getRaw(userId: string, id: string) {
    return this.prisma.conversionJob.findFirst({ where: { id, userId } });
  }

  async list(userId: string, opts: ListInput): Promise<JobDTO[]> {
    const rows = await this.prisma.conversionJob.findMany({
      where: {
        userId,
        ...(opts.status ? { status: opts.status } : {}),
        ...(opts.qualityStatus ? { qualityStatus: opts.qualityStatus } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: opts.take ?? 100,
    });
    return rows.map(toDTO);
  }

  async stats(userId: string): Promise<StatsDTO> {
    const rows = await this.prisma.conversionJob.groupBy({
      by: ["status"],
      where: { userId },
      _count: true,
    });
    const c = (s: string) => rows.find((r) => r.status === s)?._count ?? 0;
    const success = c("success");
    const failed = c("failed");
    const running = c("running");
    const queued = c("queued");
    const pending = c("pending");
    const total = success + failed + running + queued + pending;
    return {
      total,
      success,
      failed,
      running,
      queued,
      pending,
      successRate: success + failed ? success / (success + failed) : 0,
    };
  }

  async getBatch(userId: string, batchId: string): Promise<BatchDTO | null> {
    const rows = await this.prisma.conversionJob.findMany({
      where: { userId, batchId },
      select: { status: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const first = rows[0];
    if (!first) return null;

    const count = (status: JobStatus) => rows.filter((row) => row.status === status).length;
    const pending = count("pending");
    const queued = count("queued");
    const running = count("running");
    const success = count("success");
    const failed = count("failed");
    return {
      id: batchId,
      createdAt: first.createdAt.toISOString(),
      status: batchStatusFromCounts(pending, queued, running),
      total: rows.length,
      pending,
      queued,
      running,
      success,
      failed,
    };
  }
}
