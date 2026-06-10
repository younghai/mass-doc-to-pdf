import os
import pathlib
import subprocess
import tempfile

from flask import Flask, abort, request, send_file
from safe_filename import safe_upload_name

app = Flask(__name__)
# Reject uploads larger than 128 MB before they reach LibreOffice.
app.config["MAX_CONTENT_LENGTH"] = 128 * 1024 * 1024

_MACRO_SECURITY_XCU = """\
<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry"
           xmlns:xs="http://www.w3.org/2001/XMLSchema"
           xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <item oor:path="/org.openoffice.Office.Common/Security/Scripting">
    <prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop>
  </item>
</oor:items>
"""


def _write_macro_security(louser_dir: pathlib.Path) -> None:
    xcu = louser_dir / "user" / "registrymodifications.xcu"
    xcu.parent.mkdir(parents=True, exist_ok=True)
    xcu.write_text(_MACRO_SECURITY_XCU)


@app.post("/convert")
def convert():
    f = request.files.get("file")
    if not f:
        abort(400, "field 'file' required")
    with tempfile.TemporaryDirectory() as d:
        src = pathlib.Path(d) / safe_upload_name(f.filename)
        f.save(src)
        louser = pathlib.Path(d) / "louser"
        _write_macro_security(louser)
        result = subprocess.run(
            [
                "soffice",
                f"-env:UserInstallation=file://{louser}",
                "--headless",
                "--norestore",
                "--convert-to",
                "pdf",
                "--outdir",
                d,
                str(src),
            ],
            capture_output=True,
            timeout=120,
        )
        pdf = src.with_suffix(".pdf")
        if result.returncode != 0 or not pdf.exists():
            abort(422, result.stderr.decode()[:500] or "conversion failed")
        return send_file(pdf, mimetype="application/pdf")


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    app.run(host=os.getenv("HOST", "0.0.0.0"), port=int(os.getenv("PORT", "8080")))
