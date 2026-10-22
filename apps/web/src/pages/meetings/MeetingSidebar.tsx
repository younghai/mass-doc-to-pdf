import type { Dispatch, SetStateAction } from "react";
import type { MeetingRecord } from "./types";
import { formatUpdatedAt } from "./utils";
import { statusLabel } from "./meetingMetrics";

interface MeetingSidebarProps {
  readonly title: string;
  readonly setTitle: Dispatch<SetStateAction<string>>;
  readonly facilitator: string;
  readonly setFacilitator: Dispatch<SetStateAction<string>>;
  readonly participantText: string;
  readonly setParticipantText: Dispatch<SetStateAction<string>>;
  readonly searchText: string;
  readonly setSearchText: Dispatch<SetStateAction<string>>;
  readonly records: readonly MeetingRecord[];
  readonly selectedId: string | null;
  readonly onStartMeeting: () => void;
  readonly onSelectMeeting: (id: string) => void;
}

export function MeetingSidebar({
  title,
  setTitle,
  facilitator,
  setFacilitator,
  participantText,
  setParticipantText,
  searchText,
  setSearchText,
  records,
  selectedId,
  onStartMeeting,
  onSelectMeeting,
}: MeetingSidebarProps) {
  const filteredRecords = filterRecords(records, searchText);

  return (
    <aside className="meeting-command-rail" aria-label="회의 관리">
      <h1>Bzengage Minutes</h1>
      <label>
        <span>회의 제목</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        <span>진행자</span>
        <input value={facilitator} onChange={(event) => setFacilitator(event.target.value)} />
      </label>
      <label>
        <span>참여자</span>
        <input value={participantText} onChange={(event) => setParticipantText(event.target.value)} />
      </label>
      <button className="meeting-primary-pill" type="button" onClick={onStartMeeting}>
        새 회의 시작
      </button>
      <label>
        <span>회의 검색</span>
        <input
          aria-label="회의 검색"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="제목, 참여자, 내용 검색"
        />
      </label>
      <div className="meeting-rail-section">
        <div className="meeting-rail-title">
          <span>최근 회의</span>
          <button type="button" onClick={() => setSearchText("")}>
            새로고침
          </button>
        </div>
        <div className="meeting-rail-records">
          {filteredRecords.length === 0 ? (
            <p>아직 표시할 회의가 없습니다.</p>
          ) : (
            filteredRecords.map((record) => (
              <button
                key={record.id}
                type="button"
                className={record.id === selectedId ? "meeting-rail-record active" : "meeting-rail-record"}
                onClick={() => onSelectMeeting(record.id)}
              >
                <strong>{record.title}</strong>
                <span>
                  {statusLabel(record.status)} · {formatUpdatedAt(record.updatedAt)}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}

function filterRecords(records: readonly MeetingRecord[], searchText: string): readonly MeetingRecord[] {
  const query = searchText.trim().toLowerCase();
  if (!query) return records;
  return records.filter((record) =>
    [record.title, record.meetingDate, record.participants.join(" "), record.markdown]
      .join(" ")
      .toLowerCase()
      .includes(query),
  );
}
