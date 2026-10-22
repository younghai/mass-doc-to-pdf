import { describe, it, expect } from "vitest";
import {
  canTransitionJob,
  isTerminalJob,
  JOB_STATUSES,
  JOB_STATUS_TRANSITIONS,
} from "./index.js";

describe("job state machine", () => {
  it("allows the happy path pending -> queued -> running -> success", () => {
    expect(canTransitionJob("pending", "queued")).toBe(true);
    expect(canTransitionJob("queued", "running")).toBe(true);
    expect(canTransitionJob("running", "success")).toBe(true);
  });

  it("allows failure from any non-terminal state", () => {
    expect(canTransitionJob("pending", "failed")).toBe(true);
    expect(canTransitionJob("queued", "failed")).toBe(true);
    expect(canTransitionJob("running", "failed")).toBe(true);
  });

  it("allows retry of a failed job (failed -> queued)", () => {
    expect(canTransitionJob("failed", "queued")).toBe(true);
  });

  it("forbids leaving success and illegal jumps", () => {
    expect(canTransitionJob("success", "running")).toBe(false);
    expect(canTransitionJob("success", "failed")).toBe(false);
    expect(canTransitionJob("running", "queued")).toBe(false);
    expect(canTransitionJob("pending", "success")).toBe(false);
  });

  it("marks only success/failed as terminal", () => {
    expect(isTerminalJob("success")).toBe(true);
    expect(isTerminalJob("failed")).toBe(true);
    expect(isTerminalJob("running")).toBe(false);
    expect(isTerminalJob("queued")).toBe(false);
    expect(isTerminalJob("pending")).toBe(false);
  });

  it("defines transitions for every status", () => {
    for (const s of JOB_STATUSES) {
      expect(JOB_STATUS_TRANSITIONS[s]).toBeDefined();
    }
  });
});
