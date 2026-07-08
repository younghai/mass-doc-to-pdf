import { vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/render";
import { Jobs } from "./Jobs";
import { api } from "../api/client";
import type { JobDTO, JobStatus, QualityStatus } from "@hwptopdf/shared";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { ...actual.api, listJobs: vi.fn() } };
});

const job = (over: Partial<JobDTO>): JobDTO => ({
  id: "1",
  filename: "a.docx",
  format: "office",
  extension: "docx",
  mimeType: "m",
  sizeBytes: 1024,
  status: "success",
  engine: "gotenberg",
  durationMs: 100,
  error: null,
  createdAt: new Date(2026, 0, 1).toISOString(),
  ...over,
});

type JobListFilters = {
  readonly status?: JobStatus;
  readonly qualityStatus?: QualityStatus;
};

test("lists jobs and filters to failed only", async () => {
  vi.mocked(api.listJobs).mockImplementation((filters?: JobListFilters) =>
    Promise.resolve(
      filters?.status === "failed"
        ? [job({ id: "2", filename: "bad.docx", status: "failed", error: "boom" })]
        : [job({}), job({ id: "2", filename: "bad.docx", status: "failed" })],
    ),
  );
  renderWithProviders(<Jobs />);
  await waitFor(() => expect(screen.getByText("a.docx")).toBeInTheDocument());

  await userEvent.click(screen.getByRole("button", { name: "실패" }));
  await waitFor(() => expect(screen.getByText("bad.docx")).toBeInTheDocument());
  expect(screen.queryByText("a.docx")).not.toBeInTheDocument();
  expect(api.listJobs).toHaveBeenCalledWith({ status: "failed" });
});

test("저품질 탭이 review job만 보여준다", async () => {
  vi.mocked(api.listJobs).mockImplementation((filters?: JobListFilters) =>
    Promise.resolve(
      filters?.qualityStatus === "review"
        ? [job({ id: "2", filename: "needs-review.docx", qualityStatus: "review" })]
        : [
            job({ id: "1", filename: "passed.docx", qualityStatus: "passed" }),
            job({ id: "2", filename: "needs-review.docx", qualityStatus: "review" }),
          ],
    ),
  );
  renderWithProviders(<Jobs />);
  await waitFor(() => expect(screen.getByText("passed.docx")).toBeInTheDocument());

  await userEvent.click(screen.getByRole("button", { name: "저품질(review)" }));

  await waitFor(() => expect(screen.getByText("needs-review.docx")).toBeInTheDocument());
  expect(screen.queryByText("passed.docx")).not.toBeInTheDocument();
  expect(api.listJobs).toHaveBeenCalledWith({ status: "success", qualityStatus: "review" });
});
