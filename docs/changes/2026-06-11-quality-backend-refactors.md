# 품질·백엔드 리팩토링 6건 (2026-06-11)

HWP→PDF 품질 분석에서 나온 리팩토링 권장 항목을 반영했다.
테스트 95→108개(+13), 전부 통과.

## 1. 정밀 체인 조기 종료 (`qualityFallback.ts`)

`statusFor`는 실패 attempt가 하나라도 있으면 절대 `passed`를 반환하지 않고,
fallback-grade 엔진은 잘해야 `review`다. 그런데도 체인은 review 결과를 들고
남은 엔진을 끝까지 순회했다 — 수학적으로 무의미한 지연.
`couldStillPass()`: 실패 attempt 존재 또는 남은 엔진이 전부 fallback-grade면
확보한 review PDF를 즉시 반환. 사이드카 다운 같은 격하 환경에서
변환 지연이 엔진 1~2개 분량 줄어든다.

## 2. pdfPageCount 정밀화 (`quality.ts`)

기존 `/Count N` 전역 최댓값은 Outlines 트리의 /Count(북마크 수)까지 집계해
페이지 수를 과대 보고할 수 있었다. `/Type /Pages` 딕셔너리에 인접한
/Count만 양방향 정규식으로 매칭(딕셔너리 경계 `>>`를 넘지 않도록
`[^>]{0,2048}` 바운드). 폴백(`/Type /Page` 카운트)은 유지.

## 3. checks.textChars 수집 + 텍스트-제로 경고 (`quality.ts`)

`pdfTextChars()`: show-text 연산자(Tj/TJ/'/")의 글리프 수 추정.
FlateDecode 스트림은 inflate 후 스캔, hex 문자열은 Identity-H 2바이트
CID 가정(자릿수/4). 정밀 추출이 아니라 **텍스트 레이어가 빈 PDF**
(이미지 전용·인코딩 깨짐) 검출용. rhwp 계열 엔진 + HWP 포맷에서
`pageCount ≥ 1 && textChars === 0`이면 `pdf_text_empty_review` 경고 → review.

## 4. raster 풋건 제거 (`registry.ts`, `config.ts`)

`RHWP_CLI_VISUAL_MODE=raster`는 "not implemented"를 던지는 엔진을 체인에
등록해 모든 변환을 review로 오염시켰다. 미구현 엔진은 등록 자체를 차단:
registry에서 raster 블록 제거, config에서 raster 요청 시 경고 후 pdf로 강제.

## 5. claimNext 사용자별 라운드로빈 (`jobQueue.ts`)

전역 createdAt FIFO는 한 사용자의 1,000건 배치가 다른 사용자의 단건
업로드를 기아 상태로 만들었다. SQLite 윈도우 함수로 사용자별 n번째
작업끼리 인터리브(사용자 내부는 FIFO 유지). 랭크는 queued+running 전체로
계산해 작업이 claim돼도 그 사용자의 순번이 유지된다(전역 FIFO로 붕괴 방지).
만료 락 회수(크래시 복구)는 기존대로 신규 작업보다 우선.

## 6. 사이드카 운영 안정화 (`hwp-sidecar/Dockerfile`, `install-ubuntu.sh`)

- Flask dev server → **gunicorn** (워커 2, `SIDECAR_WORKERS`로 조정;
  타임아웃 180s — 내부 soffice 120s보다 길어야 변환 중 워커 재시작 없음)
- H2Orestart.oxt `releases/latest` → **v0.7.12 고정** (`H2ORESTART_VERSION`
  ARG/env로 오버라이드) — 빌드 재현성
- `unopkg add || true`가 삼키던 설치 실패를 `unopkg list` 검증으로 노출
  (Dockerfile은 빌드 실패, install 스크립트는 exit 1)

## 검증

```
corepack pnpm -r test      # shared 6, api 108(+1 skip), web 21 — 전부 통과
corepack pnpm -r typecheck # 통과
```

## 미반영(다음 단계, P0 백엔드 이슈와 함께)

워커 크래시 루프(processConversion의 storage.get이 try 밖),
엔진 가용성 프리플라이트, h2orestart fetch/builtin execFile 타임아웃,
visibility 5분/15분 모순 — `docs/changes` 분석 보고 참조.
