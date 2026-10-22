#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 9 ]; then
  echo "Usage: $0 jobs.jsonl summary.json summary.csv summary.md formats max_files min_files available_files shortfall" >&2
  exit 1
fi

python3 - "$@" <<'PY'
import collections
import csv
import json
import pathlib
import sys

jobs_path, summary_path, csv_path, markdown_path, formats, max_files, min_files, available_files, shortfall = sys.argv[1:]
records = []
with open(jobs_path, "r", encoding="utf-8") as fh:
    for line in fh:
        line = line.strip()
        if line:
            records.append(json.loads(line))

def counts(key):
    return dict(collections.Counter(record.get(key) or "-" for record in records))

def bucket(record):
    job_status = record.get("jobStatus")
    quality_status = record.get("qualityStatus")
    grade = record.get("grade")
    if job_status == "failed" or quality_status == "failed" or grade == "failed":
        return "failed"
    if quality_status == "review" or grade == "fallback" or record.get("warnings"):
        return "review"
    if job_status == "success" and quality_status == "passed":
        return "success"
    return "review"

def reason(record):
    return record.get("error") or record.get("recommendedAction") or "-"

bucket_by_file = {record.get("file") or record.get("filename") or "-": bucket(record) for record in records}
bucket_counts = dict(collections.Counter(bucket_by_file.values()))
ordered_bucket_counts = {name: bucket_counts.get(name, 0) for name in ["success", "review", "failed"]}
failure_types = dict(collections.Counter(reason(record) for record in records if bucket(record) == "failed"))
low_quality_types = dict(collections.Counter(reason(record) for record in records if bucket(record) == "review"))

summary = {
    "total": len(records),
    "formats": [item for item in formats.split(",") if item],
    "targetFiles": int(max_files),
    "minimumFiles": int(min_files),
    "availableFiles": int(available_files),
    "sampleShortfall": int(shortfall),
    "bucket": ordered_bucket_counts,
    "jobStatus": counts("jobStatus"),
    "qualityStatus": counts("qualityStatus"),
    "grade": counts("grade"),
    "selectedEngine": counts("selectedEngine"),
    "failureTypes": failure_types,
    "lowQualityTypes": low_quality_types,
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

def escape_cell(value):
    return str(value).replace("|", "\\|").replace("\n", " ")

def table(headers, rows):
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(escape_cell(value) for value in row) + " |")
    return "\n".join(lines)

detail_rows = []
for record in records:
    verdict = bucket(record)
    if verdict == "success":
        continue
    detail_rows.append([
        pathlib.Path(record.get("file") or record.get("filename") or "-").name,
        verdict,
        record.get("selectedEngine") or "-",
        record.get("grade") or "-",
        reason(record),
    ])

markdown = "\n\n".join([
    "# HWP/HWPX Quality Corpus Report",
    table(
        ["field", "value"],
        [
            ["formats", formats],
            ["targetFiles", max_files],
            ["minimumFiles", min_files],
            ["availableFiles", available_files],
            ["testedFiles", len(records)],
            ["sampleShortfall", shortfall],
        ],
    ),
    table(["bucket", "count"], [[name, ordered_bucket_counts[name]] for name in ["success", "review", "failed"]]),
    table(["engine", "count"], sorted(summary["selectedEngine"].items())),
    table(["failureType", "count"], sorted(failure_types.items()) or [["-", 0]]),
    table(["lowQualityType", "count"], sorted(low_quality_types.items()) or [["-", 0]]),
    table(["file", "bucket", "engine", "grade", "reason"], detail_rows or [["-", "-", "-", "-", "-"]]),
])
with open(markdown_path, "w", encoding="utf-8") as fh:
    fh.write(markdown + "\n")

print(json.dumps(summary, ensure_ascii=False, indent=2))
PY
