#!/usr/bin/env bash
set -euo pipefail

QUALITY_MODE="${QUALITY_MODE:-precise}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env.standalone}"

if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

WEB_URL="${WEB_URL:-${WEB_ORIGIN:-http://localhost}}"
API_URL="${API_URL:-http://127.0.0.1:${PORT:-18010}}"
SIDECAR_URL="${SIDECAR_URL:-${HWP_SIDECAR_URL:-http://127.0.0.1:${SIDECAR_PORT:-18080}}}"
SMOKE_WAIT_ATTEMPTS="${SMOKE_WAIT_ATTEMPTS:-30}"
SMOKE_WAIT_SECONDS="${SMOKE_WAIT_SECONDS:-1}"

wait_for_body() {
  local label="$1"
  local url="$2"
  for _ in $(seq 1 "$SMOKE_WAIT_ATTEMPTS"); do
    if curl -fsS "$url" 2>/dev/null; then
      return 0
    fi
    sleep "$SMOKE_WAIT_SECONDS"
  done
  echo "$label not ready: $url" >&2
  return 1
}

wait_for_code() {
  local label="$1"
  local url="$2"
  for _ in $(seq 1 "$SMOKE_WAIT_ATTEMPTS"); do
    if curl -fsS -o /dev/null -w "%{http_code}\n" "$url" 2>/dev/null; then
      return 0
    fi
    sleep "$SMOKE_WAIT_SECONDS"
  done
  echo "$label not ready: $url" >&2
  return 1
}

printf "web: "
wait_for_code web "$WEB_URL"

printf "api: "
wait_for_body api "$API_URL/health"
printf "\n"

if [ "${OFFICE_ENGINE:-builtin}" = "hwp-sidecar" ]; then
  printf "sidecar: "
  wait_for_body sidecar "$SIDECAR_URL/health"
  printf "\n"
else
  printf "sidecar: skipped (OFFICE_ENGINE=%s)\n" "${OFFICE_ENGINE:-builtin}"
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
DOCX="$TMP_DIR/smoke.docx"
JOB_JSON="$TMP_DIR/job.json"
PDF="$TMP_DIR/smoke.pdf"
QUALITY_JSON="$TMP_DIR/quality.json"

DOCX="$DOCX" python3 - <<'PY'
import os
import zipfile

docx = os.environ["DOCX"]
content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"""
rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""
document = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>standalone smoke conversion</w:t></w:r></w:p></w:body>
</w:document>"""
with zipfile.ZipFile(docx, "w", zipfile.ZIP_DEFLATED) as zf:
    zf.writestr("[Content_Types].xml", content_types)
    zf.writestr("_rels/.rels", rels)
    zf.writestr("word/document.xml", document)
PY

printf "upload: "
curl -fsS -X POST -F "file=@$DOCX" "$WEB_URL/api/convert?qualityMode=$QUALITY_MODE" > "$JOB_JSON"
JOB_ID="$(python3 - <<'PY' "$JOB_JSON"
import json
import sys
print(json.load(open(sys.argv[1]))["id"])
PY
)"
printf "%s\n" "$JOB_ID"

printf "convert: "
for _ in $(seq 1 30); do
  STATUS="$(curl -fsS "$WEB_URL/api/jobs/$JOB_ID" | python3 -c '
import json
import sys
data = json.load(sys.stdin)
print(data["status"])
if data.get("error"):
    print(data["error"], file=sys.stderr)
')"
  if [ "$STATUS" = "success" ]; then
    printf "success\n"
    break
  fi
  if [ "$STATUS" = "failed" ]; then
    echo "failed" >&2
    exit 1
  fi
  sleep 1
done

if [ "$STATUS" != "success" ]; then
  echo "timed out waiting for conversion" >&2
  exit 1
fi

curl -fsS "$WEB_URL/api/jobs/$JOB_ID/download" -o "$PDF"
if ! head -c 5 "$PDF" | grep -q "%PDF-"; then
  echo "download is not a PDF" >&2
  exit 1
fi
printf "download: %s bytes\n" "$(wc -c < "$PDF")"

printf "quality: "
curl -fsS "$WEB_URL/api/jobs/$JOB_ID/quality" -o "$QUALITY_JSON"
python3 - <<'PY' "$QUALITY_JSON"
import json
import sys

data = json.load(open(sys.argv[1]))
mode = data.get("mode", "-")
status = data.get("status", "-")
action = data.get("recommendedAction", "-")
print(f"mode={mode} engine={data['selectedEngine']} grade={data['grade']} status={status} attempts={len(data['attempts'])}")
print(f"recommendedAction={action}")
PY
