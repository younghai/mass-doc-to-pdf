# P0 백엔드 4건 (2026-06-11)

품질 분석에서 배포 차단급으로 분류한 4건을 3개 커밋으로 처리했다.
테스트 108→121개(+13), 전부 통과.

## 1. 워커 크래시 루프 (`31f086e`)

`processConversion`의 `storage.get(job.sourceKey)`가 try 밖에 있어, 원본
객체 소실(보존기간 스윕·삭제 경합)이나 스토리지 일시 장애가 워커 루프
밖으로 전파 → `process.exit(1)` → 재기동 후 같은 작업 claim → 다시 크래시.
**독성 작업 1건이 큐 전체를 무한 크래시 루프에 빠뜨렸다.**

- `storage.get`/`forFormat`을 try 안으로 — 어떤 오류도 ProcessResult로
  반환한다는 계약을 JSDoc에 명시
- `runWorkerLoop`에 반복 단위 try/catch + `errorBackoffMs`(기본 5초) —
  claim/sweep 경로의 DB·스토리지 장애도 백오프로 강등

## 2. visibility lease 5분/15분 모순 (`31f086e`)

`jobQueue.ts` 기본값은 15분(주석: "체인 최악 케이스가 5분을 넘는다")인데
`worker-main.ts`가 5분으로 덮어써, 워커 2대 이상에서 5분 넘는 변환이
재청구되어 이중 처리됐다. 15분으로 정합화 + 체인 최악 케이스 산술
(rhwp-cli 180s + rhwp 120s + sidecar 150s + builtin 120s ≈ 9.5분)을 주석화.
`standalone/env.example`에 `WORKER_VISIBILITY_TIMEOUT_MS=900000` 명시.

## 3. 외부 호출 타임아웃 (`88bfeac`)

- `H2OrestartConverter`: fetch에 AbortSignal 없음 → undici 기본만으로
  최대 ~10분 행. `AbortSignal.timeout(150s)` (env `SIDECAR_TIMEOUT_MS`) —
  사이드카 내부 soffice 120s보다 길어 사이드카의 422가 우선.
- `BuiltinOfficeConverter`: execFile에 timeout 자체가 없어 Chrome 행이
  워커를 영구 정지시켰다. 120s(env `BUILTIN_TIMEOUT_MS`) + SIGKILL
  (행 걸린 Chrome은 SIGTERM을 무시할 수 있음).

## 4. 엔진 가용성 프리플라이트 (`이번 커밋`)

**문제**: Docker api/worker 이미지(node:20-slim)에는 python3가 없고
standalone 설치 스크립트는 rhwp를 설치하지 않는데 `RHWP_ENABLED` 기본이
ON — rhwp가 체인에서 매번 실패 attempt를 남겨 **배포 환경에서 모든 HWP
변환이 영원히 `review`** (변환은 H2Orestart가 성공하는데도). builtin도
Chrome 부재로 동일.

**수정** (`convert/preflight.ts` 신설):

- 부팅 시 1회 로컬 런타임 프로브: rhwp(`python -c "import rhwp"` exit 0),
  rhwp-cli(바이너리 ENOENT 검사 — `--version` 컨벤션은 신뢰 불가하므로
  비대칭), builtin(python3 + Chrome/Chromium PATH)
- `applyPreflight`로 불가 엔진을 체인에서 제외 (disabled-engine 제외
  패턴 재사용), 엔진별 `console.warn` — **프로브는 어떤 경우에도 부팅을
  실패시키지 않음**
- **네트워크 엔진(sidecar/gotenberg)은 제외 대상이 아님**: 부팅 순서
  경합으로 일시 다운일 수 있고 죽었다 살아나는 게 정상. `/health/engines`
  에서 요청 시점 라이브 프로브로만 보고
- `GET /health/engines`: 부팅 프리플라이트 + 라이브 sidecar/gotenberg
  상태 + 실효 체인(`chains.hwpPrecise` 등) 노출 — smoke-test가 배포 직후
  엔진 구성을 검증할 수 있는 운영 창구
- `OFFICE_ENGINE=builtin` 명시 설정은 존중(제외 안 함)하되 console.error

## 검증

```
corepack pnpm -r test       # shared 6, api 121(+1 skip), web 21 — 전부 통과
corepack pnpm -r typecheck  # 통과
```

## 운영 영향

- 새 배포에서 HWP 품질 상태가 정직해짐: rhwp가 설치된 서버는 `passed`
  가능, 미설치 서버는 rhwp가 체인에서 빠져 H2Orestart 결과가
  (실패 attempt 오염 없이) 평가됨
- rhwp를 실제로 쓰려면 여전히 런타임 설치 필요: Docker 이미지에
  python3+rhwp-python 추가 또는 standalone에 venv 설치 단계 (별도 작업)
- 배포 후 확인: `curl :8010/health/engines` 로 실효 체인 확인
