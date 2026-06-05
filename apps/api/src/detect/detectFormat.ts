import type { DocFormat } from "@hwptopdf/shared";

const OFFICE_EXTS = new Set(["docx", "doc", "xlsx", "xls", "pptx", "ppt", "odt", "ods", "odp", "rtf"]);
const HWP_EXTS = new Set(["hwp", "hwpx"]);
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

const MIME: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  ppt: "application/vnd.ms-powerpoint",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  rtf: "application/rtf",
  hwp: "application/x-hwp",
  hwpx: "application/hwp+zip",
};

export function extOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i === -1 ? "" : filename.slice(i + 1).toLowerCase();
}

export function detectFormat(filename: string, head: Buffer): DocFormat {
  const ext = extOf(filename);
  if (HWP_EXTS.has(ext)) {
    if (ext === "hwp" && !head.subarray(0, 8).equals(OLE_MAGIC)) {
      throw new Error(`Invalid HWP signature for "${filename}" (expected OLE compound file)`);
    }
    return "hwp";
  }
  if (OFFICE_EXTS.has(ext)) return "office";
  throw new Error(`Unsupported file extension ".${ext}" for "${filename}"`);
}

export function fileMeta(filename: string, head: Buffer) {
  const extension = extOf(filename);
  const format = detectFormat(filename, head);
  return { extension, mimeType: MIME[extension] ?? "application/octet-stream", format };
}
