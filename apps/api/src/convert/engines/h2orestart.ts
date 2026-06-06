import {
  ConversionError,
  toFilePart,
  type Converter,
  type ConvertInput,
  type FetchFn,
} from "../types.js";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BUILTIN_OFFICE_SCRIPT = String.raw`
import html
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "ss": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
}


def text_from_xml(data):
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        return ""
    parts = []
    for elem in root.iter():
        tag = elem.tag.rsplit("}", 1)[-1]
        if tag in {"t", "instrText"} and elem.text:
            parts.append(elem.text)
        elif tag in {"br", "tab", "p", "tr"}:
            parts.append("\n")
    return " ".join("".join(parts).split())


def read_docx(zf):
    names = [name for name in zf.namelist() if name.startswith("word/") and name.endswith(".xml")]
    preferred = [name for name in names if name == "word/document.xml"]
    return [text_from_xml(zf.read(name)) for name in preferred or names]


def read_pptx(zf):
    names = sorted(name for name in zf.namelist() if name.startswith("ppt/slides/slide") and name.endswith(".xml"))
    return [text_from_xml(zf.read(name)) for name in names]


def shared_strings(zf):
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    try:
        root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    except ET.ParseError:
        return []
    values = []
    for item in root.findall("ss:si", NS):
        values.append(" ".join(t.text or "" for t in item.findall(".//ss:t", NS)).strip())
    return values


def read_xlsx(zf):
    shared = shared_strings(zf)
    rows = []
    names = sorted(name for name in zf.namelist() if name.startswith("xl/worksheets/sheet") and name.endswith(".xml"))
    for name in names:
        try:
            root = ET.fromstring(zf.read(name))
        except ET.ParseError:
            continue
        rows.append(os.path.basename(name))
        for row in root.findall(".//ss:row", NS):
            cells = []
            for cell in row.findall("ss:c", NS):
                value = cell.find("ss:v", NS)
                if value is None or value.text is None:
                    continue
                if cell.attrib.get("t") == "s":
                    try:
                        cells.append(shared[int(value.text)])
                    except (ValueError, IndexError):
                        cells.append(value.text)
                else:
                    cells.append(value.text)
            if cells:
                rows.append(" | ".join(cells))
    return rows


def read_hwpx(zf):
    names = sorted(
        name for name in zf.namelist()
        if name.lower().endswith(".xml") and (
            name.startswith("Contents/") or name.startswith("Contents/") or name.startswith("content/")
        )
    )
    if not names:
        names = sorted(name for name in zf.namelist() if name.lower().endswith(".xml"))
    return [text_from_xml(zf.read(name)) for name in names]


def extract_lines(path):
    lower = path.lower()
    if lower.endswith(".doc") or lower.endswith(".hwp"):
        raise RuntimeError("legacy binary formats require LibreOffice, Gotenberg, Hancom, or HWPX normalization")
    with zipfile.ZipFile(path) as zf:
        if lower.endswith(".docx"):
            lines = read_docx(zf)
        elif lower.endswith(".pptx"):
            lines = read_pptx(zf)
        elif lower.endswith(".xlsx"):
            lines = read_xlsx(zf)
        elif lower.endswith(".hwpx"):
            lines = read_hwpx(zf)
        else:
            raise RuntimeError("unsupported builtin office format")
    return [line for line in lines if line]


def chrome_binary():
    override = os.environ.get("GOOGLE_CHROME") or os.environ.get("CHROME_BIN")
    candidates = [override, "google-chrome", "google-chrome-stable", "chromium-browser", "chromium"]
    for candidate in candidates:
        if candidate and shutil.which(candidate):
            return shutil.which(candidate)
    raise RuntimeError("google chrome/chromium is required for builtin PDF rendering")


def render_pdf(lines, out_path):
    body = "\n".join("<p>%s</p>" % html.escape(line) for line in lines) or "<p></p>"
    doc = """<!doctype html><html><head><meta charset='utf-8'>
<style>
@page { size: A4; margin: 16mm; }
body { font-family: Arial, 'Noto Sans CJK KR', sans-serif; font-size: 12px; line-height: 1.55; color: #111; }
p { margin: 0 0 8px; white-space: pre-wrap; }
</style></head><body>%s</body></html>""" % body
    with tempfile.TemporaryDirectory() as temp:
        html_path = os.path.join(temp, "input.html")
        with open(html_path, "w", encoding="utf-8") as fh:
            fh.write(doc)
        subprocess.run(
            [
                chrome_binary(),
                "--headless=new",
                "--no-sandbox",
                "--disable-gpu",
                "--disable-dev-shm-usage",
                "--print-to-pdf=%s" % out_path,
                "file://%s" % html_path,
            ],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )


def main():
    input_path, output_path = sys.argv[1], sys.argv[2]
    render_pdf(extract_lines(input_path), output_path)


if __name__ == "__main__":
    main()
`;

export class H2OrestartConverter implements Converter {
  readonly name = "h2orestart";
  constructor(
    private readonly baseUrl: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async convert({ filename, data }: ConvertInput): Promise<Buffer> {
    const form = new FormData();
    form.append("file", new File([toFilePart(data)], filename));
    const url = `${this.baseUrl}/convert`;
    let res: Response;
    try {
      res = await this.fetchFn(url, { method: "POST", body: form });
    } catch (cause) {
      throw new ConversionError(this.name, `request to ${url} failed`, cause);
    }
    if (!res.ok) {
      throw new ConversionError(
        this.name,
        `backend ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`,
      );
    }
    return Buffer.from(await res.arrayBuffer());
  }
}

export class BuiltinOfficeConverter implements Converter {
  readonly name = "builtin-office";

  async convert(input: ConvertInput): Promise<Buffer> {
    const dir = await mkdtemp(join(tmpdir(), "hwptopdf-office-"));
    const inputPath = join(dir, basename(input.filename) || "document");
    const outputPath = join(dir, "output.pdf");

    try {
      await writeFile(inputPath, input.data);
      await execFileAsync("python3", ["-c", BUILTIN_OFFICE_SCRIPT, inputPath, outputPath], {
        maxBuffer: 8 * 1024 * 1024,
      });
      return Buffer.from(await readFile(outputPath));
    } catch (cause) {
      throw new ConversionError(this.name, "builtin conversion failed", cause);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
