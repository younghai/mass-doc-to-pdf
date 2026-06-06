import os
import pathlib
import subprocess
import tempfile

from flask import Flask, abort, request, send_file
from safe_filename import safe_upload_name

app = Flask(__name__)


@app.post("/convert")
def convert():
    f = request.files.get("file")
    if not f:
        abort(400, "field 'file' required")
    with tempfile.TemporaryDirectory() as d:
        src = pathlib.Path(d) / safe_upload_name(f.filename)
        f.save(src)
        result = subprocess.run(
            ["soffice", "--headless", "--convert-to", "pdf", "--outdir", d, str(src)],
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
