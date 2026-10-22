# 테스트 계획

| 항목 | 내용 |
|------|------|
| 문서 번호 | WF-05-01 |
| 버전 | v1.0 |
| 작성일 | 2026-06-11 |
| 작성자 | 개발팀 |
| 상태 | 확정 |

---

## 1. 테스트 전략 및 범위

### 1.1 테스트 목표

- 핵심 변환 경로(HWP/HWPX/Office → PDF)의 정확성 검증
- 엔진 체인 폴백 로직 및 비활성 엔진 제외 동작 검증
- 품질 게이트가 저품질 결과를 올바르게 거부함을 보장
- 큐 시스템의 낙관적 잠금, 재시도, stuck-running reaper 동작 검증
- 인증 및 CSRF 보안 정책 검증
- rate-limit 동작 검증
- 실제 한국어 문서를 이용한 품질 코퍼스 검증

### 1.2 테스트 범위

| 범위 | 포함 | 제외 |
|------|------|------|
| 단위 테스트 | 엔진 체인, 품질 게이트, 큐 잠금, 파일 감지 | 외부 API (Hancom SDK, Aspose) 실제 호출 |
| 통합 테스트 | Fastify 라우트, 큐 경로, DB 상태 전이 | 외부 스토리지(S3) 실제 연결 |
| E2E 테스트 | 브라우저 업로드 → PDF 다운로드 전체 플로우 | 대용량 파일 부하 테스트 |
| 품질 코퍼스 | 실제 한국어 HWP/HWPX 문서 5건 | 영문 문서, 암호화 문서 |

---

## 2. 테스트 환경

| 항목 | 내용 |
|------|------|
| 런타임 | Node.js 20+ |
| 단위/통합 테스트 프레임워크 | Vitest |
| E2E 프레임워크 | Playwright |
| DB | SQLite (`:memory:` — 테스트용) |
| 스토리지 | 메모리 mock (단위/통합), MinIO (E2E) |
| CI 환경 | GitHub Actions (ubuntu-latest) |
| HWP 엔진 | rhwp 0.7.0 (sidecar 없음) |
| 테스트 픽스처 | `apps/api/src/test/` |

---

## 3. 테스트 유형별 커버리지 목표

| 테스트 유형 | 목표 커버리지 | 현재 (2026-06-11) |
|-------------|--------------|-------------------|
| 단위 테스트 (라인) | ≥ 80% | ~78% |
| 통합 테스트 (라우트) | 모든 엔드포인트 1건 이상 | 100% |
| E2E (핵심 흐름) | 업로드→변환→다운로드 | 완료 |
| 품질 코퍼스 | 5건 이상 실문서 | 5건 완료 |

---

## 4. 테스트 실행 방법

### 4.1 전체 테스트 실행

```bash
# 모든 패키지 테스트
pnpm -r test

# API 테스트만
pnpm --filter api test

# Web 테스트만
pnpm --filter web test
```

### 4.2 타입 체크

```bash
pnpm typecheck
# 또는 개별
pnpm --filter api exec tsc --noEmit
pnpm --filter web exec tsc --noEmit
```

### 4.3 E2E 테스트

```bash
# E2E 전용 (Playwright)
pnpm --filter e2e test

# 헤드리스 모드
pnpm --filter e2e test --reporter=list

# 특정 스펙만
pnpm --filter e2e test e2e/upload.spec.ts
```

### 4.4 커버리지 리포트

```bash
pnpm --filter api test --coverage
# coverage/ 디렉토리에 HTML 리포트 생성
```

### 4.5 품질 코퍼스 테스트

```bash
# 실제 문서 변환 테스트 (rhwp 필요)
pnpm --filter api test:corpus
```

---

## 5. 테스트 파일 인벤토리

| 파일 | 테스트 수 | 대상 기능 |
|------|-----------|-----------|
| `apps/api/src/app.test.ts` | 8 | rate-limit 429 응답, `/health` 제외 동작, CORS |
| `apps/api/src/config.test.ts` | 5 | 환경변수 로드, 필수값 누락 시 에러 |
| `apps/api/src/db.test.ts` | 3 | PrismaClient 싱글턴, WAL 모드 설정 |
| `apps/api/src/queue/jobQueue.test.ts` | 14 | `claimNext` 낙관적 잠금, 동시 요청 경합, `retryOrGiveUp` 분기 |
| `apps/api/src/queue/worker.test.ts` | 11 | 워커 poll 루프, stuck-running reaper (10분 초과) |
| `apps/api/src/routes/convert.test.ts` | 16 | 파일 업로드, 포맷 감지, 큐/인라인 분기, 인증 요구 |
| `apps/api/src/routes/convert.queue.test.ts` | 9 | 큐 경로 통합 (USE_QUEUE=true 환경) |
| `apps/api/src/routes/jobs.test.ts` | 18 | 목록 조회, 단건 조회, 다운로드 presigned URL, 품질 리포트, 삭제 |
| `apps/api/src/routes/stats.test.ts` | 6 | 상태별 카운트, 엔진별 성공률, 최근 실패 집계 |
| `apps/api/src/convert/registry.test.ts` | 12 | 엔진 체인 조합, `enabled: false` 제외, 체인 순서 |
| `apps/api/src/convert/quality.test.ts` | 8 | `statusFor` 로직, `QualityGateError` 발생 조건 |
| **API 소계** | **110** | |
| `apps/web/src/pages/index.test.tsx` | 7 | 업로드 폼 렌더, 드래그앤드롭, 진행률 표시 |
| `apps/web/src/pages/jobs.test.tsx` | 8 | 작업 목록 렌더, 상태 배지, 재시도 버튼 |
| `apps/web/src/pages/stats.test.tsx` | 6 | 통계 차트 렌더, 빈 상태 처리 |
| **Web 소계** | **21** | |
| `e2e/upload.spec.ts` | E2E | 전체 업로드→변환→다운로드 플로우 |
| `e2e/auth.spec.ts` | E2E | 인증 없는 접근 리다이렉트 |
| **총계** | **131+** | |

> 참고: 초기 카운트(API 95 + Web 21 = 116)에서 2026-06-11 보안 강화 테스트 추가로 110+으로 증가.

---

## 6. CI 전략

### 6.1 파이프라인 단계

```
1. 빌드 (pnpm build)
   └─ TypeScript 컴파일 오류 조기 감지

2. 타입 체크 (pnpm typecheck)
   └─ --noEmit로 타입 안전성 검증

3. 단위/통합 테스트 (pnpm -r test)
   └─ Vitest 병렬 실행
   └─ 커버리지 임계값 검사 (라인 ≥ 80%)

4. E2E 테스트 (pnpm --filter e2e test)
   └─ Playwright headless
   └─ 핵심 플로우만 (슬로우 테스트 제외)
```

### 6.2 브랜치 정책

| 이벤트 | 실행 단계 |
|--------|-----------|
| PR 오픈/업데이트 | 빌드 + 타입 체크 + 단위/통합 테스트 |
| main 머지 | 전체 파이프라인 (E2E 포함) |
| 릴리스 태그 | 전체 + 품질 코퍼스 테스트 |

### 6.3 실패 정책

- 빌드 실패 → PR 머지 차단
- 타입 체크 실패 → PR 머지 차단
- 단위/통합 테스트 실패 → PR 머지 차단
- E2E 실패 → 경고 (non-blocking, 환경 이슈 가능성 있음)

---

## 변경 이력

| 버전 | 날짜 | 변경 내용 | 작성자 |
|------|------|-----------|--------|
| v1.0 | 2026-06-11 | 최초 작성. 보안 강화 테스트 포함 | 개발팀 |
