import { describe, it, expect } from "vitest";
import { ConversionError, type Converter } from "./types.js";

describe("converter contract", () => {
  it("ConversionError carries engine + cause", () => {
    const e = new ConversionError("gotenberg", "boom", new Error("x"));
    expect(e.engine).toBe("gotenberg");
    expect(e.message).toMatch(/boom/);
  });
  it("implements Converter", async () => {
    const c: Converter = {
      name: "f",
      async convert(i) {
        return Buffer.concat([Buffer.from("P:"), i.data]);
      },
    };
    expect((await c.convert({ filename: "a.docx", data: Buffer.from("x") })).toString()).toBe("P:x");
  });
});
