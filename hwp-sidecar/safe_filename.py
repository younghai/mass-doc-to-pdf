from __future__ import annotations

import pathlib


def safe_upload_name(filename: str | None) -> str:
    if not filename:
        return "input"
    name = pathlib.PurePosixPath(filename.replace("\\", "/")).name
    if not name or name in {".", ".."}:
        return "input"
    return name
