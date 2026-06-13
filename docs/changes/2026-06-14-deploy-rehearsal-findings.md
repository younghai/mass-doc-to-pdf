# 풀스택 배포 리허설 결과 (2026-06-14)

`docker compose build && up`을 실제로 돌려, 단위 테스트(133개)와 코드 리뷰가
잡지 못한 **배포 환경 전용 결함 4건**을 발견·수정했다. 모두 "코드는
통과하는데 실제로 띄우면 깨지는" 부류로, 리허설이 아니면 첫 운영 배포에서
드러났을 문제다.

## 결함 1 — 문서화된 quickstart가 부팅 거부 (DEV_AUTH 가드)

`apps/api/Dockerfile`이 `NODE_ENV=production`을 굽는데 `docker-compose.yml`은
로컬 편의를 위해 `DEV_AUTH=1`을 넘긴다. config.ts의 안전 가드가
"production + DEV_AUTH=1 + !ALLOW_DEV_AUTH"를 거부 → api/worker가 즉시 exit 1.
README의 `docker-compose up` 절차가 그대로는 안 떴다.

**수정**: `docker-compose.yml`의 api·worker에 `ALLOW_DEV_AUTH=${ALLOW_DEV_AUTH:-1}`.
이 파일은 localhost 전용 dev compose이므로 명시 opt-in이 옳고, prod 가드는
유지된다(docker-compose.prod.yml은 `DEV_AUTH:-0`, ALLOW_DEV_AUTH 없음).

## 결함 2 — 마이그레이션 레이스로 api 크래시 루프

api CMD는 부팅 시 `prisma migrate deploy`를 도는데, `worker.depends_on: [api]`
(short form)는 api의 *시작*만 기다리고 *준비*를 안 기다린다. 그래서 worker가
api의 마이그레이션 도중 같은 SQLite 파일을 열어 `database is locked` →
api가 exit 1. 앱 레벨 `busy_timeout=5000`은 Prisma의 Rust 스키마 엔진이
존중하지 않아 무력.

**수정**: api에 `healthcheck`(node fetch `/health`) 추가, worker·web의
`depends_on`을 `condition: service_healthy`로 변경. compose가
"api Waiting → Healthy → 그 다음 worker/web Starting"으로 직렬화 →
마이그레이션이 단독 실행된 뒤 worker가 붙는다. 클린 부팅에서 api 로그
lock/Error 0건 확인.

## 결함 3 — rhwp 정밀 엔진이 import 자체 실패 (broken wheel)

`rhwp-python==0.7.0`의 manylinux(arm64) wheel이 **FT_Palette_Select 심볼이
없는 구버전 freetype을 번들**한다. `_rhwp.abi3.so`가 RPATH로 그 번들
freetype을 잡으면서 `import rhwp` → `undefined symbol: FT_Palette_Select`.
프리플라이트가 정직하게 rhwp를 제외해서 변환은 H2Orestart로 폴백되지만,
P1에서 패키징한 정밀 엔진이 **사실상 작동하지 않았다**(전 작업이
acceptable 등급). 시스템 freetype은 2.12.1로 심볼을 가지고 있다.

**수정**: `apps/api/Dockerfile`과 `standalone/scripts/install-ubuntu.sh`에서
pip 설치 직후 번들 freetype을 배포판 freetype으로 심볼릭링크 교체
(`find … -path '*/rhwp_python.libs/libfreetype-*.so.6' -exec ln -sf "$SYS_FT" {}`).
설치기는 추가로 `import rhwp` 사후 검증 후 실패 시 경고. 수정 후
`/health/engines`의 `preflight.rhwp.available=true`, precise 체인
`["rhwp","h2orestart"]` 확인.

## 결함 4 — pdfTextChars 정규식 ReDoS로 워커 행 (최중대)

P1에서 추가한 `pdfTextChars`(텍스트 레이어 빈 PDF 검출)의 `TJ_ARRAY_RE`가
`(?:\\[\s\S]|[^\]])*?` — 두 분기가 모두 백슬래시를 매칭해 모호. rhwp가
실제로 만든 656KB(16페이지) PDF에서 **지수적 백트래킹**으로 Node 워커가
CPU 99.9%로 무한 정지 → 큐 전체가 그 뒤로 막혔다. 단위 테스트 133개는
합성·소형 PDF만 써서 못 잡았다. 실서버에서 첫 멀티페이지 rhwp 변환에
걸렸을 결함.

**수정** (`apps/api/src/convert/quality.ts`):
- 분기 상호배타화 — `[^\]]` → `[^\]\\]`(백슬래시는 `\\[\s\S]`만 소유).
  실 656KB PDF 기준 무한 → 25ms.
- 모든 지연 그룹에 반복 상한 `{0,8192}?`(pdfPageCount의 `[^>]{0,2048}`과
  동일 기법)로 적대적 입력의 2차 비용까지 차단.
- 회귀 테스트: 60자 미종결 TJ 배열(`[` + `\a`×30)이 옛 정규식은 수 초
  행, 수정본은 0ms. 5초 vitest 기본 타임아웃이 회귀를 잡는다.

## 절차 메모 (코드 결함 아님)

리허설 중 `docker-compose build api`만 돌려 worker가 구 이미지로 떠
결함 3·4의 수정이 worker에 반영 안 된 적이 있다. api와 worker는 같은
Dockerfile이지만 compose에서 **별개 이미지 태그**(`hwptopdf-api`,
`hwptopdf-worker`)다. 운영 절차는 `docker compose build`(인자 없이 전체)
또는 `up --build`를 써서 둘 다 재빌드해야 한다.

## 검증

```
corepack pnpm --filter @hwptopdf/api exec vitest run   # 134 pass(+1 ReDoS) / 1 skip
corepack pnpm --filter @hwptopdf/api typecheck         # clean
docker compose build && docker compose up -d           # 직렬 부팅, 크래시 0
curl :8010/health/engines                              # rhwp available=true
# 코퍼스 5건 — 결함 4 수정 후 행 없이 완주 (아래 표)
```

## 코퍼스 실행 결과 (compose, rhwp 활성, 결함 4 수정 후)

| 문서 | 결과 | 엔진 | 등급 | 페이지 | preview.png | 품질 |
| --- | --- | --- | --- | --- | --- | --- |
| 01-성과관리시스템.hwp | passed | **rhwp** | good | 14 | ok | passed |
| 02-수의계약양식.hwp | passed | **rhwp** | good | 7 | ok | passed |
| 03-보고서양식.hwp | **failed** | (체인 전체) | – | – | – | failed |
| 04-소득세감면신청서.hwp | passed | **rhwp** | good | 1 | ok | passed |
| 05-사업계획서.hwpx | passed | **rhwp** | good | 2 | ok | passed |

- 결함 3 수정 전(이전 라운드)에는 4건이 전부 **h2orestart / acceptable**이었다.
  freetype 수리로 rhwp가 살아나 **4건이 rhwp / good / passed**로 승격.
- `preview.png`는 4건 모두 pdftoppm으로 정상 생성(P1 미리보기 사전 생성 검증).
- 변환 중 워커 CPU 0.56% — ReDoS 행 재현 안 됨(결함 4 수정 확인).

### 03-보고서양식.hwp — 두 엔진 모두 실패 (06-11 예측 반증)

- rhwp: `LAYOUT_OVERFLOW (PartialTable)` — 높이 0 표 영역 렌더 중단 (0.7.0 한계).
- h2orestart/LibreOffice: `422` — soffice가 이 양식을 변환하지 못함(다른 4건은
  성공하므로 사이드카 자체는 정상). 06-11에 "실서버에서 H2Orestart가 폴백으로
  통과할 것"이라 적었으나 **실측 결과 통과하지 못한다**.
- builtin은 Chrome 미설치로 제외(설치해도 텍스트 전용이라 양식 레이아웃 손실).
- 시스템은 행/배치 오염 없이 `failed` + 명확한 사유로 처리 — 코드 결함이 아니라
  엔진 역량 공백. 후속: rhwp 업스트림(표 레이아웃) 추적, 또는 상용 엔진(Hancom)
  검토. 이런 양식은 운영상 "변환 불가"로 분류하고 사용자 안내가 현실적.
