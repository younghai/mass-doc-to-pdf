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
  it("aborts a hung sidecar request after timeoutMs", async () => {
    const hangingFetch: FetchFn = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })),
        );
      });
    const c = new H2OrestartConverter("http://sidecar", hangingFetch, 20);
    await expect(
      c.convert({ filename: "a.hwp", data: Buffer.from("x") }),
    ).rejects.toThrow(/timed out after 20ms/);
  });
  it("passes an abort signal to fetch", async () => {
    const f = vi.fn<FetchFn>(async (_url, init) => {
      expect(init!.signal).toBeInstanceOf(AbortSignal);
      return new Response(Buffer.from("HWPPDF"), { status: 200 });
    });
    const c = new H2OrestartConverter("http://hwp:8080", f);
    expect((await c.convert({ filename: "doc.hwp", data: Buffer.from("hwp") })).toString()).toBe(
      "HWPPDF",
    );
  });
});
