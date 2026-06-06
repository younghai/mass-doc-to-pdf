import type { PrismaClient } from "@prisma/client";
import type { JobDTO, JobStatus, StatsDTO, DocFormat } from "@hwptopdf/shared";

export interface CreateInput {
  filename: string;
  format: DocFormat;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  sourceKey: string;
}

function toDTO(j: {
  id: string;
  filename: string;
  format: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
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
    durationMs: j.durationMs ?? null,
    error: j.error ?? null,
    createdAt: j.createdAt.toISOString(),
  };
}

export class JobService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(userId: string, input: CreateInput): Promise<JobDTO> {
    return toDTO(await this.prisma.conversionJob.create({ data: { userId, ...input } }));
  }

  async markSuccess(id: string, p: { engine: string; durationMs: number; outputKey: string }) {
    return toDTO(
      await this.prisma.conversionJob.update({
        where: { id },
        data: { status: "success", ...p },
      }),
    );
  }

  async markRunning(id: string, p: { engine: string }) {
    return toDTO(
      await this.prisma.conversionJob.update({
        where: { id },
        data: { status: "running", engine: p.engine, error: null },
      }),
    );
  }

  async markFailed(id: string, p: { engine: string; durationMs: number; error: string }) {
    return toDTO(
      await this.prisma.conversionJob.update({
        where: { id },
        data: { status: "failed", ...p },
      }),
    );
  }

  async get(userId: string, id: string): Promise<JobDTO | null> {
    const j = await this.prisma.conversionJob.findFirst({ where: { id, userId } });
    return j ? toDTO(j) : null;
  }

  /** Internal: includes storage keys for download/convert flows. */
  async getRaw(userId: string, id: string) {
    return this.prisma.conversionJob.findFirst({ where: { id, userId } });
  }

  async list(userId: string, opts: { status?: JobStatus; take?: number }): Promise<JobDTO[]> {
    const rows = await this.prisma.conversionJob.findMany({
      where: { userId, ...(opts.status ? { status: opts.status } : {}) },
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
    const pending = c("pending");
    const total = success + failed + running + pending;
    return {
      total,
      success,
      failed,
      running,
      pending,
      successRate: success + failed ? success / (success + failed) : 0,
    };
  }
}
