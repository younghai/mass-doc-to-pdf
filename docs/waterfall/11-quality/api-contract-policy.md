# API 계약 정책서 (API Contract Policy)

> Mass Doc to PDF API의 버전 관리, 계약 테스트, 타입 단일 진실 소스, 하위 호환성 규칙을 정의한다.

| 항목 | 내용 |
| --- | --- |
| **프로젝트명** | Mass Doc to PDF (mass-doc-to-pdf) |
| **문서 버전** | v1.0 |
| **작성일** | 2026-06-11 |
| **최종 수정일** | 2026-06-11 |
| **작성자** | 개발팀 |
| **문서 상태** | 확정 |

---

## 1. API 버전 관리 정책

### 1.1 현재 상태

현재 API는 **v1 (비공식)**이다. URL prefix로 `/api/v1/`를 사용하지 않으며, 모든 엔드포인트는 `/api/` 직하에 위치한다.

| 항목 | 현재 | 목표 (다음 마이너) |
| --- | --- | --- |
| URL 구조 | `/api/jobs`, `/api/stats` | `/api/v1/jobs`, `/api/v1/stats` |
| 버전 표기 | 비공식 (헤더 없음) | `API-Version: 1` 응답 헤더 |
| 문서화 | 내부 스펙 | OpenAPI 3.0 스펙 |

### 1.2 Breaking Change 정책

**Breaking Change란 기존 클라이언트가 수정 없이 동작하지 않게 되는 변경이다.**

| 변경 유형 | Breaking? | 버전 정책 |
| --- | --- | --- |
| 응답 필드 추가 | 아니오 | 마이너 버전 |
| 요청 필드 추가 (선택적) | 아니오 | 마이너 버전 |
| 응답 필드 삭제 | 예 | 메이저 버전 |
| 응답 필드 타입 변경 | 예 | 메이저 버전 |
| 요청 필드 필수 추가 | 예 | 메이저 버전 |
| HTTP 메서드 변경 | 예 | 메이저 버전 |
| 상태 코드 변경 | 예 | 메이저 버전 |
| URL 경로 변경 | 예 | 메이저 버전 |
| 에러 응답 형식 변경 | 예 | 메이저 버전 |

### 1.3 버전 관리 흐름

```mermaid
flowchart TD
    Change[변경 계획] --> B{Breaking Change?}
    B -- No --> Minor[마이너 버전 업\n응답 필드 추가 등\n기존 클라이언트 영향 없음]
    B -- Yes --> C[메이저 버전 업]
    C --> D[신버전 /api/v2/ 엔드포인트 추가]
    D --> E[구버전 /api/v1/ 유지 (최소 3개월)]
    E --> F[구버전 Deprecation 공지]
    F --> G[구버전 제거]
```

### 1.4 Deprecation 절차

1. 응답 헤더에 `Deprecation` 및 `Sunset` 헤더 추가
2. 3개월 이상 유지 후 제거
3. 클라이언트 마이그레이션 가이드 제공

```
Deprecation: true
Sunset: 2026-09-11
Link: <https://docs.example.com/api/migration-v1-v2>; rel="deprecation"
```

---

## 2. 계약 테스트

### 2.1 원칙

API 계약 테스트는 **실제 HTTP 요청/응답 형식을 검증**한다. 스키마 일치, 필수 필드 존재, 상태 코드 정확성을 확인한다.

테스트 프레임워크: **Vitest**

### 2.2 계약 테스트 구조

```typescript
// packages/api/src/__tests__/contract/jobs.contract.test.ts

import { describe, it, expect } from 'vitest';
import { buildApp } from '../../app';

describe('POST /api/jobs — contract', () => {
  it('업로드 성공 시 201과 jobId 반환', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      payload: { /* 테스트 파일 */ },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    // 필수 필드 존재 확인
    expect(body).toHaveProperty('jobId');
    expect(body).toHaveProperty('status');
    expect(typeof body.jobId).toBe('string');
  });

  it('파일 크기 초과 시 413 반환', async () => {
    // ...
    expect(response.statusCode).toBe(413);
  });
});
```

### 2.3 계약 테스트 커버리지 기준

| 엔드포인트 | 성공 케이스 | 오류 케이스 |
| --- | --- | --- |
| `POST /api/jobs` | 201 + jobId 필드 | 413 (크기 초과), 400 (포맷 오류) |
| `GET /api/jobs/:id` | 200 + Job 스키마 | 404 (없는 jobId) |
| `GET /api/jobs/:id/download` | 200 + PDF 바이너리 | 404, 425 (미완료) |
| `GET /api/stats` | 200 + stats 스키마 | — |
| `GET /health` | 200 + `{"status":"ok"}` | — |
| `POST /auth/signin` | 200 + 세션 | 401, 429 |

### 2.4 CI 통합

```yaml
# .github/workflows/ci.yml (예시)
- name: Run contract tests
  run: npm run test:contract
  # vitest --project=api --reporter=verbose src/__tests__/contract
```

---

## 3. 공용 타입 관리

### 3.1 단일 진실 소스

`packages/shared/src/schema.ts`가 **모든 공용 타입의 단일 진실 소스(Single Source of Truth)**다.

```
packages/
  shared/
    src/
      schema.ts    ← 공용 타입 정의
      index.ts     ← 재export
  api/
    src/           ← schema.ts import해서 사용
  web/
    src/           ← schema.ts import해서 사용
```

### 3.2 타입 정의 원칙

1. API 요청/응답 타입은 반드시 `packages/shared/src/schema.ts`에 정의
2. API 서버와 웹 클라이언트가 동일 타입 공유
3. 타입 변경은 두 패키지를 동시에 업데이트
4. 런타임 검증: Zod 스키마로 요청 파싱 (타입과 Zod 스키마 동기화)

### 3.3 주요 공용 타입

```typescript
// packages/shared/src/schema.ts (구조 예시)

export interface Job {
  id: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  originalName: string;
  engine?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateJobResponse {
  jobId: string;
  status: Job['status'];
}

export interface StatsResponse {
  total: number;
  success: number;
  failed: number;
  running: number;
}

export interface QualityReport {
  version: 1;
  verdict: 'pass' | 'warn' | 'fail';
  pageCountMatch: boolean;
  pageCountOriginal?: number;
  pageCountConverted?: number;
  warnings: string[];
  engine: string;
}
```

---

## 4. QualityReport 스키마 버전 관리

### 4.1 현재 버전: v1

```typescript
interface QualityReport {
  version: 1;                            // 고정값. 스키마 버전 식별자
  verdict: 'pass' | 'warn' | 'fail';    // 최종 판정
  pageCountMatch: boolean;               // 원본 대비 페이지 수 일치 여부
  pageCountOriginal?: number;            // 원본 페이지 수 (측정 가능 시)
  pageCountConverted?: number;           // 변환 결과 페이지 수
  warnings: string[];                    // 경고 메시지 목록
  engine: string;                        // 사용된 엔진 (rhwp/sidecar/gotenberg/builtin)
}
```

### 4.2 버전 진화 정책

| 변경 | 버전 처리 |
| --- | --- |
| 새 필드 추가 (선택적) | `version: 1` 유지, 하위 호환 |
| 새 verdict 값 추가 | `version: 2`로 업 |
| 기존 필드 삭제 | `version: 2`로 업 |
| 필드 타입 변경 | `version: 2`로 업 |

```mermaid
flowchart LR
    v1["version: 1\n(현재)"] --> |Breaking Change| v2["version: 2\n(신규 필드/타입 변경)"]
    v1 --> |필드 추가 (선택적)| v1again["version: 1\n(하위 호환 확장)"]
```

### 4.3 버전별 소비자 처리

```typescript
// 소비자(web/api)에서 버전 분기 처리 예시
function parseQualityReport(raw: unknown): QualityReport {
  const report = raw as { version: number };
  
  if (report.version === 1) {
    return QualityReportV1Schema.parse(raw);
  }
  
  // 미래 버전 대비
  throw new Error(`Unsupported QualityReport version: ${report.version}`);
}
```

---

## 5. 하위 호환성 규칙

### 5.1 응답 필드 규칙

| 규칙 | 상세 |
| --- | --- |
| **추가 허용** | 기존 응답에 새 필드 추가 가능. 클라이언트는 알 수 없는 필드를 무시해야 함 |
| **삭제 금지** | 기존 필드를 삭제하려면 메이저 버전 업 필수 |
| **타입 변경 금지** | `string → number` 등 타입 변경은 메이저 버전 업 필수 |
| **nullable 허용** | 기존 필드를 `T` → `T | null`로 변경은 허용 (확장) |
| **optional 허용** | 기존 필수 필드를 선택적으로 변경은 허용 (확장) |

### 5.2 요청 처리 규칙

| 규칙 | 상세 |
| --- | --- |
| **알 수 없는 필드 무시** | 요청에 정의되지 않은 필드가 있어도 오류 없이 무시 |
| **선택적 필드 기본값** | 선택적 필드 미전송 시 서버가 기본값 처리 |
| **필수 필드 추가 금지** | 기존 클라이언트가 보내지 않는 필드를 필수로 추가하면 Breaking Change |

### 5.3 에러 응답 형식

에러 응답 형식은 변경 시 메이저 버전 업이 필요하다.

```typescript
// 표준 에러 응답 형식 (v1)
interface ErrorResponse {
  error: string;       // 에러 코드 또는 메시지
  message?: string;    // 사람이 읽을 수 있는 설명 (선택적)
  retryAfter?: number; // 429 응답 시 재시도 대기 초
}
```

### 5.4 호환성 체크리스트 (PR 리뷰 시)

- [ ] 기존 응답 필드가 삭제되었는가?
- [ ] 기존 필드의 타입이 변경되었는가?
- [ ] 기존 선택적 필드가 필수로 변경되었는가?
- [ ] URL 경로나 HTTP 메서드가 변경되었는가?
- [ ] 에러 상태 코드가 변경되었는가?
- [ ] QualityReport의 `version` 필드 업데이트가 필요한가?

위 항목 중 하나라도 Yes이면 메이저 버전 업 절차를 따른다.

---

## 변경 이력

| 버전 | 날짜 | 변경 내용 | 작성자 |
| --- | --- | --- | --- |
| v1.0 | 2026-06-11 | 초기 작성 | 개발팀 |
