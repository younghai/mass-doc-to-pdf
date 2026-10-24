# 소스 분석 기반 치명 결함 수정 (보안·안정성·성능·과도 호출)

2026-10-24. API/웹/큐/스토리지/검색/사이드카 전수 분석으로 식별한 운영 치명
결함 5건(+경미 1건)을 수정했다. 분석 범위: routes(convert/jobs/batches/stats/
search) · jobs · queue · storage · search · server · app · BatchUpload(웹) ·
hwp-sidecar.

## 치명 오류 (업무 서비스 진행 상 크래시/데이터 경로)

### C1. inline 변환 fire-and-forget 미처리 rejection → API 프로세스 전체 크래시
- 위치: `apps/api/src/routes/convert.ts` (변환·재시도 2개 경로)
- `void finishConversion(...)`의 catch 블록 안 `markFailed`가 throw하면
  (예: SQLite "database is locked", 마이그레이션 직후) unhandled rejection
  발생 → Node 기본 동작은 **프로세스 종료**. 단 한 건의 일시 DB 오류가 전체
  API(진행 중인 다른 사용자 변환 포함)를 죽일 수 있었다.
- 수정: finishConversion을 "never rejects" 계약으로 강화(catch 안 bookkeeping
  실패를 별도 try/catch로 가드 + 로그), 호출부에 최종 안전망 `.catch()` 추가.
- 회귀 테스트: markFailed 1회 거부 상황에서도 이후 변환이 정상 성공하는지
  확인 (unhandled rejection은 테스트 런 자체를 실패시키므로 통과=가드 증명).

### C2. 리텐션 스윕 무제한 findMany → 장기 운영 시 전체 테이블 메모리 로드
- 위치: `apps/api/src/server.ts` 데이터 보존 스윕
- `findMany`에 `take` 없음 — 긴 보존 기간 설정(로컬 365000일)에서는 매 시간
  **전체 잡 테이블**을 한 번에 로드해 순차 삭제 루프에 사용.
- 수정: 500건 배치 루프로 교체(메모리 상한 + 진행 중 부분 실패 시 다음 스윕
  이어받기).

## 치명 저성능

### P1. PDF 다운로드/미리보기 전체 버퍼링
- 위치: `apps/api/src/routes/jobs.ts` download/preview
- `storage.get()`으로 PDF 전체를 메모리에 적재한 뒤 응답 — 20MB 문서 ×
  동시 다운로드 = 메모리 스파이크 + 첫 바이트 지연(전체 수신 후 전송 시작).
  배치 ZIP 라우트는 이미 `getStream`을 쓰고 있어 비일관 상태였음.
- 수정: `getStream` 사용 스트리밍 전송(Local/S3 양측 구현 존재). 스트림
  미지원 스텁(테스트)은 기존 버퍼 경로 폴백 유지.

### P2. 검색 텍스트 추출 페이지별 순차 upsert (N+1)
- 위치: `apps/api/src/search/service.ts` extract()
- 페이지당 1회 `tx.searchPage.upsert` 순차 루프(상한 2,000페이지 = 2,000
  순차 쿼리)를 **장기 쓰기 트랜잭션** 안에서 실행 — SQLite 단일 쓰기
  특성상 변환 성공 기록(markSuccess) 등 다른 쓰기를 블록.
- 수정: `deleteMany + createMany` 벌크로 교체(2 쿼리). 추출은 단일
  트랜잭션이므로 페이지가 부분 존재하는 경우가 없어 전체 재작성이
  per-page upsert와 동치.
- 회귀 테스트: 3페이지 벌크 기록 + 재추출 시 잔여 행 없음(중복 없음) 확인.

### P3. 검색 워커 1초 고정 폴링 (과도 호출)
- 위치: `startSearchWorker`
- 색인할 작업이 없어도 매초 markOrphans 2쿼리 + 후보 findFirst 1쿼리 →
  검색을 켠 배포에서 **영구 초당 ~3 SQLite 쿼리**.
- 수정: 적응형 간격 — 작업 처리 시 1초 유지, 유휴 시 5초 백오프(runOnce가
  작업 여부 boolean 반환). 유휴 부하 80% 감소.

## 경미 (함께 수정)

### M1. 크기 초과 업로드가 500으로 응답
- `file.toBuffer()`가 fileSize 초과 시 throw → 미처리 500. `@fastify/multipart`의
  statusCode 413을 잡아 정상 413 + 안내 메시지로 변환.
- 회귀 테스트: 20MB+1KB 업로드 → 413.

## 분석 후 "정상"으로 판정한 항목 (변경 없음)

- 저장소 키 경로 조작: `safeObjectPath` 이중 가드 존재
- ZIP 엔트리명/다운로드 파일명 새니타이즈, userId 스코프 인증 전 경로 일관
- 큐 claim 원자성(옵티미스틱 가드), 라운드로빈 공정성, 시각성 타임아웃
- 검색 API: 세션 인증 + JSON 스키마 + 10/min 레이트리밋 + 권한 재검증
- pdftotext `execFile` 고정 인자(주입 불가) · CSRF Origin 가드 · multipart
  파트 수 제한 · 신뢰 프록시 홉 제한
- 배치 업로드 풀(동시 5) · 2초 폴링 1회 통합(개별 잡 N+1 아님)

## 검증

- 신규 테스트 6건(413 · 크래시 생존 · 스트리밍 다운로드 · 검색 벌크/재추출/
  유휴 false) + 기존 전체: shared 16 · api 173+1 skip · web 48 통과
- typecheck·build 전체 통과
