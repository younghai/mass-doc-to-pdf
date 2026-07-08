import { MeetingMarkdownDocument, buildMeetingMinutesHtmlDocument } from "./MeetingMarkdownDocument";
import { summarizeMeeting, type MeetingMetrics } from "./meetingMetrics";
import type { MeetingRecord } from "./types";
import { buildDocumentFileName, downloadTextFile } from "./utils";

interface MeetingSummaryCardProps {
  readonly selected: MeetingRecord | null;
  readonly markdown: string;
  readonly onGenerate: () => void;
}

type ExportFormat = "markdown" | "html" | "word";

export function MeetingSummaryCard({ selected, markdown, onGenerate }: MeetingSummaryCardProps) {
  const metrics = summarizeMeeting(selected);
  const canExport = Boolean(selected && markdown.trim());

  function handleExport(format: ExportFormat) {
    if (!selected) return;

    switch (format) {
      case "markdown":
        downloadTextFile(markdown, "text/markdown;charset=utf-8", buildDocumentFileName(selected.title, "md"));
        return;
      case "html":
        downloadTextFile(
          buildMeetingMinutesHtmlDocument({ title: selected.title, markdown }),
          "text/html;charset=utf-8",
          buildDocumentFileName(selected.title, "html"),
        );
        return;
      case "word":
        downloadTextFile(
          buildMeetingMinutesHtmlDocument({ title: selected.title, markdown }),
          "application/msword;charset=utf-8",
          buildDocumentFileName(selected.title, "doc"),
        );
        return;
      default:
        assertNever(format);
    }
  }

  return (
    <aside className="meeting-summary-card" aria-label="회의 요약">
      <button className="meeting-primary-pill" type="button" onClick={onGenerate}>
        회의록 초안 생성
      </button>
      <button className="meeting-export-pill" type="button" disabled={!canExport} onClick={() => handleExport("markdown")}>
        Markdown export
      </button>
      <div className="meeting-export-row">
        <button type="button" disabled={!canExport} onClick={() => handleExport("html")}>
          HTML export
        </button>
        <button type="button" disabled={!canExport} onClick={() => handleExport("word")}>
          Word export
        </button>
      </div>
      <MeetingMetricGrid metrics={metrics} />
      <div className="meeting-summary-body">
        <h2>회의 요약</h2>
        {selected ? (
          <ul>
            {selected.summary.slice(0, 3).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p>전사 완료 후 회의록 초안을 생성하세요.</p>
        )}
      </div>
      <div className="meeting-summary-preview">
        <MeetingMarkdownDocument markdown={markdown} ariaLabel="회의 요약 문서 미리보기" />
      </div>
    </aside>
  );
}

function MeetingMetricGrid({ metrics }: { readonly metrics: MeetingMetrics }) {
  return (
    <dl className="meeting-metric-grid">
      <div>
        <dt>기록</dt>
        <dd>{metrics.records}</dd>
      </div>
      <div>
        <dt>결정</dt>
        <dd>{metrics.decisions}</dd>
      </div>
      <div>
        <dt>액션</dt>
        <dd>{metrics.actions}</dd>
      </div>
    </dl>
  );
}

function assertNever(value: never): never {
  throw new Error(`Unhandled export format: ${value}`);
}
