import { describe, it, expect, vi } from "vitest";
import {
  FallbackPreviewRenderer,
  PdfPreviewError,
  type PdfPreviewRenderer,
} from "./preview.js";

const pdf = Buffer.from("%PDF-1.7");
const png = Buffer.from("\x89PNG\r\n\x1a\n");

function stubRenderer(impl: () => Promise<Buffer>): PdfPreviewRenderer & {
  readonly renderFirstPagePng: ReturnType<typeof vi.fn>;
} {
  return { renderFirstPagePng: vi.fn(impl) };
}

describe("FallbackPreviewRenderer", () => {
  it("returns the first renderer's result without trying later ones", async () => {
    const first = stubRenderer(async () => png);
    const second = stubRenderer(async () => Buffer.from("unused"));
    const renderer = new FallbackPreviewRenderer([first, second]);

    const out = await renderer.renderFirstPagePng(pdf);

    expect(out).toBe(png);
    expect(first.renderFirstPagePng).toHaveBeenCalledWith(pdf);
    expect(second.renderFirstPagePng).not.toHaveBeenCalled();
  });

  it("falls through to the next renderer when the first throws", async () => {
    const first = stubRenderer(async () => {
      throw new PdfPreviewError("pdftoppm missing");
    });
    const second = stubRenderer(async () => png);
    const renderer = new FallbackPreviewRenderer([first, second]);

    const out = await renderer.renderFirstPagePng(pdf);

    expect(out).toBe(png);
    expect(first.renderFirstPagePng).toHaveBeenCalledTimes(1);
    expect(second.renderFirstPagePng).toHaveBeenCalledTimes(1);
  });

  it("throws the last error when every renderer fails", async () => {
    const first = stubRenderer(async () => {
      throw new Error("pdftoppm boom");
    });
    const second = stubRenderer(async () => {
      throw new PdfPreviewError("libreoffice boom");
    });
    const renderer = new FallbackPreviewRenderer([first, second]);

    await expect(renderer.renderFirstPagePng(pdf)).rejects.toBeInstanceOf(PdfPreviewError);
    await expect(renderer.renderFirstPagePng(pdf)).rejects.toThrow(/libreoffice boom/);
  });

  it("throws when constructed with no renderers", async () => {
    const renderer = new FallbackPreviewRenderer([]);
    await expect(renderer.renderFirstPagePng(pdf)).rejects.toBeInstanceOf(PdfPreviewError);
  });
});
