# API 설계서 (API Design)

> Mass Doc to PDF (mass-doc-to-pdf)의 REST API 설계서. 엔드포인트 전체 목록, 요청/응답 스펙, 에러 형식, Rate Limiting, CSRF 정책, 파일 업로드 제약을 정의한다.

| 항목 | 내용 |
| --- | --- |
| **프로젝트명** | Mass Doc to PDF (mass-doc-to-pdf) |
| **문서 버전** | v1.0 |
| **작성일** | 2026-06-11 |
| **최종 수정일** | 2026-06-11 |
| **작성자** | 개발팀 |
| **문서 상태** | 작성 완료 |

---

## 1. API 개요

| 항목 | 내용 |
| --- | --- |
| 프레임워크 | Fastify 5 |
| 프로토콜 | REST over HTTPS |
| 기본 Content-Type | `application/json` |
| 파일 업로드 | `multipart/form-data` |
| 기본 URL | `/api` |
| 인증 방식 | Auth.js v5 세션 쿠키 (HttpOnly, Secure, SameSite=Lax) |
| API 버전 관리 | 현재 미버전 (`/api/`). 하위 호환 변경 시 마이너 업데이트, 파괴적 변경 시 `/api/v2/` 도입. |

---

## 2. 인증 방식

모든 `/api/` 엔드포인트(`/health`, `/api/auth/*` 제외)는 유효한 Auth.js 세션 쿠키를 요구한다.

| 항목 | 내용 |
| --- | --- |
| 쿠키명 | `authjs.session-token` (프로덕션) / `__Secure-authjs.session-token` (HTTPS) |
| 속성 | `HttpOnly; Secure; SameSite=Lax` |
| 미인증 응답 | `401 Unauthorized` `{ "error": "Unauthorized" }` |
| DEV_AUTH 모드 | `DEV_AUTH=1` 설정 시 `POST /api/auth/dev-login`으로 고정 개발 사용자 세션 생성 가능 |

---

## 3. 엔드포인트 전체 목록

| 메서드 | 경로 | 설명 | 인증 | Rate Limit |
| --- | --- | --- | --- | --- |
| `POST` | `/api/convert` | 파일 업로드 → 변환 작업 생성 | Y | 300/min |
| `POST` | `/api/jobs/:id/retry` | 실패 작업 수동 재시도 | Y | 300/min |
| `GET` | `/api/jobs` | 작업 목록 조회 (`?status=` 필터) | Y | 300/min |
| `GET` | `/api/jobs/:id` | 작업 상세 조회 | Y | 300/min |
| `GET` | `/api/jobs/:id/download` | PDF 파일 첨부 다운로드 | Y | 300/min |
| `GET` | `/api/jobs/:id/preview` | PDF 인라인 미리보기 | Y | 300/min |
| `GET` | `/api/jobs/:id/preview.png` | PNG 미리보기 (LibreOffice 렌더) | Y | 300/min |
| `DELETE` | `/api/jobs/:id` | 작업 및 파일 삭제 | Y | 300/min |
| `GET` | `/api/jobs/:id/quality` | 품질 리포트 JSON 조회 | Y | 300/min |
| `GET` | `/api/stats` | 통계 조회 | Y | 300/min |
| `GET` | `/health` | 헬스체크 | N | 제외 |
| `*` | `/api/auth/*` | Auth.js 인증 핸들러 | N | 60/min |

---

## 4. 엔드포인트 상세

### 4.1 POST /api/convert

파일을 업로드하고 변환 작업을 생성한다.

**요청**

```
Content-Type: multipart/form-data

Field: file        — 변환할 파일 (필수)
Query: qualityMode — "precise" | "quick" (선택, 기본 "precise", HWP 전용)
```

**요청 예시**

```bash
curl -X POST https://example.com/api/convert \
  -H "Cookie: authjs.session-token=..." \
  -F "file=@document.hwp" \
  "?qualityMode=precise"
```

**응답 (200 OK — USE_QUEUE=0, 변환 완료)**

```json
{
  "id": "clxyz123",
  "filename": "document.hwp",
  "format": "hwp",
  "extension": "hwp",
  "mimeType": "application/x-hwp",
  "sizeBytes": 204800,
  "status": "success",
  "engine": "h2orestart",
  "durationMs": 3420,
  "error": null,
  "createdAt": "2026-06-11T09:00:00.000Z"
}
```

**응답 (202 Accepted — USE_QUEUE=1, 큐에 등록)**

```json
{
  "id": "clxyz123",
  "filename": "document.hwp",
  "format": "hwp",
  "extension": "hwp",
  "mimeType": "application/x-hwp",
  "sizeBytes": 204800,
  "status": "queued",
  "engine": null,
  "durationMs": null,
  "error": null,
  "createdAt": "2026-06-11T09:00:00.000Z"
}
```

**에러 응답**

| 상태 코드 | 조건 | 응답 |
| --- | --- | --- |
| `400` | 파일 없음 / 지원하지 않는 확장자 | `{ "error": "Unsupported file type" }` |
| `413` | 파일 크기 초과 (> 20MB) | `{ "error": "File too large" }` |
| `401` | 미인증 | `{ "error": "Unauthorized" }` |
| `429` | Rate limit 초과 | `{ "error": "Too Many Requests" }` |

---

### 4.2 POST /api/jobs/:id/retry

`failed` 상태의 작업을 `queued` 상태로 복귀시켜 재시도한다.

**요청**

```
Content-Type: application/json (본문 없음)
```

**응답 (200 OK)**

```json
{
  "id": "clxyz123",
  "filename": "document.hwp",
  "format": "hwp",
  "extension": "hwp",
  "mimeType": "application/x-hwp",
  "sizeBytes": 204800,
  "status": "queued",
  "engine": null,
  "durationMs": null,
  "error": null,
  "createdAt": "2026-06-11T09:00:00.000Z"
}
```

**에러 응답**

| 상태 코드 | 조건 | 응답 |
| --- | --- | --- |
| `400` | 상태가 `failed`가 아닌 경우 | `{ "error": "Job is not in failed state" }` |
| `404` | 작업 미존재 또는 타 사용자 소유 | `{ "error": "Not found" }` |

---

### 4.3 GET /api/jobs

현재 사용자의 변환 작업 목록을 반환한다.

**쿼리 파라미터**

| 파라미터 | 타입 | 설명 |
| --- | --- | --- |
| `status` | String (선택) | 상태 필터: `pending`, `queued`, `running`, `success`, `failed`, `review` |

**응답 (200 OK)**

```json
[
  {
    "id": "clxyz123",
    "filename": "document.hwp",
    "format": "hwp",
    "extension": "hwp",
    "mimeType": "application/x-hwp",
    "sizeBytes": 204800,
    "status": "success",
    "engine": "h2orestart",
    "durationMs": 3420,
    "error": null,
    "createdAt": "2026-06-11T09:00:00.000Z"
  }
]
```

---

### 4.4 GET /api/jobs/:id

작업 단건 상세 조회.

**응답 (200 OK)** — `JobDTO` 형식 (4.3과 동일 단건)

**에러 응답**

| 상태 코드 | 조건 |
| --- | --- |
| `404` | 작업 미존재 또는 타 사용자 소유 |

---

### 4.5 GET /api/jobs/:id/download

변환 결과 PDF를 첨부 파일로 다운로드한다.

**응답 헤더**

```
Content-Type: application/pdf
Content-Disposition: attachment; filename="document.pdf"
```

**에러 응답**

| 상태 코드 | 조건 |
| --- | --- |
| `404` | 작업 미존재, 타 사용자 소유, 또는 아직 변환 미완료 (`outputKey` 없음) |

---

### 4.6 GET /api/jobs/:id/preview

변환 결과 PDF를 브라우저 인라인으로 표시한다.

**응답 헤더**

```
Content-Type: application/pdf
Content-Disposition: inline; filename="document.pdf"
```

---

### 4.7 GET /api/jobs/:id/preview.png

변환 결과 PDF의 첫 페이지를 PNG 이미지로 반환한다. LibreOffice로 렌더링하며 응답을 600초 캐시한다.

**응답 헤더**

```
Content-Type: image/png
Cache-Control: public, max-age=600
```

**에러 응답**

| 상태 코드 | 조건 |
| --- | --- |
| `404` | outputKey 없음 (변환 미완료) |
| `502` | hwp-sidecar 렌더링 실패 |

---

### 4.8 DELETE /api/jobs/:id

작업 레코드와 MinIO 저장 파일(원본 + PDF)을 모두 삭제한다.

**응답 (204 No Content)** — 본문 없음

**에러 응답**

| 상태 코드 | 조건 |
| --- | --- |
| `404` | 작업 미존재 또는 타 사용자 소유 |

---

### 4.9 GET /api/jobs/:id/quality

변환 작업의 품질 리포트 JSON을 반환한다.

**응답 (200 OK)**

```json
{
  "version": 1,
  "jobId": "clxyz123",
  "filename": "document.hwp",
  "format": "hwp",
  "mode": "precise",
  "selectedEngine": "h2orestart",
  "grade": "good",
  "status": "passed",
  "recommendedAction": null,
  "checks": {
    "pdfBytes": 512000,
    "pageCount": 10,
    "sourceBytes": 204800,
    "textChars": 4200
  },
  "attempts": [
    { "engine": "hancom", "status": "failed", "durationMs": 1200, "error": "timeout" },
    { "engine": "h2orestart", "status": "success", "durationMs": 3420 }
  ],
  "warnings": [],
  "createdAt": "2026-06-11T09:00:05.000Z"
}
```

**에러 응답**

| 상태 코드 | 조건 |
| --- | --- |
| `404` | 작업 미존재, 타 사용자 소유, 또는 품질 리포트 미생성 |

---

### 4.10 GET /api/stats

현재 사용자의 전체 변환 통계를 반환한다.

**응답 (200 OK)**

```json
{
  "total": 150,
  "success": 142,
  "failed": 5,
  "running": 1,
  "queued": 2,
  "pending": 0,
  "successRate": 94.67
}
```

---

### 4.11 GET /health

서비스 헬스체크. 인증 불필요, Rate Limit 제외.

**응답 (200 OK)**

```json
{ "status": "ok" }
```

---

### 4.12 /api/auth/*

Auth.js v5가 관리하는 인증 핸들러. 직접 구현 없음.

| 경로 | 설명 |
| --- | --- |
| `GET /api/auth/signin` | 로그인 페이지 (또는 JSON) |
| `GET /api/auth/signin/google` | Google OAuth 시작 |
| `GET /api/auth/callback/google` | Google OAuth 콜백 |
| `GET /api/auth/signout` | 세션 종료 |
| `GET /api/auth/session` | 현재 세션 정보 JSON |

---

## 5. 에러 응답 형식

모든 에러 응답은 동일한 JSON 구조를 사용한다.

```json
{ "error": "에러 메시지 문자열" }
```

| HTTP 상태 | 의미 |
| --- | --- |
| `400` | 잘못된 요청 (파일 누락, 지원 불가 형식 등) |
| `401` | 미인증 (세션 없음 또는 만료) |
| `403` | 권한 없음 (타 사용자 리소스 접근) |
| `404` | 리소스 미존재 |
| `413` | 요청 본문 크기 초과 (파일 > 20MB) |
| `429` | Rate limit 초과 |
| `500` | 서버 내부 오류 |
| `502` | 외부 서비스 오류 (Gotenberg, hwp-sidecar) |

---

## 6. Rate Limiting 정책

@fastify/rate-limit 플러그인으로 구현.

| 대상 | 제한 | 단위 | 환경 변수 |
| --- | --- | --- | --- |
| 전체 `/api/*` | 300 req | 1분 | `RATE_LIMIT_MAX` |
| `/api/auth/*` | 60 req | 1분 | `AUTH_RATE_LIMIT_MAX` |
| `/health` | 제외 | - | - |

**Rate limit 초과 응답 (429 Too Many Requests):**

```json
{ "error": "Too Many Requests" }
```

응답 헤더:
```
X-RateLimit-Limit: 300
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1718096460
Retry-After: 45
```

**trustProxy:** Nginx TLS termination 환경에서 클라이언트 실제 IP를 올바르게 식별하기 위해 `trustProxy: true` 설정.

---

## 7. CSRF 정책

State-changing 요청(`POST`, `PUT`, `PATCH`, `DELETE`)에 대해 Origin 헤더 검증으로 CSRF를 방어한다.

| 항목 | 내용 |
| --- | --- |
| 검증 방식 | `Origin` 헤더 값이 `WEB_ORIGIN` 환경 변수와 일치하는지 확인 |
| 적용 메서드 | `POST`, `PUT`, `PATCH`, `DELETE` |
| 예외 | `/api/auth/*` (Auth.js 자체 CSRF 처리), `/health` |
| 실패 응답 | `403 Forbidden` `{ "error": "Forbidden" }` |
| 환경 변수 | `WEB_ORIGIN=https://example.com` |

---

## 8. 파일 업로드 제약

| 항목 | 값 |
| --- | --- |
| 최대 파일 크기 | 20MB (`MAX_UPLOAD_BYTES=20971520`) |
| 요청 Content-Type | `multipart/form-data` |
| 파일 필드명 | `file` |

**지원 확장자 및 MIME 타입:**

| 확장자 | MIME 타입 | 포맷 |
| --- | --- | --- |
| `.hwp` | `application/x-hwp` | hwp |
| `.hwpx` | `application/x-hwpx` | hwp |
| `.doc` | `application/msword` | office |
| `.docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | office |
| `.ppt` | `application/vnd.ms-powerpoint` | office |
| `.pptx` | `application/vnd.openxmlformats-officedocument.presentationml.presentation` | office |
| `.xls` | `application/vnd.ms-excel` | office |
| `.xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | office |

**보안 제약:**
- 파일 확장자 + MIME 타입 이중 검증 (확장자 위조 방어)
- Zip-bomb 방어: 압축 해제 크기 상한 적용
- XXE 방어: XML 파싱 시 외부 엔티티 비활성화

---

## 9. 응답 타입 정의

`packages/shared/src/schema.ts`에 정의된 공유 타입을 API 응답에 사용한다.

| 타입 | 사용 엔드포인트 |
| --- | --- |
| `JobDTO` | `/api/convert`, `/api/jobs`, `/api/jobs/:id`, `/api/jobs/:id/retry` |
| `QualityReport` | `/api/jobs/:id/quality` |
| `StatsDTO` | `/api/stats` |
| `BatchDTO` | (배치 집계 응답) |

---

## 10. 관련 문서

| 문서명 | 위치 |
| --- | --- |
| 서비스 기획서 | `docs/waterfall/00-planning/service-planning.md` |
| 시스템 아키텍처 설계서 | `docs/waterfall/02-system-design/system-architecture-design.md` |
| DB 설계서 | `docs/waterfall/02-system-design/database-design.md` |
| UI 설계서 | `docs/waterfall/02-system-design/ui-design.md` |

---

## 11. 변경 이력

| 버전 | 날짜 | 작성자 | 변경 내용 |
| --- | --- | --- | --- |
| v1.0 | 2026-06-11 | 개발팀 | 초안 작성 |
