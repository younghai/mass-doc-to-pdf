# 요구사항 추적 매트릭스 (Requirements Traceability Matrix)

> Mass Doc to PDF (mass-doc-to-pdf)의 요구사항과 구현·테스트 추적 매트릭스.

| 항목 | 내용 |
| --- | --- |
| **프로젝트명** | Mass Doc to PDF (mass-doc-to-pdf) |
| **문서 버전** | v1.0 |
| **작성일** | 2026-06-11 |
| **최종 수정일** | 2026-06-11 |
| **작성자** | 개발팀 |
| **문서 상태** | 작성 중 |

---

## 1. 기능 요구사항 추적

| REQ-ID | 요구사항 요약 | 구현 파일 | UC 연결 | 상태 |
| --- | --- | --- | --- | --- |
| FR-001 | 파일 업로드 (`POST /api/convert`) | `apps/api/src/routes/convert.ts` | UC-01, UC-02 | 완료 |
| FR-002 | MIME 타입 + 확장자 이중 검증 | `apps/api/src/routes/convert.ts` | UC-01 | 완료 |
| FR-003 | 20MB 파일 크기 제한 (413 거부) | `apps/api/src/routes/convert.ts` | UC-01 | 완료 |
| FR-004 | ConversionJob 생성 + sourceKey 저장 | `apps/api/src/routes/convert.ts` | UC-01, UC-02 | 완료 |
| FR-005 | `USE_QUEUE=0` 인라인 변환 실행 | `apps/api/src/queue/jobQueue.ts` | UC-01 | 완료 |
| FR-006 | `USE_QUEUE=1` DB-backed queue + worker poll | `apps/api/src/queue/jobQueue.ts`, `apps/api/src/queue/worker.ts` | UC-01, UC-02 | 완료 |
| FR-007 | worker claim + attempts 증가 + failed 확정 | `apps/api/src/queue/worker.ts` | UC-01, UC-08 | 완료 |
| FR-008 | HWP/HWPX 엔진 체인 (precise/quick 모드) | `apps/api/src/convert/registry.ts`, `apps/api/src/convert/engines/` | UC-01 | 완료 |
| FR-009 | Office 포맷 엔진 체인 (Gotenberg 등) | `apps/api/src/convert/registry.ts`, `apps/api/src/convert/engines/` | UC-01 | 완료 |
| FR-010 | 비활성 엔진 자동 제외 + 전체 실패 처리 | `apps/api/src/convert/registry.ts` | UC-01 | 완료 |
| FR-011 | 품질 게이트 (QualityStatus + QualityGrade 판정) | `apps/api/src/convert/quality.ts` | UC-07 | 완료 |
| FR-012 | 품질 리포트 조회 (`GET /api/jobs/:id/quality`) | `apps/api/src/routes/jobs.ts` | UC-07 | 완료 |
| FR-013 | QualityStatus=failed 시 자동 재시도 트리거 | `apps/api/src/convert/quality.ts`, `apps/api/src/queue/worker.ts` | UC-08 | 완료 |
| FR-014 | PDF 다운로드 (`GET /api/jobs/:id/download`) | `apps/api/src/routes/jobs.ts` | UC-05 | 완료 |
| FR-015 | PDF 인라인 미리보기 (`GET /api/jobs/:id/preview`) | `apps/api/src/routes/jobs.ts` | UC-05 | 완료 |
| FR-016 | PNG 미리보기 (`GET /api/jobs/:id/preview.png`) | `apps/api/src/routes/jobs.ts` | UC-06 | 완료 |
| FR-017 | 작업 목록 조회 + 상태 필터 (`GET /api/jobs`) | `apps/api/src/routes/jobs.ts` | UC-03 | 완료 |
| FR-018 | 작업 삭제 + MinIO 파일 삭제 (`DELETE /api/jobs/:id`) | `apps/api/src/routes/jobs.ts` | UC-09 | 완료 |
| FR-019 | 실패 작업 재시도 (`POST /api/jobs/:id/retry`) | `apps/api/src/routes/jobs.ts` | UC-08 | 완료 |
| FR-020 | BatchUpload (batchId 기반 일괄 변환) | `apps/web/src/pages/BatchUpload.tsx` | UC-02 | 완료 |
| FR-021 | 통계 API (`GET /api/stats`) | `apps/api/src/routes/stats.ts` | UC-10 | 완료 |
| FR-022 | 헬스체크 (`GET /health`) | `apps/api/src/app.ts` | - | 완료 |
| FR-023 | Auth.js v5 세션 인증 (미인증 401) | `apps/api/src/auth/plugin.ts` | UC-01~UC-10 | 완료 |
| FR-024 | Google OAuth + DEV_AUTH 개발 모드 | `apps/api/src/auth/plugin.ts` | - | 완료 |

---

## 2. 비기능 요구사항 추적

| REQ-ID | 요구사항 요약 | 구현 방법 / 파일 | 상태 |
| --- | --- | --- | --- |
| NFR-001 | Office 포맷 변환 P99 ≤ 30초 | `apps/api/src/convert/engines/` (Gotenberg 타임아웃 설정) | 완료 |
| NFR-002 | HWP precise 변환 P99 ≤ 60초 | `apps/api/src/convert/registry.ts` (엔진 체인 타임아웃) | 완료 |
| NFR-003 | HWP quick 변환 P99 ≤ 20초 | `apps/api/src/convert/registry.ts` (quick 체인 타임아웃) | 완료 |
| NFR-004 | API 응답 P99 ≤ 500ms (변환 제외) | Fastify 라우팅 최적화, SQLite WAL 인덱스 | 완료 |
| NFR-005 | rate limit (300/min 전체, 60/min 인증) | `apps/api/src/app.ts` (@fastify/rate-limit) | 완료 |
| NFR-006 | CSRF Origin 검증 | `apps/api/src/app.ts` (onRequest hook) | 완료 |
| NFR-007 | Secure + HttpOnly + SameSite 쿠키 | `apps/api/src/auth/plugin.ts` (Auth.js 쿠키 설정) | 완료 |
| NFR-008 | trustProxy 설정 | `apps/api/src/app.ts` (Fastify trustProxy=true) | 완료 |
| NFR-009 | MIME 이중 검증 + zip-bomb 방어 | `apps/api/src/routes/convert.ts` | 완료 |
| NFR-010 | SQLite WAL 모드 + busy_timeout=5000 | `apps/api/prisma/schema.prisma`, `apps/api/src/db.ts` | 완료 |
| NFR-011 | durable queue (서버 재시작 후 재개) | `apps/api/src/queue/jobQueue.ts` | 완료 |
| NFR-012 | stuck-running reaper | `apps/api/src/queue/worker.ts` (lockedAt 기준 복구) | 완료 |
| NFR-013 | 시스템 가용성 ≥ 99.5% | Docker Compose healthcheck, `GET /health` | 완료 |
| NFR-014 | worker 수평 확장 | `apps/api/src/queue/worker.ts` (다중 인스턴스 지원) | 완료 |
| NFR-015 | MinIO S3 호환 스토리지 확장 | `packages/shared/src/storage.ts` (S3 호환 클라이언트) | 완료 |

---

## 3. UI 컴포넌트 추적

| 화면 | 파일 | 연결 UC | 상태 |
| --- | --- | --- | --- |
| Landing | `apps/web/src/pages/Landing.tsx` | - | 완료 |
| Login | `apps/web/src/pages/Login.tsx` | - | 완료 |
| Upload (단건) | `apps/web/src/pages/Upload.tsx` | UC-01 | 완료 |
| BatchUpload | `apps/web/src/pages/BatchUpload.tsx` | UC-02 | 완료 |
| Jobs (큐 목록) | `apps/web/src/pages/Jobs.tsx` | UC-03 | 완료 |
| JobDetail | `apps/web/src/pages/JobDetail.tsx` | UC-04, UC-05, UC-06, UC-07, UC-08, UC-09 | 완료 |
| Dashboard | `apps/web/src/pages/Dashboard.tsx` | UC-10 | 완료 |

---

## 4. 추적 요약

| 상태 | 기능 요구사항 | 비기능 요구사항 | 합계 |
| --- | --- | --- | --- |
| 완료 | 24 | 15 | 39 |
| 부분 완료 | 0 | 0 | 0 |
| 미착수 | 0 | 0 | 0 |

---

## 5. 변경 이력

| 버전 | 날짜 | 작성자 | 변경 내용 |
| --- | --- | --- | --- |
| v1.0 | 2026-06-11 | 개발팀 | 초안 작성 |
