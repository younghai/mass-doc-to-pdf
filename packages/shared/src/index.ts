export type DocFormat = "office" | "hwp";
export type JobStatus = "pending" | "success" | "failed";

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
  pending: number;
  successRate: number; // 0..1, success / (success+failed)
}
