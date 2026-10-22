import { screen } from "@testing-library/react";
import { Landing } from "./Landing";
import { renderWithProviders } from "../test/render";

test("shows quality judgment positioning when the landing page renders", () => {
  // Given / When
  renderWithProviders(<Landing />);

  expect(screen.getByRole("heading", { name: "hwptopdf" })).toBeInTheDocument();
  // Then
  expect(
    screen.getByRole("heading", {
      name: /품질.*passed.*review.*failed/,
    }),
  ).toBeInTheDocument();
  expect(screen.getByText(/저품질\(review\).*검수/)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "품질 리포트" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "엔진 체인" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "검수 워크플로우" })).toBeInTheDocument();
  expect(screen.getByText("예시")).toBeInTheDocument();
});

test("keeps landing navigation and service CTAs routed to existing targets", () => {
  // Given / When
  renderWithProviders(<Landing />);

  // Then
  expect(screen.getByRole("link", { name: "기능" })).toHaveAttribute("href", "#features");
  expect(screen.getByRole("link", { name: "서비스 흐름" })).toHaveAttribute("href", "#workflow");
  expect(screen.getByRole("link", { name: "운영 화면" })).toHaveAttribute("href", "/service");
  expect(screen.getByRole("link", { name: "문서 변환 시작" })).toHaveAttribute(
    "href",
    "/service/upload",
  );
  expect(screen.getByRole("link", { name: "서비스 사용하기" })).toHaveAttribute(
    "href",
    "/service/upload",
  );
  expect(screen.getByRole("link", { name: "작업 큐 보기" })).toHaveAttribute(
    "href",
    "/service/jobs",
  );
  expect(screen.getByRole("link", { name: "서비스 UI 열기" })).toHaveAttribute("href", "/service");
});
