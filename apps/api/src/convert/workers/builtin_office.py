#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
# --- How to run ---
# python3 apps/api/src/convert/workers/builtin_office.py input.docx output.pdf
# noqa: SIZE_OK - extracted subprocess worker keeps the builtin fallback self-contained.
import html
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import zipfile
import zlib
import xml.etree.ElementTree as ET

PER_ENTRY_MAX = 64 * 1024 * 1024
TOTAL_ARCHIVE_MAX = 256 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 256
MAX_COMPRESSION_RATIO = 200
XML_DECLARATION_SCAN_BYTES = 4096
ZIP_READ_STATE_ATTR = "_hwptopdf_zip_read_state"

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "ss": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
}


class ArchiveLimitError(RuntimeError):
    pass


class BuiltinOfficeError(RuntimeError):
    pass


class ZipReadState:
    __slots__ = ("archive_entry_count_checked", "read_entries", "total_size")

    def __init__(self):
        self.total_size = 0
        self.read_entries = 0
        self.archive_entry_count_checked = False


def zip_read_state(zf):
    state = getattr(zf, ZIP_READ_STATE_ATTR, None)
    if state is None:
        state = ZipReadState()
        setattr(zf, ZIP_READ_STATE_ATTR, state)
    return state


def ensure_archive_entry_count(zf, state):
    if state.archive_entry_count_checked:
        return
    if hasattr(zf, "infolist"):
        entry_count = len(zf.infolist())
        if entry_count > MAX_ARCHIVE_ENTRIES:
            raise ArchiveLimitError("archive contains too many entries")
    state.archive_entry_count_checked = True


def safe_read(zf, zinfo):
    state = zip_read_state(zf)
    ensure_archive_entry_count(zf, state)
    file_size = zinfo.file_size
    compressed_size = zinfo.compress_size
    if file_size > PER_ENTRY_MAX:
        raise ArchiveLimitError("archive entry is too large")
    if state.total_size + file_size > TOTAL_ARCHIVE_MAX:
        raise ArchiveLimitError("archive expands beyond the total read limit")
    if state.read_entries + 1 > MAX_ARCHIVE_ENTRIES:
        raise ArchiveLimitError("archive read count exceeds the entry limit")
    if compressed_size == 0 and file_size > 0:
        raise ArchiveLimitError("archive entry has an invalid compressed size")
    if compressed_size > 0 and file_size / compressed_size > MAX_COMPRESSION_RATIO:
        raise ArchiveLimitError("archive entry compression ratio is too high")
    state.total_size += file_size
    state.read_entries += 1
    return zf.read(zinfo.filename)


def xml_entries(zf, predicate):
    return [zinfo for zinfo in zf.infolist() if predicate(zinfo.filename)]


def zip_entry(zf, filename):
    for zinfo in zf.infolist():
        if zinfo.filename == filename:
            return zinfo
    return None


def has_blocked_xml_declaration(data):
    leading = data[:XML_DECLARATION_SCAN_BYTES].upper()
    return b"<!DOCTYPE" in leading or b"<!ENTITY" in leading


def parse_xml(data):
    if has_blocked_xml_declaration(data):
        return None
    try:
        return ET.fromstring(data)
    except ET.ParseError:
        return None


def text_from_xml(data):
    root = parse_xml(data)
    if root is None:
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
    names = xml_entries(
        zf,
        lambda name: name.startswith("word/") and name.endswith(".xml"),
    )
    preferred = [zinfo for zinfo in names if zinfo.filename == "word/document.xml"]
    return [text_from_xml(safe_read(zf, zinfo)) for zinfo in preferred or names]


def read_pptx(zf):
    names = sorted(
        xml_entries(
            zf,
            lambda name: name.startswith("ppt/slides/slide") and name.endswith(".xml"),
        ),
        key=lambda zinfo: zinfo.filename,
    )
    return [text_from_xml(safe_read(zf, zinfo)) for zinfo in names]


def shared_strings(zf):
    zinfo = zip_entry(zf, "xl/sharedStrings.xml")
    if zinfo is None:
        return []
    root = parse_xml(safe_read(zf, zinfo))
    if root is None:
        return []
    values = []
    for item in root.findall("ss:si", NS):
        values.append(" ".join(t.text or "" for t in item.findall(".//ss:t", NS)).strip())
    return values


def read_xlsx(zf):
    shared = shared_strings(zf)
    rows = []
    names = sorted(
        xml_entries(
            zf,
            lambda name: name.startswith("xl/worksheets/sheet") and name.endswith(".xml"),
        ),
        key=lambda zinfo: zinfo.filename,
    )
    for zinfo in names:
        root = parse_xml(safe_read(zf, zinfo))
        if root is None:
            continue
        rows.append(os.path.basename(zinfo.filename))
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
        xml_entries(
            zf,
            lambda name: name.lower().endswith(".xml")
            and (
                name.startswith("Contents/")
                or name.startswith("contents/")
                or name.startswith("content/")
            ),
        ),
        key=lambda zinfo: zinfo.filename,
    )
    if not names:
        names = sorted(
            xml_entries(zf, lambda name: name.lower().endswith(".xml")),
            key=lambda zinfo: zinfo.filename,
        )
    return [text_from_xml(safe_read(zf, zinfo)) for zinfo in names]


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
        return data[start : start + sector_size]

    fat = []
    for sid in difat:
        fat.extend(struct.unpack("<%di" % (sector_size // 4), sector(sid)))

    def read_regular(start, size=None):
        body = b"".join(sector(sid) for sid in sector_chain(start, fat))
        return body if size is None else body[:size]

    directory = read_regular(first_dir)
    entries = []
    for offset in range(0, len(directory), 128):
        item = directory[offset : offset + 128]
        if len(item) < 128:
            continue
        name_len = struct.unpack_from("<H", item, 64)[0]
        raw_name = item[: max(0, name_len - 2)]
        name = raw_name.decode("utf-16le", errors="ignore")
        entries.append(
            {
                "name": name,
                "type": item[66],
                "left": struct.unpack_from("<i", item, 68)[0],
                "right": struct.unpack_from("<i", item, 72)[0],
                "child": struct.unpack_from("<i", item, 76)[0],
                "start": struct.unpack_from("<i", item, 116)[0],
                "size": struct.unpack_from("<Q", item, 120)[0],
            }
        )

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
            chunks.append(ministream[begin : begin + mini_sector_size])
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
        tag = header & 0x3FF
        size = (header >> 20) & 0xFFF
        if size == 0xFFF:
            if pos + 4 > len(data):
                break
            size = struct.unpack_from("<I", data, pos)[0]
            pos += 4
        if size < 0 or pos + size > len(data):
            break
        payload = data[pos : pos + size]
        pos += size
        if tag == 67:
            values.extend(utf16_strings(payload, 2))
    return values


def read_hwp(path):
    with open(path, "rb") as fh:
        raw = fh.read()
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
        raise BuiltinOfficeError(
            "could not extract text from binary HWP; install Hancom/LibreOffice/Gotenberg for full rendering"
        )
    return lines


def render_with_rhwp(path, out_path):
    try:
        import rhwp
    except Exception:  # noqa: BROAD_EXCEPT_OK
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
    except Exception:  # noqa: BROAD_EXCEPT_OK
        return False
    return False


def extract_lines(path):
    lower = path.lower()
    if lower.endswith(".doc"):
        raise BuiltinOfficeError("legacy .doc requires LibreOffice or Gotenberg")
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
            raise BuiltinOfficeError("unsupported builtin office format")
    return [line for line in lines if line]


def chrome_binary():
    override = os.environ.get("GOOGLE_CHROME") or os.environ.get("CHROME_BIN")
    candidates = [override, "google-chrome", "google-chrome-stable", "chromium-browser", "chromium"]
    for candidate in candidates:
        if candidate and shutil.which(candidate):
            return shutil.which(candidate)
    raise BuiltinOfficeError("google chrome/chromium is required for builtin PDF rendering")


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
