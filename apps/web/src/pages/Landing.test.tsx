import { screen } from "@testing-library/react";
import { Landing } from "./Landing";
import { renderWithProviders } from "../test/render";

test("shows the service introduction and routes CTAs into the service UI", () => {
  renderWithProviders(<Landing />);

  expect(screen.getByRole("heading", { name: "hwptopdf" })).toBeInTheDocument();
  expect(screen.getByText(/업로드, 변환 상태, 실패 사유, 다운로드/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "기능" })).toHaveAttribute("href", "#features");
  expect(screen.getByRole("link", { name: "서비스 사용하기" })).toHaveAttribute(
    "href",
    "/service/upload",
  );
  expect(screen.getByRole("link", { name: "작업 큐 보기" })).toHaveAttribute(
    "href",
    "/service/jobs",
  );
});
