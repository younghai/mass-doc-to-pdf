export type DocFormat = "office" | "hwp";
export type JobStatus = "pending" | "running" | "success" | "failed";
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export interface JobDTO {
  id: string;
  filename: string;
  format: DocFormat;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  status: JobStatus;
  engine: string | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string; // ISO
}

export interface StatsDTO {
  total: number;
  success: number;
  failed: number;
  running: number;
  pending: number;
  successRate: number; // 0..1, success / (success+failed)
}
