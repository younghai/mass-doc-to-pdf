import { describe, it, expect } from "vitest";
import { detectFormat, fileMeta } from "./detectFormat.js";

const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

describe("detectFormat", () => {
  it("classifies office extensions", () => {
    for (const ext of ["docx", "xlsx", "pptx", "doc", "xls", "ppt"]) {
      expect(detectFormat(`f.${ext}`, ZIP)).toBe("office");
    }
  });
  it("classifies hwp (OLE) and hwpx (zip)", () => {
    expect(detectFormat("a.hwp", OLE)).toBe("hwp");
    expect(detectFormat("a.hwpx", ZIP)).toBe("hwp");
  });
  it("is case-insensitive", () => expect(detectFormat("A.HWP", OLE)).toBe("hwp"));
  it("throws on unsupported ext", () =>
    expect(() => detectFormat("a.png", Buffer.alloc(8))).toThrow(/unsupported/i));
  it("throws on misnamed hwp", () =>
    expect(() => detectFormat("a.hwp", ZIP)).toThrow(/signature/i));
});

describe("fileMeta", () => {
  it("returns extension + mime + format", () => {
    expect(fileMeta("Report.DOCX", ZIP)).toEqual({
      extension: "docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      format: "office",
    });
  });
});
