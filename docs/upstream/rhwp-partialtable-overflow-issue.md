# [PDF] 특정 HWP에서 본문 영역 높이가 0(`bottom=0.0`)으로 잡혀 전 페이지 LAYOUT_OVERFLOW → `SVG has an invalid size`로 PDF 변환 실패

> 업스트림 `edwardkim/rhwp`에 제출할 이슈 초안. **게시 전 확인**: 첨부할 `.hwp`에
> 민감/비공개 정보가 없는지 반드시 검토할 것. 아래 로컬 경로는 익명화했음.

## 요약 (Summary)

특정 HWP 문서(31페이지, 표 + 일반 문단 혼합)를 PDF로 내보낼 때, 거의 모든
페이지에서 `LAYOUT_OVERFLOW ... bottom=0.0` 이 발생하고 최종적으로
`PDF 변환 실패 - 렌더링 오류: SVG 파싱 실패: SVG has an invalid size` 로 변환이
실패합니다.

오버플로가 `PartialTable` 한 종류가 아니라 `FullParagraph` / `PartialParagraph`
/ `Table` 까지 **모든 블록 타입**에서 공통적으로 `bottom=0.0` 으로 보고된다는 점이
핵심입니다. 즉 개별 표 분할 문제라기보다 **해당 페이지/본문 영역의 가용 높이가
0으로 계산되는 것**으로 보입니다(가설).

EN: For one HWP file, the layout body region height is computed as `0`
(`bottom=0.0`) on nearly every page, so every block overflows regardless of type,
and PDF export ultimately fails with `SVG has an invalid size`.

## 환경 (Environment)

| 항목 | 값 |
|------|-----|
| rhwp-cli | **v0.7.17** (GitHub release prebuilt binary, macos-aarch64) |
| rhwp-python | **0.8.0** (core `rhwp_core_version()` = `0.7.16`) — 동일 재현 |
| 추가 확인 | rhwp-python 0.7.0 (core 0.7.13) 에서도 동일 |
| OS | macOS 15.3 (arm64) |
| 문서 | HWP, 13,824 bytes, 31페이지 |
| 문서 sha256 | `5fcfbb7e5b33c87ab4da52a07eb47e11c7bd382044133153fa170225e87e4c7a` |

## 재현 방법 (Reproduction)

업스트림 CLI로 바로 재현됩니다:

```console
$ rhwp --version
rhwp v0.7.17

$ rhwp export-pdf 보고서양식.hwp -o out.pdf
문서 로드 완료: 보고서양식.hwp (31페이지)
LAYOUT_OVERFLOW: page=0, sec=0, col=0, para=0, type=PartialTable, first=true, y=7.8, bottom=0.0, overflow=7.8px
LAYOUT_OVERFLOW: page=1, sec=0, col=0, para=0, type=PartialTable, first=true, y=35.3, bottom=0.0, overflow=35.3px
LAYOUT_OVERFLOW: page=2, sec=0, col=0, para=0, type=PartialTable, first=true, y=6.2, bottom=0.0, overflow=6.2px
LAYOUT_OVERFLOW: page=3, sec=0, col=0, para=0, type=PartialTable, first=true, y=6.2, bottom=0.0, overflow=6.2px
LAYOUT_OVERFLOW: page=5, sec=0, col=0, para=2, type=FullParagraph, first=true, y=20.0, bottom=0.0, overflow=20.0px
LAYOUT_OVERFLOW: page=6, sec=0, col=0, para=3, type=FullParagraph, first=true, y=17.3, bottom=0.0, overflow=17.3px
LAYOUT_OVERFLOW: page=7, sec=0, col=0, para=4, type=PartialParagraph, first=true, y=17.3, bottom=0.0, overflow=17.3px
LAYOUT_OVERFLOW: page=8, sec=0, col=0, para=4, type=PartialParagraph, first=true, y=17.3, bottom=0.0, overflow=17.3px
LAYOUT_OVERFLOW: page=10, sec=0, col=0, para=6, type=FullParagraph, first=true, y=20.0, bottom=0.0, overflow=20.0px
LAYOUT_OVERFLOW: page=11, sec=0, col=0, para=7, type=FullParagraph, first=true, y=17.3, bottom=0.0, overflow=17.3px
LAYOUT_OVERFLOW: page=12, sec=0, col=0, para=8, type=FullParagraph, first=true, y=17.3, bottom=0.0, overflow=17.3px
LAYOUT_OVERFLOW: page=13, sec=0, col=0, para=9, type=FullParagraph, first=true, y=17.3, bottom=0.0, overflow=17.3px
LAYOUT_OVERFLOW: page=15, sec=0, col=0, para=11, type=FullParagraph, first=true, y=20.0, bottom=0.0, overflow=20.0px
LAYOUT_OVERFLOW: page=16, sec=0, col=0, para=12, type=FullParagraph, first=true, y=17.3, bottom=0.0, overflow=17.3px
LAYOUT_OVERFLOW: page=17, sec=0, col=0, para=13, type=FullParagraph, first=true, y=16.0, bottom=0.0, overflow=16.0px
LAYOUT_OVERFLOW: page=18, sec=0, col=0, para=14, type=FullParagraph, first=true, y=16.0, bottom=0.0, overflow=16.0px
LAYOUT_OVERFLOW: page=20, sec=0, col=0, para=16, type=FullParagraph, first=true, y=20.0, bottom=0.0, overflow=20.0px
LAYOUT_OVERFLOW: page=21, sec=0, col=0, para=17, type=FullParagraph, first=true, y=17.3, bottom=0.0, overflow=17.3px
LAYOUT_OVERFLOW: page=22, sec=0, col=0, para=18, type=FullParagraph, first=true, y=17.3, bottom=0.0, overflow=17.3px
LAYOUT_OVERFLOW: page=23, sec=0, col=0, para=19, type=FullParagraph, first=true, y=17.3, bottom=0.0, overflow=17.3px
LAYOUT_OVERFLOW: page=25, sec=0, col=0, para=21, type=FullParagraph, first=true, y=20.0, bottom=0.0, overflow=20.0px
LAYOUT_OVERFLOW: page=26, sec=0, col=0, para=22, type=FullParagraph, first=true, y=17.3, bottom=0.0, overflow=17.3px
LAYOUT_OVERFLOW: page=27, sec=0, col=0, para=23, type=FullParagraph, first=true, y=17.3, bottom=0.0, overflow=17.3px
LAYOUT_OVERFLOW: page=28, sec=0, col=0, para=24, type=FullParagraph, first=true, y=17.3, bottom=0.0, overflow=17.3px
LAYOUT_OVERFLOW: page=29, sec=0, col=0, para=25, type=FullParagraph, first=true, y=17.3, bottom=0.0, overflow=17.3px
LAYOUT_OVERFLOW: page=30, sec=0, col=0, para=26, type=Table, first=true, y=36.4, bottom=0.0, overflow=36.4px
오류: PDF 변환 실패 - 렌더링 오류: SVG 파싱 실패: SVG has an invalid size
```

rhwp-python 에서도 동일하게 재현됩니다(같은 오버플로 로그 후):

```python
import rhwp
doc = rhwp.parse("보고서양식.hwp")
doc.export_pdf("out.pdf")
# ValueError: PDF conversion failed: SVG 파싱 실패: SVG has an invalid size
```

## 관찰 / 가설 (Analysis)

- 모든 `LAYOUT_OVERFLOW` 라인의 공통점은 **`bottom=0.0`** 입니다. 표(`PartialTable`,
  `Table`)뿐 아니라 일반 문단(`FullParagraph`, `PartialParagraph`)도 동일하게
  `bottom=0.0` 으로 잡힙니다.
- `bottom`(본문 영역 하단 한계)이 0 이면 어떤 블록이든 `y > 0` 인 순간 오버플로로
  판정됩니다. 따라서 이는 특정 표 분할 로직이 아니라 **페이지/섹션의 본문 가용
  높이 계산이 0이 되는 상위 원인**으로 추정됩니다 (예: 페이지 높이/여백 파싱,
  머리말·꼬리말·바탕쪽 영역 차감 후 본문 높이가 음수→0 클램프 등).
- 최종 에러 `SVG has an invalid size` 는 본문 높이 0 의 귀결(높이 0/음수 캔버스로
  SVG 생성)로 보입니다.
- 같은 변환 파이프라인에서 다른 일반 HWP/HWPX 문서들은 정상 변환됩니다. 이 문서만
  위 증상을 보입니다.

## 기대 동작 (Expected)

- 본문 영역 높이가 정상적으로 계산되어 31페이지가 정상 페이지네이션되고 PDF로
  내보내져야 합니다(또는 최소한 `SVG has an invalid size` 로 전체 실패하지 않고
  유효한 PDF를 생성).

## 첨부 (Attachments)

- [ ] `보고서양식.hwp` (13,824 bytes, sha256 `5fcfbb7e…`) — **게시 시 첨부**.
      공개 리포지토리이므로 민감정보 포함 여부 확인 후 업로드.
- 필요 시 `rhwp export-render-tree` / `to_ir_json` 출력(페이지·섹션 geometry)도
  제공 가능.

## 참고 (Context)

- 유사 과거 이슈들은 대부분 개별 문서의 표 분할로 closed 되었으나(#1073, #101,
  #1022 등), 본 건은 **모든 블록 타입에 걸친 `bottom=0.0`** 라는 점에서 본문 영역
  높이 산정 자체의 문제로 보입니다.
