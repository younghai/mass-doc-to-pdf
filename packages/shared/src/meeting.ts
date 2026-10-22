export type MeetingMinuteStatus = "draft" | "needs_review" | "completed";
export type MeetingActionStatus = "open" | "in_progress" | "done" | "cancelled";

export const MEETING_MINUTE_STATUSES = ["draft", "needs_review", "completed"] as const;

export interface MeetingActionItem {
  readonly text: string;
  readonly owner: string;
  readonly dueDate: string;
  readonly status: MeetingActionStatus;
  readonly sourceLine?: string;
}

export interface MeetingMinutesInput {
  readonly title: string;
  readonly meetingDate?: string;
  readonly participantText?: string;
  readonly transcript: string;
  readonly sourceFileName?: string;
  readonly generatedAt?: string;
}

export interface MeetingMinutesDraft {
  readonly title: string;
  readonly meetingDate: string;
  readonly participants: readonly string[];
  readonly status: MeetingMinuteStatus;
  readonly sourceFileName?: string;
  readonly generatedAt: string;
  readonly summary: readonly string[];
  readonly decisions: readonly string[];
  readonly actionItems: readonly MeetingActionItem[];
  readonly openQuestions: readonly string[];
  readonly transcriptHighlights: readonly string[];
  readonly markdown: string;
}

const STATUS_LABELS: Record<MeetingMinuteStatus, string> = {
  draft: "초안",
  needs_review: "검토 필요",
  completed: "완료",
};

const ACTION_STATUS_LABELS: Record<MeetingActionStatus, string> = {
  open: "대기",
  in_progress: "진행 중",
  done: "완료",
  cancelled: "취소",
};

const DECISION_KEYWORDS = ["결정", "합의", "확정", "하기로", "채택", "승인"];
const ACTION_KEYWORDS = ["담당", "액션", "TODO", "해야", "진행", "준비", "공유", "까지"];
const QUESTION_KEYWORDS = ["?", "질문", "확인 필요", "논의 필요", "미정", "보류"];
const MAX_LINE_LENGTH = 180;

export function parseMeetingParticipants(participantText = ""): string[] {
  const seen = new Set<string>();
  return participantText
    .split(/[\n,;]+/u)
    .map((part) => part.trim())
    .filter((part) => {
      if (!part || seen.has(part)) return false;
      seen.add(part);
      return true;
    });
}

export function buildDraftMeetingMinutes(input: MeetingMinutesInput): MeetingMinutesDraft {
  const title = cleanText(input.title) || "회의록";
  const meetingDate = cleanText(input.meetingDate) || "미정";
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const participants = parseMeetingParticipants(input.participantText);
  const lines = normalizeTranscriptLines(input.transcript);
  const decisions = uniqueLines(lines.filter(isDecisionLine)).slice(0, 8);
  const actionItems = uniqueLines(lines.filter(isActionLine))
    .slice(0, 10)
    .map((line) => ({
      text: stripSpeaker(line),
      owner: extractOwner(line),
      dueDate: extractDueDate(line),
      status: "open" as const,
      sourceLine: line,
    }));
  const openQuestions = uniqueLines(lines.filter(containsAny(QUESTION_KEYWORDS))).slice(0, 8);
  const transcriptHighlights = lines.slice(0, 6);
  const summary = buildSummary(lines);
  const draftBase = {
    title,
    meetingDate,
    participants,
    status: lines.length > 0 ? ("needs_review" as const) : ("draft" as const),
    sourceFileName: cleanText(input.sourceFileName) || undefined,
    generatedAt,
    summary,
    decisions,
    actionItems,
    openQuestions,
    transcriptHighlights,
  };

  return {
    ...draftBase,
    markdown: renderMeetingMinutesMarkdown(draftBase),
  };
}

export function renderMeetingMinutesMarkdown(
  minutes: Omit<MeetingMinutesDraft, "markdown">,
): string {
  const sourceLine = minutes.sourceFileName ? `\n- 원본: ${minutes.sourceFileName}` : "";
  return [
    `# ${minutes.title}`,
    "",
    `- 일시: ${minutes.meetingDate}`,
    `- 참석자: ${minutes.participants.length ? minutes.participants.join(", ") : "미정"}`,
    `- 상태: ${STATUS_LABELS[minutes.status]}`,
    `- 생성일: ${minutes.generatedAt}${sourceLine}`,
    "",
    "## 요약",
    renderBulletList(minutes.summary),
    "",
    "## 결정 사항",
    renderBulletList(minutes.decisions),
    "",
    "## 액션 아이템",
    renderActionTable(minutes.actionItems),
    "",
    "## 미해결 질문",
    renderBulletList(minutes.openQuestions),
    "",
    "## 전사 하이라이트",
    renderBulletList(minutes.transcriptHighlights),
    "",
  ].join("\n");
}

function buildSummary(lines: readonly string[]): string[] {
  if (lines.length === 0) return ["전사 내용이 아직 없습니다."];
  return lines
    .filter((line) => !containsAny([...DECISION_KEYWORDS, ...ACTION_KEYWORDS])(line))
    .concat(lines)
    .map(stripSpeaker)
    .filter(Boolean)
    .slice(0, 3);
}

function normalizeTranscriptLines(transcript: string): string[] {
  return transcript
    .split(/\r?\n/u)
    .flatMap((line) => line.split(/(?<=[.!?。！？])\s+/u))
    .map((line) => cleanText(line.replace(/^[-*•\d.)\s]+/u, "")))
    .filter(Boolean)
    .map((line) => truncateLine(line, MAX_LINE_LENGTH));
}

function cleanText(value?: string): string {
  return (value ?? "").replace(/\s+/gu, " ").trim();
}

function truncateLine(line: string, maxLength: number): string {
  if (line.length <= maxLength) return line;
  return `${line.slice(0, maxLength - 1)}…`;
}

function uniqueLines(lines: readonly string[]): string[] {
  const seen = new Set<string>();
  return lines.filter((line) => {
    const key = stripSpeaker(line).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function containsAny(keywords: readonly string[]) {
  return (line: string) => keywords.some((keyword) => line.includes(keyword));
}

function isDecisionLine(line: string): boolean {
  return containsAny(DECISION_KEYWORDS)(line) && !containsAny(QUESTION_KEYWORDS)(line);
}

function isActionLine(line: string): boolean {
  return containsAny(ACTION_KEYWORDS)(line) && !isDecisionLine(line);
}

function stripSpeaker(line: string): string {
  return cleanText(line.replace(/^[^:：]{1,24}[:：]\s*/u, ""));
}

function extractOwner(line: string): string {
  const ownerByLabel = line.match(/담당\s*[:：]\s*([^\s,;|]+)/u);
  if (ownerByLabel?.[1]) return ownerByLabel[1];

  const ownerByVerb = line.match(/^([가-힣A-Za-z0-9._-]{2,20})(?:님)?(?:이|가)?\s*(?:진행|준비|공유|확인)/u);
  if (ownerByVerb?.[1]) return ownerByVerb[1];

  return "미정";
}

function extractDueDate(line: string): string {
  const date = line.match(
    /(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}|오늘|내일|이번 주|다음 주|[월화수목금토일]요일|말일까지|EOD)/u,
  );
  return date?.[1] ?? "미정";
}

function renderBulletList(items: readonly string[]): string {
  if (items.length === 0) return "- 없음";
  return items.map((item) => `- ${stripSpeaker(item)}`).join("\n");
}

function renderActionTable(actionItems: readonly MeetingActionItem[]): string {
  if (actionItems.length === 0) return "액션 아이템 없음";
  const rows = actionItems.map((item) =>
    [
      ACTION_STATUS_LABELS[item.status],
      escapeTableCell(item.owner),
      escapeTableCell(item.dueDate),
      escapeTableCell(item.text),
    ].join(" | "),
  );
  return ["| 상태 | 담당 | 기한 | 내용 |", "| --- | --- | --- | --- |", ...rows.map((row) => `| ${row} |`)].join(
    "\n",
  );
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/gu, "\\|");
}
