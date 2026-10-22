# Codex 구현 스펙 — 보안 하드닝 (분석 C: 파서 캡)

> 작성일: 2026-07-08 · 작성: Claude(Fable 5, 설계) · 구현: Codex GPT-5.5 xhigh
> 출처: [15-외부저장소-분석-hwpConverter](15-외부저장소-분석-hwpConverter.md) 항목 **C**(hwpConverter의 XXE/zip-bomb/상한 방어를 우리 파서에 개념 이식).
> 공통 규약은 [10-codex-구현-스펙](10-codex-구현-스펙.md) §공통 규약.

## 배경 — 실제 대상 (grounded)
분석 C는 원래 형제 프로젝트(v1.2) 경로를 참조했으나, **hwptopdf의 실제 신뢰불가 ZIP+XML 파싱 지점**은 builtin 엔진에 임베드된 Python 스크립트다: `apps/api/src/convert/engines/h2orestart.ts`.

확인된 표면(line 기준):
- `text_from_xml(data)` (L37~): `root = ET.fromstring(data)` — 신뢰불가 XML을 `xml.etree.ElementTree.fromstring`으로 파싱. **billion-laughs / 엔티티 확장 DoS**에 취약(내부 DTD `<!ENTITY>` 확장). 현재 `ET.ParseError`만 catch.
- ZIP 리더들 — `read_hwpx`(L104), 그리고 docx/pptx/xlsx 리더(L53/59/64/79)와 `with zipfile.ZipFile(path) as zf`(L315): 전부 `zf.namelist()` + `zf.read(name)`로 **엔트리를 통째 메모리에 로드**. 크기·개수·압축비 **상한 없음** → **zip bomb**(메모리 고갈). HWPX + 모든 OOXML(zip) 공통.
- `extractall` 미사용 → **zip-slip 쓰기 위험은 없음**(엔트리를 명시 이름으로 read만).

즉 이 스펙은 **builtin(텍스트 추출) fallback 엔진**이 신뢰불가 문서를 파싱할 때의 DoS(zip bomb + XML 엔티티 확장)를 막는다. (SEC 리뷰의 zip bomb/XXE 우려에 대응.)

## 대상 파일
- `apps/api/src/convert/engines/h2orestart.ts` (임베드 Python 문자열: `text_from_xml`, `read_hwpx`, office 리더들, `zipfile.ZipFile` 블록)
- (선택) 테스트/모듈화 방식에 따라 신규 `.py` 파일 + 그 테스트

## 변경 설계

### 1. Zip-bomb 상한 (모든 엔트리 읽기에 적용)
`zf.read(name)` 직접 호출을 **상한 강제 헬퍼**로 교체. 예: `safe_read(zf, zinfo)`:
- 읽기 **전** `zinfo.file_size`(비압축) 확인 → `PER_ENTRY_MAX`(예: 64MB) 초과 시 skip/abort.
- 누적 비압축 바이트 추적 → `TOTAL_MAX`(예: 256MB) 초과 시 abort.
- 처리 XML 엔트리 수 상한(예: 256개).
- (선택) 압축비 `file_size/compress_size`가 극단적(예: >200:1)이면 bomb 신호로 abort.
- `zf.infolist()`로 순회하며 캡 검사 후 read. 상한은 상수로 파일 상단에 명시.

리더들(`read_hwpx`, docx/pptx/xlsx)이 모두 이 헬퍼를 쓰도록 통일.

### 2. XML 엔티티 확장 하드닝 (`text_from_xml`)
billion-laughs가 확장되지 못하게 **DTD/엔티티를 차단**:
- **권장(스택 경량, 신규 pip 의존 회피):** 입력 앞부분(예: 첫 4KB)에 `<!DOCTYPE` 또는 `<!ENTITY`가 있으면 파싱 거부(빈 문자열 반환). OWPML/OOXML 정상 문서는 DTD를 쓰지 않으므로 오탐 없음. + zip 캡으로 입력 크기 자체가 유계.
- 대안: `defusedxml.ElementTree.fromstring` 사용(가장 견고하나 **의존성 추가** — builtin fallback의 self-contained 성격과 트레이드오프). Codex가 택1하되 기본은 스택 경량(DOCTYPE 거부).
- 기존 `ET.ParseError` catch 유지.

### 3. 회귀 방지
- 정상 HWPX/OOXML은 기존과 동일하게 텍스트 추출(오탐 없음).
- builtin 엔진의 다른 경로(.hwp OLE `cfb_streams` 등)는 이번 범위 밖(별도), 단 zip 캡 헬퍼가 office 리더에 일관 적용되는지만 확인.

## 수용 기준
- 비압축 크기가 `PER_ENTRY_MAX`를 넘는 엔트리를 가진 HWPX/OOXML은 **깨끗이 실패/skip**(OOM·수 GB 할당 없음).
- `<!DOCTYPE>`+내부 엔티티(billion-laughs) 페이로드 XML은 **확장되지 않음**(파서가 DTD 거부/skip) — CPU·메모리 폭증 없음.
- 정상 문서 텍스트 추출 회귀 없음.
- `pnpm -r typecheck` 0 error + `pnpm -r test` 통과.

## 테스트 조건 (TDD)
임베드 Python은 TS 문자열이라 단위 테스트가 어렵다. **택1(권장 순):**
- **(a) 모듈 추출 + 단위 테스트(권장, 테스트성↑·편집 리스크↓):** 텍스트 추출 Python을 독립 `.py`(예: `apps/api/src/convert/workers/text_extract.py`)로 빼고 h2orestart.ts가 이를 호출. 그 모듈에 pytest/파이썬 단위: `safe_read` 캡, `text_from_xml`의 DOCTYPE 거부·정상 파싱을 **작은 합성 페이로드**로 검증(실제 OOM 금지 — 낮은 캡/작은 bomb로 로직만 검증).
- **(b) 통합 테스트:** `BuiltinOfficeConverter`에 zip-bomb/DOCTYPE HWPX **작은 합성 버퍼**를 넣어 유계 실패를 assert(vitest). 실제 대용량 금지.

RED→GREEN 증거·실측 수치 보고. **실 OOM/행 유발 금지** — 캡을 테스트용으로 낮추거나 캡 로직을 직접 검증.

## 위험
- 임베드 Python 문자열 편집은 이스케이프가 까다로움 → (a) 모듈 추출이 편집 리스크와 테스트성 양쪽에서 유리하나, h2orestart.ts의 호출 방식(현재 인라인 스크립트 실행) 변경을 동반하므로 **builtin 엔진 회귀에 주의**(추출 후에도 기존 텍스트 추출 동작 보존 검증 필수).
- 캡 값은 우리 업로드 상한(`MAX_UPLOAD_BYTES=20MB`)과 정합해야(비압축 256MB 캡은 20MB zip의 정상 팽창은 통과, 극단 bomb만 차단하도록).

## 착수
[10 스펙 형식]과 동일 워크플로: Codex 구현+테스트(미커밋) → Fable5 감사(합성 페이로드로 캡·DTD 동작 확인, 회귀) → 커밋.
