# 소프트웨어 요구사항 명세서 (Software Requirements Specification)

> Mass Doc to PDF (mass-doc-to-pdf)의 기능 요구사항, 비기능 요구사항, 제약 조건, 이해관계자를 정의한다.

| 항목 | 내용 |
| --- | --- |
| **프로젝트명** | Mass Doc to PDF (mass-doc-to-pdf) |
| **문서 버전** | v1.0 |
| **작성일** | 2026-06-11 |
| **최종 수정일** | 2026-06-11 |
| **작성자** | 개발팀 |
| **문서 상태** | 작성 중 |

---

## 1. 목적 및 범위

본 문서는 Mass Doc to PDF 서비스의 전체 요구사항을 정의한다. HWP/HWPX/DOC/DOCX/PPT/PPTX/XLS/XLSX 파일을 PDF로 변환하는 기능, 품질 리포트 생성, durable queue 기반 작업 처리, 사용자 인증, 운영 통계를 포함한다.

---

## 2. 이해관계자

| 역할 | 설명 | 주요 관심사 |
| --- | --- | --- |
| 공공기관 담당자 | HWP 공문서 일괄 PDF 변환 | 변환 성공률, 렌더링 품질 |
| 기업 운영팀 | Office 사무 문서 PDF 표준화 | 처리 속도, 배치 처리 |
| 개발자/운영자 | API 연동, 변환 파이프라인 자동화 | API 안정성, 운영 가시성, 통계 |
| 시스템 관리자 | 인프라 운영, 보안 관리 | 가용성, 보안, 스케일링 |

---

## 3. 기능 요구사항

### 3.1 파일 업로드 및 작업 생성

| REQ-ID | 요구사항 | 우선순위 |
| --- | --- | --- |
| FR-001 | 사용자는 HWP/HWPX/DOC/DOCX/PPT/PPTX/XLS/XLSX 파일을 `POST /api/convert`로 업로드할 수 있다. | 필수 |
| FR-002 | 업로드된 파일의 MIME 타입과 확장자를 이중 검증하여 지원하지 않는 포맷은 400으로 거부한다. | 필수 |
| FR-003 | 파일 크기가 20MB를 초과하면 413으로 거부한다. | 필수 |
| FR-004 | 업로드 성공 시 ConversionJob 레코드를 생성하고(status=pending), 파일을 MinIO에 저장(sourceKey)한 뒤 작업 ID를 반환한다. | 필수 |

### 3.2 큐 처리 및 Worker

| REQ-ID | 요구사항 | 우선순위 |
| --- | --- | --- |
| FR-005 | `USE_QUEUE=0`(기본)이면 업로드 즉시 인라인으로 변환을 실행한다. | 필수 |
| FR-006 | `USE_QUEUE=1`이면 작업을 queued 상태로 DB에 적재하고 별도 worker 프로세스가 poll하여 처리한다. | 필수 |
| FR-007 | worker는 작업을 claim 시 lockedAt·lockedBy를 갱신하고 실패 시 attempts를 증가시킨다. attempts가 3을 초과하면 failed로 확정한다. | 필수 |

### 3.3 변환 엔진 체인

| REQ-ID | 요구사항 | 우선순위 |
| --- | --- | --- |
| FR-008 | HWP/HWPX 포맷은 qualityMode에 따라 다른 엔진 체인을 사용한다. precise 모드: Hancom SDK → rhwp-cli → rhwp(Python) → H2Orestart/LibreOffice → builtin fallback. quick 모드: builtin → H2Orestart → rhwp(Python). | 필수 |
| FR-009 | Office 포맷(DOC/DOCX/PPT/PPTX/XLS/XLSX)은 Gotenberg → hwp-sidecar → builtin → Aspose 순서로 변환을 시도한다. | 필수 |
| FR-010 | 설치되지 않은 엔진은 체인에서 자동 제외하고 다음 엔진으로 폴백한다. 체인 내 모든 엔진 실패 시 ConversionJob을 failed로 확정하고 각 엔진별 실패 원인을 error 필드에 기록한다. | 필수 |

### 3.4 품질 게이트 및 품질 리포트

| REQ-ID | 요구사항 | 우선순위 |
| --- | --- | --- |
| FR-011 | 변환 완료 후 품질 게이트를 실행하여 QualityStatus(passed/review/failed)와 QualityGrade(good/acceptable/fallback/failed)를 판정한다. | 필수 |
| FR-012 | 품질 리포트는 `GET /api/jobs/:id/quality`로 조회할 수 있으며, 각 엔진의 시도 결과(QualityAttempt)를 포함한다. | 필수 |
| FR-013 | QualityStatus가 failed인 경우 자동 재시도를 트리거한다. | 필수 |

### 3.5 변환 결과 접근

| REQ-ID | 요구사항 | 우선순위 |
| --- | --- | --- |
| FR-014 | 변환된 PDF를 `GET /api/jobs/:id/download`로 다운로드할 수 있다 (Content-Disposition: attachment). | 필수 |
| FR-015 | 변환된 PDF를 `GET /api/jobs/:id/preview`로 인라인 렌더링할 수 있다 (Content-Disposition: inline). | 필수 |
| FR-016 | 변환된 PDF 첫 페이지의 PNG 미리보기를 `GET /api/jobs/:id/preview.png`로 제공한다 (LibreOffice 렌더). | 선택 |

### 3.6 작업 관리

| REQ-ID | 요구사항 | 우선순위 |
| --- | --- | --- |
| FR-017 | 사용자는 `GET /api/jobs`로 자신의 작업 목록을 조회할 수 있으며, `?status=` 쿼리 파라미터로 상태 필터링을 지원한다. | 필수 |
| FR-018 | 사용자는 `DELETE /api/jobs/:id`로 작업을 삭제할 수 있으며, MinIO의 원본 파일과 PDF 출력도 함께 삭제된다. | 필수 |
| FR-019 | 사용자는 `POST /api/jobs/:id/retry`로 failed 상태의 작업을 재시도할 수 있다. | 필수 |

### 3.7 배치 업로드

| REQ-ID | 요구사항 | 우선순위 |
| --- | --- | --- |
| FR-020 | 사용자는 BatchUpload UI를 통해 폴더 또는 다수 파일을 한 번에 선택하여 일괄 변환 요청을 할 수 있다. 각 파일은 독립적인 ConversionJob으로 생성되며 batchId로 묶인다. | 필수 |

### 3.8 통계 및 모니터링

| REQ-ID | 요구사항 | 우선순위 |
| --- | --- | --- |
| FR-021 | `GET /api/stats`는 전체 작업 수, 상태별 집계, 포맷별 집계, 평균 변환 시간, 품질 등급 분포를 반환한다. | 필수 |
| FR-022 | `GET /health`는 API 서버 상태를 반환한다. MinIO 연결과 DB 연결 상태를 포함한다. | 필수 |

### 3.9 인증

| REQ-ID | 요구사항 | 우선순위 |
| --- | --- | --- |
| FR-023 | 모든 API 엔드포인트는 Auth.js v5 세션 인증을 요구한다. 미인증 요청은 401을 반환한다. | 필수 |
| FR-024 | 인증은 Google OAuth를 통해 처리한다. `DEV_AUTH=1` 환경변수 설정 시 개발 모드 인증 우회를 허용한다. | 필수 |

---

## 4. 비기능 요구사항

### 4.1 성능

| REQ-ID | 요구사항 | 목표값 |
| --- | --- | --- |
| NFR-001 | Office 포맷(DOCX/PPTX/XLSX) 변환 P99 응답 시간 | ≤ 30초 |
| NFR-002 | HWP/HWPX precise 모드 변환 P99 응답 시간 | ≤ 60초 |
| NFR-003 | HWP/HWPX quick 모드 변환 P99 응답 시간 | ≤ 20초 |
| NFR-004 | API 응답 시간 (변환 제외, 목록/상세 조회) | ≤ 500ms |

### 4.2 보안

| REQ-ID | 요구사항 |
| --- | --- |
| NFR-005 | 전체 API에 rate limit 적용 (300 req/min), 인증 엔드포인트에 강화 rate limit 적용 (60 req/min) |
| NFR-006 | 모든 state-mutating 요청에 Origin 헤더 검증 (CSRF 방어) |
| NFR-007 | 세션 쿠키에 `Secure=true`, `HttpOnly=true`, `SameSite=Lax` 속성 적용 |
| NFR-008 | trustProxy 설정으로 리버스 프록시 뒤에서 실제 클라이언트 IP 추출 |
| NFR-009 | 파일 업로드 시 MIME 타입 + 확장자 이중 검증, zip-bomb 방어 적용 |

### 4.3 안정성

| REQ-ID | 요구사항 |
| --- | --- |
| NFR-010 | SQLite WAL 모드 운영으로 읽기/쓰기 동시성 확보, busy_timeout=5000ms 설정 |
| NFR-011 | DB-backed durable queue로 서버 재시작 후에도 pending 작업 유실 없이 재개 |
| NFR-012 | stuck-running reaper: lockedAt 기준 일정 시간 초과된 running 작업을 자동 복구 |

### 4.4 가용성

| REQ-ID | 요구사항 | 목표값 |
| --- | --- | --- |
| NFR-013 | 시스템 가용성 (`GET /health` 기준) | ≥ 99.5% |

### 4.5 확장성

| REQ-ID | 요구사항 |
| --- | --- |
| NFR-014 | `USE_QUEUE=1` + worker 프로세스 수평 확장으로 변환 처리량 증가 가능 |
| NFR-015 | MinIO S3 호환 스토리지로 파일 저장 규모 독립적 확장 가능 |

---

## 5. 제약 조건

| ID | 제약 조건 |
| --- | --- |
| CON-001 | 데이터베이스는 SQLite 단일 파일로, WAL 모드에서 운영한다. 다중 writer 프로세스 동시 쓰기는 지원하지 않는다. |
| CON-002 | 파일 크기 상한은 20MB로 고정하며, 이를 초과하는 파일은 처리하지 않는다. |
| CON-003 | Hancom SDK, Aspose는 선택적 외부 엔진이며 설치 여부에 따라 체인에서 동적으로 포함/제외된다. |
| CON-004 | `DEV_AUTH=1`은 개발 환경에서만 사용하며 프로덕션 배포 시 반드시 제거해야 한다. |
| CON-005 | PNG 미리보기(`preview.png`)는 LibreOffice가 hwp-sidecar에 설치된 경우에만 제공된다. |
| CON-006 | MinIO는 S3 호환 스토리지를 사용하며 AWS S3로 대체 가능하다. |

---

## 6. 변경 이력

| 버전 | 날짜 | 작성자 | 변경 내용 |
| --- | --- | --- | --- |
| v1.0 | 2026-06-11 | 개발팀 | 초안 작성 |
