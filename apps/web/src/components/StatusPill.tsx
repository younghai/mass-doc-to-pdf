import type { JobStatus } from "@hwptopdf/shared";

const LABEL: Record<JobStatus, string> = {
  pending: "대기",
  queued: "대기열",
  running: "변환 중",
  success: "성공",
  failed: "실패",
};

export function StatusPill({ status }: { status: JobStatus }) {
  return <span className={`pill pill-${status}`}>{LABEL[status]}</span>;
}
