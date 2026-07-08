import { afterEach, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useSession } from "../auth/useSession";
import { Layout } from "./Layout";

vi.mock("../api/client", () => ({
  api: {
    signOutUrl: vi.fn(),
  },
}));

vi.mock("../auth/useSession", () => ({
  useSession: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(useSession).mockReturnValue({
    user: { email: "dev@example.com" },
    isLoading: false,
  });
  vi.mocked(api.signOutUrl).mockReturnValue("/logout");
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

test("keeps desktop nav links in the DOM and omits meetings nav when the feature flag is off", () => {
  renderLayout();

  expect(screen.getByRole("link", { name: "운영 현황" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "문서 업로드" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "폴더 일괄 변환" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "작업 큐" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "회의록 (실험)" })).not.toBeInTheDocument();
});

test("shows the meetings nav link when the feature flag is on", () => {
  vi.stubEnv("VITE_ENABLE_MEETINGS", "1");

  renderLayout("/labs/meetings");

  expect(screen.getByRole("link", { name: "회의록 (실험)" })).toHaveAttribute(
    "href",
    "/labs/meetings",
  );
});

test("toggles the mobile drawer button state", async () => {
  const user = userEvent.setup();
  renderLayout();

  const toggle = screen.getByRole("button", { name: "모바일 탐색 메뉴" });

  expect(toggle).toHaveAttribute("aria-expanded", "false");

  await user.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");

  await user.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("closes the drawer after clicking a navigation link", async () => {
  const user = userEvent.setup();
  renderLayout();

  const toggle = screen.getByRole("button", { name: "모바일 탐색 메뉴" });

  await user.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");

  await user.click(screen.getByRole("link", { name: "문서 업로드" }));

  expect(screen.getByTestId("pathname")).toHaveTextContent("/service/upload");
  expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("closes the drawer when the route changes outside the navigation", async () => {
  const user = userEvent.setup();
  renderLayout();

  const toggle = screen.getByRole("button", { name: "모바일 탐색 메뉴" });

  await user.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");

  await user.click(screen.getByRole("button", { name: "외부 라우트 변경" }));

  expect(screen.getByTestId("pathname")).toHaveTextContent("/service/jobs");
  expect(toggle).toHaveAttribute("aria-expanded", "false");
});

function renderLayout(route = "/service") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="*" element={<LayoutHarness />} />
      </Routes>
    </MemoryRouter>,
  );
}

function LayoutHarness() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <>
      <button type="button" onClick={() => navigate("/service/jobs")}>
        외부 라우트 변경
      </button>
      <div data-testid="pathname">{location.pathname}</div>
      <Layout>
        <div>본문</div>
      </Layout>
    </>
  );
}
