import { vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/render";
import { Upload } from "./Upload";
import { api } from "../api/client";
import type { JobDTO } from "@hwptopdf/shared";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { ...actual.api, upload: vi.fn() } };
});

const job = (over: Partial<JobDTO>): JobDTO => ({
  id: "j1",
  filename: "r.docx",
  format: "office",
  extension: "docx",
  mimeType: "m",
  sizeBytes: 10,
  status: "success",
  engine: "gotenberg",
  durationMs: 100,
  error: null,
  createdAt: new Date(2026, 0, 1).toISOString(),
  ...over,
});

test("lists accepted file types", () => {
  renderWithProviders(<Upload />);
  expect(screen.getByText(/hwp, hwpx, docx/)).toBeInTheDocument();
});

test("uploads a file and shows a success result with a detail link", async () => {
  vi.mocked(api.upload).mockResolvedValue(job({ status: "success" }));
  renderWithProviders(<Upload />);
  const input = screen.getByTestId("file-input") as HTMLInputElement;
  await userEvent.upload(input, new File(["x"], "r.docx"));
  await waitFor(() => expect(screen.getByText("성공")).toBeInTheDocument());
  expect(screen.getByRole("link", { name: "상세 보기" })).toBeInTheDocument();
});

test("shows the failure reason when conversion fails", async () => {
  vi.mocked(api.upload).mockResolvedValue(
    job({ id: "j2", status: "failed", error: "backend 500", engine: "gotenberg" }),
  );
  renderWithProviders(<Upload />);
  const input = screen.getByTestId("file-input") as HTMLInputElement;
  await userEvent.upload(input, new File(["x"], "bad.docx"));
  await waitFor(() => expect(screen.getByText(/사유: backend 500/)).toBeInTheDocument());
});
