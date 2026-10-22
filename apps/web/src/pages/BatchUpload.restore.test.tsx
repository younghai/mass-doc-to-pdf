import { afterEach, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BatchDTO, JobDTO } from "@hwptopdf/shared";
import { api } from "../api/client";
import { renderWithProviders } from "../test/render";
import { BatchUpload } from "./BatchUpload";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      upload: vi.fn(),
      listJobs: vi.fn(),
      getBatch: vi.fn(),
      getQualityReport: vi.fn(),
    },
  };
});

const job = (over: Partial<JobDTO>): JobDTO => ({
  id: "j1",
  filename: "report.docx",
  format: "office",
  extension: "docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  sizeBytes: 10,
  status: "running",
  engine: "gotenberg",
  durationMs: null,
  error: null,
  createdAt: new Date(2026, 0, 1).toISOString(),
  ...over,
});

const batch = (over: Partial<BatchDTO>): BatchDTO => ({
  id: "batch-1",
  createdAt: new Date(2026, 0, 1).toISOString(),
  status: "active",
  total: 5,
  pending: 1,
  queued: 1,
  running: 1,
  success: 2,
  failed: 0,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.mocked(api.listJobs).mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

test("assigns one batch id to all uploads and restores aggregate progress after reload", async () => {
  const generatedBatchId = "00000000-0000-4000-8000-000000000001";
  vi.spyOn(crypto, "randomUUID").mockReturnValue(generatedBatchId);
  vi.mocked(api.upload)
    .mockResolvedValueOnce(job({ id: "j1", filename: "a.docx" }))
    .mockResolvedValueOnce(job({ id: "j2", filename: "b.docx" }));
  vi.mocked(api.getBatch).mockResolvedValue(batch({ id: generatedBatchId }));

  const firstRender = renderWithProviders(<BatchUpload />, { route: "/service/batch" });
  await userEvent.upload(screen.getByTestId("folder-input"), [
    new File(["a"], "a.docx"),
    new File(["b"], "b.docx"),
  ]);
  await userEvent.click(screen.getByRole("button", { name: "변환 시작" }));

  await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(2));
  expect(api.upload).toHaveBeenNthCalledWith(1, expect.any(File), "precise", generatedBatchId);
  expect(api.upload).toHaveBeenNthCalledWith(2, expect.any(File), "precise", generatedBatchId);
  expect(window.localStorage.getItem("hwptopdf.activeBatchId")).toBe(generatedBatchId);

  firstRender.unmount();
  vi.clearAllMocks();
  vi.mocked(api.getBatch).mockResolvedValue(batch({ id: generatedBatchId }));
  renderWithProviders(<BatchUpload />, { route: `/service/batch?batch=${generatedBatchId}` });

  await waitFor(() => expect(api.getBatch).toHaveBeenCalledWith(generatedBatchId));
  await waitFor(() => expect(screen.getByLabelText("복원된 배치 진행 상황")).toHaveTextContent("2 / 5 완료"));
  expect(screen.getByLabelText("복원된 배치 요약")).toHaveTextContent("대기/큐3");
});
