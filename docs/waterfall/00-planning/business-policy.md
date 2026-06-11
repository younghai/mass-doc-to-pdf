# 비즈니스 정책서 (Business Policy Document)

> Mass Doc to PDF (mass-doc-to-pdf)의 파일 처리, 보안, 데이터, 운영, 품질 정책을 정의한다.

| 항목 | 내용 |
| --- | --- |
| **프로젝트명** | Mass Doc to PDF (mass-doc-to-pdf) |
| **문서 버전** | v1.0 |
| **작성일** | 2026-06-11 |
| **최종 수정일** | 2026-06-11 |
| **작성자** | 개발팀 |
| **문서 상태** | 작성 중 |

---

## 1. 비즈니스 규칙

### 1.1 파일 업로드 제한

| 규칙 | 값 | 설명 |
| --- | --- | --- |
| 최대 파일 크기 | 20MB | 단건 업로드 및 배치 파일 각각 적용 |
| 지원 포맷 (HWP) | `.hwp`, `.hwpx` | HWP 엔진 체인으로 처리 |
| 지원 포맷 (Office) | `.doc`, `.docx`, `.ppt`, `.pptx`, `.xls`, `.xlsx` | Office 엔진 체인으로 처리 |
| 20MB 초과 시 | 413 응답 | 업로드 즉시 거부 |
| 지원 외 포맷 | 400 응답 | MIME 타입 + 확장자 이중 검증 |

### 1.2 작업 한도

| 규칙 | 값 | 설명 |
| --- | --- | --- |
| 사용자당 활성 작업 한도 | 50개 | status가 pending/queued/running인 작업 합산 |
| 한도 초과 시 | 429 응답 | 신규 작업 생성 거부 |
| 재시도 최대 횟수 | 3회 | attempts 컬럼 기준, 초과 시 failed 확정 |

### 1.3 작업 데이터 보존

| 데이터 유형 | 보존 기간 | 삭제 방법 |
| --- | --- | --- |
| ConversionJob 레코드 | 무기한 (사용자 삭제 시 cascade) | DELETE + MinIO 객체 삭제 |
| sourceKey (원본 파일) | 작업 존속 기간 동안 | DELETE /api/jobs/:id 호출 시 MinIO에서 삭제 |
| outputKey (PDF 출력) | 작업 존속 기간 동안 | DELETE /api/jobs/:id 호출 시 MinIO에서 삭제 |
| 품질 리포트 | ConversionJob과 동일 | ConversionJob 삭제 시 cascade |
| 사용자 계정 삭제 | 즉시 cascade | User → ConversionJob → MinIO 파일 순 삭제 |

---

## 2. 보안 정책

### 2.1 인증

| 계층 | 메커니즘 | 설명 |
| --- | --- | --- |
| 사용자 인증 | Auth.js v5 (Google OAuth) | 세션 기반, Secure + HttpOnly 쿠키 |
| 개발 모드 | DEV_AUTH=1 | 로컬 개발 전용, 프로덕션 사용 절대 금지 |
| 미인증 요청 | 401 응답 | 모든 API 엔드포인트에 인증 필수 |

### 2.2 속도 제한 (Rate Limiting)

| 대상 | 한도 | 윈도우 |
| --- | --- | --- |
| 전체 API | 300 요청/분 | 1분 슬라이딩 윈도우 |
| 인증 엔드포인트 | 60 요청/분 | 1분 슬라이딩 윈도우 |
| 한도 초과 시 | 429 응답 + Retry-After 헤더 | - |

### 2.3 CSRF 방어

| 항목 | 정책 |
| --- | --- |
| Origin 검증 | 모든 state-mutating 요청에 Origin 헤더 검증 |
| 허용 Origin | `WEB_ORIGIN` 환경변수에 명시된 URL만 허용 |
| 불일치 시 | 403 응답 |

### 2.4 기타 보안

| 항목 | 정책 |
| --- | --- |
| 쿠키 속성 | `Secure=true`, `HttpOnly=true`, `SameSite=Lax` |
| trustProxy | Fastify `trustProxy=true` (리버스 프록시 뒤 실제 IP 추출) |
| HTTPS | 프로덕션 환경에서 반드시 TLS 종단 (로드밸런서 또는 nginx) |
| 파일 검증 | MIME 타입 + 확장자 이중 검증으로 확장자 위장 방지 |
| zip-bomb 방어 | 압축 해제 크기 상한 설정 (20MB 적용) |

### 2.5 보안 체크리스트

- [ ] `AUTH_SECRET` 프로덕션에서 강력한 랜덤 값으로 설정 필수
- [ ] `DEV_AUTH=1` 프로덕션 환경에서 미설정 확인
- [ ] `WEB_ORIGIN` 운영 URL로 설정 (예: `https://pdf.example.com`)
- [ ] `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` 기본값 변경
- [ ] SQLite 파일에 대한 파일시스템 접근 권한 제한
- [ ] TLS 인증서 설치 및 HTTPS 강제 리다이렉트 설정

---

## 3. 데이터 정책

### 3.1 데이터 분류

| 등급 | 정의 | 예시 | 저장 위치 |
| --- | --- | --- | --- |
| Confidential | 업로드된 원본 문서 | HWP, DOCX, XLSX 원본 파일 | MinIO (sourceKey) |
| Internal | 변환 결과 및 품질 데이터 | PDF 출력, 품질 리포트 | MinIO (outputKey), SQLite |
| Operational | 운영 메타데이터 | 작업 상태, 변환 시간, 엔진 정보 | SQLite (ConversionJob) |
| Transient | 임시 변환 작업 파일 | 변환 중 임시 파일 | 컨테이너 로컬 tmpfs |

### 3.2 데이터 흐름

```
사용자 → [파일 업로드] → MinIO (sourceKey)
                      → SQLite (ConversionJob: pending)
worker  → [변환 실행] → MinIO (outputKey: PDF)
                      → SQLite (ConversionJob: success + qualityReport)
사용자 → [삭제 요청] → MinIO 원본 + PDF 삭제
                      → SQLite ConversionJob 삭제
```

---

## 4. 운영 정책

### 4.1 필수 환경변수

| 환경변수 | 필수 여부 | 설명 |
| --- | --- | --- |
| `AUTH_SECRET` | 필수 | Auth.js 세션 서명 키. 미설정 시 서버 시작 거부 |
| `WEB_ORIGIN` | 필수 (프로덕션) | CSRF Origin 검증 허용 URL |
| `DATABASE_URL` | 필수 | SQLite 파일 경로 |
| `MINIO_ENDPOINT` | 필수 | MinIO 서버 주소 |
| `GOOGLE_CLIENT_ID` | OAuth 사용 시 필수 | Google OAuth 클라이언트 ID |
| `GOOGLE_CLIENT_SECRET` | OAuth 사용 시 필수 | Google OAuth 클라이언트 Secret |
| `DEV_AUTH` | 개발 전용 | `1`로 설정 시 인증 우회 (프로덕션 사용 금지) |
| `USE_QUEUE` | 선택 | `1`로 설정 시 DB-backed 큐 모드 활성화 |

### 4.2 운영 금지 사항

| 항목 | 이유 |
| --- | --- |
| `DEV_AUTH=1` 프로덕션 사용 | 인증 우회로 모든 API 무방비 노출 |
| `AUTH_SECRET` 미설정 | 세션 위조 가능 |
| `WEB_ORIGIN` 미설정 또는 와일드카드(`*`) | CSRF 방어 무력화 |
| SQLite 파일을 공유 볼륨에 여러 프로세스가 쓰기 접근 | WAL 모드에서도 동시 다중 writer는 corruption 위험 |
| worker 미실행 상태에서 `USE_QUEUE=1` 운영 | 작업이 queued 상태에 무기한 정체 |

---

## 5. 품질 정책

### 5.1 변환 모드

| 모드 | 엔진 체인 (순서) | 적합 상황 |
| --- | --- | --- |
| `precise` (HWP) | Hancom SDK → rhwp-cli → rhwp(Python) → H2Orestart/LibreOffice → builtin | 정확한 렌더링이 필요한 공문서·계약서 |
| `quick` (HWP) | builtin → H2Orestart → rhwp(Python) | 빠른 처리가 필요한 대량 변환 |
| Office (기본) | Gotenberg → hwp-sidecar → builtin → Aspose | DOC/PPT/XLS 계열 |

### 5.2 품질 등급 기준

| 품질 등급 (QualityGrade) | 설명 | 조치 |
| --- | --- | --- |
| `good` | 원본 대비 렌더링 충실도 높음 | 즉시 사용 가능 |
| `acceptable` | 일부 레이아웃 차이 있으나 내용 판독 가능 | 검토 후 사용 |
| `fallback` | fallback 엔진으로 변환 완료, 품질 저하 가능 | 수동 검토 권장 |
| `failed` | 변환 결과물이 유효한 PDF가 아님 | 재시도 또는 원본 확인 |

### 5.3 품질 상태 처리 지침

| 품질 상태 (QualityStatus) | 처리 지침 |
| --- | --- |
| `passed` | 자동 승인, 사용자에게 즉시 다운로드 제공 |
| `review` | UI에서 주의 배지 표시, 사용자가 직접 PDF 미리보기 확인 후 사용 판단 |
| `failed` | 자동 재시도 트리거, 재시도 후에도 failed 시 사용자에게 실패 알림 |

### 5.4 비활성 엔진 처리

- 설치되지 않은 엔진(Hancom SDK, Aspose 등)은 자동으로 체인에서 제외
- `ENGINE_CHAIN` 환경변수로 활성 엔진 명시적 지정 가능
- 체인 내 모든 엔진 실패 시 ConversionJob을 `failed`로 확정하고 error 필드에 각 엔진별 실패 원인 기록

---

## 6. 변경 이력

| 버전 | 날짜 | 작성자 | 변경 내용 |
| --- | --- | --- | --- |
| v1.0 | 2026-06-11 | 개발팀 | 초안 작성 |
