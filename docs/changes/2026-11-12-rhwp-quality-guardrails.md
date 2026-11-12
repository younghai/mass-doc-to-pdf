# rhwp 품질 가드레일: 범프 게이트·CI 엔진 스모크·판정 래더 + 바닥 8KB 재보정

2026-11-12. v0.9.0 범프에서 발견된 사고 클래스(범프가 출력 특성을 바꾸고
품질 휴리스틱 보정이 조용히 무효화 — PR #43)의 재발 방지 구조를 깔았다.
원칙: 반복 교훈은 문서가 아니라 구조로.

## 사고 클래스 재정리

1. 휴리스틱 보정값(RHWP_CLI_MIN_PDF_BYTES)이 rhwp 버전의 출력 크기 분포에
   암묵 결합 — 범프가 분포를 바꾸면 보정이 부패.
2. 범프 검증이 수동 관례(코퍼스 실측 5회 선례)라 세션마다 재구현.
3. CI에 실변환 신호 없음 — 이미지 안 엔진 생존(freetype 워크어라운드
   포함)이 빌드 성공으로만 추정됨.

## 추가된 구조

### 1. 범프 게이트 — `standalone/scripts/rhwp-bump-gate.sh`
- `fetch <dir>`: sha256 핀된 픽스처 4종 다운로드·검증
  (`fixtures/rhwp/manifest.json`, 상류 edwardkim/rhwp MIT 테스트 자산).
  계급: 희소 노트(사고 계급)·법령 텍스트·다단 HWPX·중형 고시문서.
- `smoke <dir> <bin>`: 단일 엔진 전 픽스처 변환 게이트(페이지>0, 오버플로는
  경고 — 프로덕션 체인 폴백이 설계된 처리이므로).
- `compare <dir> <old> <new> --json`: 양 버전 변환 비교 — 페이지 수 변경,
  오버플로 증가, 최소 정상 출력이 바닥×1.25 미만으로 하락(CALIBRATION)시
  exit 1. baseline JSON 산출.
- 실측 승인 테스트: v0.8.7 vs v0.9.0 비교에서 이번 주 사고를 재현해
  CALIBRATION 경고를 정상 발화시킴 + standards.hwp 오버플로 1→0(개선)도
  포착.

### 2. CI 엔진 스모크 잡 (docker-build.yml `engine-smoke`)
- api 이미지 빌드 → 컨테이너 안에서 픽스처 4종을 `/opt/rhwp/bin/python3`
  워커로 실변환 → PDF 매직 확인. **이미지 내 엔진 import·freetype
  워크어라운드의 최초 CI 검증** (그동안 빌드 성공만으로 추정).
- 트리거: Dockerfile·워커·매니페스트·게이트 스크립트 변경 시.

### 3. 판정 래더 테스트 (quality.test.ts)
- (bytes)→status 경계 5단계를 측정 앵커와 함께 잠금: 5KB/7,999B→review,
  8,200B/15,888B(v0.9.0 실측 최소)/22,600B(코퍼스 실측 최소)→passed.
  바닥이 움직이면 앵커도 함께 움직여야 하므로 diff에서 보정 이동이 드러남.

### 4. 바닥 16KB → 8KB 재보정 (게이트의 첫 포획)
- #43에서 16KB로 맞췄으나 게이트 픽스처(더 넓은 계급) 실측에서 정상 최소가
  15,888B(CLI v0.9.0)·16,261B(운영 rhwp-python 0.8.1)로 **16KB도 여전히
  오발**임이 발견됨 — 희소 노트 계급이 우리 코퍼스에 없었던 것.
- 8KB = 측정 정상 최소의 절반, 퇴화 출력(수 KB)과 2배 마진. 페이지당
  4KB 규칙·textChars 규칙은 무변경.

## 다음 범프 절차 (구조화됨)

1. `rhwp-bump-gate.sh fetch` → `compare` (구→신) — CALIBRATION 경고 없는지
2. 경고 시: quality.ts 바닥 + 래더 앵커 + 게이트 GATE_FLOOR_BYTES를
   baseline JSON 근거로 함께 이동 (세 곳 동기가 diff에 보임)
3. 기존: 휠 freetype 검사(rhwp-python 범프 시)·코퍼스·시각 회귀는 유지
