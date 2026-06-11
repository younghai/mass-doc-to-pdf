# 테스트 실행 결과

| 항목 | 내용 |
|------|------|
| 문서 번호 | WF-05-03 |
| 버전 | v1.0 |
| 작성일 | 2026-06-11 |
| 작성자 | 개발팀 |
| 상태 | 확정 |

---

## 1. 테스트 실행 결과 요약 (2026-06-11 기준)

| 구분 | 총 테스트 | 통과 | 실패 | 건너뜀 | 통과율 |
|------|-----------|------|------|--------|--------|
| API (Vitest) | 110 | 110 | 0 | 0 | 100% |
| Web (Vitest) | 21 | 21 | 0 | 0 | 100% |
| E2E (Playwright) | 8 | 8 | 0 | 0 | 100% |
| **전체** | **139** | **139** | **0** | **0** | **100%** |

> 참고: 2026-06-11 보안 강화(rate-limit, CSRF, 품질 게이트, 비활성 엔진 제외) 관련 테스트 23건 추가 후 전수 통과.

---

## 2. 파일별 테스트 결과

### 2.1 API 테스트

| 파일 | 테스트 수 | 통과 | 실패 | 비고 |
|------|-----------|------|------|------|
| `app.test.ts` | 8 | 8 | 0 | rate-limit 429, `/health` 제외, CORS |
| `config.test.ts` | 5 | 5 | 0 | 환경변수 검증 |
| `db.test.ts` | 3 | 3 | 0 | WAL 모드, busy_timeout |
| `queue/jobQueue.test.ts` | 14 | 14 | 0 | claimNext 낙관적 잠금, retryOrGiveUp |
| `queue/worker.test.ts` | 11 | 11 | 0 | poll 루프, stuck-running reaper |
| `routes/convert.test.ts` | 16 | 16 | 0 | 업로드, 포맷 감지, 큐 분기 |
| `routes/convert.queue.test.ts` | 9 | 9 | 0 | USE_QUEUE=true 통합 |
| `routes/jobs.test.ts` | 18 | 18 | 0 | CRUD, 다운로드, 품질, 삭제 |
| `routes/stats.test.ts` | 6 | 6 | 0 | 통계 집계 |
| `convert/registry.test.ts` | 12 | 12 | 0 | 엔진 체인, 비활성 엔진 제외 |
| `convert/quality.test.ts` | 8 | 8 | 0 | 품질 게이트, statusFor |
| **소계** | **110** | **110** | **0** | |

### 2.2 Web 테스트

| 파일 | 테스트 수 | 통과 | 실패 | 비고 |
|------|-----------|------|------|------|
| `pages/index.test.tsx` | 7 | 7 | 0 | 업로드 폼, 드래그앤드롭 |
| `pages/jobs.test.tsx` | 8 | 8 | 0 | 목록, 상태 배지, 재시도 |
| `pages/stats.test.tsx` | 6 | 6 | 0 | 통계 차트, 빈 상태 |
| **소계** | **21** | **21** | **0** | |

### 2.3 E2E 테스트

| 파일 | 테스트 수 | 통과 | 실패 | 비고 |
|------|-----------|------|------|------|
| `e2e/upload.spec.ts` | 5 | 5 | 0 | 전체 업로드→변환→다운로드 플로우 |
| `e2e/auth.spec.ts` | 3 | 3 | 0 | 인증 없는 접근 리다이렉트 |
| **소계** | **8** | **8** | **0** | |

---

## 3. HWP 품질 코퍼스 결과

실제 한국어 업무 문서 5건을 rhwp 0.7.0 환경 (sidecar 없음)에서 테스트한 결과.

| # | 파일명 | 파일 형식 | 크기 | 품질 상태 | 사용 엔진 | 페이지 수 | PDF 크기 | 비고 |
|---|--------|-----------|------|-----------|-----------|-----------|----------|------|
| 1 | 시스템 구성안 | HWP | 44 KB | passed | rhwp 0.7.0 | 14 | 990 KB | 정상 변환 |
| 2 | 계약서류 안내 | HWP | 65 KB | passed | rhwp 0.7.0 | 7 | 542 KB | 정상 변환 |
| 3 | 보고서 양식 | HWP | 14 KB | **failed** | - | - | - | PartialTable LAYOUT_OVERFLOW |
| 4 | 소득세 감면신청서 | HWP | 313 KB | passed | rhwp 0.7.0 | 1 | 121 KB | 정상 변환 |
| 5 | 사업계획서 | **HWPX** | 36 KB | passed | rhwp 0.7.0 | 2 | 98 KB | HWPX 포맷 정상 처리 |

### 코퍼스 결과 요약

| 항목 | 수치 |
|------|------|
| 총 문서 | 5건 |
| 성공 | 4건 (80%) |
| 실패 | 1건 (20%) |
| 평균 PDF 크기 (성공분) | ~438 KB |
| 총 변환 페이지 | 24페이지 |

### 실패 문서 상세: 보고서 양식.hwp

- **실패 원인**: `PartialTable LAYOUT_OVERFLOW` — 복잡한 중첩 표 레이아웃이 rhwp 0.7.0의 렌더러 한계를 초과
- **근본 원인**: rhwp 0.7.0은 표 셀 병합 및 중첩 표 레이아웃 처리에 제약 존재
- **해결 방안**: rhwp 0.8.0+ 업그레이드 또는 Hancom sidecar 엔진 활성화 필요

---

## 4. 발견된 버그 및 수정 이력

### BUG-001: 비활성 엔진이 품질 상태를 오염시키는 버그

| 항목 | 내용 |
|------|------|
| 발견일 | 2026-06-11 |
| 심각도 | 중(Medium) |
| 영향 범위 | `convert/registry.ts`, `convert/quality.ts` |
| 증상 | `hancom.enabled=false`, `rhwpCli.enabled=false` 환경에서 rhwp Python으로 변환 성공 시 `status='review'`로 잘못 계산됨 |
| 근본 원인 | 비활성 엔진이 체인에 포함된 채로 "실패 시도"로 기록되고, `statusFor`가 실패 시도 존재 시 `review`를 반환하는 로직과 충돌 |
| 수정 방법 | `registry.ts`에서 `enabled: false` 엔진을 conditional spread로 배열에서 완전 제외 |
| 수정 커밋 | `f2e3088` (2026-06-11) |
| 검증 | `convert/registry.test.ts` TC `enabled:false 엔진 제외` 12건 전수 통과 |

**수정 전 (버그):**
```typescript
const hwpPrecise: Converter[] = [
  new HancomConverter(config.hancom),   // enabled=false여도 포함됨
  new RhwpCliConverter(config.rhwpCli), // enabled=false여도 포함됨
  new H2OConverter(),
  new BuiltinConverter(),
];
```

**수정 후 (정상):**
```typescript
const hwpPrecise: Converter[] = [
  ...(config.hancom.enabled   ? [new HancomConverter(config.hancom)]   : []),
  ...(config.rhwpCli.enabled  ? [new RhwpCliConverter(config.rhwpCli)] : []),
  new H2OConverter(),
  new BuiltinConverter(),
];
```

### BUG-002: Office precise + fallback grade 조합 시 품질 게이트 미동작

| 항목 | 내용 |
|------|------|
| 발견일 | 2026-06-11 |
| 심각도 | 중(Medium) |
| 영향 범위 | `convert/quality.ts` |
| 증상 | Office 문서를 precise 모드로 변환 시 H2O(fallback 등급)로 성공해도 품질 게이트가 작동하지 않아 저품질 PDF가 반환됨 |
| 근본 원인 | `QualityGateError` 발생 조건이 구현되지 않았음 |
| 수정 방법 | `normalizeQualityReport` 내에서 `isOfficePrecise && grade==='fallback'` 시 `QualityGateError` throw 추가 |
| 수정 커밋 | `f2e3088` (2026-06-11) |
| 검증 | `convert/quality.test.ts` TC `QualityGateError 발생 조건` 전수 통과 |

---

## 5. 미결 항목

### OPEN-001: 보고서 양식.hwp PartialTable LAYOUT_OVERFLOW

| 항목 | 내용 |
|------|------|
| 상태 | 미결 (오픈) |
| 우선순위 | 낮음 |
| 증상 | 복잡한 중첩 표 문서(14KB) 변환 실패 (`status='failed'`) |
| 원인 | rhwp 0.7.0 표 레이아웃 오버플로우 처리 한계 |
| 해결 조건 | rhwp 0.8.0+ 릴리스 이후 업그레이드 OR Hancom sidecar 엔진 활성화 |
| 임시 대응 | 사용자에게 `status='failed'` + 상세 에러 메시지 표시. 수동 변환 안내 |
| 영향 범위 | 복잡한 표 레이아웃이 포함된 HWP 문서에 한정 |

### OPEN-002: E2E 테스트 환경 의존성

| 항목 | 내용 |
|------|------|
| 상태 | 미결 (모니터링) |
| 증상 | CI 환경에서 MinIO 컨테이너 초기화 지연으로 E2E 간헐적 타임아웃 |
| 임시 대응 | E2E는 non-blocking으로 설정 (실패해도 PR 머지 차단 안 함) |
| 해결 방안 | MinIO health check 대기 로직 추가 예정 |

---

## 변경 이력

| 버전 | 날짜 | 변경 내용 | 작성자 |
|------|------|-----------|--------|
| v1.0 | 2026-06-11 | 최초 작성. BUG-001/002 수정 이력, 코퍼스 결과 포함 | 개발팀 |
