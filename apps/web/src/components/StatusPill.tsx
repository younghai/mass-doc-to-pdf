import type { JobStatus } from "@hwptopdf/shared";

const LABEL: Record<JobStatus, string> = { success: "성공", failed: "실패", pending: "대기" };

export function StatusPill({ status }: { status: JobStatus }) {
  return <span className={`pill pill-${status}`}>{LABEL[status]}</span>;
}
