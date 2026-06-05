# hwptopdf

문서(**HWP · HWPX · DOCX · XLSX · PPTX** 및 레거시 Office)를 **PDF로 변환**하는 풀스택 웹 서비스.
Google 로그인, 파일 업로드, 성공/실패 케이스 뷰, 변환 성공률 대시보드를 제공합니다.

## 구성

```
apps/web   React + Vite 대시보드 SPA (로그인 · 업로드 · 변환내역 · 상세 · 대시보드)
apps/api   Fastify 백엔드 (인증 · 변환 라우팅 · 영속성 · 저장소 · 통계)
packages/shared   web/api 공용 DTO 타입
hwp-sidecar   LibreOffice + H2Orestart 변환 사이드카 (HWP/HWPX)
e2e        Playwright 게이트 e2e (수동 실행)
```

## 변환 엔진 매트릭스

| 입력 형식 | 1차(상용, 고충실도) | 폴백(무료 OSS) |
|-----------|--------------------|----------------|
| DOCX/XLSX/PPTX/Office | **Aspose** (`ASPOSE_*` 설정 시) | **Gotenberg**(LibreOffice) |
| HWP/HWPX | **Hancom Hwp SDK** (`HANCOM_*` 설정 시) | **LibreOffice + H2Orestart** 사이드카 |

상용 자격증명이 없으면 자동으로 무료 엔진으로 폴백합니다. 포맷은 확장자 + OLE/ZIP 매직바이트로 분류합니다.

## 아키텍처

```
        브라우저
           │
        web (nginx, SPA + /api 프록시)
           │
        api (Fastify)
     ┌─────┼───────────────┬──────────────┐
 Auth.js  변환 레지스트리   Prisma         S3 스토리지
 (Google) ├─ Gotenberg     (SQLite:        (MinIO)
          └─ HWP 사이드카    users/sessions/
                            jobs)
```

- **인증**: `@auth/core` + `@auth/prisma-adapter`(Google OAuth)를 Fastify에 브리지. 세션/유저는 Prisma+SQLite.
- **저장소**: 업로드 원본과 결과 PDF는 S3 호환(MinIO)에 `{userId}/src/…`, `{userId}/out/…` 키로 저장.
- **잡 기록**: 모든 변환은 `ConversionJob`(파일명·형식·크기·상태·엔진·소요시간·오류)으로 기록 → 대시보드 통계.

## 로컬 개발

```bash
pnpm install
# 백엔드 (별도 터미널) — DB 마이그레이션 후 실행
cd apps/api && DATABASE_URL="file:./prisma/dev.db" pnpm prisma migrate deploy
AUTH_SECRET=$(openssl rand -base64 32) GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... pnpm dev
# 프론트엔드 (별도 터미널) — /api 는 localhost:8000 으로 프록시
cd apps/web && pnpm dev   # http://localhost:5173
```

Gotenberg/MinIO/HWP 사이드카는 docker-compose로 띄우거나 개별 실행하세요.
로컬 dev의 Google 리디렉션 URI: `http://localhost:5173/api/auth/callback/google`

## Docker로 전체 실행

```bash
cp .env.example .env        # AUTH_SECRET, GOOGLE_CLIENT_ID/SECRET 채우기
docker compose up -d --build
# web  → http://localhost:8081
# api  → http://localhost:8000/health
```

Docker 환경의 Google 리디렉션 URI: `http://localhost:8081/api/auth/callback/google`

## API 계약

| 메서드 · 경로 | 설명 |
|---------------|------|
| `POST /api/convert` | 멀티파트 `file` 업로드 → 변환 → 잡 DTO 반환(성공/실패 모두 201) |
| `GET /api/jobs[?status=success\|failed]` | 내 변환 내역(최신순, 상태 필터) |
| `GET /api/jobs/:id` | 잡 상세 DTO |
| `GET /api/jobs/:id/download` | 결과 PDF (성공 시) · 409(미변환) |
| `GET /api/stats` | `{ total, success, failed, pending, successRate }` |
| `GET /api/auth/*` | Auth.js (Google 로그인/콜백/세션/로그아웃) |
| `GET /health` | 헬스 체크 |

## 테스트

```bash
pnpm -r test        # 전 패키지 단위/통합 테스트 (네트워크 불필요)
pnpm -r typecheck
pnpm -r build
```

e2e는 게이트 처리되어 기본 실행에서 제외됩니다. 전체 스택을 띄운 뒤:

```bash
docker compose up -d --build
cd e2e && pnpm install && npx playwright install chromium
RUN_E2E=1 pnpm test
```

## 충실도 주의사항

- **HWP/HWPX**: 순수 OSS(LibreOffice + H2Orestart)는 복잡한 정부 양식·병합셀·수식에서 ~10–20% 레이아웃 손실이 발생할 수 있습니다. 충실도가 중요하면 **Hancom Hwp SDK**(`HANCOM_*`)를 설정하세요. **레거시 HWP v3는 H2Orestart 미지원** — HWPX로 정규화를 권장합니다.
- **Office**: LibreOffice 기반 변환은 SmartArt·차트에서 일부 차이가 날 수 있습니다. 계약상 충실도가 필요하면 **Aspose**(`ASPOSE_*`)를 사용하세요.
- CJK 폰트가 컨테이너에 설치되어 있어야 한글이 깨지지 않습니다(사이드카에 나눔/Noto CJK 포함).

## Future Work

- **1,000+ 배치 파이프라인**: 잡 큐, warm 워커 풀, `maxTasksPerProcess` 재활용, 작업 타임아웃, 멱등 재시도, 수평 오토스케일.
- **충실도 벤치마크 하니스**: 실제 문서 코퍼스로 엔진 품질/속도 측정 후 fleet 규모 산정.
- **HWP→HWPX 정규화** 사전 단계(KS X 6101 개방 표준, 한국 정부 2026-10 의무화).
- **프리사인드 직접 업로드**, 레이트 리밋, 관측성(메트릭/트레이싱), Postgres 이관.
