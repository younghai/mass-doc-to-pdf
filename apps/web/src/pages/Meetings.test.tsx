import { afterEach, beforeEach, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/render";
import { Meetings } from "./Meetings";

interface MockSpeechAlternative {
  readonly transcript: string;
}

interface MockSpeechResult {
  readonly isFinal: boolean;
  readonly [index: number]: MockSpeechAlternative | undefined;
}

interface MockSpeechResultList {
  readonly length: number;
  readonly [index: number]: MockSpeechResult | undefined;
}

interface MockSpeechEvent {
  readonly resultIndex: number;
  readonly results: MockSpeechResultList;
}

const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
let latestRecorder: MockMediaRecorder | null = null;
let latestSpeechRecognition: MockSpeechRecognition | null = null;
let stopTrack: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("VITE_ENABLE_MEETINGS", "1");
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  restoreDescriptor(navigator, "mediaDevices", originalMediaDevices);
  restoreDescriptor(URL, "createObjectURL", originalCreateObjectUrl);
  restoreDescriptor(URL, "revokeObjectURL", originalRevokeObjectUrl);
  latestRecorder = null;
  latestSpeechRecognition = null;
});

test("generates a Markdown meeting-minutes draft from transcript text", async () => {
  renderWithProviders(<Meetings />);
  await userEvent.clear(screen.getByLabelText("회의 제목"));
  await userEvent.type(screen.getByLabelText("회의 제목"), "주간 회의");
  await userEvent.click(screen.getByRole("button", { name: "회의록 초안 생성" }));

  const markdown = screen.getByLabelText("회의록 Markdown") as HTMLTextAreaElement;
  await waitFor(() => expect(markdown.value).toContain("# 주간 회의"));
  expect(markdown.value).toContain("## 액션 아이템");
  expect(screen.getByRole("button", { name: "MD 다운로드" })).toBeEnabled();
  expect(screen.getByRole("button", { name: /주간 회의/ })).toBeInTheDocument();
});

test("starts a new meeting from the screenshot-style command rail", async () => {
  renderWithProviders(<Meetings />);

  expect(screen.getByText("Bzengage Minutes")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "새 회의 시작" })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "회의 검색" })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "새 회의 시작" }));

  expect(screen.getByText("새 회의를 시작하세요")).toBeInTheDocument();
  expect(screen.getByText("기록 1개")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /2분기 제품 전략 회의/ })).toBeInTheDocument();
});

test("shows meeting stats and export controls in the summary card", async () => {
  renderWithProviders(<Meetings />);
  await userEvent.click(screen.getByRole("button", { name: "회의록 초안 생성" }));

  expect(screen.getByRole("heading", { name: "회의 요약" })).toBeInTheDocument();
  expect(screen.getByText("기록")).toBeInTheDocument();
  expect(screen.getByText("결정")).toBeInTheDocument();
  expect(screen.getByText("액션")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Markdown export" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "HTML export" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Word export" })).toBeEnabled();
});

test("shows a Word-style document preview and exports HTML", async () => {
  const downloadedBlobs: Blob[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn((blob: Blob) => {
      downloadedBlobs.push(blob);
      return "blob:meeting-document";
    }),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });

  renderWithProviders(<Meetings />);
  await userEvent.click(screen.getByRole("button", { name: "회의록 초안 생성" }));

  const preview = screen.getByRole("document", { name: "회의록 문서 미리보기" });
  expect(preview).toBeInTheDocument();
  expect(within(preview).getByRole("heading", { level: 1, name: "2분기 제품 전략 회의" })).toBeInTheDocument();
  expect(within(preview).getByRole("heading", { level: 2, name: "액션 아이템" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Word 다운로드" })).toBeEnabled();

  await userEvent.click(screen.getByRole("button", { name: "HTML 다운로드" }));

  const downloadedBlob = downloadedBlobs[0];
  if (!downloadedBlob) throw new Error("HTML download blob was not created");
  expect(downloadedBlob.type).toBe("text/html;charset=utf-8");
});

test("updates status and saves edited markdown locally", async () => {
  renderWithProviders(<Meetings />);
  await userEvent.click(screen.getByRole("button", { name: "회의록 초안 생성" }));
  await userEvent.selectOptions(screen.getByLabelText("회의록 상태"), "completed");
  const markdown = screen.getByLabelText("회의록 Markdown") as HTMLTextAreaElement;
  await waitFor(() => expect(markdown.value).toContain("상태: 완료"));

  await userEvent.clear(markdown);
  await userEvent.type(markdown, "# 수정된 회의록");
  await userEvent.click(screen.getByRole("button", { name: "저장" }));

  const stored = localStorage.getItem("hwptopdf.meeting-minutes.v1");
  expect(stored).toContain("# 수정된 회의록");
});

test("records audio and appends live speech transcription", async () => {
  installRealtimeCaptureMocks();
  renderWithProviders(<Meetings />);

  await userEvent.click(screen.getByRole("button", { name: "실시간 녹음 시작" }));
  await waitFor(() => expect(screen.getByText("녹음 중")).toBeInTheDocument());

  await act(async () => {
    latestSpeechRecognition?.emitFinal("영수: 오늘 회의는 실시간 전사로 기록합니다.");
  });
  const transcript = screen.getByLabelText("전사 텍스트") as HTMLTextAreaElement;
  await waitFor(() => expect(transcript.value).toContain("실시간 전사로 기록합니다."));

  await userEvent.click(screen.getByRole("button", { name: "녹음 중지" }));
  await waitFor(() => expect(screen.getByRole("link", { name: "녹음 다운로드" })).toBeEnabled());
  expect(screen.getByRole("link", { name: "녹음 다운로드" })).toHaveAttribute(
    "href",
    "blob:meeting-audio",
  );
  expect(latestRecorder?.stop).toHaveBeenCalled();
  expect(stopTrack).toHaveBeenCalled();
});

class MockMediaRecorder {
  static isTypeSupported = vi.fn(() => true);

  readonly mimeType = "audio/webm";
  state: "inactive" | "recording" = "inactive";
  ondataavailable: ((event: { readonly data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  readonly start = vi.fn(() => {
    this.state = "recording";
  });
  readonly stop = vi.fn(() => {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio"], { type: this.mimeType }) });
    this.onstop?.();
  });

  constructor() {
    latestRecorder = this;
  }
}

class MockSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((event: MockSpeechEvent) => void) | null = null;
  onerror: ((event: { readonly error: string; readonly message?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  readonly start = vi.fn(() => {
    latestSpeechRecognition = this;
  });
  readonly stop = vi.fn(() => {
    this.onend?.();
  });
  readonly abort = vi.fn(() => {
    this.onend?.();
  });

  emitFinal(transcript: string) {
    this.onresult?.({
      resultIndex: 0,
      results: {
        0: { 0: { transcript }, isFinal: true },
        length: 1,
      },
    });
  }
}

function installRealtimeCaptureMocks() {
  stopTrack = vi.fn();
  const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
  const getUserMedia = vi.fn().mockResolvedValue(stream);

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:meeting-audio"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal("MediaRecorder", MockMediaRecorder);
  vi.stubGlobal("webkitSpeechRecognition", MockSpeechRecognition);
}

function restoreDescriptor<T extends object>(
  target: T,
  key: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) Object.defineProperty(target, key, descriptor);
  else Reflect.deleteProperty(target, key);
}
