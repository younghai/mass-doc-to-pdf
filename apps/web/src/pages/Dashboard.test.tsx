import { vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test/render";
import { Dashboard } from "./Dashboard";
import { api } from "../api/client";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Cell: () => null,
  Legend: () => null,
  Tooltip: () => null,
}));

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual, api: { ...actual.api, getStats: vi.fn(), listJobs: vi.fn() } };
});

test("shows totals, success rate, and recent files", async () => {
  vi.mocked(api.getStats).mockResolvedValue({
    total: 10,
    success: 8,
    failed: 2,
    pending: 0,
    successRate: 0.8,
  });
  vi.mocked(api.listJobs).mockResolvedValue([
    {
      id: "1",
      filename: "recent.docx",
      format: "office",
      extension: "docx",
      mimeType: "m",
      sizeBytes: 1024,
      status: "success",
      engine: "gotenberg",
      durationMs: 100,
      error: null,
      createdAt: new Date(2026, 0, 1).toISOString(),
    },
  ]);

  renderWithProviders(<Dashboard />);

  await waitFor(() => expect(screen.getByText("80%")).toBeInTheDocument());
  expect(screen.getByText("총 변환수")).toBeInTheDocument();
  expect(screen.getByText("10")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText("recent.docx")).toBeInTheDocument());
});
