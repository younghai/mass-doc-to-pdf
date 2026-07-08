# 외부 저장소 분석 — vsdn/hwpConverter → hwptopdf 적용 제안

> 작성일: 2026-07-08 · 작성: Claude(Fable 5, 분석/기획) · 대상: [github.com/vsdn/hwpConverter](https://github.com/vsdn/hwpConverter)
> 목적: 외부 HWP 변환기를 분석하고, 우리 서비스(hwptopdf: HWP/HWPX/Office→PDF + 품질 게이트)에 **실제로 도움되는 부분**만 골라 우선순위·통합 방식·리스크와 함께 제안.

## 요약

`hwpConverter`는 **NSoftware INC.의 Apache-2.0 Java 라이브러리**로, HWP·HWPX·ODT·Markdown 간 변환과 배포용(DRM) HWP 생성을 제공한다(192개 `.java`, 핵심 클래스만 3,700+ LOC). 핵심 엔진은 `kr.dogfoot:hwplib`/`hwpxlib`/`hwp2hwpx`(역시 Apache-2.0) + Apache POI.

**우리 서비스와의 관계 — 냉정한 결론:**
- ⚠️ **직접 PDF 변환은 없다.** hwpConverter는 HWP↔HWPX↔ODT↔MD 변환기이지 →PDF 엔진이 아니다. 따라서 우리 엔진 체인의 드롭인 대체가 **아니다**.
- ⚠️ **스택 불일치.** 우리는 Node/Fastify + Python, 이건 Java. 채택하려면 **Java 사이드카**(기존 hwp-sidecar처럼)로 감싸거나 **개념만 이식**해야 한다.
- ✅ **그럼에도 3~4개 지점은 실질 가치가 크다** — 특히 우리 차별점인 **품질 게이트**를 소스-측 검증으로 강화하는 것, LibreOffice에 더 깨끗한 입력을 주는 **HWP→ODT 브리지**, 그리고 **v1.2 AI 문서생성**의 MD→HWPX.

**한 줄 제안:** 통째로 도입하지 말고, **(1) 소스 손상/스펙 검증을 품질 게이트에 연결**, **(2) HWP→ODT 브리지 엔진을 체인에 추가 실험**, **(3) 파서 보안 캡을 우리 Python HWPX 처리 체크리스트로 이식**, **(4) MD→HWPX는 v1.2로 크로스 적용** — 4개를 선별 채택한다.

---

## 1. 저장소 능력 개요

| 능력 | 내용 | 구현 기반 |
|---|---|---|
| HWPX ↔ HWP | HWPX→HWP는 자체 바이너리 writer, HWP→HWPX는 hwplib/hwp2hwpx + 후처리 | `hwplib/`, `hwp2hwpx` |
| HWP/HWPX ↔ ODT | 양방향, 전용 mapper·OdtWriter·StyleRegistry (MD 미경유 직접변환) | `newfeature/hwp2odt`, `hwpx2odt` |
| HWP/HWPX ↔ Markdown | MD 추출 + MD→구조 변환 **4전략**(Rich/Direct/HwpxNative/HwpxImage) 폴백 | `mdlib/` |
| 배포용(DRM) HWP | AES-128 ViewText 암호화 + 복사/인쇄 방지 플래그 | `writer/DistributionWriter` |
| FormatSniffer | 확장자 무관 **시그니처 기반 포맷 판별**(HWP5/HWPX/ODT/MD/UNKNOWN) | `newfeature/FormatSniffer` |
| 파서 보안 하드닝 | XXE 차단·zip bomb 차단·중첩 깊이 상한·payload 상한·문단 텍스트 상한·자기덮어쓰기 차단 | reader/writer 전반 (README §4 예외 계약) |
| 검증/진단 도구 | `HwpSpecValidator`(파일헤더·스펙), `BinaryValidator`/`RecordCompareTest`(레코드 정합), **`DamageWarningTest`(한글 "손상 경고" 유발 콘텐츠 탐지)**, `StrictValidator` 등 다수 | `test/` |
| 배치 | `BatchResult`(성공/실패 카운트 + `failDetails`), `BatchRunner` | — |

라이선스: **Apache-2.0** (저장소 + 모든 핵심 의존성). 상업적 사용·수정·재배포 가능, **저작권/NOTICE 고지 의무**만 있음.

---

## 2. hwptopdf 적합성 매트릭스

> 가치 = 우리 제품(특히 품질 게이트 차별점·변환 충실도)에 주는 임팩트. 비용 = 통합 난이도(Java 사이드카/이식).

| # | 아이디어 | 가치 | 통합 비용 | 판정 |
|---|---|---|---|---|
| A | **소스 손상·스펙 검증 → 품질 게이트 신호 강화** | ★★★ | 중(Java 사이드카) | **채택 권장** |
| B | **HWP→ODT 브리지 엔진**(→LibreOffice→PDF) | ★★★ | 중~고(사이드카+체인) | **실험 권장(PoC)** |
| C | **파서 보안 캡 체크리스트 이식**(Python HWPX 처리) | ★★☆ | 저(개념 이식) | **채택 권장** |
| D | **MD→HWPX 4전략** → v1.2 AI 문서생성 | ★★☆ | 중(별 프로젝트) | 크로스적용 검토 |
| E | FormatSniffer 개념 → 업로드 판별 강화 | ★☆☆ | 저(개념) | 소규모 반영 |
| F | 배포용(DRM) HWP | ★★☆(프리미엄) | 고 | 로드맵 후보 |
| G | HWP↔HWPX 정규화(→rhwp 입력) | ★☆☆ | 중 | 조건부(엔진 편차 시) |

---

## 3. 우선순위 제안 (상세)

### A. 소스 손상·스펙 검증을 품질 게이트에 연결 — 가장 강한 적합
**왜:** 우리 품질 게이트(passed/review/failed)는 현재 **출력 PDF 휴리스틱**(페이지 수·바이트·글리프 수·엔진 등급)에만 의존한다([convert/quality.ts]). hwpConverter의 검증기는 **소스 HWP 구조**를 본다 — `DamageWarningTest`는 한글이 "이 문서에는 손상을 줄 수 있는 내용이…" 경고를 띄울 콘텐츠를 탐지하고, `HwpSpecValidator`는 파일헤더/스펙 위반을, `BinaryValidator`/`RecordCompareTest`는 레코드 정합/라운드트립 손실을 잡는다.
**제안:** 변환 **전(preflight)** 소스 문서를 검증해 신호를 추출 → 우리 리포트의 `warnings`/`status`에 반영. 예: 소스가 손상 경고 대상이거나 스펙 비표준이면 성공이라도 **review**로 강등. 이는 "출력만 보는" 현재 게이트를 **소스+출력 양면**으로 만들어 차별점을 실제로 강화한다.
**통합:** hwpConverter를 Java 사이드카(`hwp-validate`)로 감싸 `POST /validate` → `{ damageWarning, specViolations[], recordMismatches }` JSON 반환. 우리 `preflight.ts`/`quality.ts`가 소비.

### B. HWP→ODT 브리지 엔진 (→LibreOffice→PDF) — 충실도 실험
**왜:** 우리 체인의 H2Orestart/LibreOffice는 **LibreOffice 자체 HWP import가 약하다**(표·이미지·각주 편차 원인). hwpConverter의 전용 HWP→ODT 변환기(mapper·StyleRegistry 기반)는 LibreOffice에 **훨씬 깨끗한 ODT**를 줄 수 있다 → `HWP→(hwpConverter)ODT→(LibreOffice)PDF` 경로가 LibreOffice 직접 HWP→PDF보다 충실도가 높을 가능성.
**제안:** 새 엔진 후보로 **PoC**: 동일 코퍼스로 (기존)LibreOffice-HWP vs (신규)hwpConverter-ODT→LibreOffice 품질 비교(우리 품질 리포트로 계량). 이기면 `registry`에 `hwp-odt-bridge` 엔진으로 편입(rhwp 다음, H2Orestart 앞 등 위치는 코퍼스 결과로).
**주의:** rhwp가 이미 정밀 HWP 엔진이므로, **rhwp가 약한 케이스**(특정 표/도형)에서만 이득일 수 있음 → 코퍼스 비교가 채택 전제.

### C. 파서 보안 캡 체크리스트 이식 — 저비용 보안 강화
**왜:** hwpConverter는 HWPX(=ZIP+XML) 파싱에 **XXE 차단·zip bomb 차단·중첩 깊이 상한·payload 상한·문단 텍스트 상한**을 건다(README §4). 우리 보안 리뷰([01-개발자-리뷰] SEC 파트)도 Python HWPX 처리의 zip slip/bomb/XXE를 우려했다.
**제안(코드 이식 아님, 개념):** 우리 `scripts/office/hwpx_utils.py`(unpack/pack)와 XML 파싱에 동일 방어를 적용하는 **하드닝 체크리스트**를 만든다: ① XML 파서 XXE off(entity/DOCTYPE 비활성), ② 압축 해제 시 총 크기·파일 수·압축비 상한(zip bomb), ③ 경로 정규화(zip slip), ④ 중첩/텍스트 상한. → 별도 SPEC-AUD 형태로 Codex 구현 가능.

### D. MD→HWPX 4전략 → v1.2(hwp_demo) AI 문서생성 크로스적용
**왜:** 형제 프로젝트 v1.2(hwp_demo)는 LLM으로 콘텐츠를 만들어 **HWPX로 생성**한다. hwpConverter의 `MdStructureConverter`(Rich→Direct→HwpxNative→HwpxImage 폴백)는 성숙한 **MD→HWPX 구조 변환기**다. "LLM→markdown→HWPX" 파이프라인에 직접 유용.
**제안:** hwptopdf 범위 밖이지만 **포트폴리오 기회**로 기록. v1.2가 자체 build_hwpx.py 대신 이 변환기(사이드카)를 쓰면 서식 충실도↑.

### E. FormatSniffer 개념 → 업로드 판별 강화 (소규모)
우리 `detect/detectFormat.ts`는 확장자+매직바이트를 본다. FormatSniffer는 **확장자 무관 시그니처 판별**(ODT/MD 포함). 개념만 반영해 "확장자와 실제 포맷 불일치"를 명시 경고로 처리(현재 [DEV-08] 레거시 포맷 조용한 실패와도 연결).

### F. 배포용(DRM) HWP — 프리미엄 기능 후보
AES-128 암호화 + 복사/인쇄 방지 HWP 생성. 우리 PDF 초점과는 다르나, "문서 운영 플랫폼" 확장([PO] Meetings 전략 논의) 시 **보안 배포** 유료 기능 후보. 지금은 로드맵 메모.

---

## 4. 통합 방식 옵션

| 방식 | 설명 | 적합 아이디어 |
|---|---|---|
| **Java 사이드카** | hwpConverter를 얇은 HTTP 서비스로 감싸 우리 hwp-sidecar 옆에 배치(compose 서비스 추가). 기존 sidecar 패턴 재사용 | A(검증), B(ODT 브리지) |
| **개념 이식** | 코드가 아니라 방어/판별 로직을 우리 Python/TS로 재구현 | C(보안 캡), E(sniffer) |
| **크로스 프로젝트** | 별 저장소(v1.2)에서 채택 | D(MD→HWPX) |

**권장:** A·B는 **하나의 Java 사이드카**(`hwp-tools`)로 묶어 `/validate` + `/to-odt` 엔드포인트를 노출하면 인프라 추가가 1개로 끝난다. C·E는 코드 이식(사이드카 불필요).

---

## 5. 리스크·주의

1. **Java 런타임 추가.** 사이드카 = JVM 컨테이너 추가(이미지 크기·메모리·운영 표면↑). 우리는 현재 Node/Python. → A/B만이 이를 정당화할 만큼 가치 있는지 코퍼스로 검증 후 결정.
2. **라이선스/고지.** Apache-2.0 → 채택 시 **NOTICE·저작권 고지 의무**(NSoftware, neolord0/hwplib). 배포물에 attribution 포함 필요. 코드 직접 포함이 아니라 사이드카(별 프로세스)면 고지 부담이 더 가볍다.
3. **유지보수·버전.** 192파일·특정 hwplib 버전에 결합. 우리가 포크/벤더링하면 업스트림 추적 부담. 사이드카로 **버전 핀 고정** 권장.
4. **중복.** rhwp가 이미 정밀 HWP를 처리 — B(ODT 브리지)는 rhwp가 약한 구간에서만 이득. **코퍼스 비교 없이 채택 금지.**
5. **PDF 아님.** 어떤 것도 우리 최종 산출(PDF)을 직접 만들지 않는다 — 항상 우리 렌더 단계(LibreOffice/rhwp)와 조합해야 한다.

---

## 6. 권장 결론 + 다음 단계

**결론:** 통째 도입은 부적합(Java·비-PDF). 그러나 **품질 게이트 강화(A)**, **충실도 실험(B)**, **보안 하드닝(C)** 은 우리 제품 가치에 직결되어 **선별 채택 권장**. D는 v1.2 크로스, E/F는 소규모/로드맵.

**착수 순서 제안(가치×저비용):**
1. **C(보안 캡 이식)** — 저비용·즉효. `hwpx_utils.py` 하드닝 SPEC로 바로 Codex 구현 가능(사이드카 불필요).
2. **A(소스 검증 사이드카)** — PoC: `DamageWarningTest`/`HwpSpecValidator` 신호를 `/validate`로 노출 → 품질 게이트 연결. 차별점 강화 효과 큼.
3. **B(HWP→ODT 브리지)** — 코퍼스 비교 PoC 후 조건부 편입.
4. **D/E/F** — 각 프로젝트/로드맵 맥락에서 별도 판단.

**결정 필요(사용자):** ① Java 사이드카 추가를 감내할지(A/B의 전제) ② 먼저 C(보안, 사이드카 불필요)만 착수할지. 승인 주시면 해당 항목을 [10/13/14 스펙 형식](10-codex-구현-스펙.md)으로 상세화해 Codex에 넘긴다.

> 분석 근거: 클론본(`/tmp/hwpConverter-analysis`, 분석 후 삭제)의 README·소스 트리·검증기 grep. 코드 자체는 채택 결정 전까지 우리 저장소에 포함하지 않음.
