# 구현 문서

| 항목 | 내용 |
|------|------|
| 문서 번호 | WF-04-01 |
| 버전 | v1.0 |
| 작성일 | 2026-06-11 |
| 작성자 | 개발팀 |
| 상태 | 확정 |

---

## 1. 구현 완료 현황

| 기능 | 파일 | 상태 |
|------|------|------|
| Fastify 앱 팩토리 + 플러그인 조립 | `apps/api/src/app.ts` | 완료 |
| 서버 진입점 + graceful shutdown | `apps/api/src/server.ts` | 완료 |
| Google OAuth 인증 (Auth.js v5) | `apps/api/src/auth/plugin.ts` | 완료 |
| 파일 업로드 엔드포인트 | `apps/api/src/routes/convert.ts` | 완료 |
| 작업 CRUD + 다운로드 + 품질 리포트 | `apps/api/src/routes/jobs.ts` | 완료 |
| 통계 집계 엔드포인트 | `apps/api/src/routes/stats.ts` | 완료 |
| 엔진 체인 레지스트리 | `apps/api/src/convert/registry.ts` | 완료 |
| Hancom SDK 엔진 | `apps/api/src/convert/engines/hancom.ts` | 완료 |
| rhwp-cli 엔진 (PDF/raster) | `apps/api/src/convert/engines/rhwpCli.ts` | 완료 |
| rhwp Python 엔진 | `apps/api/src/convert/engines/rhwpPython.ts` | 완료 |
| H2Orestart 엔진 | `apps/api/src/convert/engines/h2o.ts` | 완료 |
| Builtin 최소 변환기 | `apps/api/src/convert/engines/builtin.ts` | 완료 |
| Aspose 클라우드 엔진 | `apps/api/src/convert/engines/aspose.ts` | 완료 |
| Gotenberg 엔진 | `apps/api/src/convert/engines/gotenberg.ts` | 완료 |
| 품질 게이트 + 상태 계산 | `apps/api/src/convert/quality.ts` | 완료 |
| 공유 타입 정의 | `apps/api/src/convert/types.ts` | 완료 |
| DB 기반 작업 큐 (낙관적 잠금) | `apps/api/src/queue/jobQueue.ts` | 완료 |
| 폴링 워커 + stuck-running reaper | `apps/api/src/queue/worker.ts` | 완료 |
| ConversionJob 서비스 | `apps/api/src/jobs/jobService.ts` | 완료 |
| S3 호환 스토리지 | `apps/api/src/storage/s3.ts` | 완료 |
| 파일 포맷 감지 (매직 바이트) | `apps/api/src/detect/detectFormat.ts` | 완료 |
| PDF 미리보기 렌더러 | `apps/api/src/pdf/preview.ts` | 완료 |
| Prisma 스키마 + 마이그레이션 | `apps/api/prisma/schema.prisma` | 완료 |
| 환경변수 검증 | `apps/api/src/config.ts` | 완료 |
| Web 대시보드 (Next.js) | `apps/web/src/` | 완료 |
| rate-limit + trustProxy | `apps/api/src/app.ts` | 완료 (2026-06-11) |
| CSRF Origin 검증 | `apps/api/src/auth/plugin.ts` | 완료 (2026-06-11) |
| 비활성 엔진 품질 오염 수정 | `apps/api/src/convert/registry.ts` | 완료 (2026-06-11) |
| Office precise fallback 품질 거부 | `apps/api/src/convert/quality.ts` | 완료 (2026-06-11) |

---

## 2. 코드 구조 (monorepo 디렉토리 트리)

```
hwptopdf/
├── apps/
│   ├── api/                          # Fastify API 서버
│   │   ├── prisma/
│   │   │   ├── schema.prisma         # ConversionJob 모델
│   │   │   └── migrations/
│   │   ├── src/
│   │   │   ├── app.ts                # buildApp (팩토리)
│   │   │   ├── server.ts             # 진입점
│   │   │   ├── config.ts             # 환경변수 로드 + 검증
│   │   │   ├── db.ts                 # PrismaClient 싱글턴
│   │   │   ├── auth/
│   │   │   │   └── plugin.ts         # Auth.js v5, CSRF
│   │   │   ├── convert/
│   │   │   │   ├── registry.ts       # buildRegistry
│   │   │   │   ├── quality.ts        # statusFor, normalizeQualityReport
│   │   │   │   ├── types.ts          # Converter, QualityReport
│   │   │   │   └── engines/
│   │   │   │       ├── hancom.ts
│   │   │   │       ├── rhwpCli.ts
│   │   │   │       ├── rhwpPython.ts
│   │   │   │       ├── h2o.ts
│   │   │   │       ├── builtin.ts
│   │   │   │       ├── aspose.ts
│   │   │   │       └── gotenberg.ts
│   │   │   ├── detect/
│   │   │   │   └── detectFormat.ts   # fileMeta
│   │   │   ├── jobs/
│   │   │   │   └── jobService.ts
│   │   │   ├── pdf/
│   │   │   │   └── preview.ts
│   │   │   ├── queue/
│   │   │   │   ├── jobQueue.ts       # claimNext, retryOrGiveUp
│   │   │   │   └── worker.ts         # poll loop, reaper
│   │   │   ├── routes/
│   │   │   │   ├── convert.ts
│   │   │   │   ├── jobs.ts
│   │   │   │   └── stats.ts
│   │   │   ├── storage/
│   │   │   │   └── s3.ts
│   │   │   └── test/                 # 테스트 픽스처
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── web/                          # Next.js 프론트엔드
│       ├── src/
│       │   ├── pages/
│       │   │   ├── index.tsx         # 업로드 페이지
│       │   │   ├── jobs.tsx          # 작업 목록
│       │   │   └── stats.tsx         # 통계 대시보드
│       │   └── components/
│       └── package.json
├── e2e/                              # Playwright E2E 테스트
│   └── *.spec.ts
├── docker-compose.yml                # MinIO, Gotenberg, DB
├── pnpm-workspace.yaml
└── package.json
```

---

## 3. 핵심 구현 패턴

### 3.1 `finishConversion` 함수 흐름

`routes/convert.ts`와 `queue/worker.ts` 모두 동일한 `finishConversion` 유틸리티를 호출한다.

```
finishConversion(jobId, inputPath, registry, storage, jobService):

  1. registry.getChain(format, mode) → converter[]
  2. 엔진 체인 순회 (QualityFallbackConverter 패턴)
     - 각 엔진 시도 → ConversionAttempt 누적
     - 첫 성공 시 break
  3. normalizeQualityReport(attempts, warnings)
     - status: 'passed' | 'review' | 'failed'
     - grade: 'good' | 'acceptable' | 'fallback' | 'failed'
  4. grade === 'fallback' && mode === 'office-precise' → QualityGateError
  5. pdfBuffer → storage.put(key, buffer) → s3Key
  6. pdfPageCount(outputPath) → pageCount
  7. jobService.markSuccess(jobId, { s3Key, qualityReport, pageCount })
```

### 3.2 durable queue vs inline 분기 (`USE_QUEUE` 환경변수)

```
POST /convert:
  fileMeta(filename, magic) → format

  if USE_QUEUE === 'true':
    jobService.create({ format, mode, ... }) → job
    jobQueue.enqueue(job.id)
    return 202 Accepted { jobId }
  else:
    jobService.create({ format, mode, status: 'running' })
    finishConversion(jobId, ...)  ← 동기 실행 (await)
    return 200 OK { jobId, qualityReport }
```

인라인 모드는 개발/단일 파일 테스트에 적합하다. 프로덕션에서는 `USE_QUEUE=true`로 워커를 별도 프로세스로 실행한다.

### 3.3 `QualityFallbackConverter` (시도 루프, 결과 누적)

```typescript
async function runChain(
  converters: Converter[],
  inputPath: string,
  outputPath: string,
): Promise<{ attempts: ConversionAttempt[]; warnings: string[] }> {
  const attempts: ConversionAttempt[] = [];
  const warnings: string[] = [];

  for (const conv of converters) {
    const start = Date.now();
    try {
      await conv.convert(inputPath, outputPath);
      attempts.push({
        engine: conv.name,
        grade: conv.qualityGrade,
        success: true,
        durationMs: Date.now() - start,
      });
      break; // 첫 성공 시 중단
    } catch (err) {
      attempts.push({
        engine: conv.name,
        grade: conv.qualityGrade,
        success: false,
        durationMs: Date.now() - start,
        error: String(err),
      });
      // 계속 다음 엔진 시도
    }
  }

  return { attempts, warnings };
}
```

### 3.4 비활성 엔진 제외 패턴 (conditional spread)

```typescript
// apps/api/src/convert/registry.ts
export function buildRegistry(config: EngineConfig): ConversionRegistry {
  const hwpPrecise: Converter[] = [
    ...(config.hancom.enabled   ? [new HancomConverter(config.hancom)]   : []),
    ...(config.rhwpCli.enabled  ? [new RhwpCliConverter(config.rhwpCli)] : []),
    ...(config.rhwp.enabled     ? [new RhwpPythonConverter(config.rhwp)] : []),
    new H2OConverter(),
    new BuiltinConverter(),
  ];

  const hwpQuick: Converter[] = [
    new BuiltinConverter(),
    new H2OConverter(),
    ...(config.rhwp.enabled ? [new RhwpPythonConverter(config.rhwp)] : []),
  ];

  const officePrecise: Converter[] = [
    ...(config.aspose.enabled    ? [new AsposeConverter(config.aspose)]      : []),
    ...(config.gotenberg.enabled ? [new GotenbergConverter(config.gotenberg)]: []),
    new H2OConverter(),
    new BuiltinConverter(),
  ];

  const officeQuick: Converter[] = [new BuiltinConverter()];

  return { hwpPrecise, hwpQuick, officePrecise, officeQuick };
}
```

비활성 엔진은 배열에 포함되지 않으므로 `attempts`에 실패 항목이 기록되지 않고, `statusFor`가 불필요하게 `review`를 반환하는 오염을 방지한다.

---

## 4. 빌드 및 실행 방법

### 4.1 의존성 설치

```bash
pnpm install
```

### 4.2 Prisma 스키마 생성 및 마이그레이션

```bash
# 클라이언트 생성
pnpm --filter api exec prisma generate

# 개발 DB 마이그레이션 (SQLite)
pnpm --filter api exec prisma migrate dev

# 프로덕션 마이그레이션
pnpm --filter api exec prisma migrate deploy
```

### 4.3 개발 서버 실행

```bash
# API + Web 동시 실행
pnpm dev

# API만 실행
pnpm --filter api dev

# Web만 실행
pnpm --filter web dev
```

### 4.4 프로덕션 빌드

```bash
pnpm build
pnpm --filter api start
```

### 4.5 Docker Compose (MinIO + Gotenberg)

```bash
docker compose up -d
```

---

## 5. 개발 환경 설정

### 5.1 필수 환경변수 (`.env`)

```bash
# 데이터베이스
DATABASE_URL="file:./dev.db"

# 스토리지
S3_ENDPOINT="http://localhost:9000"
S3_ACCESS_KEY="minioadmin"
S3_SECRET_KEY="minioadmin"
S3_BUCKET="hwptopdf"

# 인증
AUTH_SECRET="dev-secret-change-in-prod"
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."

# CSRF
WEB_ORIGIN="http://localhost:3000"

# 개발 편의
DEV_AUTH=1          # Google OAuth 생략, 고정 계정 사용
USE_QUEUE=false     # 인라인 변환 (큐 불필요)

# 엔진 활성화
RHWP_CLI_ENABLED=true
RHWP_CLI_MODE=pdf
RHWP_PYTHON_ENABLED=false
HANCOM_ENABLED=false
ASPOSE_ENABLED=false
GOTENBERG_ENABLED=false
```

### 5.2 타입 체크

```bash
pnpm typecheck
# 또는
pnpm -r exec tsc --noEmit
```

---

## 6. 2026-06-11 보안 강화 구현 내역

| 항목 | 구현 위치 | 내용 |
|------|-----------|------|
| rate-limit | `app.ts` | `@fastify/rate-limit` 플러그인. 기본 100 req/min/IP. `/health`는 제외 | 
| trustProxy | `app.ts` | Nginx 역방향 프록시 환경에서 실제 클라이언트 IP를 rate-limit에 적용 |
| CSRF Origin 검증 | `auth/plugin.ts` | POST/PUT/DELETE/PATCH 요청 시 `Origin` 헤더가 `WEB_ORIGIN`과 일치하지 않으면 403 반환 |
| 품질 게이트 수정 | `convert/quality.ts` | Office precise + grade=fallback 조합 시 `QualityGateError` 발생. 사용자에게 422로 응답 |
| 비활성 엔진 오염 수정 | `convert/registry.ts` | `enabled: false` 엔진을 체인 배열에서 완전 제외 (conditional spread). 실패 시도로 기록되어 `status=review` 오염하던 버그 수정 |

---

## 변경 이력

| 버전 | 날짜 | 변경 내용 | 작성자 |
|------|------|-----------|--------|
| v1.0 | 2026-06-11 | 최초 작성. 보안 강화 구현 내역 포함 | 개발팀 |
