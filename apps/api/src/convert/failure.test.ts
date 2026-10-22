import { describe, it, expect } from "vitest";
import { errorMessage, isPermanentFailure } from "./failure.js";

describe("errorMessage", () => {
  it("returns friendly Korean guidance without leaking internal engine details", () => {
    const message = errorMessage(
      new Error("[hwp-quality-chain] all converters failed: h2orestart failed: http://localhost:8080/convert failed"),
    );

    expect(message).toBe("렌더링 실패: 다른 품질 모드로 재시도하거나 원본 문서를 다시 저장하세요.");
    expect(message).not.toContain("http://");
    expect(message).not.toContain("localhost");
    expect(message).not.toContain("[");
  });
});

describe("isPermanentFailure", () => {
  it("treats input-inherent failures as permanent (no retry)", () => {
    expect(isPermanentFailure("암호로 보호된 문서입니다")).toBe(true);
    expect(isPermanentFailure("password protected document")).toBe(true);
    expect(isPermanentFailure("file is corrupt")).toBe(true);
    expect(isPermanentFailure("unsupported document structure")).toBe(true);
    expect(isPermanentFailure("품질 게이트 실패")).toBe(true);
  });

  it("keeps transient failures retryable", () => {
    expect(isPermanentFailure("rendering timed out")).toBe(false);
    expect(isPermanentFailure("sidecar connection refused")).toBe(false);
    expect(isPermanentFailure("something unexpected blew up")).toBe(false);
  });
});
