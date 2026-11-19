import { beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/render";
import { Upload } from "./Upload";
import { api, MAX_UPLOAD_BYTES, ACCEPTED_EXTENSIONS } from "../api/client";
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

beforeEach(() => {
  vi.clearAllMocks();
});

test("lists accepted file types", () => {
  renderWithProviders(<Upload />);
  // 안내 문구는 ACCEPTED_EXTENSIONS에서 파생되므로 8종 전체를 나열해야 한다
  // (회귀 가드: 5종 하드코딩 시 이 어설션이 실패).
  const help = screen.getByText(/지원 형식/).textContent ?? "";
  for (const ext of ACCEPTED_EXTENSIONS) expect(help).toContain(ext.slice(1));
  expect(screen.getByText(/최대 20.0 MB/)).toBeInTheDocument();
});

test("uploads a file and shows a running job with a detail link", async () => {
  vi.mocked(api.upload).mockResolvedValue(job({ status: "running", durationMs: null }));
  renderWithProviders(<Upload />);
  const input = screen.getByTestId("file-input") as HTMLInputElement;
  await userEvent.upload(input, new File(["x"], "r.docx"));
  await waitFor(() => expect(screen.getByText("변환 중")).toBeInTheDocument());
  expect(screen.getByText("작업 큐에서 변환 중입니다.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "상세 보기" })).toBeInTheDocument();
  expect(api.upload).toHaveBeenCalledWith(expect.any(File), "precise");
});

test("can upload with quick quality mode", async () => {
  vi.mocked(api.upload).mockResolvedValue(job({ status: "running", durationMs: null }));
  renderWithProviders(<Upload />);
  await userEvent.click(screen.getByRole("radio", { name: "빠른 변환" }));
  const input = screen.getByTestId("file-input") as HTMLInputElement;
  await userEvent.upload(input, new File(["x"], "r.hwp"));
  await waitFor(() => expect(api.upload).toHaveBeenCalledWith(expect.any(File), "quick"));
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

test("rejects files over the 20 MB upload limit before calling the API", async () => {
  renderWithProviders(<Upload />);
  const input = screen.getByTestId("file-input") as HTMLInputElement;
  await userEvent.upload(input, new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "huge.pptx"));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/최대 20.0 MB/));
  expect(api.upload).not.toHaveBeenCalled();
});
