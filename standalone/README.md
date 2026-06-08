# Standalone Deployment (No Docker)

이 폴더는 `mass-doc-to-pdf`를 Docker 없이 단일 Linux 서버에서 운영하기 위한 배포 표면입니다.

운영 검증 결과와 전환 조건은 [OPERATIONS-VALIDATION.md](./OPERATIONS-VALIDATION.md)를 먼저 확인합니다.

## 최근 GitHub 업데이트 요약

최근 `main`에 반영된 standalone 관련 변경은 단순 문구 수정이 아니라 운영 검증, HWP 품질 고도화, 미리보기 안정화, 배포 재현성 보강입니다.

| 영역 | 변경/추가 파일 | 운영 영향 |
| --- | --- | --- |
| HWP 정밀 변환 | `standalone/scripts/install-rhwp-cli.sh`, `standalone/env.example` | Rust `rhwp export-pdf` CLI를 설치하고 `RHWP_CLI_*` 환경값으로 Python rhwp보다 앞단에 배치할 수 있습니다. |
| 품질 리포트 | `standalone/scripts/quality-corpus-report.sh`, `standalone/scripts/quality-report-summary.sh`, `standalone/scripts/test-quality-corpus-report.sh` | HWP/HWPX 샘플을 `success`, `review`, `failed`로 집계하고 `jsonl`, `json`, `csv`, `summary.md`를 생성합니다. 샘플 부족분도 `sampleShortfall`로 기록합니다. |
| 서버 리허설 | `standalone/scripts/rehearse-ubuntu.sh`, `standalone/OPERATIONS-VALIDATION.md` | Ubuntu/VM에서 `install-ubuntu -> build -> init-db -> systemd -> smoke-test` 흐름을 한 번에 재현하고 로그를 남깁니다. |
| 서비스 설치/상태 | `standalone/scripts/install-systemd.sh`, `standalone/nginx/mass-doc-to-pdf.conf.in`, `standalone/scripts/status.sh` | API, sidecar, worker, nginx가 env 기반 포트로 설치되고 status 확인 대상에 worker가 포함됩니다. |
| smoke test | `standalone/scripts/smoke-test.sh` | Web/API/sidecar readiness를 기다린 뒤 업로드, 변환, PDF 다운로드, 품질 API까지 확인합니다. |
| 패키징 | `standalone/scripts/package.sh`, `standalone/scripts/build.sh` | GitHub/로컬 개발 메타데이터와 build output을 제외한 source-only 배포본을 생성합니다. |
| PDF 미리보기 | API/Web runtime 코드 | 상세 화면은 브라우저 PDF plugin에 의존하지 않고 `/api/jobs/:id/preview.png` 첫 페이지 PNG를 표시합니다. 원본 PDF는 `/preview` inline 링크로 열립니다. |

구성:

- API: Node.js + Fastify + Prisma SQLite
- Web: 정적 Vite 빌드 결과 + Nginx
- 변환 엔진: rhwp-cli, rhwp worker, LibreOffice + H2Orestart sidecar, Node API builtin fallback
- 저장소: 로컬 파일 저장소 (`STORAGE_DRIVER=local`)

MinIO와 Gotenberg 없이 동작하도록 기본값은 `OFFICE_ENGINE=hwp-sidecar`입니다. Office/PPT는 LibreOffice sidecar로 원본 서식 렌더링을 우선 사용하고, HWP/HWPX는 품질 모드에 따라 변환 체인을 다르게 사용합니다. 실패/성공 시도 이력은 `/api/jobs/:id/quality`에 저장됩니다.
LibreOffice/H2Orestart를 사용할 수 없는 서버에서만 `OFFICE_ENGINE=builtin`으로 낮춥니다.

품질 모드:

- `precise`: rhwp/Hancom 같은 정밀 엔진을 우선 사용하고 H2Orestart, builtin으로 fallback합니다.
- `quick`: builtin/fallback 중심으로 빠르게 처리하고, 저품질 의심 결과는 품질 리포트에서 `review`로 분리합니다.

정밀 Office/PPT 변환에서 `builtin-office`까지 내려간 결과는 text-only/source-only PDF일 가능성이 높으므로 다운로드 가능한 성공으로 처리하지 않습니다. 이 경우 작업은 실패로 끝나며 LibreOffice/H2Orestart 또는 상용 정밀 엔진 연결이 필요하다는 오류를 보여줍니다.

운영 리포트 기준:

- 변환 결과는 `passed`, `review`, `failed`로 분리합니다.
- UI는 엔진명, 등급, 권장 조치, 첫 페이지 PNG 미리보기, 첫 1-3페이지 inline PDF 링크를 제공합니다.
- 1,000개 배치에서는 성공, 저품질 의심, 재시도 가능, 제외/실패를 따로 보여줍니다.

## 지원 OS

- Ubuntu 22.04 또는 24.04
- systemd
- Nginx

## 빠른 설치

서버에서 repository를 받은 뒤:

```bash
cd /opt/mass-doc-to-pdf
sudo standalone/scripts/install-ubuntu.sh
cp standalone/env.example .env.standalone
```

`.env.standalone`에서 최소한 아래 값을 채웁니다.

```bash
AUTH_SECRET=$(openssl rand -base64 32)
WEB_ORIGIN=http://your-server-domain-or-ip
```

rhwp worker를 Python venv로 설치하려면 아래 명령을 실행하고 출력된 `RHWP_PYTHON=...` 값을 `.env.standalone`에 반영합니다.

```bash
standalone/scripts/install-rhwp-worker.sh
```

HWP/HWPX 렌더링 품질을 높이려면 Rust 기반 `rhwp` CLI도 설치합니다. 이 엔진은 Python rhwp worker보다 먼저
`rhwp export-pdf`를 시도합니다.

```bash
standalone/scripts/install-rhwp-cli.sh
```

출력된 `RHWP_CLI_PATH=...` 값을 `.env.standalone`에 반영하고, 품질 리포트에서 통과하면 아래처럼 활성화합니다.

```bash
RHWP_CLI_ENABLED=1
RHWP_CLI_VISUAL_MODE=pdf
RHWP_FONT_PATHS=/opt/mass-doc-to-pdf/fonts/hwp:/usr/share/fonts/truetype/nanum
```

로컬 운영자 로그인으로 먼저 확인하려면 `DEV_AUTH=1`을 유지합니다. 실제 Google OAuth를 쓸 때는
`DEV_AUTH=0`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`을 채우고 Google callback URI를 등록합니다.

```text
http://your-server-domain-or-ip/api/auth/callback/google
```

## 빌드

```bash
standalone/scripts/build.sh
standalone/scripts/init-db.sh
```

## systemd + nginx 설치

```bash
sudo standalone/scripts/install-systemd.sh
```

실행 후:

```bash
standalone/scripts/status.sh
standalone/scripts/smoke-test.sh
```

정밀 모드 smoke test:

```bash
QUALITY_MODE=precise standalone/scripts/smoke-test.sh
```

브라우저:

```text
http://your-server-domain-or-ip
```

## 배포 폴더/tarball 만들기

개발 머신에서 서버로 복사할 독립 배포 폴더를 만들려면:

```bash
standalone/scripts/package.sh
```

결과:

```text
standalone/release/mass-doc-to-pdf/
standalone/release/mass-doc-to-pdf-standalone.tar.gz
```

서버에서는 tarball을 풀고 같은 설치 절차를 실행합니다.

```bash
sudo mkdir -p /opt
sudo tar -C /opt -xzf mass-doc-to-pdf-standalone.tar.gz
sudo chown -R "$USER":"$(id -gn)" /opt/mass-doc-to-pdf
cd /opt/mass-doc-to-pdf
sudo standalone/scripts/install-ubuntu.sh
cp standalone/env.example .env.standalone
standalone/scripts/build.sh
standalone/scripts/init-db.sh
sudo standalone/scripts/install-systemd.sh
```

## 포트

기본값:

- Web/Nginx: `80`
- API 내부: `127.0.0.1:18010`
- 변환 sidecar 내부: `127.0.0.1:18080` (`OFFICE_ENGINE=hwp-sidecar`일 때)
- 품질 리포트: `GET /api/jobs/:id/quality`
- PDF 다운로드: `GET /api/jobs/:id/download` (`Content-Disposition: attachment`)
- PDF inline 열기: `GET /api/jobs/:id/preview` (`Content-Disposition: inline`)
- 첫 페이지 이미지 미리보기: `GET /api/jobs/:id/preview.png` (`image/png`)

Nginx가 `/api/*`를 API로 프록시합니다.

## PDF 미리보기 동작

상세 화면의 미리보기는 브라우저 내장 PDF viewer에만 의존하지 않습니다. API가 변환 완료 PDF의 첫 페이지를 LibreOffice headless로 PNG 렌더링해서 `/api/jobs/:id/preview.png`로 제공합니다. 그래서 브라우저가 iframe PDF 렌더링을 막거나 검은 화면을 표시해도 첫 페이지 미리보기는 이미지로 보입니다.

미리보기 관련 조건:

- `standalone/scripts/install-ubuntu.sh`가 설치하는 `libreoffice`가 필요합니다.
- `/api/jobs/:id/preview.png`가 실패하면 UI는 inline PDF 새 창 링크를 fallback으로 표시합니다.
- 다운로드 버튼은 계속 `/api/jobs/:id/download`를 사용하므로 사용자가 받는 PDF 파일 동작은 바뀌지 않습니다.

## 데이터 위치

기본값:

```text
/opt/mass-doc-to-pdf/data/app.db
/opt/mass-doc-to-pdf/data/objects
```

이 디렉터리를 백업하면 SQLite DB와 원본/변환 PDF 파일을 함께 보존할 수 있습니다.

## 운영 명령

```bash
sudo systemctl restart mass-doc-to-pdf-api
sudo systemctl restart mass-doc-to-pdf-sidecar
sudo systemctl restart mass-doc-to-pdf-worker
sudo systemctl reload nginx

journalctl -u mass-doc-to-pdf-api -f
journalctl -u mass-doc-to-pdf-sidecar -f
journalctl -u mass-doc-to-pdf-worker -f
```

## 서버 리허설

Ubuntu 서버나 VM에서 독립 배포가 재현되는지 끝까지 확인하려면:

```bash
WEB_URL=http://127.0.0.1:19081 \
API_URL=http://127.0.0.1:19010 \
SIDECAR_URL=http://127.0.0.1:19080 \
INSTALL_DEPS=1 \
RUN_SYSTEMD=1 \
FORCE_REHEARSAL=1 \
standalone/scripts/rehearse-ubuntu.sh
```

기본 포트와 충돌하지 않도록 `.env.standalone`에서 `PORT`, `SIDECAR_PORT`, `HWP_SIDECAR_URL`,
`NGINX_LISTEN_PORT`, `WEB_ORIGIN`을 같은 포트 세트로 맞춥니다.

## 품질 코퍼스 리포트

복잡한 HWP, 구버전 HWP, 표/이미지/각주/폰트가 많은 파일군은 운영 전에 별도 코퍼스로 검증합니다.
아래 스크립트는 지정 폴더에서 최대 1,000개 문서를 업로드하고 품질 리포트를 `jsonl`, `json`, `csv`로 집계합니다.

```bash
WEB_URL=http://your-server-domain-or-ip \
QUALITY_MODE=precise \
MAX_FILES=1000 \
OUT_DIR=quality-reports/prod-sample-001 \
standalone/scripts/quality-corpus-report.sh /path/to/document-samples
```

산출물:

```text
quality-reports/prod-sample-001/jobs.jsonl
quality-reports/prod-sample-001/summary.json
quality-reports/prod-sample-001/summary.csv
quality-reports/prod-sample-001/summary.md
```

PO/운영 KPI는 `summary.json` 또는 사람이 읽기 쉬운 `summary.md`에서 확인합니다.

- 전체 성공률: `jobStatus.success / total`
- 고품질 통과율: `qualityStatus.passed / total`
- 저품질 의심: `qualityStatus.review`
- 재시도/조치 대상: `failedFiles`, `reviewFiles`
- 샘플 부족 여부: `sampleShortfall`

`rhwp-cli` 도입 후에는 같은 샘플로 최소 두 번 비교합니다.

```bash
RHWP_CLI_ENABLED=0 OUT_DIR=quality-reports/baseline-h2o \
  standalone/scripts/quality-corpus-report.sh /path/to/document-samples

RHWP_CLI_ENABLED=1 OUT_DIR=quality-reports/rhwp-cli-pdf \
  standalone/scripts/quality-corpus-report.sh /path/to/document-samples
```

`selectedEngine`이 `rhwp-cli-pdf`인 결과의 페이지 수, PDF 크기, 미리보기 품질을 `h2orestart` 결과와 비교합니다.
이미지/표가 많은 문서에서 `rhwp-cli-pdf`가 흔들리면 `RHWP_CLI_VISUAL_MODE=raster`는 후보로만 두고, PNG 기반
image PDF 조합을 별도 검증 후 활성화합니다.

## 주의

- Docker compose를 사용하지 않습니다.
- Office/PPT 원본 서식 보존은 `OFFICE_ENGINE=hwp-sidecar`와 sidecar health가 필요합니다. `OFFICE_ENGINE=builtin`은 text-only fallback이므로 정밀 모드 성공으로 인정하지 않습니다.
- HWP binary 고품질 렌더링은 `rhwp-python` 설치 상태와 문서 복잡도에 따라 달라집니다. 실패 시 서비스는
  H2Orestart와 builtin으로 내려가며, 어떤 단계가 쓰였는지는 품질 리포트에서 확인합니다.
- 대량 배치 변환은 현재 브라우저에서 1,000개까지 순차 큐 등록합니다. 탭을 닫으면 남은 등록은 중단됩니다.
