# Standalone Deployment (No Docker)

이 폴더는 `mass-doc-to-pdf`를 Docker 없이 단일 Linux 서버에서 운영하기 위한 배포 표면입니다.

구성:

- API: Node.js + Fastify + Prisma SQLite
- Web: 정적 Vite 빌드 결과 + Nginx
- 변환 엔진: Node API builtin fallback, 선택적으로 LibreOffice + H2Orestart Flask sidecar
- 저장소: 로컬 파일 저장소 (`STORAGE_DRIVER=local`)

MinIO와 Gotenberg 없이 동작하도록 기본값은 `OFFICE_ENGINE=builtin`입니다. 이 값은 HWP/HWPX 업로드를
외부 sidecar로 보내지 않아, sidecar 미설치 서버에서도 업로드/변환 요청이 실패하지 않습니다.
LibreOffice/H2Orestart를 설치해 더 나은 렌더링을 확인한 서버에서만 `OFFICE_ENGINE=hwp-sidecar`로 바꿉니다.

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

## 주의

- Docker compose를 사용하지 않습니다.
- `OFFICE_ENGINE=builtin`은 서비스 가용성 중심의 fallback입니다. HWP binary 고품질 렌더링은
  LibreOffice/H2Orestart 또는 별도 상용/전용 엔진 검증이 필요합니다.
- 대량 배치 변환은 현재 브라우저에서 1,000개까지 순차 큐 등록합니다. 탭을 닫으면 남은 등록은 중단됩니다.
