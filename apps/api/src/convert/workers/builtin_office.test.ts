import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { BuiltinOfficeConverter } from "../engines/h2orestart.js";

const execFileAsync = promisify(execFile);
const NORMAL_DOCX =
  "UEsDBBQAAAAIAOQo6FwnQJe5fQAAAKkAAAARAAAAd29yZC9kb2N1bWVudC54bWxFzkEOwjAMBMCvVH0ArjhwiEr/kiamjajtyHEJ/J6mHLjMylpp5bG6KGEnZOvetHFx9d6vZtkBlLAi+XKRjHx0D1Hydpy6QBWNWSVgKYkX2uA6DDcgn7ifxupmiZ+WuaENm+Y9bZa4C8IvVEPtCskTR2hlU0/z6W8A/s9NX1BLAQIUAxQAAAAIAOQo6FwnQJe5fQAAAKkAAAARAAAAAAAAAAAAAACAAQAAAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAQABAD8AAACsAAAAAAA=";

function outputField(value: unknown, field: "stdout" | "stderr"): string {
  if (typeof value !== "object" || value === null || !(field in value)) return "";
  const raw = Reflect.get(value, field);
  return typeof raw === "string" ? raw : "";
}

async function expectPythonUnitTestsToPass(source: string): Promise<void> {
  try {
    await execFileAsync("python3", ["-c", source], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PYTHONPATH: `${process.cwd()}/src/convert/workers`,
      },
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    const stdout = outputField(error, "stdout");
    const stderr = outputField(error, "stderr");
    throw new Error(`python unit tests failed\n${stdout}${stderr}`);
  }
}

describe("builtin office Python extractor", () => {
  it("converts a normal DOCX through the extracted worker subprocess", async () => {
    const dir = await mkdtemp(join(tmpdir(), "builtin-office-test-"));
    const fakeChrome = join(dir, "chrome");
    const previousChrome = process.env.CHROME_BIN;
    await writeFile(
      fakeChrome,
      [
        "#!/bin/sh",
        'out=""',
        'for arg in "$@"; do',
        '  case "$arg" in --print-to-pdf=*) out="${arg#--print-to-pdf=}" ;; esac',
        "done",
        'if [ -z "$out" ]; then exit 2; fi',
        "printf '%s\\n' '%PDF-1.7 fake' > \"$out\"",
      ].join("\n"),
    );
    await chmod(fakeChrome, 0o755);
    process.env.CHROME_BIN = fakeChrome;

    try {
      const pdf = await new BuiltinOfficeConverter(5_000).convert({
        filename: "normal.docx",
        data: Buffer.from(NORMAL_DOCX, "base64"),
      });

      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    } finally {
      if (previousChrome === undefined) {
        delete process.env.CHROME_BIN;
      } else {
        process.env.CHROME_BIN = previousChrome;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects XML entity declarations while preserving normal text parsing", async () => {
    await expectPythonUnitTestsToPass(`
import unittest
import builtin_office as target


class XmlEntityGuardTest(unittest.TestCase):
    def test_rejects_doctype_and_entity_declarations(self):
        doctype_payload = b'<!DOCTYPE x [<!ENTITY boom "EXPANDED">]><root><t>&boom;</t></root>'
        entity_payload = b'<?xml version="1.0"?><!ENTITY boom "EXPANDED"><root><t>safe</t></root>'

        self.assertEqual("", target.text_from_xml(doctype_payload))
        self.assertEqual("", target.text_from_xml(entity_payload))

    def test_normal_xml_text_still_parses(self):
        payload = b'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello world</w:t></w:r></w:p></w:body></w:document>'

        self.assertEqual("Hello world", target.text_from_xml(payload))


if __name__ == "__main__":
    unittest.main()
`);
  });

  it("enforces archive read caps without large payloads", async () => {
    await expectPythonUnitTestsToPass(`
import unittest
import builtin_office as target


class FakeZipInfo:
    def __init__(self, filename, file_size, compress_size):
        self.filename = filename
        self.file_size = file_size
        self.compress_size = compress_size


class FakeZipFile:
    def __init__(self):
        self.read_calls = []

    def read(self, filename):
        self.read_calls.append(filename)
        return b"ok"


class SafeReadTest(unittest.TestCase):
    def test_rejects_oversized_entry_before_reading(self):
        zf = FakeZipFile()
        zinfo = FakeZipInfo("word/document.xml", target.PER_ENTRY_MAX + 1, 1)

        with self.assertRaises(target.ArchiveLimitError):
            target.safe_read(zf, zinfo)

        self.assertEqual([], zf.read_calls)

    def test_rejects_cumulative_expansion_over_total_cap(self):
        zf = FakeZipFile()
        chunk_size = target.TOTAL_ARCHIVE_MAX // 4
        for index in range(4):
            target.safe_read(zf, FakeZipInfo(f"part-{index}.xml", chunk_size, chunk_size))

        with self.assertRaises(target.ArchiveLimitError):
            target.safe_read(zf, FakeZipInfo("overflow.xml", 1, 1))

    def test_rejects_entry_count_over_cap(self):
        zf = FakeZipFile()
        for index in range(target.MAX_ARCHIVE_ENTRIES):
            target.safe_read(zf, FakeZipInfo(f"part-{index}.xml", 0, 0))

        with self.assertRaises(target.ArchiveLimitError):
            target.safe_read(zf, FakeZipInfo("extra.xml", 0, 0))

    def test_rejects_extreme_compression_ratio_before_reading(self):
        zf = FakeZipFile()
        zinfo = FakeZipInfo("ratio.xml", target.MAX_COMPRESSION_RATIO + 1, 1)

        with self.assertRaises(target.ArchiveLimitError):
            target.safe_read(zf, zinfo)

        self.assertEqual([], zf.read_calls)


if __name__ == "__main__":
    unittest.main()
`);
  });

  it("extracts normal DOCX and HWPX text after hardening", async () => {
    await expectPythonUnitTestsToPass(`
import os
import tempfile
import unittest
import zipfile
import builtin_office as target


class NormalExtractionTest(unittest.TestCase):
    def test_docx_and_hwpx_text_extraction_still_work(self):
        with tempfile.TemporaryDirectory() as temp:
            docx_path = os.path.join(temp, "normal.docx")
            with zipfile.ZipFile(docx_path, "w", zipfile.ZIP_DEFLATED) as zf:
                zf.writestr(
                    "word/document.xml",
                    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>normal docx text</w:t></w:r></w:p></w:body></w:document>',
                )

            hwpx_path = os.path.join(temp, "normal.hwpx")
            with zipfile.ZipFile(hwpx_path, "w", zipfile.ZIP_DEFLATED) as zf:
                zf.writestr(
                    "Contents/section0.xml",
                    '<hp:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"><hp:t>normal hwpx text</hp:t></hp:sec>',
                )

            self.assertEqual(["normal docx text"], target.extract_lines(docx_path))
            self.assertEqual(["normal hwpx text"], target.extract_lines(hwpx_path))


if __name__ == "__main__":
    unittest.main()
`);
  });
});
