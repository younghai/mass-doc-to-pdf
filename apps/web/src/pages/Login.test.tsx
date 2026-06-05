import { screen } from "@testing-library/react";
import { renderWithProviders } from "../test/render";
import { Login } from "./Login";

test("shows a Google sign-in link to the auth endpoint", () => {
  renderWithProviders(<Login />);
  const link = screen.getByRole("link", { name: /google/i });
  expect(link).toHaveAttribute("href", "/api/auth/signin/google");
});
