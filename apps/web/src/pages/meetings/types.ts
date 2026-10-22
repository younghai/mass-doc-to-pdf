import type { MeetingMinutesDraft } from "@hwptopdf/shared";

export interface MeetingRecord extends MeetingMinutesDraft {
  readonly id: string;
  readonly updatedAt: string;
}

export const STORAGE_KEY = "hwptopdf.meeting-minutes.v1";

export const DEFAULT_TRANSCRIPT = [
  "영수: 회의 녹음 전사는 파일 업로드와 수동 전사 입력을 모두 지원하기로 결정했습니다.",
  "민지: 담당: 민지 다음 주까지 검토 화면에서 액션 아이템을 확인해야 합니다.",
  "지훈: STT 공급자는 비용과 보안 기준을 비교한 뒤 확정하나요?",
].join("\n");
