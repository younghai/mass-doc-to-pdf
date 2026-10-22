import type { MeetingMinuteStatus } from "@hwptopdf/shared";
import { STORAGE_KEY, type MeetingRecord } from "./types";

export function loadRecords(): MeetingRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMeetingRecord);
  } catch (error) {
    if (error instanceof SyntaxError) return [];
    if (typeof DOMException !== "undefined" && error instanceof DOMException) return [];
    throw error;
  }
}

export function createRecordId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `meeting-${Date.now()}`;
}

export function parseMeetingMinuteStatus(value: string): MeetingMinuteStatus {
  switch (value) {
    case "draft":
      return "draft";
    case "needs_review":
      return "needs_review";
    case "completed":
      return "completed";
    default:
      return "draft";
  }
}

export function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function downloadTextFile(content: string, mimeType: string, fileName: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  anchor.remove();
  revokeObjectUrl(url);
}

export function buildDocumentFileName(title: string, extension: string): string {
  return `${slugify(title)}.minutes.${extension}`;
}

export function revokeObjectUrl(url: string) {
  if (url && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
}

function isMeetingRecord(value: unknown): value is MeetingRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "updatedAt" in value &&
    "title" in value &&
    "meetingDate" in value &&
    "status" in value &&
    "markdown" in value &&
    typeof value.id === "string" &&
    typeof value.updatedAt === "string" &&
    typeof value.title === "string" &&
    typeof value.meetingDate === "string" &&
    typeof value.status === "string" &&
    typeof value.markdown === "string"
  );
}

function slugify(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]+/gu, "-")
      .replace(/^-|-$/gu, "") || "meeting"
  );
}
