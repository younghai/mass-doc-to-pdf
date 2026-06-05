import { render, screen } from "@testing-library/react";
import { App } from "./App";

test("renders the app brand", () => {
  render(<App />);
  expect(screen.getByText("hwptopdf")).toBeInTheDocument();
});
