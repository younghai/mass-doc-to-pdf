# Codex 구현 스펙 — 남은 로드맵

> 작성일: 2026-07-05 · 작성: Claude(Fable 5, 계획/설계) · 구현: **Codex GPT-5.5 (xhigh)**
> 저장소: `/Users/young/Downloads/personal_project/hwptopdf` · 기준 브랜치: `review/expert-review-p0-1`
> 이 문서는 **구현 지시서**입니다. 각 항목은 독립 작업 단위(work order)이며 "대상 파일 · 변경 설계 · 수용 기준 · 테스트 조건 · 위험"으로 구성됩니다. 프로젝트 규율: **TDD(실패 테스트 선작성)**, 커밋은 코드/문서 분리, 커밋 메시지 말미 `Co-Authored-By`.

## 공통 규약 (모든 작업)
- 스택: pnpm workspace(api=Fastify+Prisma+SQLite, web=React+Vite, shared=DTO). 테스트 vitest.
- 완료 게이트: `pnpm -r typecheck` 0 error + `pnpm -r test` 전부 통과(신규 테스트 포함).
- DTO는 `packages/shared`가 단일 소스 — web/api가 공유. 타입 drift 금지.
- 사용자 대상 카피는 한국어. 에러 원문(내부 경로/호스트)은 클라이언트에 노출 금지.

---

## SPEC-A · P1-4 사용자 친화 에러 메시지 (내부 인프라 노출 제거)

**근거:** [DSN-03]/[SEC-09]. 브라우저 QA에서 작업 상세 실패 메시지에 `([hwp-quality-chain] all converters failed: h2orestart failed: [h2orestart] request to http://localhost:8080/convert failed)`가 그대로 노출됨(내부 호스트/포트/체인 누출).

**대상 파일**
- `apps/api/src/convert/failure.ts` — `errorMessage()`가 `친절메시지 (원문)` 형태로 원문을 접미(라인 24~40).
- `apps/api/src/convert/failure.test.ts` — 기존 기대값(원문 포함) 갱신 필요.
- (표시부) `apps/web/src/pages/JobDetail.tsx` — `job.error`를 그대로 렌더(라인 174).
- 원문 로깅 지점: `apps/api/src/routes/convert.ts`(finishConversion catch), `apps/api/src/queue/worker.ts`(markFailed 직전).

**변경 설계 (권장안 — 최소·안전)**
1. `errorMessage(err)`를 **친절 메시지만** 반환하도록 변경(원문 `(${message})` 접미 제거). 즉 사용자·`job.error`에는 실행 지침이 담긴 한국어 문장만 저장.
2. 원문(raw)은 **서버 로그로만** 남긴다: 실패 처리 지점에서 `app.log.warn({ jobId, rawError }, "conversion failed")` 형태로 기록. `rawErrorMessage(err)`(이미 존재)를 로그에만 사용.
3. (선택, 운영자 디버깅용) 실패 상세에 "기술 상세" 접기 UI가 필요하면, `QualityReport.attempts[].error`(엔진별 원문, 이미 존재)를 실패 케이스에도 노출. **단 이는 별도 후속** — 이번 스펙은 1·2만.

> **결정 필요(사용자):** 운영자가 UI에서 원문을 봐야 하면 3번(접기형)을 포함. 아니면 1·2만으로 충분. 기본 권장은 **1·2만**(원문은 로그).

**수용 기준**
- `errorMessage()`의 반환값에 `http://`, `localhost`, 대괄호 엔진명(`[...]`) 등 내부 문자열이 포함되지 않는다.
- 실패 job의 `job.error`(및 상세 화면 표시)는 한국어 지침 문장만 노출.
- 원문은 서버 로그에 남아 운영자가 확인 가능.
- 기존 실패 분류/재시도 정책(`failureReason`/`isPermanentFailure`)은 **동작 불변**(분류는 여전히 원문 기반으로 내부 판정).

**테스트 조건 (TDD)**
- `failure.test.ts`: `errorMessage(new Error("[hwp-quality-chain] ... http://localhost:8080 ..."))`가 내부 문자열을 포함하지 않고 친절 문구만 반환함을 assert(RED→GREEN).
- `failureReason`/`isPermanentFailure`는 원문 입력에 대해 기존과 동일 분류 유지(회귀 테스트).
- 표시부를 건드리면 `JobDetail.test.tsx`의 "failed job shows the error reason"이 친절 문구 기준으로 통과.

**위험**
- `failure.test.ts`가 원문 포함을 assert 중일 수 있음 → 기대값 갱신 필요(정상).
- 원문 로깅이 과도하면 로그에 파일명 등 PII가 남을 수 있음 — 파일명은 제외하고 사유/엔진만 로깅 권장.

---

## SPEC-B · P1-1 저품질(review)을 작업 큐의 일급 객체로 노출

**근거:** [PO-04]/[DSN-05]. 차별점이 review인데 `Jobs.tsx` 탭에 저품질 필터가 없고(전체/진행중/대기/성공/실패), 목록에 품질 배지도 없음. 배치 요약엔 "저품질 의심"이 있어 **불일치**.

**핵심 설계 결정:** 품질 상태(`passed|review|failed`)는 현재 **스토리지의 리포트 JSON에만** 존재하고 `ConversionJob` 행/`JobDTO`엔 없음(`packages/shared/src/index.ts:86` JobDTO, `prisma/schema.prisma:55` 모델 확인). 목록에서 필터·배지를 하려면 품질 상태를 **DB 행에 승격**해야 한다(리포트 N개를 목록마다 가져오는 것은 비효율·비확장).

**대상 파일**
- `apps/api/prisma/schema.prisma` — `ConversionJob`에 `qualityStatus String?`(passed|review|failed) 컬럼 + 마이그레이션.
- `apps/api/src/jobs/jobService.ts` — `toDTO`(라인 14~)와 `markSuccess`/`markFailed`(품질 판정 반영), `list`가 `qualityStatus` 포함.
- 품질 판정 기록 지점: `apps/api/src/routes/convert.ts`(finishConversion) + `apps/api/src/queue/processConversion.ts` — 리포트 생성 후 `report.status`(또는 `qualityStatus(report)`)를 job에 저장.
- `packages/shared/src/index.ts` — `JobDTO`에 `qualityStatus?: QualityStatus` 추가.
- `apps/web/src/pages/Jobs.tsx` — TABS에 "저품질(review)" 추가. 단, `qualityStatus`는 `JobStatus`가 아니므로 필터 로직을 status와 분리(예: 클라이언트 필터 또는 `?qualityStatus=review` 쿼리 추가).
- `apps/web/src/components/JobsTable.tsx` — 상태 열 옆에 품질 배지(passed/review/failed) 표시.
- `apps/api/src/routes/jobs.ts` — (쿼리 필터 방식 채택 시) `GET /api/jobs?qualityStatus=review` 지원.

**변경 설계**
1. 스키마에 `qualityStatus` 추가 → `prisma migrate`.
2. 변환 완료 시(성공/실패/게이트거부 모두) 리포트의 `status`를 job 행에 저장. 게이트 거부(실패)는 `review`가 아니라 실패지만, review 판정(성공이나 저품질)이 핵심.
3. `JobDTO.qualityStatus` 노출.
4. Jobs: "저품질" 탭 = `status=success && qualityStatus=review` 필터. 서버 쿼리 파라미터로 처리하거나(권장) 클라이언트 필터.
5. JobsTable: `qualityView.ts`의 `QUALITY_STATUS_LABEL`/색상으로 배지 렌더(이미 존재).

**수용 기준**
- 변환된 job은 `qualityStatus`를 갖는다(기존 job은 null 허용, 백필 불필요).
- Jobs에 "저품질" 탭이 있고, review 판정 문서만 필터된다.
- 목록 각 행에 품질 배지가 표시된다.
- 상태 색상 체계가 passed/review/failed 3단계로 일관.

**테스트 조건 (TDD)**
- api: `jobService` 성공 마킹 시 `qualityStatus` 저장/조회 테스트. `list({ qualityStatus: "review" })` 필터 테스트.
- web: `Jobs.test.tsx`에 "저품질 탭이 review job만 보여준다", `JobsTable`에 배지 렌더 테스트.

**위험**
- **DB 마이그레이션** 필요 — SQLite. 배포 시 마이그레이션 순서 주의(README 운영 주의: prod DB 자동 실행 금지).
- 게이트 거부 job의 상태 표기 일관성(실패 vs review) 정의를 명확히.

---

## SPEC-C · P1-2 대량(1,000개) 배치 복원력

**근거:** [PO-06]/[DEV-03]/[DEV-04]. `BatchUpload.tsx`가 순차 업로드(라인 141 `for..of` + `await api.upload`)와 파일당 60×2초 폴링(라인 110~124). 진행률 바·ETA·취소 없음, 탭 닫으면 배치 뷰 소실(서버 batch 미사용), 성공분 ZIP 없음. **단, 스키마에 `batchId`(schema.prisma:72)와 `BatchDTO`(shared/index.ts:72~84)가 이미 존재하나 미배선.**

**대상 파일**
- (백엔드 batch) `apps/api/prisma/schema.prisma`(batchId 존재), 신규 `Batch` 모델 또는 batchId 그룹 집계, `apps/api/src/routes/` 신규 `batches.ts`(`POST /api/batches`, `GET /api/batches/:id`), `jobService`/신규 batchService.
- `apps/api/src/routes/convert.ts` — 업로드 시 `batchId` 수용·기록.
- `apps/web/src/pages/BatchUpload.tsx` — 동시성 풀·일괄 폴링·진행률/ETA/취소·복원.
- `apps/web/src/api/client.ts` — `upload(file, mode, batchId?)`, `getBatch(id)`.
- `packages/shared` — `BatchDTO`(존재) 활용/확장.

**변경 설계 (단계적 — 하위 작업으로 쪼갤 것)**
1. **C-1 동시성 + 일괄 폴링(프론트, 무DB):** 순차 for → 동시성 풀(4~6). 개별 job 폴러 60개 → `GET /api/jobs?status=...` 1개 폴러로 통합. 60회 소진 시 항목을 "지연(큐에서 확인)"으로 명시 갱신([DEV-04]). — **가장 저비용·고효과, 먼저.**
2. **C-2 진행률/ETA/취소(프론트):** 전체 진행 바 + 남은 수 + 취소(AbortController로 미시작 업로드 중단).
3. **C-3 서버 batch(풀스택):** 업로드에 `batchId` 부여, `GET /api/batches/:id`로 새로고침·재접속 복원. `BatchDTO` 집계 사용.
4. **C-4 성공분 ZIP 다운로드(백엔드):** `GET /api/batches/:id/download`가 성공 PDF들을 zip 스트리밍.

**수용 기준**
- 1,000개 등록 시 동시 업로드 상한(예: 6)으로 처리, 폴링이 rate limit(300/min)와 충돌하지 않음.
- 전체 진행률·남은 개수 표시, 취소 가능.
- (C-3) 새로고침/재접속 후 배치 상태 복원.
- (C-4) 성공 문서 일괄 ZIP 다운로드.

**테스트 조건 (TDD)**
- 프론트: 동시성 풀이 상한을 지키는지(모킹된 upload 호출 동시성), 일괄 폴러가 상태를 반영하는지, 취소가 미시작 업로드를 막는지.
- 백엔드: `POST /api/batches`+`GET /api/batches/:id` 집계 정확성, ZIP에 성공분만 포함.

**위험**
- 범위가 큼(L) — 반드시 C-1→C-4 순으로 쪼개 각각 커밋. C-1만으로도 QA 지적 대부분 해소.
- ZIP 스트리밍 메모리(대량 PDF) — 스트리밍 방식 필수.
- 서버 batch는 마이그레이션 동반.

---

## SPEC-D · P1-3 모바일 네비게이션·반응형

**근거:** [DSN-02]. 375px에서 nav 5개 항목이 각 2줄로 깨지고 "새 변환" 버튼도 줄바꿈(QA 실측). 햄버거 없음.

**대상 파일**
- `apps/web/src/components/Layout.tsx` — 현재 flat `<nav>`(라인 29~35), 햄버거/드로어 없음.
- `apps/web/src/styles.css` — `@media (max-width: 720px)` 존재(nav 반응형 규칙 추가 지점).

**변경 설계**
1. `Layout`에 모바일 토글 상태 추가(useState) + 햄버거 버튼(≤720px 노출). `<nav>`를 드로어/collapsible로.
2. 720px 이하에서 nav를 햄버거 뒤로 접고, 열림 시 세로 목록. 라우트 변경 시 자동 닫힘.
3. 접근성: 버튼 `aria-expanded`/`aria-controls`, 터치 타깃 ≥44px, 키보드 포커스.
4. `styles.css`의 720/480 미디어쿼리에 규칙 추가(디자인 토큰 없으면 기존 색상 값 재사용).

**수용 기준**
- 375px에서 nav 항목이 줄바꿈 없이 햄버거 메뉴로 접힘, 열고 닫기 동작.
- 데스크톱(>720px) 레이아웃은 불변.
- 헤더의 사용자/로그아웃, 브랜드도 좁은 화면에서 정렬 유지.

**테스트 조건**
- web: `Layout` 렌더 시 햄버거 버튼 존재(모바일 뷰), 클릭 시 nav 토글, 링크 클릭 시 닫힘(RTL + userEvent). 데스크톱에서 nav 항상 노출.
- (선택) 시각 확인은 프리뷰로 375px 스냅샷.

**위험**
- `styles.css` 1,646줄 단일 파일 — 회귀 표면. 변경은 nav 관련 규칙에 국한.
- SPA 라우팅 시 드로어 닫힘 처리 누락 주의.

---

## SPEC-E · BUILTIN_TIMEOUT_MS 설정 중앙화 (P1-5 잔여)

**근거:** [DEV-10] 잔여. `MAX_ACTIVE_JOBS_PER_USER`/`TRUST_PROXY`는 config로 이관 완료. `BUILTIN_TIMEOUT_MS`만 엔진 생성자에서 `process.env` 직접 참조.

**대상 파일**
- `apps/api/src/convert/engines/h2orestart.ts:425` — `constructor(private readonly timeoutMs = Number(process.env.BUILTIN_TIMEOUT_MS ?? 120_000))`.
- `apps/api/src/config.ts` — `EngineConfig`에 `builtinTimeoutMs`, `loadEngineConfig`에서 env 읽기(기존 `rhwp.timeoutMs`/`hwpSidecarTimeoutMs` 패턴과 동일).
- `apps/api/src/convert/registry.ts` — builtin 엔진 생성 시 `cfg.builtinTimeoutMs` 주입.
- `apps/api/src/config.test.ts` — 기본값/오버라이드 테스트.

**변경 설계**
1. `EngineConfig`에 `builtinTimeoutMs: number` 추가, `loadEngineConfig`에서 `Number(env.BUILTIN_TIMEOUT_MS ?? 120_000)`.
2. builtin 엔진 생성자를 env 직접 참조 대신 주입받도록(registry에서 전달).

**수용 기준**
- `BUILTIN_TIMEOUT_MS`가 `loadEngineConfig` 단일 창구를 거친다(모듈 로드 시점 고정 제거, 주입·테스트 가능).
- 기본 120,000ms 동작 불변.

**테스트 조건 (TDD)**
- `config.test.ts`: 기본 120000 / `BUILTIN_TIMEOUT_MS` 오버라이드 2케이스.

**위험**
- 낮음(S). 엔진 생성 경로만 수정.

---

## 권장 착수 순서 (Codex 전달 순서)
1. **SPEC-E**(가장 작음, P1-5 마감) → 2. **SPEC-A**(에러 메시지, 보안+UX, 결정 1건) → 3. **SPEC-D**(모바일 nav, 프론트 독립) → 4. **SPEC-B**(review 큐, DB 마이그레이션 동반) → 5. **SPEC-C**(대량 배치, C-1부터 쪼개서).

각 SPEC은 독립 커밋 단위. 구현 후 **Claude가 감사(audit)** — 이 문서의 수용 기준·테스트 조건 대조 + 회귀 확인.
