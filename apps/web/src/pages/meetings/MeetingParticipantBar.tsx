import type { Dispatch, SetStateAction } from "react";

interface MeetingParticipantBarProps {
  readonly facilitator: string;
  readonly setFacilitator: Dispatch<SetStateAction<string>>;
}

export function MeetingParticipantBar({ facilitator, setFacilitator }: MeetingParticipantBarProps) {
  return (
    <section className="meeting-participant-bar" aria-label="참여자 입장">
      <div>
        <h2>참여자님으로 입장 중</h2>
        <p>새 기록의 기본 작성자로 사용합니다.</p>
      </div>
      <label>
        <span>표시 이름</span>
        <input
          aria-label="표시 이름"
          value={facilitator}
          onChange={(event) => setFacilitator(event.target.value)}
        />
      </label>
      <button className="meeting-outline-pill" type="button">
        이름 변경
      </button>
    </section>
  );
}
