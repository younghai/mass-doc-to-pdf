# Standalone Deployment (No Docker)

이 폴더는 `mass-doc-to-pdf`를 Docker 없이 단일 Linux 서버에서 운영하기 위한 배포 표면입니다.

구성:

- API: Node.js + Fastify + Prisma SQLite
- Web: 정적 Vite 빌드 결과 + Nginx
- 변환 엔진: rhwp worker 1차 시도, LibreOffice + H2Orestart sidecar, Node API builtin fallback
- 저장소: 로컬 파일 저장소 (`STORAGE_DRIVER=local`)

MinIO와 Gotenberg 없이 동작하도록 기본값은 `OFFICE_ENGINE=hwp-sidecar`입니다. Office/PPT는 LibreOffice sidecar로 원본 서식 렌더링을 우선 사용하고, HWP/HWPX는 품질 모드에 따라 변환 체인을 다르게 사용합니다. 실패/성공 시도 이력은 `/api/jobs/:id/quality`에 저장됩니다.
LibreOffice/H2Orestart를 사용할 수 없는 서버에서만 `OFFICE_ENGINE=builtin`으로 낮춥니다.

품질 모드:

- `precise`: rhwp/Hancom 같은 정밀 엔진을 우선 사용하고 H2Orestart, builtin으로 fallback합니다.
- `quick`: builtin/fallback 중심으로 빠르게 처리하고, 저품질 의심 결과는 품질 리포트에서 `review`로 분리합니다.

정밀 Office/PPT 변환에서 `builtin-office`까지 내려간 결과는 text-only/source-only PDF일 가능성이 높으므로 다운로드 가능한 성공으로 처리하지 않습니다. 이 경우 작업은 실패로 끝나며 LibreOffice/H2Orestart 또는 상용 정밀 엔진 연결이 필요하다는 오류를 보여줍니다.

운영 리포트 기준:

- 변환 결과는 `passed`, `review`, `failed`로 분리합니다.
- UI는 엔진명, 등급, 권장 조치, 첫 1-3페이지 PDF 미리보기 링크를 제공합니다.
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

Nginx가 `/api/*`를 API로 프록시합니다.

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
sudo systemctl reload nginx

journalctl -u mass-doc-to-pdf-api -f
journalctl -u mass-doc-to-pdf-sidecar -f
```

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
```

PO/운영 KPI는 `summary.json`에서 확인합니다.

- 전체 성공률: `jobStatus.success / total`
- 고품질 통과율: `qualityStatus.passed / total`
- 저품질 의심: `qualityStatus.review`
- 재시도/조치 대상: `failedFiles`, `reviewFiles`

## 주의

- Docker compose를 사용하지 않습니다.
- Office/PPT 원본 서식 보존은 `OFFICE_ENGINE=hwp-sidecar`와 sidecar health가 필요합니다. `OFFICE_ENGINE=builtin`은 text-only fallback이므로 정밀 모드 성공으로 인정하지 않습니다.
- HWP binary 고품질 렌더링은 `rhwp-python` 설치 상태와 문서 복잡도에 따라 달라집니다. 실패 시 서비스는
  H2Orestart와 builtin으로 내려가며, 어떤 단계가 쓰였는지는 품질 리포트에서 확인합니다.
- 대량 배치 변환은 현재 브라우저에서 1,000개까지 순차 큐 등록합니다. 탭을 닫으면 남은 등록은 중단됩니다.
