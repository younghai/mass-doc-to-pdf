import { describe, it, expect, vi } from "vitest";
import { GotenbergConverter } from "./gotenberg.js";
import { ConversionError, type FetchFn } from "../types.js";

describe("GotenbergConverter", () => {
  it("POSTs to /forms/libreoffice/convert and returns bytes", async () => {
    const f = vi.fn<FetchFn>(async () => new Response(Buffer.from("PDF"), { status: 200 }));
    const c = new GotenbergConverter("http://g:3000", f);
    expect((await c.convert({ filename: "r.docx", data: Buffer.from("d") })).toString()).toBe("PDF");
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe("http://g:3000/forms/libreoffice/convert");
    expect((init!.body as FormData).get("files")).toBeInstanceOf(File);
  });
  it("wraps non-200 in ConversionError", async () => {
    const f = vi.fn<FetchFn>(async () => new Response("no", { status: 500 }));
    await expect(
      new GotenbergConverter("http://g", f).convert({ filename: "r.docx", data: Buffer.from("x") }),
    ).rejects.toBeInstanceOf(ConversionError);
  });
});
