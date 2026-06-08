# Standalone Operations Validation

이 문서는 `standalone/` 배포본을 GitHub 소스와 분리해서 운영할 때 확인해야 하는 현재 검증 상태와 남은 전환 조건입니다.

## 현재 포함된 개선 사항

- HWP/HWPX 품질 코퍼스 리포트: `jsonl`, `summary.json`, `summary.csv`, `summary.md` 산출.
- HWP/HWPX 샘플 부족 표시: `minimumFiles`, `targetFiles`, `sampleShortfall` 기록.
- Google OAuth 운영 readiness 체크와 테스트 코드.
- `NODE_ENV=production` 환경에서 build 중 테스트가 실패하던 문제 방지.
- systemd 재설치 시 active 서비스에 새 env가 적용되도록 restart 처리.
- nginx/API/sidecar 포트 env 기반 렌더링.
- API/sidecar readiness 대기 후 smoke-test 실행.
- durable conversion worker systemd 서비스 포함.
- `/opt/mass-doc-to-pdf` 기준 install, build, init-db, systemd, smoke-test 리허설 스크립트 포함.
- HWP 정밀 변환용 `rhwp-cli-pdf` 엔진 추가: Rust `rhwp export-pdf`를 Python rhwp worker보다 먼저 시도.
- `RHWP_CLI_PATH`, `RHWP_CLI_TIMEOUT_MS`, `RHWP_FONT_PATHS`, `RHWP_CLI_VISUAL_MODE` 운영 설정 추가.

## HWP/HWPX 실제 샘플 검증

서버에 있던 실제 HWP/HWPX 샘플은 14개였으므로 50/100개 검증은 `14개 실측 + 샘플 부족 표시`로 처리했습니다.

| 항목 | 결과 |
| --- | --- |
| availableFiles | 14 |
| testedFiles | 14 |
| success | 14 |
| review/low-quality | 0 |
| failed | 0 |
| selectedEngine | rhwp 14 |
| quality | passed, grade good |
| pageCounts | 4, 5, 6, 7 |
| 50개 기준 부족분 | 36 |
| 100개 기준 부족분 | 86 |
| 서버 리포트 | `/home/vts/hwptopdf/quality-reports/hwp-hwpx-20260607-102245/summary.md` |

운영 전에는 실제 고객 문서 기준으로 최소 50개, 권장 100개 이상을 다시 넣고 아래 명령으로 재측정합니다.

```bash
WEB_URL=http://your-server-domain-or-ip \
QUALITY_MODE=precise \
FORMATS=hwp,hwpx \
MIN_FILES=50 \
MAX_FILES=100 \
OUT_DIR=quality-reports/hwp-hwpx-prod-001 \
standalone/scripts/quality-corpus-report.sh /path/to/hwp-samples
```

## Google OAuth 상태

테스트 코드와 운영 readiness 가드는 포함되어 있습니다. 현재 서버 설정은 외부 Google OAuth 운영 로그인 기준으로는 아직 불합격입니다.

| 조건 | 현재 상태 | 운영 전 조치 |
| --- | --- | --- |
| `DEV_AUTH` | `1` | 외부 로그인 전 `0`으로 변경 |
| `GOOGLE_CLIENT_ID` | 미설정 | Google Cloud Console OAuth client 값 설정 |
| `GOOGLE_CLIENT_SECRET` | 미설정 | Google Cloud Console OAuth secret 설정 |
| `WEB_ORIGIN` | HTTP/raw IP 기반 | DNS 도메인 + HTTPS origin으로 변경 |
| redirect URI | HTTP/raw IP callback | Google OAuth client에 HTTPS callback 등록 |

운영 callback 형식:

```text
https://your-domain.example/api/auth/callback/google
```

내부 검증이나 폐쇄망 운영에서는 `DEV_AUTH=1`로 smoke-test를 먼저 끝낸 뒤, 외부 사용자 오픈 전에 OAuth 조건을 별도로 통과시킵니다.

## 서버 리허설 결과

`/opt/mass-doc-to-pdf`에 standalone 리허설 배포본을 만들고 아래 흐름을 완료했습니다.

```text
install-ubuntu -> build -> init-db -> systemd -> smoke-test
```

리허설 포트:

| 서비스 | 포트 |
| --- | --- |
| web/nginx | 19081 |
| API | 19010 |
| sidecar | 19080 |

검증 증거:

- 리허설 로그: `/opt/mass-doc-to-pdf/rehearsal-reports/20260607-103323`
- systemd: `mass-doc-to-pdf-api`, `mass-doc-to-pdf-sidecar`, `mass-doc-to-pdf-worker`, `nginx` active
- smoke: web 200, API health OK, sidecar health OK
- 변환: 업로드 성공, 변환 성공, PDF 다운로드 확인
- 품질: `passed`, engine `h2orestart`, grade `acceptable`

같은 흐름을 재현하려면 `.env.standalone`을 만든 뒤:

```bash
INSTALL_DEPS=1 RUN_SYSTEMD=1 standalone/scripts/rehearse-ubuntu.sh
```

운영 포트와 충돌하는 서버에서는 `.env.standalone`의 포트를 먼저 변경하고 실행합니다.

## 현재 운영 전환 보류

`/home/vts/hwptopdf` 운영 DB에는 durable queue 컬럼이 아직 적용되지 않았습니다. 운영 DB migration은 승인 없이 실행하지 않았습니다.

현재 의미:

- `http://172.19.1.151:8081/` 운영 서비스 smoke-test는 정상입니다.
- 기존 서비스는 현재 상태로 유지 가능합니다.
- queue-enabled 런타임으로 운영 재시작하려면 `/home/vts/hwptopdf` 운영 DB migration 승인이 필요합니다.
- 승인 후에는 rollback 계획과 DB 백업을 먼저 만든 뒤 `standalone/scripts/init-db.sh` 또는 동일한 migration deploy 절차를 실행해야 합니다.

## 운영 완료 기준

운영 전환을 완료로 판단하려면 아래 항목이 모두 통과해야 합니다.

| 항목 | 완료 기준 |
| --- | --- |
| 패키지 | `standalone/scripts/package.sh`로 tarball 생성 |
| 설치 | Ubuntu 서버에서 `install-ubuntu`, `build`, `init-db`, `install-systemd` 성공 |
| 서비스 | API, sidecar, worker, nginx active |
| smoke | 업로드, 변환, 다운로드, 품질 API 통과 |
| HWP 품질 | 실제 HWP/HWPX 50개 이상 리포트에서 success/review/failed 분리 |
| rhwp-cli | `rhwp-cli-pdf`와 `h2orestart` 결과를 같은 샘플로 비교하고 selectedEngine/pageCount/pdfBytes/preview 확인 |
| OAuth | 외부 사용자 운영 시 DNS + HTTPS + Google OAuth callback 통과 |
| DB | 운영 DB migration 승인, 백업, 적용, 재시작 검증 |
