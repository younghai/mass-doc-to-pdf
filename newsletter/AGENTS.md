# AGENTS.md - `newsletter` project

This folder runs the recurring Korean newsletter workflow for "비개발자를 위한 AI 트렌드 뉴스레터".

One-line rule: the team-lead thread delegates to 담당자 threads, receives completion reports, advances gated phases automatically, and never sends anything externally.

## 1. Project Goal

- Produce one issue of "비개발자를 위한 AI 트렌드 뉴스레터".
- Audience: non-developer solo founders, freelancers, and small-company operators.
- Language: Korean for all instructions, reports, and deliverables.
- Delivery scope: final HTML, optional PDF when the local environment supports it, and a sources file.

## 2. Output Locations

- Create each weekly run under `newsletter/runs/YYYY-MM-DD/`.
- Required files:
  - `ai-trend-newsletter.html`
  - `sources.md`
  - `brief.md` with the final section outline and editorial notes
- Optional files:
  - `ai-trend-newsletter.pdf`
  - image direction notes or generated image assets

## 3. Thread Roles

| Thread | Role |
| --- | --- |
| `newsletter-team-lead` | 총괄 데스크. 직접 리서치/작성하지 않고 지시, 완료 보고 취합, 후속 요청, 최종 검수만 한다. |
| `research-news` | 이번 주 AI 트렌드 뉴스 수집 |
| `research-tools` | 비개발자가 쓸 만한 AI 도구/업데이트 수집 |
| `research-cases` | 실제 활용 사례와 적용 아이디어 수집 |
| `factcheck` | 리서치 주장 사실 검증. 의심하는 검수자 역할 |
| `outline` | 뉴스레터 목차와 섹션 구조 설계 |
| `writing` | 확정된 목차와 검증 자료 기반 본문 작성 |
| `image` | 헤더/섹션별 이미지 방향과 프롬프트 제안 |
| `packaging` | 최종 HTML, optional PDF, sources 패키징 |

## 4. Phase Gate Rules

1. Phase 1: `research-news`, `research-tools`, `research-cases` start in parallel.
2. Phase 2: start `factcheck` only after all three Phase 1 reports arrive.
3. Phase 3: start `outline` only with factcheck-passed material.
4. Phase 4: start `writing` only after the outline is ready.
5. Phase 5: start `image` after the outline is ready; it may run in parallel with `writing`.
6. Phase 6: start `packaging` only after both writing and image outputs are ready.

Unlike the sample guide, this recurring workflow does not ask the user before each phase. Advance automatically when the gate condition is met.

## 5. Reporting Format

- Every 담당자 report must use: conclusion first, evidence later.
- 담당자 report shape:
  - 핵심 3줄
  - 근거/출처
  - 다음 단계 1줄
- Report only when the assigned task is complete.
- Immediate exception reports are allowed only when blocked, when a claim cannot be verified, or when a human decision is required.
- The team-lead thread should summarize by phase, merge duplicates, call out conflicts, and pass only usable material to the next phase.

## 6. Quality Rules

- Do not invent facts, prices, dates, launches, model names, product features, or citations.
- Mark uncertain claims as `확인 필요`.
- Remove or soften any claim that factcheck cannot verify.
- Keep tone practical, calm, and useful for non-developers.
- Avoid hype, exaggerated sales language, and unexplained jargon.
- Explain technical terms once in plain Korean.
- The writing and factcheck roles must stay separate.

## 7. Safety Rules

- Do not send emails, Slack messages, SNS posts, or any external publication automatically.
- Do not perform purchases, account changes, credential changes, or production operations.
- Do not include private or sensitive information unless explicitly supplied for this run.
- The final package is a draft for human review, not an automatically sent newsletter.

## 8. Weekly Automation Default

- Automation name: `weekly-ai-trend-newsletter`.
- Schedule: every Monday at 09:00 Asia/Seoul.
- The automation starts the team-lead workflow and stores outputs under the current run date.
