import type { Dispatch, SetStateAction } from "react";
import type { MeetingMinuteStatus } from "@hwptopdf/shared";
import { MeetingMarkdownDocument, buildMeetingMinutesHtmlDocument } from "./MeetingMarkdownDocument";
import type { MeetingRecord } from "./types";
import {
  buildDocumentFileName,
  downloadTextFile,
  formatUpdatedAt,
  parseMeetingMinuteStatus,
} from "./utils";

type DownloadFormat = "markdown" | "html" | "word";

interface MeetingMinutesEditorProps {
  readonly selected: MeetingRecord | null;
  readonly markdown: string;
  readonly setMarkdown: Dispatch<SetStateAction<string>>;
  readonly onSaveMarkdown: () => void;
  readonly onStatusChange: (status: MeetingMinuteStatus) => void;
}

export function MeetingMinutesEditor({
  selected,
  markdown,
  setMarkdown,
  onSaveMarkdown,
  onStatusChange,
}: MeetingMinutesEditorProps) {
  const canUseDocument = Boolean(selected && markdown.trim());
  const title = selected?.title ?? "회의록";

  function handleDownload(format: DownloadFormat) {
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
    <section className="meeting-panel" aria-label="회의록 편집">
      <div className="meeting-editor-head">
        <div>
          <h3>{selected?.title ?? "생성된 회의록 없음"}</h3>
          {selected && <p>{formatUpdatedAt(selected.updatedAt)}</p>}
        </div>
        <select
          aria-label="회의록 상태"
          value={selected?.status ?? "draft"}
          disabled={!selected}
          onChange={(event) => onStatusChange(parseMeetingMinuteStatus(event.target.value))}
        >
          <option value="draft">초안</option>
          <option value="needs_review">검토 필요</option>
          <option value="completed">완료</option>
        </select>
      </div>

      <div className="meeting-document-shell" aria-label={`${title} 문서 보기`}>
        <MeetingMarkdownDocument markdown={markdown} />
      </div>

      <textarea
        aria-label="회의록 Markdown"
        className="meeting-markdown"
        value={markdown}
        rows={14}
        onChange={(event) => setMarkdown(event.target.value)}
        placeholder="회의록 초안을 생성하면 여기에 표시됩니다."
      />
      <div className="meeting-actions">
        <button className="btn secondary" type="button" disabled={!selected} onClick={onSaveMarkdown}>
          저장
        </button>
        <button className="btn secondary" type="button" disabled={!canUseDocument} onClick={() => handleDownload("html")}>
          HTML 다운로드
        </button>
        <button className="btn secondary" type="button" disabled={!canUseDocument} onClick={() => handleDownload("word")}>
          Word 다운로드
        </button>
        <button className="btn" type="button" disabled={!selected} onClick={() => handleDownload("markdown")}>
          MD 다운로드
        </button>
      </div>
    </section>
  );
}

function assertNever(value: never): never {
  throw new Error(`Unhandled download format: ${value}`);
}
