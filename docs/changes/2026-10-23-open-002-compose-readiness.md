# OPEN-002 해소: docker-compose MinIO 준비 게이팅 + compose CI 검증

2026-10-23. E2E 간헐 타임아웃(OPEN-002)의 원인인 compose 시작 순서 경쟁을
제거했다.

## 원인

`api` 서비스의 `depends_on`이 리스트 형식(`depends_on: [minio, createbucket,
…]`)이었다. 리스트 형식은 컨테이너 **시작**만 보장한다. MinIO 초기화가 느린
환경(CI 러너 등)에서는:

1. `minio` 컨테이너는 시작됐지만 API 포트가 아직 준비 전
2. `createbucket`(버킷 생성 원샷)도 완료 전
3. `api`가 부팅하며 즉시 S3 클라이언트로 접근 → 간헐적 실패/타임아웃

## 변경

- `minio` 서비스에 표준 `/minio/health/live` healthcheck 추가
  (dev: 2s 간격 × 30회, prod: 5s × 12회).
- `createbucket`이 `minio: service_healthy` 대기(기존 mc 재시도 루프는
  이중 안전망으로 유지).
- `api`가 `minio: service_healthy` + `createbucket:
  service_completed_successfully`(버킷 생성 완료)까지 대기.
  `gotenberg`/`hwp-sidecar`는 기존대로 시작 대기만 — 엔진 프리플라이트가
  불가용 엔진을 체인에서 제거하므로 준비 게이팅이 불필요.
- `docker-compose.yml`·`docker-compose.prod.yml` 양쪽 동일 적용.
- Docker Build 워크플로에 `docker compose config -q` 검증 잡(compose-validate)
  추가 + `docker-compose.prod.yml`을 paths 트리거에 포함 — 이후 compose
  회귀(depends_on/healthcheck/인터폴레이션 오류)가 빌드 전에 잡힌다.

## 검증

- 로컬: YAML 파싱 + 서비스 그래프 구조 확인(이 머신에 Docker CLI가 없어
  데몬 검증은 CI에 위임).
- CI: 이 PR의 compose-validate 잡이 두 파일 모두 `config --quiet` 통과하는
  것으로 증명. 이미지 빌드 3종도 동일 워크플로에서 재확인.

E2E 전체 실행(브라우저 스택 기동)은 Docker 환경에서 수동 검증 대상 —
`docker compose up -d --build && cd e2e && RUN_E2E=1 pnpm test`.
