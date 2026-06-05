import { vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./test/render";
import { App } from "./App";
import { api } from "./api/client";

vi.mock("./api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api/client")>();
  return { ...actual, api: { ...actual.api, session: vi.fn() } };
});

test("redirects to the login screen when unauthenticated", async () => {
  vi.mocked(api.session).mockResolvedValue(null);
  renderWithProviders(<App />, { route: "/" });
  await waitFor(() =>
    expect(screen.getByRole("link", { name: /google/i })).toBeInTheDocument(),
  );
});
