import { describe, it, expect } from "vitest";
import { isPermanentFailure } from "./failure.js";

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
