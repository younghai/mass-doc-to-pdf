import type { ConversionMode, QualityGrade, QualityReport, QualityStatus } from "@hwptopdf/shared";

export const QUALITY_MODE_LABEL: Record<ConversionMode, string> = {
  precise: "정밀 변환",
  quick: "빠른 변환",
};

export const QUALITY_MODE_HELP: Record<ConversionMode, string> = {
  precise: "rhwp와 정밀 엔진을 우선 사용합니다.",
  quick: "빠른 builtin/fallback 경로를 우선 사용합니다.",
};

export const QUALITY_STATUS_LABEL: Record<QualityStatus, string> = {
  passed: "검수 불필요",
  review: "저품질 의심 — 검수 권장",
  failed: "변환 실패",
};

const WARNING_LABEL: Record<string, string> = {
  rhwp_small_pdf_review: "PDF 크기가 작습니다 — 원본 대조 검수 필요",
  rhwp_low_bytes_per_page_review: "페이지당 PDF 용량이 낮습니다 — 이미지·표 유실 가능",
};

export function warningLabel(code: string): string {
  return WARNING_LABEL[code] ?? code;
}

export function qualityStatus(report: QualityReport | null | undefined): QualityStatus {
  if (!report) return "review";
  if (report.status) return report.status;
  if (report.grade === "fallback") return "review";
  if (report.grade === "failed") return "failed";
  if (report.warnings.length > 0) return "review";
  return "passed";
}

export function qualityAction(report: QualityReport): string {
  if (report.recommendedAction) return report.recommendedAction;
  if (report.grade === "fallback") return "원본과 첫 페이지를 비교하고 정밀 변환으로 재시도하세요.";
  return "표, 이미지, 각주가 많은 문서는 원본 대조 검수를 권장합니다.";
}

export function gradeLabel(grade: QualityGrade): string {
  switch (grade) {
    case "good":
      return "고품질";
    case "acceptable":
      return "허용";
    case "fallback":
      return "저품질 의심";
    case "failed":
      return "실패";
  }
}
