# 컴포넌트 상세 설계

| 항목 | 내용 |
|------|------|
| 문서 번호 | WF-03-01 |
| 버전 | v1.0 |
| 작성일 | 2026-06-11 |
| 작성자 | 개발팀 |
| 상태 | 확정 |

---

## 1. 모듈 구조

### 1.1 전체 모듈 책임 표

| 파일 경로 | 책임 | 주요 export |
|-----------|------|-------------|
| `apps/api/src/app.ts` | Fastify 앱 팩토리. 플러그인 등록(auth, rate-limit, multipart, CORS), 라우트 마운트, 미들웨어 체인 조립 | `buildApp(deps: AppDeps): FastifyInstance` |
| `apps/api/src/server.ts` | 프로세스 진입점. DB migrate, 앱 빌드, listen, graceful shutdown 처리 | (진입점, export 없음) |
| `apps/api/src/auth/plugin.ts` | Auth.js v5 기반 Google OAuth 세션 관리. DEV_AUTH=1 시 고정 개발 계정 주입. CSRF Origin 검증 훅 | `authPlugin(deps): FastifyPlugin` |
| `apps/api/src/routes/convert.ts` | 파일 업로드 엔드포인트(`POST /convert`). 파일 감지 → 큐/인라인 분기 → 변환 실행 또는 큐 등록 | `convertRoutes(deps): FastifyPlugin` |
| `apps/api/src/routes/jobs.ts` | 작업 CRUD(`GET /jobs`, `GET /jobs/:id`, `DELETE /jobs/:id`), 결과 다운로드(`GET /jobs/:id/download`), 품질 리포트(`GET /jobs/:id/quality`) | `jobsRoutes(deps): FastifyPlugin` |
| `apps/api/src/routes/stats.ts` | 변환 통계 집계(`GET /stats`). 상태별 카운트, 엔진별 성공률, 최근 실패 목록 | `statsRoutes(deps): FastifyPlugin` |
| `apps/api/src/convert/registry.ts` | 활성화된 엔진 목록 조합. HWP/HWPX precise/quick, Office precise/quick 네 가지 체인 구성. 비활성 엔진(`enabled: false`)은 스프레드에서 제외 | `buildRegistry(config: EngineConfig): ConversionRegistry` |
| `apps/api/src/convert/engines/hancom.ts` | Hancom SDK 래퍼. `convert(inputPath, outputPath)` → SDK 호출 | `HancomConverter` |
| `apps/api/src/convert/engines/rhwpCli.ts` | rhwp-cli 프로세스 래퍼. PDF/raster 모드 분기 | `RhwpCliConverter` |
| `apps/api/src/convert/engines/rhwpPython.ts` | rhwp Python 패키지 래퍼. subprocess 호출 | `RhwpPythonConverter` |
| `apps/api/src/convert/engines/h2o.ts` | H2Orestart(LibreOffice headless) 래퍼 | `H2OConverter` |
| `apps/api/src/convert/engines/builtin.ts` | 내장 최소 변환기. 최후 폴백 | `BuiltinConverter` |
| `apps/api/src/convert/engines/aspose.ts` | Aspose 클라우드 API 래퍼. Office precise 1순위 | `AsposeConverter` |
| `apps/api/src/convert/engines/gotenberg.ts` | Gotenberg Docker 래퍼. Office precise 2순위 | `GotenbergConverter` |
| `apps/api/src/convert/quality.ts` | 품질 점수 계산. `statusFor`, `normalizeQualityReport`. Office precise fallback 거부(QualityGateError) | `statusFor`, `normalizeQualityReport`, `QualityGateError` |
| `apps/api/src/convert/types.ts` | 공유 타입 정의. `Converter` 인터페이스, `ConversionAttempt`, `QualityReport` | `Converter`, `ConversionAttempt`, `QualityReport` |
| `apps/api/src/queue/jobQueue.ts` | DB 기반 작업 큐. 낙관적 잠금 claim, 재시도/포기 로직 | `JobQueue.claimNext()`, `JobQueue.retryOrGiveUp()` |
| `apps/api/src/queue/worker.ts` | 폴링 워커. 2초 간격 claimNext → 변환 → 결과 기록. 10분 stuck-running reaper | `startWorker(deps)`, `runReaper(deps)` |
| `apps/api/src/jobs/jobService.ts` | ConversionJob CRUD 추상화. 상태 전이 메서드 | `create`, `markRunning`, `markSuccess`, `markFailed`, `countActive` |
| `apps/api/src/storage/s3.ts` | S3 호환 오브젝트 스토리지(MinIO/S3). presigned URL, put/get/delete | `Storage.put()`, `Storage.get()`, `Storage.delete()` |
| `apps/api/src/detect/detectFormat.ts` | 파일명 + 매직 바이트 기반 포맷 감지. PDF 입력 거부 | `fileMeta(filename, magic8bytes): FileMeta` |
| `apps/api/src/pdf/preview.ts` | LibreOffice 기반 PDF 페이지 수 측정 및 썸네일 생성 | `LibreOfficePdfPreviewRenderer` |

---

## 2. 핵심 인터페이스 정의

### 2.1 `Converter` 인터페이스 (`convert/types.ts`)

```typescript
interface Converter {
  /** 엔진 고유 식별자 (품질 리포트에 기록됨) */
  readonly name: string;

  /** 품질 등급: 'good' | 'acceptable' | 'fallback' | 'failed' */
  readonly qualityGrade: QualityGrade;

  /**
   * 변환 실행
   * @param inputPath  임시 디렉토리 내 원본 파일 경로
   * @param outputPath 변환 결과 PDF 저장 경로
   * @throws ConversionError  변환 실패 시
   */
  convert(inputPath: string, outputPath: string): Promise<void>;
}

type QualityGrade = 'good' | 'acceptable' | 'fallback' | 'failed';

interface ConversionAttempt {
  engine: string;
  grade: QualityGrade;
  success: boolean;
  durationMs: number;
  error?: string;
}

interface QualityReport {
  attempts: ConversionAttempt[];
  warnings: string[];
  finalGrade: QualityGrade;
  status: 'passed' | 'review' | 'failed';
}
```

### 2.2 `AppDeps` 인터페이스 (`app.ts`)

```typescript
interface AppDeps {
  db: PrismaClient;
  storage: Storage;
  registry: ConversionRegistry;
  jobQueue: JobQueue;
  jobService: JobService;
  config: AppConfig;
}
```

`AppDeps`는 앱 팩토리에 주입되는 모든 외부 의존성을 포함한다. 테스트 시 각 의존성을 mock으로 교체할 수 있다.

### 2.3 `EngineConfig` 인터페이스 (`convert/registry.ts`)

```typescript
interface EngineConfig {
  hancom: {
    enabled: boolean;
    sdkPath?: string;
  };
  rhwpCli: {
    enabled: boolean;
    mode: 'pdf' | 'raster';
    binPath?: string;
  };
  rhwp: {
    enabled: boolean;
    pythonPath?: string;
  };
  aspose: {
    enabled: boolean;
    apiKey?: string;
    appSid?: string;
  };
  gotenberg: {
    enabled: boolean;
    url?: string;
  };
}
```

---

## 3. 의존성 주입 패턴

### 3.1 `buildApp(deps: AppDeps)` 패턴

앱은 모든 I/O 의존성을 생성자 주입으로 받는다. `server.ts`는 실제 구현체를, 테스트는 mock을 주입한다.

```
server.ts
  └─ buildApp({
       db: new PrismaClient(),
       storage: new S3Storage(config),
       registry: buildRegistry(engineConfig),
       jobQueue: new JobQueue(db),
       jobService: new JobService(db),
       config: loadConfig()
     })

app.test.ts
  └─ buildApp({
       db: mockDb,
       storage: mockStorage,
       registry: mockRegistry,
       ...
     })
```

### 3.2 라우트 플러그인 주입

각 라우트 플러그인은 `deps`를 클로저로 캡처한다. Fastify `decorate`를 사용하지 않아 타입 안전성을 유지한다.

```
buildApp(deps)
  ├─ authPlugin(deps)          ← auth 의존성 전달
  ├─ convertRoutes(deps)       ← storage, registry, jobQueue, jobService
  ├─ jobsRoutes(deps)          ← storage, jobService
  └─ statsRoutes(deps)         ← db (집계 쿼리 직접 실행)
```

---

## 4. 변환 엔진 추상화

### 4.1 `QualityFallbackConverter` 동작 원리

`buildRegistry`는 우선순위 순으로 `Converter[]` 배열을 반환한다. `convertRoutes` 또는 `worker`는 이 배열을 순회하면서 첫 번째 성공하는 엔진의 결과를 사용한다.

```
시도 루프:
  for converter of chain:
    try:
      await converter.convert(inputPath, outputPath)
      attempts.push({ engine, grade, success: true, ... })
      break  ← 성공 시 중단
    catch:
      attempts.push({ engine, grade, success: false, error, ... })
      continue  ← 다음 엔진 시도

결과 누적:
  qualityReport = normalizeQualityReport(attempts, warnings)
  if qualityReport.status === 'failed': throw ConversionError
  if isOfficePrecise && grade === 'fallback': throw QualityGateError
```

### 4.2 비활성 엔진 제외 패턴

비활성 엔진은 배열에 추가되지 않으므로 "실패 시도"로 기록되지 않아 품질 상태를 오염시키지 않는다.

```typescript
// registry.ts 핵심 패턴
const hwpPreciseChain: Converter[] = [
  ...(config.hancom.enabled  ? [new HancomConverter(config.hancom)]  : []),
  ...(config.rhwpCli.enabled ? [new RhwpCliConverter(config.rhwpCli)]: []),
  ...(config.rhwp.enabled    ? [new RhwpPythonConverter(config.rhwp)] : []),
  new H2OConverter(),
  new BuiltinConverter(),
];
```

---

## 변경 이력

| 버전 | 날짜 | 변경 내용 | 작성자 |
|------|------|-----------|--------|
| v1.0 | 2026-06-11 | 최초 작성 | 개발팀 |
