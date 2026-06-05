import { vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/render";
import { Jobs } from "./Jobs";
import { api } from "../api/client";
import type { JobDTO, JobStatus } from "@hwptopdf/shared";

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

test("lists jobs and filters to failed only", async () => {
  vi.mocked(api.listJobs).mockImplementation((status?: JobStatus) =>
    Promise.resolve(
      status === "failed"
        ? [job({ id: "2", filename: "bad.docx", status: "failed", error: "boom" })]
        : [job({}), job({ id: "2", filename: "bad.docx", status: "failed" })],
    ),
  );
  renderWithProviders(<Jobs />);
  await waitFor(() => expect(screen.getByText("a.docx")).toBeInTheDocument());

  await userEvent.click(screen.getByRole("button", { name: "실패" }));
  await waitFor(() => expect(screen.getByText("bad.docx")).toBeInTheDocument());
  expect(screen.queryByText("a.docx")).not.toBeInTheDocument();
  expect(api.listJobs).toHaveBeenCalledWith("failed");
});
