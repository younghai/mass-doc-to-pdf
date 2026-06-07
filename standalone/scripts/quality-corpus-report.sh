#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${1:-${SOURCE_DIR:-}}"
WEB_URL="${WEB_URL:-http://localhost}"
QUALITY_MODE="${QUALITY_MODE:-precise}"
MAX_FILES="${MAX_FILES:-1000}"
POLL_ATTEMPTS="${POLL_ATTEMPTS:-120}"
POLL_SECONDS="${POLL_SECONDS:-2}"
OUT_DIR="${OUT_DIR:-quality-reports/$(date +%Y%m%d-%H%M%S)}"

if [ -z "$SOURCE_DIR" ]; then
  echo "Usage: WEB_URL=http://server QUALITY_MODE=precise $0 /path/to/documents" >&2
  exit 1
fi

if [ ! -d "$SOURCE_DIR" ]; then
  echo "SOURCE_DIR is not a directory: $SOURCE_DIR" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
JOBS_JSONL="$OUT_DIR/jobs.jsonl"
SUMMARY_JSON="$OUT_DIR/summary.json"
SUMMARY_CSV="$OUT_DIR/summary.csv"
: > "$JOBS_JSONL"

mapfile -t FILES < <(
  find "$SOURCE_DIR" -type f \
    \( -iname "*.hwp" -o -iname "*.hwpx" -o -iname "*.docx" -o -iname "*.doc" -o -iname "*.xlsx" -o -iname "*.xls" -o -iname "*.pptx" -o -iname "*.ppt" \) \
    | sort \
    | head -n "$MAX_FILES"
)

printf "quality corpus: files=%s mode=%s out=%s\n" "${#FILES[@]}" "$QUALITY_MODE" "$OUT_DIR"

json_field() {
  python3 -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1], ""))' "$1"
}

append_record() {
  local file="$1"
  local job_json="$2"
  local quality_json="$3"
  local final_status="$4"
  local error="$5"
  python3 - "$file" "$job_json" "$quality_json" "$final_status" "$error" >> "$JOBS_JSONL" <<'PY'
import json
import pathlib
import sys

file_path, job_path, quality_path, final_status, error = sys.argv[1:]

def read_json(path):
    if not path or not pathlib.Path(path).exists():
        return None
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)

job = read_json(job_path)
quality = read_json(quality_path)
record = {
    "file": file_path,
    "jobId": job.get("id") if job else None,
    "filename": job.get("filename") if job else pathlib.Path(file_path).name,
    "format": job.get("format") if job else None,
    "jobStatus": final_status,
    "engine": job.get("engine") if job else None,
    "error": error or (job.get("error") if job else None),
    "qualityMode": quality.get("mode") if quality else None,
    "qualityStatus": quality.get("status") if quality else ("failed" if final_status == "failed" else None),
    "grade": quality.get("grade") if quality else None,
    "selectedEngine": quality.get("selectedEngine") if quality else None,
    "pageCount": (quality.get("checks") or {}).get("pageCount") if quality else None,
    "pdfBytes": (quality.get("checks") or {}).get("pdfBytes") if quality else None,
    "recommendedAction": quality.get("recommendedAction") if quality else None,
    "warnings": quality.get("warnings", []) if quality else [],
}
print(json.dumps(record, ensure_ascii=False))
PY
}

for file in "${FILES[@]}"; do
  tmp_dir="$(mktemp -d)"
  job_json="$tmp_dir/job.json"
  current_json="$tmp_dir/current.json"
  quality_json="$tmp_dir/quality.json"
  printf "upload: %s\n" "$file"

  if ! curl -fsS -X POST -F "file=@$file" "$WEB_URL/api/convert?qualityMode=$QUALITY_MODE" > "$job_json"; then
    append_record "$file" "" "" "failed" "upload_failed"
    rm -rf "$tmp_dir"
    continue
  fi

  job_id="$(json_field id < "$job_json")"
  final_status=""
  error=""

  for _ in $(seq 1 "$POLL_ATTEMPTS"); do
    curl -fsS "$WEB_URL/api/jobs/$job_id" > "$current_json"
    final_status="$(json_field status < "$current_json")"
    error="$(json_field error < "$current_json")"
    if [ "$final_status" = "success" ] || [ "$final_status" = "failed" ]; then
      break
    fi
    sleep "$POLL_SECONDS"
  done

  if [ "$final_status" = "success" ]; then
    curl -fsS "$WEB_URL/api/jobs/$job_id/quality" > "$quality_json" || true
  elif [ "$final_status" != "failed" ]; then
    final_status="failed"
    error="poll_timeout"
  fi

  append_record "$file" "$current_json" "$quality_json" "$final_status" "$error"
  rm -rf "$tmp_dir"
done

python3 - "$JOBS_JSONL" "$SUMMARY_JSON" "$SUMMARY_CSV" <<'PY'
import collections
import csv
import json
import sys

jobs_path, summary_path, csv_path = sys.argv[1:]
records = []
with open(jobs_path, "r", encoding="utf-8") as fh:
    for line in fh:
        line = line.strip()
        if line:
            records.append(json.loads(line))

def counts(key):
    return dict(collections.Counter(record.get(key) or "-" for record in records))

summary = {
    "total": len(records),
    "jobStatus": counts("jobStatus"),
    "qualityStatus": counts("qualityStatus"),
    "grade": counts("grade"),
    "selectedEngine": counts("selectedEngine"),
    "reviewFiles": [r["file"] for r in records if r.get("qualityStatus") == "review"],
    "failedFiles": [r["file"] for r in records if r.get("jobStatus") == "failed" or r.get("qualityStatus") == "failed"],
}

with open(summary_path, "w", encoding="utf-8") as fh:
    json.dump(summary, fh, ensure_ascii=False, indent=2)

columns = [
    "file",
    "jobId",
    "jobStatus",
    "qualityMode",
    "qualityStatus",
    "grade",
    "selectedEngine",
    "pageCount",
    "pdfBytes",
    "recommendedAction",
    "error",
]
with open(csv_path, "w", encoding="utf-8", newline="") as fh:
    writer = csv.DictWriter(fh, fieldnames=columns)
    writer.writeheader()
    for record in records:
        writer.writerow({column: record.get(column) for column in columns})

print(json.dumps(summary, ensure_ascii=False, indent=2))
PY

printf "summary: %s\n" "$SUMMARY_JSON"
printf "csv: %s\n" "$SUMMARY_CSV"
