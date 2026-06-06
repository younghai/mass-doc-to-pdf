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

## 빠른 설치 및 실행

새로 clone한 환경에서 가장 빠르게 전체 서비스를 띄우는 방법입니다. Docker가 실행 중이어야 합니다.

```bash
git clone https://github.com/younghai/mass-doc-to-pdf.git
cd mass-doc-to-pdf
cp .env.example .env
```

`.env`에서 `AUTH_SECRET`을 채웁니다.

```bash
openssl rand -base64 32
```

그 다음 전체 스택을 실행합니다.

```bash
docker-compose up -d --build
```

실행 후 확인:

```bash
curl http://localhost:8010/health
open http://localhost:8081
```

기본값은 `DEV_AUTH=1`이라 Google OAuth 없이 로컬 운영자 계정으로 바로 서비스 UI를 확인할 수 있습니다.
메뉴에서 `문서 업로드`, `폴더 일괄 변환`, `작업 큐`를 사용할 수 있습니다.

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
AUTH_SECRET=$(openssl rand -base64 32) DEV_AUTH=1 pnpm dev
# 프론트엔드 (별도 터미널) — /api 는 localhost:8000 으로 프록시
cd apps/web && pnpm dev   # http://localhost:5173
```

Gotenberg/MinIO/HWP 사이드카는 docker-compose로 띄우거나 개별 실행하세요.
`DEV_AUTH=1`은 운영 흐름 검증용 로컬 세션을 자동으로 사용합니다. 실제 Google OAuth를 쓰려면
`DEV_AUTH=0 GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...`로 실행하고 Google 리디렉션 URI
`http://localhost:5173/api/auth/callback/google`를 등록하세요.

## Docker로 전체 실행

```bash
cp .env.example .env        # AUTH_SECRET 채우기, 기본 DEV_AUTH=1
docker-compose up -d --build
# web  → http://localhost:8081
# api  → http://localhost:8010/health
```

Docker 기본값은 `DEV_AUTH=1`입니다. 실제 Google OAuth를 쓰려면 `.env`에서 `DEV_AUTH=0`으로 바꾸고
Docker 환경의 Google 리디렉션 URI `http://localhost:8081/api/auth/callback/google`를 등록하세요.

## GitHub 배포

GitHub Actions로 GHCR 이미지를 게시하고 Docker 서버에 SSH 배포할 수 있도록 `.github/`,
`docker-compose.prod.yml`, `.env.production.example`이 준비되어 있습니다.

배포 흐름:

1. GitHub에 repository 생성 후 이 프로젝트를 push합니다.
2. GitHub Actions의 `Publish Images to GHCR` 워크플로로 이미지를 게시합니다.
3. 서버 배포용 GitHub Secrets를 등록합니다.
4. `Deploy over SSH` 워크플로를 실행합니다.

```bash
cp .env.production.example .env.production
# 운영 비밀값을 채운 뒤, 같은 내용을 GitHub Secrets의 PRODUCTION_ENV에 등록
```

필수 Secrets:

| Secret | 설명 |
|--------|------|
| `DEPLOY_HOST` | Docker 서버 IP 또는 도메인 |
| `DEPLOY_USER` | Docker 실행 권한이 있는 SSH 사용자 |
| `DEPLOY_SSH_KEY` | 배포용 private SSH key |
| `DEPLOY_PATH` | 서버 배포 경로 예: `/opt/mass-doc-to-pdf` |
| `PRODUCTION_ENV` | `.env.production` 전체 내용 |

자세한 절차와 필요한 GitHub Secrets는 [`.github/DEPLOYMENT.md`](.github/DEPLOYMENT.md)를 확인하세요.

## Docker 없이 단독 서버 운영

Docker를 쓰지 않는 서버에는 [`standalone/`](standalone/) 폴더를 사용합니다. 이 경로는 MinIO/Gotenberg 없이
로컬 파일 저장소와 LibreOffice/H2Orestart sidecar만으로 서비스를 실행하도록 구성되어 있습니다.

```bash
# 선택: 서버로 복사할 독립 배포 폴더/tarball 생성
standalone/scripts/package.sh

cd /opt/mass-doc-to-pdf
sudo standalone/scripts/install-ubuntu.sh
cp standalone/env.example .env.standalone
standalone/scripts/build.sh
standalone/scripts/init-db.sh
sudo standalone/scripts/install-systemd.sh
standalone/scripts/smoke-test.sh
```

단독 운영 기본값:

- API: `127.0.0.1:18010`
- 변환 sidecar: `127.0.0.1:18080`
- Web/Nginx: `80`
- 데이터: `./data/app.db`, `./data/objects`

## API 계약

| 메서드 · 경로 | 설명 |
|---------------|------|
| `POST /api/convert` | 멀티파트 `file` 업로드 → 작업 등록 → `running` 잡 DTO 반환(202) |
| `GET /api/jobs[?status=pending\|running\|success\|failed]` | 내 변환 내역(최신순, 상태 필터) |
| `GET /api/jobs/:id` | 잡 상세 DTO |
| `GET /api/jobs/:id/download` | 결과 PDF (성공 시) · 409(미변환) |
| `GET /api/stats` | `{ total, success, failed, running, pending, successRate }` |
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
docker-compose up -d --build
cd e2e && pnpm install --ignore-workspace
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
- **프리사인드 직접 업로드**, 재시도 워커, 레이트 리밋, 관측성(메트릭/트레이싱), Postgres 이관.
