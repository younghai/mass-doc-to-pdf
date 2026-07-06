import { afterEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./test/render";

type ApiClient = typeof import("./api/client").api;

vi.mock("./api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getStats: vi.fn(),
      listJobs: vi.fn(),
      session: vi.fn(),
    },
  };
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

test("renders the public landing page at root", async () => {
  const api = await loadApi();
  vi.mocked(api.session).mockResolvedValue(null);
  const App = await loadApp();
  renderWithProviders(<App />, { route: "/" });
  expect(screen.getByRole("heading", { name: "hwptopdf" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "서비스 사용하기" })).toHaveAttribute(
    "href",
    "/service/upload",
  );
});

test("redirects service routes to the login screen when unauthenticated", async () => {
  const api = await loadApi();
  vi.mocked(api.session).mockResolvedValue(null);
  const App = await loadApp();
  renderWithProviders(<App />, { route: "/service" });
  await waitFor(() =>
    expect(screen.getByRole("link", { name: /google/i })).toBeInTheDocument(),
  );
});

test("hides meetings navigation and redirects the labs route when the meetings flag is off", async () => {
  const api = await loadApi();
  mockAuthenticatedService(api);
  const App = await loadApp();

  renderWithProviders(<App />, { route: "/labs/meetings" });

  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "운영 현황" })).toBeInTheDocument(),
  );
  expect(screen.queryByRole("link", { name: /회의록/ })).not.toBeInTheDocument();
  expect(screen.queryByText("Bzengage Minutes")).not.toBeInTheDocument();
});

test("redirects the legacy meetings route when the meetings flag is off", async () => {
  const api = await loadApi();
  mockAuthenticatedService(api);
  const App = await loadApp();

  renderWithProviders(<App />, { route: "/service/meetings" });

  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "운영 현황" })).toBeInTheDocument(),
  );
  expect(screen.queryByRole("link", { name: /회의록/ })).not.toBeInTheDocument();
  expect(screen.queryByText("Bzengage Minutes")).not.toBeInTheDocument();
});

test("exposes the meetings lab route and experiment label when the meetings flag is on", async () => {
  vi.stubEnv("VITE_ENABLE_MEETINGS", "1");
  const api = await loadApi();
  mockAuthenticatedService(api);
  const App = await loadApp();

  renderWithProviders(<App />, { route: "/labs/meetings" });

  await waitFor(() => expect(screen.getByText("Bzengage Minutes")).toBeInTheDocument());
  expect(screen.getByRole("link", { name: "회의록 (실험)" })).toHaveAttribute(
    "href",
    "/labs/meetings",
  );
  expect(
    screen.getByText(
      "실험 기능 · 서버에 저장되지 않음(브라우저 로컬) · 민감/기밀 정보 입력 금지 · 음성이 브라우저 외부(STT)로 전송될 수 있음",
    ),
  ).toBeInTheDocument();
});

async function loadApi(): Promise<ApiClient> {
  const { api } = await import("./api/client");
  return api;
}

async function loadApp() {
  const { App } = await import("./App");
  return App;
}

function mockAuthenticatedService(api: ApiClient) {
  vi.mocked(api.session).mockResolvedValue({ user: { email: "dev@example.com" } });
  vi.mocked(api.getStats).mockResolvedValue({
    total: 0,
    success: 0,
    failed: 0,
    running: 0,
    queued: 0,
    pending: 0,
    successRate: 0,
  });
  vi.mocked(api.listJobs).mockResolvedValue([]);
}
