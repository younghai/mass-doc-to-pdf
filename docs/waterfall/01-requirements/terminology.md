# 용어 규칙 (Terminology)

> Mass Doc to PDF (mass-doc-to-pdf) 프로젝트에서 사용하는 용어, 상태값, 네이밍 규칙을 정의한다.

| 항목 | 내용 |
| --- | --- |
| **프로젝트명** | Mass Doc to PDF (mass-doc-to-pdf) |
| **문서 버전** | v1.0 |
| **작성일** | 2026-06-11 |
| **최종 수정일** | 2026-06-11 |
| **작성자** | 개발팀 |
| **문서 상태** | 작성 중 |

---

## 1. 핵심 도메인 용어

| 용어 | 영문 | 정의 |
| --- | --- | --- |
| 변환 작업 | ConversionJob | 문서 하나의 변환 요청 단위. Prisma 모델이며 SQLite에 영속화된다. id(cuid), status, engine, qualityMode 등을 포함한다. |
| 문서 포맷 | DocFormat | 변환 작업의 포맷 분류. `office`(DOC/DOCX/PPT/PPTX/XLS/XLSX)와 `hwp`(HWP/HWPX) 두 가지로 구분된다. |
| 원본 키 | sourceKey | MinIO에 저장된 업로드 원본 파일의 경로/키. `conversions/{userId}/{jobId}/source.{ext}` 형식. |
| 출력 키 | outputKey | 변환 완료된 PDF 파일의 MinIO 경로/키. `conversions/{userId}/{jobId}/output.pdf` 형식. |
| 엔진 체인 | engine chain | HWP 또는 Office 포맷을 PDF로 변환하기 위해 순차적으로 시도되는 변환 엔진의 목록. 앞선 엔진이 실패하면 다음 엔진으로 폴백한다. |
| 품질 리포트 | QualityReport | 변환 완료 후 생성되는 품질 판정 결과. QualityStatus, QualityGrade, QualityAttempt 목록을 포함한다. |
| 품질 시도 | QualityAttempt | 엔진 체인 내 개별 엔진의 변환 시도 결과. 엔진명, 성공 여부, 소요 시간, 오류 메시지를 기록한다. |
| 배치 | BatchDTO | 동시에 업로드된 여러 파일 묶음. 각 파일은 독립적인 ConversionJob으로 생성되며 공통 batchId를 공유한다. |
| 내구성 큐 | durable queue | DB(SQLite)에 상태를 영속화하는 작업 큐. 서버 재시작 후에도 pending/queued 작업이 유실되지 않는다. |
| 인라인 모드 | inline mode | PDF를 `Content-Disposition: inline`으로 응답하여 브라우저 내장 뷰어에서 바로 렌더링하는 방식. |
| 사이드카 | sidecar | hwp-sidecar Docker 컨테이너. LibreOffice 및 HWP 관련 도구를 격리된 환경에서 실행하는 서비스. |
| 빌트인 폴백 | builtin fallback | 외부 엔진 없이 서버 내장 로직으로 변환을 시도하는 최후의 엔진. 품질은 낮으나 의존성이 없다. |
| 속도 제한 | rate limit | 단위 시간 내 요청 횟수를 제한하는 메커니즘. 전체 300 req/min, 인증 엔드포인트 60 req/min. |
| 신뢰 프록시 | trustProxy | Fastify 설정. 리버스 프록시(nginx, 로드밸런서) 뒤에서 `X-Forwarded-For` 헤더를 신뢰하여 실제 클라이언트 IP를 추출한다. |
| CSRF | CSRF (Cross-Site Request Forgery) | 악성 사이트가 인증된 사용자의 세션을 악용해 state-mutating 요청을 위조하는 공격. Origin 헤더 검증으로 방어한다. |
| WAL 모드 | WAL (Write-Ahead Logging) | SQLite 저널 모드. 읽기와 쓰기를 동시에 허용하여 동시성을 향상시킨다. `busy_timeout=5000ms`와 함께 설정한다. |

---

## 2. 상태값 (Enum)

### 2.1 작업 상태 (JobStatus)

| 상태값 | 설명 | 전이 조건 |
| --- | --- | --- |
| `pending` | 작업이 생성되었으나 아직 처리되지 않음 | 업로드 직후, 또는 재시도 시 리셋 |
| `queued` | DB 큐에 적재되어 worker가 처리 대기 중 | `USE_QUEUE=1`에서 pending → queued |
| `running` | 현재 변환 엔진이 실행 중 | worker가 작업을 claim할 때 |
| `success` | 변환 완료 및 outputKey 저장 성공 | running → success (품질 게이트 통과/review 포함) |
| `failed` | 변환 실패 (모든 엔진 실패 또는 attempts 초과) | running → failed |

**상태 전이 다이어그램:**

```
pending ──► queued ──► running ──► success
   ▲                      │
   │                      ▼
   └──────────────── failed (재시도 시 pending으로 리셋)
```

### 2.2 품질 상태 (QualityStatus)

| 상태값 | 설명 | UI 처리 |
| --- | --- | --- |
| `passed` | 렌더링 품질이 기준을 충족함 | 즉시 사용 가능, 별도 배지 없음 |
| `review` | 품질이 허용 범위이나 수동 검토 권장 | 주의(warning) 배지 표시 |
| `failed` | 변환 결과물이 유효한 PDF가 아니거나 품질 미달 | 오류 표시, 자동 재시도 트리거 |

### 2.3 품질 등급 (QualityGrade)

| 등급값 | 설명 | 조건 |
| --- | --- | --- |
| `good` | 원본 대비 렌더링 충실도 높음 | 최선순위 엔진(Hancom SDK, Gotenberg)으로 변환 성공 |
| `acceptable` | 일부 레이아웃 차이 있으나 내용 판독 가능 | 2순위 엔진으로 변환 성공 |
| `fallback` | fallback 엔진으로 변환 완료, 품질 저하 가능 | builtin 또는 H2Orestart로 폴백하여 성공 |
| `failed` | 변환 결과물이 유효한 PDF로 인정되지 않음 | 모든 엔진 실패 |

### 2.4 변환 모드 (ConversionMode / qualityMode)

| 모드값 | 설명 | 엔진 체인 |
| --- | --- | --- |
| `precise` | 정확한 렌더링 우선. HWP 전용 | Hancom SDK → rhwp-cli → rhwp(Python) → H2Orestart/LibreOffice → builtin |
| `quick` | 빠른 처리 우선. HWP 전용 | builtin → H2Orestart → rhwp(Python) |

> Office 포맷(DOC/DOCX 등)은 qualityMode에 관계없이 단일 체인(Gotenberg → hwp-sidecar → builtin → Aspose)을 사용한다.

---

## 3. 엔진 식별자

| 엔진 식별자 | 설명 | 적용 포맷 |
| --- | --- | --- |
| `hancom-sdk` | Hancom Office SDK (선택적 설치) | HWP, HWPX |
| `rhwp-cli` | rhwp 커맨드라인 도구 | HWP, HWPX |
| `rhwp-python` | rhwp Python 바인딩 | HWP, HWPX |
| `h2orestart` | H2Orestart LibreOffice 확장 + hwp-sidecar | HWP, HWPX |
| `libreoffice` | LibreOffice 직접 실행 (hwp-sidecar) | HWP, HWPX, Office |
| `builtin` | 서버 내장 폴백 변환 로직 | HWP, HWPX, Office |
| `gotenberg` | Gotenberg 마이크로서비스 (LibreOffice 기반) | Office (DOC/DOCX/PPT/PPTX/XLS/XLSX) |
| `hwp-sidecar` | hwp-sidecar Docker 서비스 경유 변환 | HWP, HWPX, Office |
| `aspose` | Aspose.Words/Slides/Cells (선택적 라이선스) | Office |

---

## 4. 네이밍 규칙

### 4.1 코드 네이밍

| 대상 | 규칙 | 예시 |
| --- | --- | --- |
| TypeScript 변수/함수 | camelCase | `conversionJob`, `getJobById`, `qualityMode` |
| TypeScript 클래스/타입/인터페이스 | PascalCase | `ConversionJob`, `QualityReport`, `BatchDTO` |
| TypeScript Enum 값 | camelCase (문자열) | `"pending"`, `"precise"`, `"good"` |
| DB 테이블/컬럼 | PascalCase (Prisma 모델), snake_case (DB 컬럼) | `ConversionJob` 모델 → `conversion_jobs` 테이블 |
| Prisma 모델 필드 | camelCase | `userId`, `sourceKey`, `durationMs`, `lockedAt` |
| API 경로 | kebab-case | `/api/jobs/:id/preview.png` |
| 환경변수 | UPPER_SNAKE_CASE | `USE_QUEUE`, `DEV_AUTH`, `AUTH_SECRET`, `WEB_ORIGIN` |
| MinIO 키 | 슬래시 구분 경로 | `conversions/{userId}/{jobId}/source.hwp` |
| React 컴포넌트 | PascalCase | `JobDetail`, `BatchUpload`, `QualityBadge` |
| React 훅 | camelCase + `use` 접두사 | `useJobDetail`, `useBatchUpload` |

### 4.2 API 응답 필드

| 위치 | DB 컬럼 | API 응답 | 비고 |
| --- | --- | --- | --- |
| ConversionJob | `created_at` | `createdAt` | Prisma camelCase 자동 변환 |
| ConversionJob | `duration_ms` | `durationMs` | Prisma camelCase 자동 변환 |
| ConversionJob | `source_key` | `sourceKey` | Prisma camelCase 자동 변환 |
| ConversionJob | `output_key` | `outputKey` | Prisma camelCase 자동 변환 |
| ConversionJob | `quality_mode` | `qualityMode` | Prisma camelCase 자동 변환 |
| ConversionJob | `batch_id` | `batchId` | Prisma camelCase 자동 변환 |

### 4.3 파일/디렉터리 구조 네이밍

| 영역 | 규칙 | 예시 |
| --- | --- | --- |
| API 라우트 파일 | kebab-case | `convert.ts`, `jobs.ts`, `stats.ts` |
| 변환 엔진 파일 | kebab-case | `gotenberg.ts`, `rhwp-cli.ts`, `builtin.ts` |
| React 페이지 | PascalCase | `JobDetail.tsx`, `BatchUpload.tsx` |
| 공유 패키지 | camelCase/kebab-case | `packages/shared/src/storage.ts` |
| Docker 서비스명 | kebab-case | `hwp-sidecar`, `createbucket`, `api`, `worker` |

---

## 5. 변경 이력

| 버전 | 날짜 | 작성자 | 변경 내용 |
| --- | --- | --- | --- |
| v1.0 | 2026-06-11 | 개발팀 | 초안 작성 |
