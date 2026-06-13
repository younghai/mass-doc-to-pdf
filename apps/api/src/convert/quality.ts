import { inflateSync } from "node:zlib";
import type {
  ConversionMode,
  DocFormat,
  QualityAttempt,
  QualityGrade,
  QualityReport,
  QualityStatus,
} from "@hwptopdf/shared";

const PDF_PAGE_RE = /\/Type\s*\/Page\b/g;
// Only count /Count when it belongs to a /Type /Pages dictionary. PDF dictionary
// keys appear in arbitrary order, so match both directions. The [^>]{0,2048} bound
// keeps the match inside a single dictionary (it cannot cross the `>>` terminator)
// and caps backtracking so a pathological buffer cannot blow up the regex engine.
const PAGES_COUNT_FWD_RE = /\/Type\s*\/Pages\b[^>]{0,2048}?\/Count\s+(\d+)/g;
const PAGES_COUNT_BWD_RE = /\/Count\s+(\d+)[^>]{0,2048}?\/Type\s*\/Pages\b/g;
const RHWP_CLI_MIN_PDF_BYTES = 32 * 1024;
const RHWP_CLI_MIN_BYTES_PER_PAGE = 4 * 1024;

export function reportObjectKey(userId: string, jobId: string): string {
  return `${userId}/report/${jobId}.json`;
}

export function previewObjectKey(userId: string, jobId: string): string {
  return `${userId}/preview/${jobId}.png`;
}

export function pdfPageCount(pdf: Buffer): number | undefined {
  const text = pdf.toString("latin1");
  // /Count from the /Type /Pages node works for PDF 1.5+ XRef-stream PDFs where
  // /Type /Page objects are compressed and invisible to the fallback regex below.
  // Scoping to /Pages avoids over-counting the /Count carried by the Outlines tree
  // (which reports the number of bookmarks). Incrementally updated PDFs can carry
  // several /Pages nodes; the document root holds the highest /Count.
  let maxCount = 0;
  for (const re of [PAGES_COUNT_FWD_RE, PAGES_COUNT_BWD_RE]) {
    for (const m of text.matchAll(re)) {
      const n = Number(m[1]);
      if (n > maxCount) maxCount = n;
    }
  }
  if (maxCount > 0) return maxCount;
  // Fallback: count /Type /Page objects — reliable for PDF ≤ 1.4 without XRef streams.
  const count = text.match(PDF_PAGE_RE)?.length ?? 0;
  return count > 0 ? count : undefined;
}

// Escaped pairs (\\( \\) \\\\ …) are removed before measuring literal-string length
// so a backslash escape counts as the single glyph it renders, not two bytes.
const PDF_ESCAPE_RE = /\\[\s\S]/g;
const PDF_STREAM_RE = /stream\r?\n([\s\S]*?)endstream/g;
// Two defenses make these operator regexes safe on hostile/binary PDF bytes:
//  1. Mutually exclusive alternation branches — the `\\[\s\S]` (escaped pair)
//     branch owns the backslash and the bracket-exclusion branch also excludes
//     it (`[^\\]`, `[^\]\\]`). Overlapping branches make the lazy group
//     ambiguous and backtrack *exponentially* (a real 656KB rhwp PDF pegged a
//     CPU for minutes here).
//  2. A bounded repetition (`{0,GLYPH_RUN_MAX}?`) instead of `*?`. Without it a
//     long run of unmatched `[`/`(` is still *quadratic* — every start position
//     rescans to end. Capping the run keeps each attempt O(GLYPH_RUN_MAX), so
//     the whole scan is linear. Real show-text operands are far shorter.
const GLYPH_RUN_MAX = 8192;
// Literal-string show operators: (...) Tj | (...) ' | (...) "
const LITERAL_SHOW_RE = new RegExp(`\\(((?:\\\\[\\s\\S]|[^\\\\]){0,${GLYPH_RUN_MAX}}?)\\)\\s*(?:Tj|'|")`, "g");
// TJ array: [ ... ] TJ — kerning array mixing literal (...) and <hex> chunks.
const TJ_ARRAY_RE = new RegExp(`\\[((?:\\\\[\\s\\S]|[^\\]\\\\]){0,${GLYPH_RUN_MAX}}?)\\]\\s*TJ`, "g");
const TJ_LITERAL_RE = new RegExp(`\\(((?:\\\\[\\s\\S]|[^\\\\]){0,${GLYPH_RUN_MAX}}?)\\)`, "g");
const TJ_HEX_RE = /<([0-9A-Fa-f\s]*)>/g;
// Hard ceiling on how much of each buffer the operator regexes scan, as a final
// backstop on top of the per-match bound above.
const MAX_GLYPH_SCAN_BYTES = 2 * 1024 * 1024;
// Standalone hex-string show: <hex> Tj
const HEX_SHOW_RE = /<([0-9A-Fa-f\s]*)>\s*Tj/g;

function literalGlyphCount(literal: string): number {
  // Drop escape sequences so each rendered glyph is counted once.
  return literal.replace(PDF_ESCAPE_RE, "x").length;
}

function hexGlyphCount(hex: string): number {
  // CJK PDFs from rhwp/Hancom use Identity-H with 2-byte CIDs, so a hex run of N
  // digits encodes floor(N / 4) glyphs. Whitespace inside the run is ignored.
  const digits = hex.replace(/\s+/g, "").length;
  return Math.floor(digits / 4);
}

function countGlyphs(scanned: string): number {
  const content = scanned.length > MAX_GLYPH_SCAN_BYTES ? scanned.slice(0, MAX_GLYPH_SCAN_BYTES) : scanned;
  let total = 0;
  for (const m of content.matchAll(LITERAL_SHOW_RE)) {
    total += literalGlyphCount(m[1]);
  }
  for (const arr of content.matchAll(TJ_ARRAY_RE)) {
    const inner = arr[1];
    for (const lit of inner.matchAll(TJ_LITERAL_RE)) {
      total += literalGlyphCount(lit[1]);
    }
    for (const hex of inner.matchAll(TJ_HEX_RE)) {
      total += hexGlyphCount(hex[1]);
    }
  }
  for (const m of content.matchAll(HEX_SHOW_RE)) {
    total += hexGlyphCount(m[1]);
  }
  return total;
}

// Estimates the number of glyphs drawn by show-text operators (Tj/TJ/'/"). This is
// a heuristic glyph count, NOT precise text extraction: it is only used to detect a
// PDF whose text layer is empty (image-only output or broken encoding).
export function pdfTextChars(pdf: Buffer): number | undefined {
  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") return undefined;

  const buffers: string[] = [pdf.toString("latin1")];
  // Inflate each FlateDecode content stream so glyphs in compressed streams count
  // too. Non-FlateDecode streams throw and are skipped.
  for (const m of pdf.toString("latin1").matchAll(PDF_STREAM_RE)) {
    const start = m.index! + m[0].indexOf(m[1]);
    const raw = pdf.subarray(start, start + m[1].length);
    try {
      buffers.push(inflateSync(raw).toString("latin1"));
    } catch {
      // Not a FlateDecode stream (or corrupt) — ignore.
    }
  }

  let total = 0;
  for (const content of buffers) {
    total += countGlyphs(content);
  }
  return total;
}

export function gradeForEngine(engine: string): QualityGrade {
  switch (engine) {
    case "rhwp":
    case "rhwp-cli-pdf":
    case "rhwp-cli-raster":
    case "hancom":
    case "aspose":
      return "good";
    case "h2orestart":
    case "gotenberg":
      return "acceptable";
    case "builtin-office":
      return "fallback";
    default:
      return "fallback";
  }
}

function statusFor(input: {
  readonly grade: QualityGrade;
  readonly attempts: readonly QualityAttempt[];
  readonly warnings: readonly string[];
  readonly pageCount: number | undefined;
}): QualityStatus {
  if (input.grade === "failed") return "failed";
  if (input.grade === "fallback") return "review";
  if (input.attempts.some((attempt) => attempt.status === "failed")) return "review";
  if (input.warnings.length > 0) return "review";
  if (!input.pageCount) return "review";
  return "passed";
}

function recommendedAction(status: QualityStatus, grade: QualityGrade): string {
  if (status === "passed") return "검수 우선순위 낮음";
  if (grade === "fallback") return "원본과 첫 페이지를 비교하고 정밀 변환으로 재시도하세요.";
  if (status === "failed") return "파일 상태와 암호 여부를 확인한 뒤 재시도하세요.";
  return "표, 이미지, 각주가 많은 문서는 원본 대조 검수를 권장합니다.";
}

function isHwpFormat(format: DocFormat): boolean {
  return format === "hwp";
}

function isRhwpQualityRiskEngine(engine: string): boolean {
  return engine === "rhwp" || engine === "rhwp-cli-pdf" || engine === "rhwp-cli-raster";
}

function intrinsicWarnings(input: {
  readonly format: DocFormat;
  readonly selectedEngine: string;
  readonly pdfBytes: number;
  readonly pageCount: number | undefined;
  readonly textChars: number | undefined;
}): readonly string[] {
  if (!isHwpFormat(input.format) || !isRhwpQualityRiskEngine(input.selectedEngine)) return [];

  const warnings: string[] = [];
  if (input.pdfBytes < RHWP_CLI_MIN_PDF_BYTES) {
    warnings.push("rhwp_small_pdf_review");
  }
  if (input.pageCount && input.pdfBytes / input.pageCount < RHWP_CLI_MIN_BYTES_PER_PAGE) {
    warnings.push("rhwp_low_bytes_per_page_review");
  }
  if (input.pageCount && input.pageCount >= 1 && input.textChars === 0) {
    warnings.push("pdf_text_empty_review");
  }
  return warnings;
}

export function buildQualityReport(input: {
  readonly jobId: string;
  readonly filename: string;
  readonly format: DocFormat;
  readonly mode?: ConversionMode;
  readonly selectedEngine: string;
  readonly pdf: Buffer;
  readonly sourceBytes: number;
  readonly attempts: readonly QualityAttempt[];
  readonly warnings: readonly string[];
  readonly createdAt?: string;
}): QualityReport {
  const pageCount = pdfPageCount(input.pdf);
  const textChars = pdfTextChars(input.pdf);
  const grade = gradeForEngine(input.selectedEngine);
  const warnings = [
    ...input.warnings,
    ...intrinsicWarnings({
      format: input.format,
      selectedEngine: input.selectedEngine,
      pdfBytes: input.pdf.byteLength,
      pageCount,
      textChars,
    }),
  ];
  const status = statusFor({
    grade,
    attempts: input.attempts,
    warnings,
    pageCount,
  });
  return {
    version: 1,
    jobId: input.jobId,
    filename: input.filename,
    format: input.format,
    mode: input.mode,
    selectedEngine: input.selectedEngine,
    grade,
    status,
    recommendedAction: recommendedAction(status, grade),
    checks: {
      pdfBytes: input.pdf.byteLength,
      pageCount,
      sourceBytes: input.sourceBytes,
      textChars,
    },
    attempts: input.attempts,
    warnings,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function normalizeQualityReport(input: {
  readonly report: QualityReport | undefined;
  readonly jobId: string;
  readonly filename: string;
  readonly format: DocFormat;
  readonly mode: ConversionMode;
  readonly fallbackEngine: string;
  readonly pdf: Buffer;
  readonly sourceBytes: number;
  readonly durationMs: number;
}): QualityReport {
  if (!input.report) {
    return buildQualityReport({
      jobId: input.jobId,
      filename: input.filename,
      format: input.format,
      mode: input.mode,
      selectedEngine: input.fallbackEngine,
      pdf: input.pdf,
      sourceBytes: input.sourceBytes,
      attempts: [{ engine: input.fallbackEngine, status: "success", durationMs: input.durationMs }],
      warnings: [],
    });
  }

  return {
    ...input.report,
    jobId: input.jobId,
    filename: input.filename,
    format: input.format,
    mode: input.report.mode ?? input.mode,
    checks: {
      ...input.report.checks,
      pdfBytes: input.pdf.byteLength,
      pageCount: input.report.checks.pageCount ?? pdfPageCount(input.pdf),
      sourceBytes: input.sourceBytes,
      textChars: input.report.checks.textChars ?? pdfTextChars(input.pdf),
    },
  };
}
