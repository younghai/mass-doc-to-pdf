# P1 품질·백엔드 4건 + 런타임 패키징 (2026-06-11)

P0(크래시 루프·프리플라이트·타임아웃·visibility) 직후 이어진 P1 묶음.

## 1. 영구 실패 분류 — 무의미한 재시도 제거

`failureReason`/`errorMessage`(한국어 안내)를 routes/convert.ts에서
`convert/failure.ts`로 이동해 인라인·큐 경로가 공유. 새
`isPermanentFailure()`: password_protected / corrupt_file /
unsupported_format / quality_gate_failed / too_large는 재시도해도 결과가
같으므로 **3회 × 전체 엔진 체인 재시도를 스킵**하고 즉시 영구 실패 처리.
timeout / engine_error / unknown은 사이드카 다운 등 일시 장애일 수 있어
보수적으로 재시도 유지. 부수 효과: 큐 경로도 이제 사용자 친화 한국어
오류 메시지를 저장 (이전엔 원시 메시지 — 인라인 경로와 불일치).

## 2. 미리보기 사전 생성 + poppler 전환

- 변환 성공 시점에 첫 페이지 PNG를 1회 렌더해 storage에 저장
  (`{userId}/preview/{jobId}.png`) — best-effort, 실패해도 변환은 성공
- `GET /api/jobs/:id/preview.png`: 저장본 우선 서빙(렌더러 프로세스 0회),
  사전 생성 이전의 과거 작업은 1회 렌더 후 저장. **인증·소유·상태 게이트는
  저장본 경로에서도 동일하게 선행** (`readConvertedRaw` 공용화)
- 렌더러: `pdftoppm`(poppler, ~50ms·수 MB) 우선 → LibreOffice(수백 MB,
  1~3초) 폴백. 요청마다 LO를 띄우던 메모리 폭주 경로와, LO가 없는 Docker
  컨테이너에서 preview.png가 항상 503이던 문제를 함께 해소
- 삭제(DELETE /api/jobs/:id)와 보존기간 스윕이 preview 키도 정리

## 3. rhwp 폰트 전달 + maxBuffer

- `RHWP_FONT_PATHS`가 이제 Python rhwp 워커에도 적용 (이전엔 rhwp-cli만):
  ① env 전달, ② CLI와 동일한 cwd `ttfs/hwp/*` 심링크 규약(공용
  `linkFontPaths` 헬퍼로 통합), ③ 워커에서 hasattr 가드로 알려진 폰트 API
  best-effort 시도 후 적용 여부를 stderr JSON으로 보고
- Python rhwp stdio maxBuffer 1MB → 4MB (CLI와 동일) — 경고 다량 출력
  문서가 정상 변환을 죽이던 비대칭 제거

## 4. 런타임 패키징 — 프리플라이트의 완결

- **Docker api/worker 이미지**: python3 + venv(`/opt/rhwp`,
  rhwp-python==0.7.0 고정) + poppler-utils + 나눔/노토 폰트.
  `ENV RHWP_PYTHON=/opt/rhwp/bin/python3` — 새 컨테이너에서 HWP 정밀
  변환(passed 등급)이 기본 동작
- **standalone install-ubuntu.sh**: python3-venv/pip + poppler-utils,
  `/opt/mass-doc-to-pdf/venv`에 rhwp-python==0.7.0 (버전 env 오버라이드
  가능). rhwp는 선택 엔진이므로 pip 실패는 경고만 — 프리플라이트가 제외
  처리하고 `/health/engines`로 확인
- env.example의 `RHWP_PYTHON`이 venv 경로를 가리키도록 갱신

## 검증

```
corepack pnpm -r test       # shared 6, api 133(+1 skip), web 21 — 전부 통과
corepack pnpm -r typecheck  # 통과
python3 -m py_compile rhwp_worker.py / bash -n install-ubuntu.sh — 통과
```

## 운영 메모

- rhwp-python 0.7.0 고정은 품질 재현성용 — 버전 올릴 때 품질 코퍼스
  (`2026-06-11-hwp-quality-corpus.md`) 재실행 후 의도적으로 변경
- 폰트 API 적용 여부는 변환 로그의 stderr JSON(`font paths applied via …`)
  으로 확인 가능
