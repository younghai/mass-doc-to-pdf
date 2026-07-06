import type { MeetingMetrics } from "./meetingMetrics";

interface MeetingHeroProps {
  readonly metrics: MeetingMetrics;
  readonly onCopyInvite: () => void;
  readonly onEndMeeting: () => void;
  readonly onDeleteMeeting: () => void;
  readonly inviteCopied: boolean;
  readonly hasSelected: boolean;
}

export function MeetingHero({
  metrics,
  onCopyInvite,
  onEndMeeting,
  onDeleteMeeting,
  inviteCopied,
  hasSelected,
}: MeetingHeroProps) {
  return (
    <section className="meeting-hero" aria-label="회의 시작">
      <div className="meeting-hero-copy">
        <span>WHISPER MEETING OS</span>
        <h2>새 회의를 시작하세요</h2>
        <p>
          화자별 기록 · 안건 요약 · 업무 진행 계획
          <br />
          <span>{`기록 ${metrics.records}개`}</span>
        </p>
        <div className="meeting-hero-actions">
          <button className="meeting-primary-pill" type="button" onClick={onCopyInvite}>
            {inviteCopied ? "복사 완료" : "입장 링크 복사"}
          </button>
          <button className="meeting-outline-pill" type="button" disabled={!hasSelected} onClick={onEndMeeting}>
            회의 종료
          </button>
        </div>
      </div>
      <div className="meeting-signal-wrap">
        <div className="meeting-signal-card" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <p>Speaker labels · timestamps · action items</p>
      </div>
      <button className="meeting-delete-pill" type="button" disabled={!hasSelected} onClick={onDeleteMeeting}>
        삭제
      </button>
    </section>
  );
}
