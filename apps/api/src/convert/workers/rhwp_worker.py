#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["rhwp-python>=0.5.1"]
# ///
# --- How to run ---
# uv run apps/api/src/convert/workers/rhwp_worker.py input.hwp output.pdf
from __future__ import annotations

import importlib
import json
import os
import sys
from pathlib import Path


def _emit(payload: dict[str, str | int]) -> None:
    print(json.dumps(payload, ensure_ascii=False))


def _apply_font_paths(rhwp) -> str | None:
    """Best-effort: rhwp-python's font API differs across versions, so try the
    known entry points guarded by hasattr and report which one applied."""
    raw = os.environ.get("RHWP_FONT_PATHS", "")
    paths = [p for p in (s.strip() for s in raw.split(":")) if p]
    if not paths:
        return None
    for name in ("set_font_paths", "set_font_dirs", "add_font_paths"):
        fn = getattr(rhwp, name, None)
        if callable(fn):
            try:
                fn(paths)
                return name
            except (TypeError, ValueError):
                continue
    return None


def _fail(message: str) -> int:
    print(json.dumps({"error": message}, ensure_ascii=False), file=sys.stderr)
    return 2


def _export_with_document(doc, output_path: Path) -> int:
    export_pdf = getattr(doc, "export_pdf", None)
    if callable(export_pdf):
        byte_size = export_pdf(str(output_path))
        _emit({"engine": "rhwp", "method": "export_pdf", "bytes": int(byte_size)})
        return 0

    render_pdf = getattr(doc, "render_pdf", None)
    if callable(render_pdf):
        pdf = render_pdf()
        output_path.write_bytes(bytes(pdf))
        _emit({"engine": "rhwp", "method": "render_pdf", "bytes": output_path.stat().st_size})
        return 0

    return _fail("rhwp document does not expose export_pdf or render_pdf")


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        return _fail("usage: rhwp_worker.py <input.hwp|input.hwpx> <output.pdf>")

    input_path = Path(argv[1])
    output_path = Path(argv[2])

    try:
        rhwp = importlib.import_module("rhwp")
    except ModuleNotFoundError:
        return _fail("python package rhwp-python is not installed")

    parse = getattr(rhwp, "parse", None)
    if not callable(parse):
        return _fail("rhwp.parse is not available")

    applied = _apply_font_paths(rhwp)
    if applied is not None:
        print(
            json.dumps({"info": f"font paths applied via {applied}"}),
            file=sys.stderr,
        )
    elif os.environ.get("RHWP_FONT_PATHS", "").strip():
        print(
            json.dumps({"info": "font paths set in env only (no rhwp font API found)"}),
            file=sys.stderr,
        )

    try:
        doc = parse(str(input_path))
        return _export_with_document(doc, output_path)
    except (AttributeError, OSError, RuntimeError, TypeError) as exc:
        return _fail(f"rhwp export failed: {exc}")


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
