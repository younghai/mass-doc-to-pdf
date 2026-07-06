import type { MeetingRecord } from "./types";

export interface MeetingMetrics {
  readonly records: number;
  readonly decisions: number;
  readonly actions: number;
}

export function summarizeMeeting(record: MeetingRecord | null): MeetingMetrics {
  return {
    records: record ? record.transcriptHighlights.length : 0,
    decisions: record ? record.decisions.length : 0,
    actions: record ? record.actionItems.length : 0,
  };
}

export function statusLabel(status: MeetingRecord["status"]): string {
  switch (status) {
    case "draft":
      return "초안";
    case "needs_review":
      return "검토 중";
    case "completed":
      return "완료";
    default:
      return assertNever(status);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled meeting status: ${value}`);
}
