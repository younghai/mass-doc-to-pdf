export type DocFormat = "office" | "hwp";
export type JobStatus = "pending" | "queued" | "running" | "success" | "failed";
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

// ---- Job state machine (single contract shared by API, workers, and UI) ----
export const JOB_STATUSES = ["pending", "queued", "running", "success", "failed"] as const;
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ["success", "failed"];

/** Allowed forward transitions. `failed -> queued` models an explicit retry. */
export const JOB_STATUS_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  pending: ["queued", "running", "failed"],
  queued: ["running", "failed"],
  running: ["success", "failed"],
  success: [],
  failed: ["queued"],
};

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return JOB_STATUS_TRANSITIONS[from].includes(to);
}

export function isTerminalJob(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}

// ---- Failure taxonomy (drives UX messaging + retry policy) ----
export type ConversionFailureReason =
  | "unsupported_format"
  | "password_protected"
  | "corrupt_file"
  | "engine_error"
  | "quality_gate_failed"
  | "timeout"
  | "too_large"
  | "unknown";

export type ConversionMode = "quick" | "precise";
export type QualityGrade = "good" | "acceptable" | "fallback" | "failed";
export type QualityStatus = "passed" | "review" | "failed";
export type QualityAttemptStatus = "success" | "failed";

export interface QualityAttempt {
  readonly engine: string;
  readonly status: QualityAttemptStatus;
  readonly durationMs: number;
  readonly error?: string;
}

export interface QualityChecks {
  readonly pdfBytes: number;
  readonly pageCount?: number;
  readonly sourceBytes?: number;
  readonly textChars?: number;
}

export interface QualityReport {
  readonly version: 1;
  readonly jobId: string;
  readonly filename: string;
  readonly format: DocFormat;
  readonly mode?: ConversionMode;
  readonly selectedEngine: string;
  readonly grade: QualityGrade;
  readonly status?: QualityStatus;
  readonly recommendedAction?: string;
  readonly checks: QualityChecks;
  readonly attempts: readonly QualityAttempt[];
  readonly warnings: readonly string[];
  readonly createdAt: string;
}

// ---- Batch: first-class aggregate for bulk conversion ----
export type BatchStatus = "active" | "completed";
export interface BatchDTO {
  id: string;
  createdAt: string; // ISO
  status: BatchStatus;
  total: number;
  pending: number;
  queued: number;
  running: number;
  success: number;
  failed: number;
}

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
  queued: number;
  pending: number;
  successRate: number; // 0..1, success / (success+failed)
}
