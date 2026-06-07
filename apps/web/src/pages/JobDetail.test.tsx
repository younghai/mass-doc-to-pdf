import { vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "../test/render";
import { JobDetail } from "./JobDetail";
import { api } from "../api/client";
import type { JobDTO, QualityReport } from "@hwptopdf/shared";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { ...actual.api, getJob: vi.fn(), getQualityReport: vi.fn() } };
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

const quality: QualityReport = {
  version: 1,
  jobId: "1",
  filename: "a.docx",
  format: "office",
  mode: "precise",
  selectedEngine: "rhwp",
  grade: "good",
  status: "review",
  recommendedAction: "표, 이미지, 각주가 많은 문서는 원본 대조 검수를 권장합니다.",
  checks: { pdfBytes: 12345, pageCount: 2 },
  attempts: [
    { engine: "rhwp", status: "failed", durationMs: 10, error: "module missing" },
    { engine: "h2orestart", status: "success", durationMs: 200 },
  ],
  warnings: ["rhwp fallback used"],
  createdAt: new Date(2026, 0, 1).toISOString(),
};

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
  vi.mocked(api.getQualityReport).mockResolvedValue(null);
  renderDetail();
  await waitFor(() =>
    expect(screen.getByRole("link", { name: /PDF 다운로드/ })).toHaveAttribute(
      "href",
      "/api/jobs/1/download",
    ),
  );
});

test("successful job shows quality report details when available", async () => {
  vi.mocked(api.getJob).mockResolvedValue(job({ status: "success", engine: "hwp-quality-chain" }));
  vi.mocked(api.getQualityReport).mockResolvedValue(quality);

  renderDetail();

  await waitFor(() => expect(screen.getByText("품질 리포트")).toBeInTheDocument());
  expect(screen.getByText("저품질 의심")).toBeInTheDocument();
  expect(screen.getByText("정밀 변환")).toBeInTheDocument();
  expect(screen.getByText("고품질")).toBeInTheDocument();
  expect(screen.getAllByText("rhwp").length).toBeGreaterThan(0);
  expect(screen.getByText(/h2orestart/)).toBeInTheDocument();
  expect(screen.getByText(/rhwp fallback used/)).toBeInTheDocument();
});

test("successful job shows a first-page PDF preview", async () => {
  vi.mocked(api.getJob).mockResolvedValue(job({ status: "success" }));
  vi.mocked(api.getQualityReport).mockResolvedValue(null);

  renderDetail();

  await waitFor(() => expect(screen.getByText("PDF 미리보기")).toBeInTheDocument());
  expect(screen.getByTitle("PDF 첫 페이지 미리보기")).toHaveAttribute(
    "src",
    "/api/jobs/1/download#page=1&view=FitH",
  );
  expect(screen.getByRole("link", { name: "3페이지" })).toHaveAttribute(
    "href",
    "/api/jobs/1/download#page=3",
  );
});

test("failed job shows the error reason and no download link", async () => {
  vi.mocked(api.getJob).mockResolvedValue(job({ status: "failed", error: "backend 500" }));
  vi.mocked(api.getQualityReport).mockResolvedValue(null);
  renderDetail();
  await waitFor(() => expect(screen.getByText("backend 500")).toBeInTheDocument());
  expect(screen.queryByRole("link", { name: /다운로드/ })).not.toBeInTheDocument();
});

test("running job shows progress guidance and no download link", async () => {
  vi.mocked(api.getJob).mockResolvedValue(job({ status: "running", durationMs: null }));
  vi.mocked(api.getQualityReport).mockResolvedValue(null);
  renderDetail();
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/진행 중/));
  expect(screen.queryByRole("link", { name: /다운로드/ })).not.toBeInTheDocument();
});
