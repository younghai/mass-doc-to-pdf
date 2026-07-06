import { screen } from "@testing-library/react";
import type { JobDTO } from "@hwptopdf/shared";
import { renderWithProviders } from "../test/render";
import { QUALITY_STATUS_LABEL } from "../qualityView";
import { JobsTable } from "./JobsTable";

const job = (overrides: Partial<JobDTO>): JobDTO => ({
  id: "1",
  filename: "review.docx",
  format: "office",
  extension: "docx",
  mimeType: "application/octet-stream",
  sizeBytes: 1024,
  status: "success",
  engine: "rhwp",
  durationMs: 100,
  error: null,
  createdAt: new Date(2026, 0, 1).toISOString(),
  ...overrides,
});

test("renders a quality status badge for each job", () => {
  renderWithProviders(<JobsTable jobs={[job({ qualityStatus: "review" })]} />);

  expect(screen.getByRole("columnheader", { name: "품질" })).toBeInTheDocument();
  expect(screen.getByText(QUALITY_STATUS_LABEL.review)).toBeInTheDocument();
});
