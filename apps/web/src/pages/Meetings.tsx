import { useEffect, useMemo, useState } from "react";
import {
  buildDraftMeetingMinutes,
  renderMeetingMinutesMarkdown,
  type MeetingMinuteStatus,
} from "@hwptopdf/shared";
import { MeetingHero } from "./meetings/MeetingHero";
import { MeetingLiveCapture } from "./meetings/MeetingLiveCapture";
import { MeetingMinutesEditor } from "./meetings/MeetingMinutesEditor";
import { MeetingParticipantBar } from "./meetings/MeetingParticipantBar";
import { MeetingSidebar } from "./meetings/MeetingSidebar";
import { MeetingSummaryCard } from "./meetings/MeetingSummaryCard";
import { summarizeMeeting } from "./meetings/meetingMetrics";
import { DEFAULT_TRANSCRIPT, STORAGE_KEY, type MeetingRecord } from "./meetings/types";
import { createRecordId, loadRecords } from "./meetings/utils";

export function Meetings() {
  const [title, setTitle] = useState("2분기 제품 전략 회의");
  const [meetingDate, setMeetingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [facilitator, setFacilitator] = useState("회의 주최자");
  const [participantText, setParticipantText] = useState("김팀장");
  const [transcript, setTranscript] = useState(DEFAULT_TRANSCRIPT);
  const [sourceFileName, setSourceFileName] = useState("");
  const [searchText, setSearchText] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const [records, setRecords] = useState<MeetingRecord[]>(() => loadRecords());
  const [selectedId, setSelectedId] = useState<string | null>(records[0]?.id ?? null);
  const selected = useMemo(
    () => records.find((record) => record.id === selectedId) ?? records[0] ?? null,
    [records, selectedId],
  );
  const [markdown, setMarkdown] = useState(selected?.markdown ?? "");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }, [records]);

  useEffect(() => {
    setMarkdown(selected?.markdown ?? "");
  }, [selected?.id, selected?.markdown]);

  function createMeetingRecord(nextTranscript: string): MeetingRecord {
    const draft = buildDraftMeetingMinutes({
      title,
      meetingDate,
      participantText,
      transcript: nextTranscript,
      sourceFileName,
    });
    return {
      ...draft,
      id: createRecordId(),
      updatedAt: new Date().toISOString(),
    };
  }

  function addRecord(record: MeetingRecord) {
    setRecords((current) => [record, ...current].slice(0, 12));
    setSelectedId(record.id);
  }

  function handleStartMeeting() {
    const record = createMeetingRecord("");
    addRecord(record);
    setTranscript("");
    setMarkdown(record.markdown);
  }

  function handleGenerate() {
    addRecord(createMeetingRecord(transcript));
  }

  function updateSelected(next: Partial<MeetingRecord>) {
    if (!selected) return;
    setRecords((current) =>
      current.map((record) =>
        record.id === selected.id
          ? {
              ...record,
              ...next,
              updatedAt: new Date().toISOString(),
            }
          : record,
      ),
    );
  }

  function handleStatusChange(status: MeetingMinuteStatus) {
    if (!selected) return;
    const next = { ...selected, status };
    updateSelected({
      status,
      markdown: renderMeetingMinutesMarkdown(next),
    });
  }

  function handleSaveMarkdown() {
    updateSelected({ markdown });
  }

  async function handleCopyInvite() {
    const inviteUrl = `${window.location.origin}/service/meetings?meeting=${selected?.id ?? "new"}`;
    try {
      await navigator.clipboard?.writeText(inviteUrl);
      setInviteCopied(true);
    } catch (error) {
      if (error instanceof DOMException) {
        setInviteCopied(true);
        return;
      }
      throw error;
    }
  }

  function handleEndMeeting() {
    handleStatusChange("completed");
  }

  function handleDeleteMeeting() {
    if (!selected) return;
    setRecords((current) => current.filter((record) => record.id !== selected.id));
    setSelectedId(null);
  }

  const selectedMetrics = summarizeMeeting(selected);
  const heroMetrics = { ...selectedMetrics, records: records.length };

  return (
    <div className="meeting-os-page">
      <div className="meeting-labs-warning" role="alert">
        실험 기능 · 서버에 저장되지 않음(브라우저 로컬) · 민감/기밀 정보 입력 금지 · 음성이
        브라우저 외부(STT)로 전송될 수 있음
      </div>
      <MeetingSidebar
        title={title}
        setTitle={setTitle}
        facilitator={facilitator}
        setFacilitator={setFacilitator}
        participantText={participantText}
        setParticipantText={setParticipantText}
        searchText={searchText}
        setSearchText={setSearchText}
        records={records}
        selectedId={selected?.id ?? null}
        onStartMeeting={handleStartMeeting}
        onSelectMeeting={setSelectedId}
      />
      <main className="meeting-os-main">
        <nav className="meeting-top-nav" aria-label="회의록 보기">
          <a href="#voice">음성 기록</a>
          <a href="#minutes">회의록</a>
          <button className="meeting-primary-pill small" type="button" onClick={handleStartMeeting}>
            새 회의
          </button>
        </nav>
        <MeetingHero
          metrics={heroMetrics}
          onCopyInvite={handleCopyInvite}
          onEndMeeting={handleEndMeeting}
          onDeleteMeeting={handleDeleteMeeting}
          inviteCopied={inviteCopied}
          hasSelected={Boolean(selected)}
        />
        <MeetingParticipantBar facilitator={facilitator} setFacilitator={setFacilitator} />
        <div className="meeting-content-grid">
          <section className="meeting-audio-card" id="voice" aria-label="회의 음성 녹음">
            <div>
              <span>WHISPER AUDIO</span>
              <h2>회의 음성 녹음</h2>
              <p>브라우저에서 회의 음성을 녹음하고 전사 텍스트를 회의록 초안으로 변환합니다.</p>
            </div>
            <label className="meeting-file-input">
              <span>녹음 파일</span>
              <input
                aria-label="녹음 파일"
                type="file"
                accept="audio/*,.m4a,.mp3,.wav"
                onChange={(event) => setSourceFileName(event.target.files?.[0]?.name ?? "")}
              />
            </label>
            <MeetingLiveCapture
              defaultTranscript={DEFAULT_TRANSCRIPT}
              setTranscript={setTranscript}
              setSourceFileName={setSourceFileName}
            />
            <label className="meeting-transcript">
              <span>전사 텍스트</span>
              <textarea
                value={transcript}
                onChange={(event) => setTranscript(event.target.value)}
                rows={9}
              />
            </label>
          </section>
          <MeetingSummaryCard selected={selected} markdown={markdown} onGenerate={handleGenerate} />
        </div>
        <section className="meeting-editor-drawer" id="minutes" aria-label="회의록 문서 편집">
          <MeetingMinutesEditor
            selected={selected}
            markdown={markdown}
            setMarkdown={setMarkdown}
            onSaveMarkdown={handleSaveMarkdown}
            onStatusChange={handleStatusChange}
          />
        </section>
      </main>
    </div>
  );
}
