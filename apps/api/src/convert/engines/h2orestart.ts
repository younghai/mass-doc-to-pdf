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
import re
import struct
import xml.etree.ElementTree as ET
import zlib

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


def clean_text(value):
    value = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]+", " ", value)
    return " ".join(value.split())


def utf16_strings(data, min_len=4):
    try:
        decoded = data.decode("utf-16le", errors="ignore")
    except UnicodeDecodeError:
        return []
    values = []
    current = []
    for ch in decoded:
        if ch in "\r\n\t" or (ch.isprintable() and ch not in "\uffff\ufffe"):
            current.append(ch)
            continue
        if len(current) >= min_len:
            value = clean_text("".join(current))
            if value:
                values.append(value)
        current = []
    if len(current) >= min_len:
        value = clean_text("".join(current))
        if value:
            values.append(value)
    return values


def sector_chain(start, fat, end_mark=0xFFFFFFFE):
    chain = []
    seen = set()
    sid = start
    while sid not in seen and 0 <= sid < len(fat) and sid != end_mark:
        seen.add(sid)
        chain.append(sid)
        sid = fat[sid]
    return chain


def cfb_streams(data):
    if len(data) < 512 or data[:8] != b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        return {}
    sector_size = 1 << struct.unpack_from("<H", data, 30)[0]
    mini_sector_size = 1 << struct.unpack_from("<H", data, 32)[0]
    first_dir = struct.unpack_from("<i", data, 48)[0]
    cutoff = struct.unpack_from("<I", data, 56)[0]
    first_minifat = struct.unpack_from("<i", data, 60)[0]
    minifat_count = struct.unpack_from("<I", data, 64)[0]
    difat = [sid for sid in struct.unpack_from("<109i", data, 76) if sid >= 0]

    def sector(sid):
        start = (sid + 1) * sector_size
        return data[start:start + sector_size]

    fat = []
    for sid in difat:
        fat.extend(struct.unpack("<%di" % (sector_size // 4), sector(sid)))

    def read_regular(start, size=None):
        body = b"".join(sector(sid) for sid in sector_chain(start, fat))
        return body if size is None else body[:size]

    directory = read_regular(first_dir)
    entries = []
    for offset in range(0, len(directory), 128):
        item = directory[offset:offset + 128]
        if len(item) < 128:
            continue
        name_len = struct.unpack_from("<H", item, 64)[0]
        raw_name = item[:max(0, name_len - 2)]
        name = raw_name.decode("utf-16le", errors="ignore")
        entries.append({
            "name": name,
            "type": item[66],
            "left": struct.unpack_from("<i", item, 68)[0],
            "right": struct.unpack_from("<i", item, 72)[0],
            "child": struct.unpack_from("<i", item, 76)[0],
            "start": struct.unpack_from("<i", item, 116)[0],
            "size": struct.unpack_from("<Q", item, 120)[0],
        })

    if not entries:
        return {}

    root = entries[0]
    minifat = []
    if first_minifat >= 0 and minifat_count:
        body = b"".join(sector(sid) for sid in sector_chain(first_minifat, fat))
        minifat = list(struct.unpack("<%di" % (len(body) // 4), body))
    ministream = read_regular(root["start"], root["size"]) if root["start"] >= 0 else b""

    def read_mini(start, size):
        chunks = []
        for sid in sector_chain(start, minifat):
            begin = sid * mini_sector_size
            chunks.append(ministream[begin:begin + mini_sector_size])
        return b"".join(chunks)[:size]

    streams = {}

    def walk(idx, parent):
        if idx < 0 or idx >= len(entries):
            return
        entry = entries[idx]
        walk(entry["left"], parent)
        name = entry["name"]
        path = "%s/%s" % (parent, name) if parent and name else name
        if entry["type"] in {1, 5}:
            child_parent = parent if entry["type"] == 5 else path
            walk(entry["child"], child_parent)
        elif entry["type"] == 2 and entry["start"] >= 0:
            if entry["size"] < cutoff and minifat:
                streams[path] = read_mini(entry["start"], entry["size"])
            else:
                streams[path] = read_regular(entry["start"], entry["size"])
        walk(entry["right"], parent)

    walk(root["child"], "")
    return streams


def hwp_record_text(data):
    values = []
    pos = 0
    while pos + 4 <= len(data):
        header = struct.unpack_from("<I", data, pos)[0]
        pos += 4
        tag = header & 0x3ff
        size = (header >> 20) & 0xfff
        if size == 0xfff:
            if pos + 4 > len(data):
                break
            size = struct.unpack_from("<I", data, pos)[0]
            pos += 4
        if size < 0 or pos + size > len(data):
            break
        payload = data[pos:pos + size]
        pos += size
        if tag == 67:
            values.extend(utf16_strings(payload, 2))
    return values


def read_hwp(path):
    raw = open(path, "rb").read()
    streams = cfb_streams(raw)
    header = streams.get("FileHeader", b"")
    compressed = True
    if len(header) >= 40:
        compressed = bool(struct.unpack_from("<I", header, 36)[0] & 1)
    body_names = sorted(name for name in streams if name.lower().startswith("bodytext/section"))
    lines = []
    for name in body_names:
        body = streams[name]
        candidates = []
        if compressed:
            try:
                candidates.append(zlib.decompress(body, -15))
            except zlib.error:
                candidates.append(body)
        else:
            candidates.append(body)
        for candidate in candidates:
            lines.extend(hwp_record_text(candidate))
            if not lines:
                lines.extend(utf16_strings(candidate))
    if not lines:
        lines = utf16_strings(raw)
    if not lines:
        raise RuntimeError("could not extract text from binary HWP; install Hancom/LibreOffice/Gotenberg for full rendering")
    return lines


def render_with_rhwp(path, out_path):
    try:
        import rhwp
    except Exception:
        return False
    try:
        document = rhwp.parse(path)
        if hasattr(document, "export_pdf"):
            document.export_pdf(out_path)
            return os.path.exists(out_path) and os.path.getsize(out_path) > 0
        if hasattr(document, "render_pdf"):
            pdf = document.render_pdf()
            with open(out_path, "wb") as fh:
                fh.write(pdf)
            return os.path.exists(out_path) and os.path.getsize(out_path) > 0
    except Exception:
        return False
    return False


def extract_lines(path):
    lower = path.lower()
    if lower.endswith(".doc"):
        raise RuntimeError("legacy .doc requires LibreOffice or Gotenberg")
    if lower.endswith(".hwp"):
        return read_hwp(path)
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
    lower = input_path.lower()
    if lower.endswith(".hwp") or lower.endswith(".hwpx"):
        if render_with_rhwp(input_path, output_path):
            return
    render_pdf(extract_lines(input_path), output_path)


if __name__ == "__main__":
    main()
`;

export class H2OrestartConverter implements Converter {
  readonly name = "h2orestart";
  constructor(
    private readonly baseUrl: string,
    private readonly fetchFn: FetchFn = fetch,
    // Slightly above the sidecar's internal soffice timeout (120s) so the
    // sidecar's own 422 wins over a client-side abort, and a hung sidecar
    // (network black hole) cannot stall the worker for undici's ~10min default.
    private readonly timeoutMs = 150_000,
  ) {}

  async convert({ filename, data }: ConvertInput): Promise<Buffer> {
    const form = new FormData();
    form.append("file", new File([toFilePart(data)], filename));
    const url = `${this.baseUrl}/convert`;
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      if (cause instanceof Error && cause.name === "TimeoutError") {
        throw new ConversionError(
          this.name,
          `request to ${url} timed out after ${this.timeoutMs}ms`,
          cause,
        );
      }
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
  // Chrome headless inside the script is the hang risk; SIGKILL because a hung
  // Chrome can ignore the default SIGTERM and leave the worker stuck forever.
  constructor(private readonly timeoutMs = Number(process.env.BUILTIN_TIMEOUT_MS ?? 120_000)) {}

  async convert(input: ConvertInput): Promise<Buffer> {
    const dir = await mkdtemp(join(tmpdir(), "hwptopdf-office-"));
    const inputPath = join(dir, basename(input.filename) || "document");
    const outputPath = join(dir, "output.pdf");

    try {
      await writeFile(inputPath, input.data);
      await execFileAsync("python3", ["-c", BUILTIN_OFFICE_SCRIPT, inputPath, outputPath], {
        maxBuffer: 8 * 1024 * 1024,
        timeout: this.timeoutMs,
        killSignal: "SIGKILL",
      });
      return Buffer.from(await readFile(outputPath));
    } catch (cause) {
      throw new ConversionError(this.name, "builtin conversion failed", cause);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
