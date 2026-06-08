#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

SOURCE_DIR="$TMP_DIR/source"
OUT_DIR="$TMP_DIR/report"
JOBS_JSONL="$TMP_DIR/jobs.jsonl"

mkdir -p "$SOURCE_DIR"
touch "$SOURCE_DIR/pass.hwp"
touch "$SOURCE_DIR/review.hwpx"
touch "$SOURCE_DIR/fail.hwp"

cat > "$JOBS_JSONL" <<'JSONL'
{"file":"/tmp/pass.hwp","jobId":"job-pass","filename":"pass.hwp","format":"office","jobStatus":"success","engine":"h2orestart","error":null,"qualityMode":"precise","qualityStatus":"passed","grade":"high","selectedEngine":"h2orestart","pageCount":3,"pdfBytes":12000,"recommendedAction":"검수 우선순위 낮음","warnings":[]}
{"file":"/tmp/review.hwpx","jobId":"job-review","filename":"review.hwpx","format":"office","jobStatus":"success","engine":"builtin","error":null,"qualityMode":"precise","qualityStatus":"review","grade":"fallback","selectedEngine":"builtin","pageCount":1,"pdfBytes":700,"recommendedAction":"원본과 첫 페이지를 비교하고 정밀 변환으로 재시도하세요.","warnings":["builtin fallback"]}
{"file":"/tmp/fail.hwp","jobId":null,"filename":"fail.hwp","format":"office","jobStatus":"failed","engine":null,"error":"upload_failed","qualityMode":null,"qualityStatus":"failed","grade":null,"selectedEngine":null,"pageCount":null,"pdfBytes":null,"recommendedAction":null,"warnings":[]}
JSONL

SUMMARY_ONLY=1 \
JOBS_JSONL_IN="$JOBS_JSONL" \
FORMATS=hwp,hwpx \
MIN_FILES=50 \
MAX_FILES=100 \
OUT_DIR="$OUT_DIR" \
  "$ROOT/standalone/scripts/quality-corpus-report.sh" "$SOURCE_DIR" > "$TMP_DIR/stdout"

python3 - "$OUT_DIR/summary.json" "$OUT_DIR/summary.md" "$OUT_DIR/summary.csv" <<'PY'
import csv
import json
import pathlib
import sys

summary_path, markdown_path, csv_path = [pathlib.Path(path) for path in sys.argv[1:]]
summary = json.loads(summary_path.read_text(encoding="utf-8"))
markdown = markdown_path.read_text(encoding="utf-8")

assert summary["total"] == 3
assert summary["availableFiles"] == 3
assert summary["targetFiles"] == 100
assert summary["minimumFiles"] == 50
assert summary["sampleShortfall"] == 47
assert summary["bucket"] == {"success": 1, "review": 1, "failed": 1}
assert summary["failureTypes"] == {"upload_failed": 1}
assert "| success | 1 |" in markdown
assert "| review | 1 |" in markdown
assert "| failed | 1 |" in markdown
assert "sampleShortfall" in markdown

with csv_path.open("r", encoding="utf-8", newline="") as fh:
    rows = list(csv.DictReader(fh))
assert len(rows) == 3
assert rows[1]["qualityStatus"] == "review"
PY

echo "quality corpus report fixture test passed"
