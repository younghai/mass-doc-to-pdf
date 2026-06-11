# 테스트 케이스 명세

| 항목 | 내용 |
|------|------|
| 문서 번호 | WF-05-02 |
| 버전 | v1.0 |
| 작성일 | 2026-06-11 |
| 작성자 | 개발팀 |
| 상태 | 확정 |

---

## 영역 1. 파일 업로드

| TC-ID | 구분 | 테스트명 | 전제조건 | 입력 | 기댓값 | 합격기준 |
|-------|------|----------|----------|------|--------|----------|
| TC-UP-01 | 단위 | HWP 파일 포맷 감지 | 없음 | `test.hwp` + D0 CF 11 E0 매직 바이트 | `{ format: 'hwp', ext: 'hwp' }` | `fileMeta` 반환값 정확 |
| TC-UP-02 | 단위 | HWPX 파일 포맷 감지 | 없음 | `test.hwpx` + PK ZIP 매직 바이트 | `{ format: 'hwp', ext: 'hwpx' }` | `fileMeta` 반환값 정확 |
| TC-UP-03 | 단위 | PDF 입력 거부 | 없음 | `test.pdf` + 25 50 44 46 매직 바이트 | `ConversionError: already PDF` | 에러 타입 및 메시지 일치 |
| TC-UP-04 | 통합 | 인증 없는 업로드 거부 | 세션 쿠키 없음 | `POST /convert` multipart | `401 Unauthorized` | 상태 코드 401 |
| TC-UP-05 | 통합 | 정상 HWP 업로드 (인라인) | `DEV_AUTH=1`, `USE_QUEUE=false` | `POST /convert` + test.hwp | `200 OK { jobId, qualityReport }` | jobId 존재, status ≠ 'failed' |

---

## 영역 2. 큐 처리

| TC-ID | 구분 | 테스트명 | 전제조건 | 입력 | 기댓값 | 합격기준 |
|-------|------|----------|----------|------|--------|----------|
| TC-QU-01 | 단위 | claimNext 낙관적 잠금 단일 워커 | `status='queued'` 잡 1건 | `claimNext()` | 잡 반환, `lockedAt` 설정됨 | DB에 `lockedAt != null` |
| TC-QU-02 | 단위 | claimNext 동시 경합 | `status='queued'` 잡 1건, 워커 2개 동시 호출 | `claimNext()` × 2 | 1개만 잡 획득, 나머지 null | 중복 처리 없음 |
| TC-QU-03 | 단위 | retryOrGiveUp — 재시도 | `attempts=0`, `maxAttempts=3` | `retryOrGiveUp(jobId)` | `status='queued'`, `attempts=1` | DB 상태 확인 |
| TC-QU-04 | 단위 | retryOrGiveUp — 포기 | `attempts=2`, `maxAttempts=3` | `retryOrGiveUp(jobId)` | `status='failed'`, `attempts=3` | DB 상태 확인 |
| TC-QU-05 | 통합 | USE_QUEUE=true 업로드 큐 등록 | `DEV_AUTH=1`, `USE_QUEUE=true` | `POST /convert` + test.hwp | `202 Accepted { jobId }` | 상태 코드 202, DB에 `status='queued'` |

---

## 영역 3. 엔진 체인

| TC-ID | 구분 | 테스트명 | 전제조건 | 입력 | 기댓값 | 합격기준 |
|-------|------|----------|----------|------|--------|----------|
| TC-EC-01 | 단위 | HWP precise 체인 순서 | `hancom.enabled=true`, `rhwpCli.enabled=true` | `getChain('hwp', 'precise')` | `[Hancom, RhwpCli, H2O, Builtin]` | 배열 순서 및 길이 일치 |
| TC-EC-02 | 단위 | 비활성 엔진 제외 | `hancom.enabled=false`, `rhwpCli.enabled=false` | `getChain('hwp', 'precise')` | `[H2O, Builtin]` (Hancom, RhwpCli 없음) | 배열에 비활성 엔진 없음 |
| TC-EC-03 | 단위 | 첫 엔진 실패 → 폴백 | 1순위 엔진 mock throw | 체인 실행 | 2순위 엔진 호출됨 | 2순위 `convert` 호출 횟수 = 1 |
| TC-EC-04 | 단위 | 모든 엔진 실패 | 모든 엔진 mock throw | 체인 실행 | `ConversionError: all engines failed` | 에러 발생, attempts 모두 `success=false` |
| TC-EC-05 | 단위 | Office quick 체인 | 설정 무관 | `getChain('office', 'quick')` | `[Builtin]` | 단일 엔진 |

---

## 영역 4. 품질 게이트

| TC-ID | 구분 | 테스트명 | 전제조건 | 입력 | 기댓값 | 합격기준 |
|-------|------|----------|----------|------|--------|----------|
| TC-QG-01 | 단위 | 모두 성공 + warnings 없음 → passed | - | `attempts=[{success:true}]`, `warnings=[]` | `{ status: 'passed' }` | status 값 일치 |
| TC-QG-02 | 단위 | 실패 시도 존재 → review | - | `attempts=[{success:false},{success:true}]`, `warnings=[]` | `{ status: 'review' }` | status 값 일치 |
| TC-QG-03 | 단위 | warnings 존재 → review | - | `attempts=[{success:true}]`, `warnings=['font missing']` | `{ status: 'review' }` | status 값 일치 |
| TC-QG-04 | 단위 | 전체 실패 → failed | - | `attempts=[{success:false}]` | `{ status: 'failed' }` | status 값 일치 |
| TC-QG-05 | 단위 | Office precise + fallback grade → QualityGateError | `mode='office-precise'` | `grade='fallback'` | `QualityGateError` 발생 | 에러 타입 일치 |

---

## 영역 5. 다운로드/미리보기

| TC-ID | 구분 | 테스트명 | 전제조건 | 입력 | 기댓값 | 합격기준 |
|-------|------|----------|----------|------|--------|----------|
| TC-DL-01 | 통합 | 완료된 작업 다운로드 | `status='success'`, S3 키 존재 | `GET /jobs/:id/download` | 302 redirect (presigned URL) | 상태 코드 302 |
| TC-DL-02 | 통합 | 진행 중 작업 다운로드 시도 | `status='running'` | `GET /jobs/:id/download` | `404 Not Ready` | 상태 코드 404 |
| TC-DL-03 | 통합 | 품질 리포트 조회 | `status='success'`, qualityReport 존재 | `GET /jobs/:id/quality` | `200 { status, grade, attempts }` | 필드 모두 존재 |
| TC-DL-04 | 통합 | 타인 작업 접근 거부 | 다른 userId 세션 | `GET /jobs/:id` | `403 Forbidden` | 상태 코드 403 |

---

## 영역 6. 삭제

| TC-ID | 구분 | 테스트명 | 전제조건 | 입력 | 기댓값 | 합격기준 |
|-------|------|----------|----------|------|--------|----------|
| TC-DEL-01 | 통합 | 완료 작업 삭제 | `status='success'`, S3 키 존재 | `DELETE /jobs/:id` | `200 OK`, S3 오브젝트 삭제, DB 레코드 삭제 | DB 레코드 없음, S3 호출 확인 |
| TC-DEL-02 | 통합 | 존재하지 않는 작업 삭제 | DB에 해당 ID 없음 | `DELETE /jobs/999` | `404 Not Found` | 상태 코드 404 |
| TC-DEL-03 | 통합 | 타인 작업 삭제 거부 | 다른 userId 세션 | `DELETE /jobs/:id` | `403 Forbidden` | 상태 코드 403 |

---

## 영역 7. 재시도

| TC-ID | 구분 | 테스트명 | 전제조건 | 입력 | 기댓값 | 합격기준 |
|-------|------|----------|----------|------|--------|----------|
| TC-RT-01 | 단위 | stuck-running reaper 감지 | `status='running'`, `lockedAt=now()-11m` | reaper 실행 | `retryOrGiveUp` 호출됨 | 메서드 호출 횟수 = 1 |
| TC-RT-02 | 단위 | stuck-running reaper 무시 (정상) | `status='running'`, `lockedAt=now()-5m` | reaper 실행 | `retryOrGiveUp` 미호출 | 메서드 호출 횟수 = 0 |
| TC-RT-03 | 통합 | 워커 재시도 후 성공 | 1차 실패 엔진 mock, 2차 성공 엔진 mock | 워커 2회 poll | `status='success'` | DB 최종 상태 확인 |
| TC-RT-04 | 통합 | 최대 재시도 초과 후 실패 | 모든 엔진 실패 mock, `maxAttempts=3` | 워커 3회 poll | `status='failed'` | DB 최종 상태 확인 |

---

## 영역 8. rate-limit

| TC-ID | 구분 | 테스트명 | 전제조건 | 입력 | 기댓값 | 합격기준 |
|-------|------|----------|----------|------|--------|----------|
| TC-RL-01 | 통합 | rate-limit 초과 시 429 | 동일 IP | `GET /jobs` 101회 연속 | 101번째 요청 `429 Too Many Requests` | 상태 코드 429 |
| TC-RL-02 | 통합 | `/health` rate-limit 제외 | 동일 IP | `GET /health` 200회 | 모두 `200 OK` | 429 없음 |
| TC-RL-03 | 통합 | rate-limit 헤더 포함 | - | `GET /jobs` | `X-RateLimit-Remaining` 헤더 존재 | 헤더 값 ≥ 0 |

---

## 영역 9. 인증

| TC-ID | 구분 | 테스트명 | 전제조건 | 입력 | 기댓값 | 합격기준 |
|-------|------|----------|----------|------|--------|----------|
| TC-AU-01 | 통합 | 세션 쿠키 없이 보호 라우트 접근 | 세션 없음 | `GET /jobs` | `401 Unauthorized` | 상태 코드 401 |
| TC-AU-02 | 통합 | CSRF 검증 실패 | Origin 헤더 = `http://evil.example.com` | `POST /convert` | `403 Forbidden` | 상태 코드 403 |
| TC-AU-03 | 통합 | CSRF 검증 통과 | Origin 헤더 = `WEB_ORIGIN` | `POST /convert` | 정상 처리 | 상태 코드 ≠ 403 |
| TC-AU-04 | 통합 | CSRF GET 요청 제외 | Origin 헤더 없음 | `GET /jobs` | 정상 처리 | 상태 코드 ≠ 403 |
| TC-AU-05 | 통합 | DEV_AUTH=1 개발 계정 자동 로그인 | `DEV_AUTH=1` 환경 | 쿠키 없이 `GET /jobs` | `200 OK` | 인증 우회 동작 |

---

## 영역 10. 통계

| TC-ID | 구분 | 테스트명 | 전제조건 | 입력 | 기댓값 | 합격기준 |
|-------|------|----------|----------|------|--------|----------|
| TC-ST-01 | 통합 | 상태별 카운트 집계 | `success=3, failed=1, running=2` | `GET /stats` | `{ success: 3, failed: 1, running: 2 }` | 카운트 값 일치 |
| TC-ST-02 | 통합 | 엔진별 성공률 집계 | rhwp 성공 5건, h2o 성공 2건 | `GET /stats` | `engines: { rhwp: { successRate: 1.0 }, h2o: {...} }` | 성공률 계산 정확 |
| TC-ST-03 | 통합 | 최근 실패 목록 | 실패 작업 3건 | `GET /stats` | `recentFailures: [...]` 최신순 3건 | 목록 존재, 정렬 정확 |
| TC-ST-04 | 통합 | 데이터 없을 때 빈 통계 | DB 비어 있음 | `GET /stats` | `{ success: 0, failed: 0, ... }` | 에러 없이 빈 값 반환 |

---

## 변경 이력

| 버전 | 날짜 | 변경 내용 | 작성자 |
|------|------|-----------|--------|
| v1.0 | 2026-06-11 | 최초 작성. 10개 영역 40개 테스트 케이스 | 개발팀 |
