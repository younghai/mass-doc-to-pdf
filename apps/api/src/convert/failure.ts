import type { ConversionFailureReason } from "@hwptopdf/shared";
import { ConversionError } from "./types.js";

export function rawErrorMessage(err: unknown): string {
  if (err instanceof ConversionError) return err.message;
  if (err instanceof Error) return err.message;
  return "unknown conversion failure";
}

export function failureReason(message: string): ConversionFailureReason {
  const lower = message.toLowerCase();
  if (lower.includes("password") || lower.includes("encrypted") || message.includes("암호")) return "password_protected";
  if (lower.includes("enametoolong") || lower.includes("filename") || message.includes("파일명")) return "unknown";
  if (lower.includes("quality gate") || message.includes("품질 게이트")) return "quality_gate_failed";
  if (lower.includes("unsupported") || lower.includes("not supported") || lower.includes("not available")) return "unsupported_format";
  if (lower.includes("timeout") || lower.includes("timed out")) return "timeout";
  if (lower.includes("corrupt") || lower.includes("invalid")) return "corrupt_file";
  return "engine_error";
}

export function errorMessage(err: unknown): string {
  const message = rawErrorMessage(err);
  switch (failureReason(message)) {
    case "password_protected":
      return `암호 문서: 암호를 해제한 파일로 다시 업로드하세요. (${message})`;
    case "unsupported_format":
      return `엔진 미지원: 현재 변환 엔진이 이 문서 구조를 지원하지 않습니다. (${message})`;
    case "timeout":
      return `렌더링 시간 초과: 파일을 나누거나 정밀 변환으로 다시 시도하세요. (${message})`;
    case "corrupt_file":
      return `파일 손상 의심: 원본을 다시 저장한 뒤 업로드하세요. (${message})`;
    case "too_large":
      return `파일 크기 초과: 파일을 나눠 업로드하세요. (${message})`;
    case "unknown":
      return `파일명 길이 또는 문서 구조 문제: 파일명을 짧게 바꾸고 다시 시도하세요. (${message})`;
    case "engine_error":
      return `렌더링 실패: 다른 품질 모드로 재시도하거나 원본 문서를 다시 저장하세요. (${message})`;
    case "quality_gate_failed":
      return `품질 게이트 실패: PDF가 생성됐지만 원본 서식 보존 엔진 결과가 아니어서 다운로드를 막았습니다. LibreOffice/H2Orestart 또는 정밀 엔진을 연결한 뒤 재시도하세요. (${message})`;
  }
}

/** Reasons where a retry cannot change the outcome (the input itself is the problem). */
const PERMANENT_REASONS: ReadonlySet<ConversionFailureReason> = new Set([
  "password_protected",
  "corrupt_file",
  "unsupported_format",
  "quality_gate_failed",
  "too_large",
]);

/**
 * True when re-running the engine chain cannot succeed because the failure is
 * inherent to the input (encrypted, corrupt, unsupported structure, …). The
 * transient reasons — timeout / engine_error / unknown — are deliberately left
 * out: they can be caused by a downed sidecar or a momentary resource crunch, so
 * a retry may still succeed. This conservative split keeps real outages retrying
 * while sparing deterministic failures the full 3-attempt engine-chain budget.
 */
export function isPermanentFailure(message: string): boolean {
  return PERMANENT_REASONS.has(failureReason(message));
}
