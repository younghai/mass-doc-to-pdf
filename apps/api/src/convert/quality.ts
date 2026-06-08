import type {
  ConversionMode,
  DocFormat,
  QualityAttempt,
  QualityGrade,
  QualityReport,
  QualityStatus,
} from "@hwptopdf/shared";

const PDF_PAGE_RE = /\/Type\s*\/Page\b/g;
const RHWP_CLI_MIN_PDF_BYTES = 32 * 1024;
const RHWP_CLI_MIN_BYTES_PER_PAGE = 4 * 1024;

export function reportObjectKey(userId: string, jobId: string): string {
  return `${userId}/report/${jobId}.json`;
}

export function pdfPageCount(pdf: Buffer): number | undefined {
  const count = pdf.toString("latin1").match(PDF_PAGE_RE)?.length ?? 0;
  return count > 0 ? count : undefined;
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
}): readonly string[] {
  if (!isHwpFormat(input.format) || !isRhwpQualityRiskEngine(input.selectedEngine)) return [];

  const warnings: string[] = [];
  if (input.pdfBytes < RHWP_CLI_MIN_PDF_BYTES) {
    warnings.push("rhwp_small_pdf_review");
  }
  if (input.pageCount && input.pdfBytes / input.pageCount < RHWP_CLI_MIN_BYTES_PER_PAGE) {
    warnings.push("rhwp_low_bytes_per_page_review");
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
  const grade = gradeForEngine(input.selectedEngine);
  const warnings = [
    ...input.warnings,
    ...intrinsicWarnings({
      format: input.format,
      selectedEngine: input.selectedEngine,
      pdfBytes: input.pdf.byteLength,
      pageCount,
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
    },
  };
}
