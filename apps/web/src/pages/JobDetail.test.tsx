import { vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "../test/render";
import { JobDetail } from "./JobDetail";
import { api } from "../api/client";
import type { JobDTO } from "@hwptopdf/shared";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { ...actual.api, getJob: vi.fn() } };
});

const job = (over: Partial<JobDTO>): JobDTO => ({
  id: "1",
  filename: "a.docx",
  format: "office",
  extension: "docx",
  mimeType: "application/vnd...",
  sizeBytes: 2048,
  status: "success",
  engine: "gotenberg",
  durationMs: 900,
  error: null,
  createdAt: new Date(2026, 0, 1).toISOString(),
  ...over,
});

function renderDetail() {
  return renderWithProviders(
    <Routes>
      <Route path="/service/jobs/:id" element={<JobDetail />} />
    </Routes>,
    { route: "/service/jobs/1" },
  );
}

test("successful job shows a Download PDF link", async () => {
  vi.mocked(api.getJob).mockResolvedValue(job({ status: "success" }));
  renderDetail();
  await waitFor(() =>
    expect(screen.getByRole("link", { name: /PDF 다운로드/ })).toHaveAttribute(
      "href",
      "/api/jobs/1/download",
    ),
  );
});

test("failed job shows the error reason and no download link", async () => {
  vi.mocked(api.getJob).mockResolvedValue(job({ status: "failed", error: "backend 500" }));
  renderDetail();
  await waitFor(() => expect(screen.getByText("backend 500")).toBeInTheDocument());
  expect(screen.queryByRole("link", { name: /다운로드/ })).not.toBeInTheDocument();
});

test("running job shows progress guidance and no download link", async () => {
  vi.mocked(api.getJob).mockResolvedValue(job({ status: "running", durationMs: null }));
  renderDetail();
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/진행 중/));
  expect(screen.queryByRole("link", { name: /다운로드/ })).not.toBeInTheDocument();
});
