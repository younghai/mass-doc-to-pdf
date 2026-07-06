import { describe, expect, it } from "vitest";
import { buildDraftMeetingMinutes, parseMeetingParticipants } from "./meeting.js";

describe("meeting minutes draft", () => {
  it("parses unique participants from comma and line separated input", () => {
    expect(parseMeetingParticipants("영수, 민지\n영수; 지훈")).toEqual(["영수", "민지", "지훈"]);
  });

  it("extracts decisions, action items, questions, and renders markdown", () => {
    const draft = buildDraftMeetingMinutes({
      title: "제품 주간 회의",
      meetingDate: "2026-06-13",
      participantText: "영수, 민지",
      generatedAt: "2026-06-13T09:00:00.000Z",
      transcript: [
        "영수: 신규 회의록 기능은 전사 텍스트 기반 초안으로 먼저 진행하기로 결정했습니다.",
        "민지: 담당: 민지 다음 주까지 검토 화면 문구를 정리해야 합니다.",
        "영수: STT 공급자는 어떤 기준으로 확정하나요?",
      ].join("\n"),
    });

    expect(draft.status).toBe("needs_review");
    expect(draft.decisions).toHaveLength(1);
    expect(draft.actionItems).toEqual([
      expect.objectContaining({
        owner: "민지",
        dueDate: "다음 주",
        status: "open",
      }),
    ]);
    expect(draft.openQuestions).toHaveLength(1);
    expect(draft.markdown).toContain("# 제품 주간 회의");
    expect(draft.markdown).toContain("| 상태 | 담당 | 기한 | 내용 |");
  });
});
