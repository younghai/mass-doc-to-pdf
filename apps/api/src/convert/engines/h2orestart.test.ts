import { describe, it, expect, vi } from "vitest";
import { H2OrestartConverter } from "./h2orestart.js";
import { ConversionError, type FetchFn } from "../types.js";

describe("H2OrestartConverter", () => {
  it("POSTs the HWP file to /convert and returns PDF bytes", async () => {
    const f = vi.fn<FetchFn>(
      async () => new Response(Buffer.from("HWPPDF"), { status: 200 }),
    );
    const c = new H2OrestartConverter("http://hwp:8080", f);
    expect((await c.convert({ filename: "doc.hwp", data: Buffer.from("hwp") })).toString()).toBe(
      "HWPPDF",
    );
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe("http://hwp:8080/convert");
    expect((init!.body as FormData).get("file")).toBeInstanceOf(File);
  });
  it("wraps backend failures in ConversionError", async () => {
    const f = vi.fn<FetchFn>(async () => new Response("err", { status: 422 }));
    await expect(
      new H2OrestartConverter("http://hwp:8080", f).convert({
        filename: "doc.hwp",
        data: Buffer.from("x"),
      }),
    ).rejects.toBeInstanceOf(ConversionError);
  });
});
