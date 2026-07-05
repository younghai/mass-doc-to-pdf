# Codex 구현 스펙 — 자체 감사 백로그 (AUD-1~7)

> 작성일: 2026-07-05 · 작성: Claude(Fable 5, 감사) · 구현: Codex GPT-5.5 xhigh
> 출처: [12-자체구현-감사](12-자체구현-감사.md) 후속 백로그. 전부 **비차단**이나 우선순위 순 정리.
> 공통 규약은 [10-codex-구현-스펙](10-codex-구현-스펙.md) §공통 규약.

---

## SPEC-AUD-1 · [MEDIUM] deploy-ssh.yml `image_tag` 셸 인젝션 차단

**근거:** `.github/workflows/deploy-ssh.yml:76` `export HWPTOPDF_IMAGE_TAG='${{ inputs.image_tag }}'` — GitHub Actions가 `${{ }}`를 셸 실행 전 텍스트로 치환하므로 `image_tag`에 `x'; <cmd>; '`를 넣으면 원격 임의 명령 실행. `workflow_dispatch`(write 권한자)라 MEDIUM이나 동일 파일이므로 후속 처리.

**대상 파일**
- `.github/workflows/deploy-ssh.yml`

**변경 설계**
1. "Pull and restart stack" 스텝 시작부에 **입력 검증 가드** 추가: `image_tag`가 도커 태그 문법(`^[A-Za-z0-9._:-]+$`)이 아니면 즉시 실패.
   ```bash
   TAG="${{ inputs.image_tag }}"
   case "$TAG" in
     *[!A-Za-z0-9._:-]*|'') echo "invalid image_tag" >&2; exit 1 ;;
   esac
   ```
   (또는 `env: IMAGE_TAG`로 받아 위 검증 후 heredoc에 주입.)
2. 검증 통과 값만 `HWPTOPDF_IMAGE_TAG`로 사용. 안전 문자만 통과하므로 인젝션 무력화.

**수용 기준**
- 따옴표/세미콜론/공백 포함 태그는 ssh 실행 전 워크플로 실패.
- 정상 태그(`latest`, `v1.2.3`, `sha-abc123`)는 통과.

**테스트 조건**
- 워크플로는 로컬 실행 불가 — `python3 -c "import yaml; yaml.safe_load(...)"` 파싱 + 검증 정규식을 셸에서 샘플 입력으로 단위 확인(악성/정상 각 1).

**위험:** 실 배포 dry-run 미검증(환경 제약). YAML/셸 정합만 로컬 확인 가능.

---

## SPEC-AUD-2 · [LOW] 보안 변경 통합 테스트 (trustProxy · 멀티파트)

**근거:** [12 감사] AUD-2. `trustProxy`(req.ip 스푸핑 방지)·멀티파트 `parts:12`는 파싱/설정 유닛만 있고 Fastify 통합 동작 테스트 부재 → 보안 회귀가 조용히 통과 가능.

**대상 파일**
- `apps/api/src/app.test.ts`

**변경 설계**
1. **trustProxy 통합:** `buildApp({ trustProxy: 1, rateLimitMax: 3, ... })`에 `app.inject`로 위조 `X-Forwarded-For: 1.2.3.4`를 넣어도 rate-limit 키(=`req.ip`)가 소켓 IP로 고정되어 스푸핑으로 한도를 우회하지 못함을 검증. (또는 `trustProxy: false`와 대비.)
2. **멀티파트 parts:** 13개 이상 파트를 담은 multipart 요청이 거부됨을 검증(413 또는 파서 에러). 정상 단일 파일은 통과.

**수용 기준**
- 위조 XFF가 rate-limit victim을 바꾸지 못함을 테스트가 증명.
- 파트 수 초과가 거부됨을 테스트가 증명.

**테스트 조건 (이 자체가 테스트 추가):** 위 2개가 GREEN. 기존 app.test.ts 통과 유지.

**위험:** 낮음. `@fastify/multipart` inject 멀티파트 구성 관례 확인 필요.

---

## SPEC-AUD-3 · [LOW] `/api/convert` 429 한도 통합 테스트

**근거:** [12 감사] AUD-3. 활성 job ≥ 한도 시 429 동작이 리팩터 전후 무테스트.

**대상 파일**
- `apps/api/src/routes/convert.test.ts`

**변경 설계**
- `deps.jobs.countActive`를 `maxActiveJobsPerUser` 이상 반환하도록 스텁 → `POST /api/convert`가 **429 + "변환 대기 한도 초과…"** 반환을 검증. `maxActiveJobsPerUser`를 작은 값(예: 1)으로 주입해 경계 테스트.

**수용 기준**
- 한도 도달 시 429, 미만 시 정상 진행을 테스트가 커버.

**위험:** 낮음.

---

## SPEC-AUD-4 · [LOW] JobDetail success-브랜치 삭제 확인 테스트

**근거:** [12 감사] AUD-4. 신규 삭제확인 테스트가 failed 상태만 클릭, success 브랜치(`JobDetail.tsx:158`) 미커버(동일 코드라 저위험).

**대상 파일**
- `apps/web/src/pages/JobDetail.test.tsx`

**변경 설계**
- success job 렌더 → "삭제" 클릭 → `confirmDelete` 취소 시 `deleteJob` 미호출 / 확인 시 호출 검증(failed 케이스와 동일 패턴).

**수용 기준:** success 브랜치 삭제도 확인 게이트가 걸림을 테스트가 증명.

**위험:** 낮음.

---

## SPEC-AUD-5 · [LOW] README 문서 드리프트 정정

**근거:** [12 감사] AUD-5. `README.md:308` "2026-06-11" 이력 표에 옛 `trustProxy: true` 잔존(현 기본 1홉과 불일치, README:298은 이미 정정됨).

**대상 파일**
- `README.md:308`

**변경 설계**
- 해당 이력 셀에 "(2026-07-05 기본 1홉으로 변경 — §운영상 주의 참조)" 주석 추가, 또는 문구를 현행에 맞게 갱신하되 **이력 항목임을 보존**(6/11 시점 기록이므로 완전 삭제보다 '이후 변경' 표기 권장).

**수용 기준:** README에 `trustProxy: true`가 현행 기본값으로 오인될 표기가 없음.

**위험:** 없음(문서).

---

## SPEC-AUD-6 · [LOW] package.sh 가드 정규식 예제 오탐 예방

**근거:** [12 감사] AUD-6. 가드 정규식 `(^|/)\.env(\.|$)`가 `.env.example`도 flag(현재는 tar가 예제를 제외해 무발생이나, 향후 exclude 완화 시 오탐으로 릴리스 파손).

**대상 파일**
- `standalone/scripts/package.sh` (가드 블록, ~라인 57)

**변경 설계**
- 금지 경로 grep 결과에서 예제/샘플을 제외: 파이프에 `| grep -viE '\.(example|sample)$'` 추가, 또는 `.env` 패턴을 예제 접미사 제외로 명시. 실 시크릿(`.env`, `.env.production`)은 여전히 flag.

**수용 기준:** `.env`/`.env.production`은 flag, `.env.example`/`.env.production.example`은 비-flag. 실측(단위 grep)로 확인.

**위험:** 없음.

---

## SPEC-AUD-7 · [INFO] CSP 미사용 아바타 호스트 (선택)

**근거:** [12 감사] AUD-7. CSP `img-src`의 `https://lh3.googleusercontent.com`가 현재 아바타 `<img>` 미렌더라 미사용(과느슨 아님, 무해).

**대상 파일**
- `apps/web/nginx.conf`, `standalone/nginx/mass-doc-to-pdf.conf.in`

**변경 설계 (선택):** (a) 유지 — 향후 Google 아바타 표시 도입 대비, 또는 (b) 제거 후 아바타 도입 시 재추가. **권장: 유지**(정확히 1개 호스트, 리스크 없음). 별도 조치 불요.

**수용 기준:** 결정만. 유지 시 no-op.

---

## 착수 순서 (백로그)
1. **SPEC-AUD-1**(MEDIUM, 유일한 실질 보안) → 2. **AUD-5·AUD-6**(문서/스크립트, 초저위험 빠른 처리) → 3. **AUD-2·AUD-3·AUD-4**(테스트 커버리지 보강) → 4. **AUD-7**(선택/무조치).

각 SPEC 독립 커밋. 구현 후 Fable 5 감사.
