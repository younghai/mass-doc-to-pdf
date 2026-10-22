# macOS localhost 실행

프로젝트 루트(`package.json`이 있는 `hwptopdf/` 폴더)에서 실행합니다.

```bash
pnpm dev
```

접속: http://localhost:5173/service · 종료: 실행 터미널에서 `Ctrl+C`. 5초 후에도 남은 프로세스는 종료하며, `Ctrl+C`를 다시 누르면 즉시 종료합니다.
웹(5173), API(8000), 변환 sidecar(8080), 큐 worker를 함께 실행합니다.
모든 HTTP 서버는 `127.0.0.1`에만 바인딩합니다. 기존 포트가 사용 중이면 종료하며 다른 프로세스를 중지하지 않습니다.

## 로컬 데이터

- DB: `tmp/local-dev/app.db`
- 원본/PDF/리포트: `tmp/local-dev/objects`
- Python 환경: `tmp/local-runtime`
- Mac별 실행 파일 경로: `.env.local` (Git 제외)

첫 설정 시 기존 `tmp/preview.db`와 `tmp/preview-objects`의 복사본을 연결했습니다. 실행 명령은 `tmp/local-dev/app.db`에만 마이그레이션을 적용합니다. 기존 DB와 파일은 유지됩니다. 이전 11건은 품질 상태 열이 없었으므로 새 화면에서 `미기록`으로 표시됩니다. 기존 성공 이력을 품질 통과로 임의 변경하지 않았습니다.

개발 로그인은 로컬 운영자 계정을 사용합니다. 문서는 이 Mac의 변환 엔진과 저장소에서 처리합니다. 로컬 복사본의 오래된 기록 보존을 위해 `DATA_RETENTION_DAYS=365000`을 사용합니다. 운영 배포 설정이 아닙니다.

## 현재 Mac 설정 및 재설치

Node 20.12 이상, pnpm 10.32.1, Python 3.12, uv, LibreOffice, pdftoppm이 필요합니다.

```bash
pnpm install --frozen-lockfile
uv venv --python 3.12 tmp/local-runtime
uv pip install --python tmp/local-runtime/bin/python rhwp-python==0.8.1 Flask==3.1.3 gunicorn==26.2.0
```

`pnpm dev`가 Prisma 생성, 로컬 마이그레이션, 공용 코드·API 빌드를 실행합니다. 설치가 이미 완료된 현재 Mac에서는 다시 설치할 필요가 없습니다.

`.env.local`에는 `HWPTOPDF_BIN_DIR`(soffice/pdftoppm 디렉터리), `GOOGLE_CHROME`(선택적 builtin fallback), `LIBREOFFICE_PATH`를 설정합니다. 현재는 Codex 번들 LibreOffice/Poppler와 설치된 Chromium 경로가 연결되어 있습니다. 이 경로들은 다른 Mac으로 복사할 때 새 환경에 맞게 변경해야 합니다. `HOST`, DB, 포트, 개발 인증, 저장소는 실행 명령이 로컬 전용 값으로 고정합니다.

HWP/HWPX는 rhwp-python 0.8.1(코어 0.7.17)을 우선 사용합니다. Office 파일은 LibreOffice sidecar를 사용합니다. 상용 엔진과 회의록 labs는 이 실행에서 활성화하지 않습니다. LibreOffice fallback의 HWP/HWPX 호환성과 원본 대비 완전한 레이아웃 충실도는 별도 검증 대상입니다.

## 점검

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/health/engines
curl http://localhost:5173/api/stats
pnpm -r typecheck
pnpm -r build
NODE_OPTIONS=--no-experimental-webstorage pnpm -r test
```

현재 설치된 Node 26에서는 네이티브 Web Storage와 기존 Vitest/jsdom의 충돌 때문에 마지막 옵션이 필요합니다. 이 옵션으로 223개 통과, 상용 엔진 관련 1개 건너뜀을 확인했습니다. 테스트 생략이나 검증 조건 완화는 하지 않았습니다.

실제 브라우저에서 Word 단일 업로드, HWP/HWPX/Word 3건 폴더 변환, PDF 미리보기/다운로드, ZIP 다운로드, 새로고침 후 배치 복원을 확인했습니다. 파일당 20 MB, 폴더당 1,000개는 코드상 제한이며 이번에 1,000건 부하 검증을 수행한 것은 아닙니다.
