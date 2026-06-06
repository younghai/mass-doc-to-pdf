import { beforeEach, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/render";
import { BatchUpload } from "./BatchUpload";
import { api, MAX_UPLOAD_BYTES } from "../api/client";
import type { JobDTO } from "@hwptopdf/shared";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { ...actual.api, upload: vi.fn() } };
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

beforeEach(() => {
  vi.clearAllMocks();
});

test("shows folder batch limits and accepted file guidance", () => {
  renderWithProviders(<BatchUpload />);

  expect(screen.getByRole("heading", { name: "폴더 일괄 변환" })).toBeInTheDocument();
  expect(screen.getByText(/최대 1,000개/)).toBeInTheDocument();
  expect(screen.getByText(/최대 20.0 MB/)).toBeInTheDocument();
  expect(screen.getByTestId("folder-input")).toHaveAttribute("webkitdirectory");
});

test("selects supported folder files and skips unsupported or oversized files", async () => {
  renderWithProviders(<BatchUpload />);
  const input = screen.getByTestId("folder-input");

  fireEvent.change(input, {
    target: {
      files: [
        new File(["x"], "ready.docx"),
        new File(["x"], "ignore.txt"),
        new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "huge.pptx"),
      ],
    },
  });

  expect(screen.getByText("ready.docx")).toBeInTheDocument();
  expect(screen.getByText("ignore.txt")).toBeInTheDocument();
  expect(screen.getByText("huge.pptx")).toBeInTheDocument();
  expect(screen.getByText("지원하지 않는 형식")).toBeInTheDocument();
  expect(screen.getByText("20.0 MB 초과")).toBeInTheDocument();
});

test("queues ready files sequentially through the upload API", async () => {
  vi.mocked(api.upload)
    .mockResolvedValueOnce(job({ id: "j1", filename: "a.docx" }))
    .mockResolvedValueOnce(job({ id: "j2", filename: "b.pptx" }));

  renderWithProviders(<BatchUpload />);
  await userEvent.upload(screen.getByTestId("folder-input"), [
    new File(["a"], "a.docx"),
    new File(["b"], "b.pptx"),
  ]);

  await userEvent.click(screen.getByRole("button", { name: "변환 시작" }));

  await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(2));
  const rows = screen.getAllByRole("row");
  expect(within(rows[1]).getByRole("link", { name: "작업 보기" })).toHaveAttribute(
    "href",
    "/service/jobs/j1",
  );
  expect(within(rows[2]).getByRole("link", { name: "작업 보기" })).toHaveAttribute(
    "href",
    "/service/jobs/j2",
  );
});

test("keeps only the first 1000 files from a folder selection", async () => {
  renderWithProviders(<BatchUpload />);
  const files = Array.from({ length: 1001 }, (_, index) => new File(["x"], `doc-${index}.docx`));

  await userEvent.upload(screen.getByTestId("folder-input"), files);

  expect(screen.getByRole("alert")).toHaveTextContent("1,000개까지만 등록했습니다");
  expect(screen.getByText("doc-999.docx")).toBeInTheDocument();
  expect(screen.queryByText("doc-1000.docx")).not.toBeInTheDocument();
});
