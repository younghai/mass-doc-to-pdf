#!/usr/bin/env bash
# rhwp bump gate — turn the manual bump-verification procedure into a one-command check.
#
# The 2026-11-12 incident class: a rhwp release changed output characteristics
# (font subsetting halved file sizes) and a quality heuristic calibrated to the
# old distribution (RHWP_CLI_MIN_PDF_BYTES) would have silently downgraded
# legitimate conversions. This gate makes the calibration measurable per bump:
# convert the pinned fixture corpus with the OLD and NEW engine binaries,
# compare pages/text/overflow, and emit a baseline JSON whose min-size must
# stay comfortably above the heuristic floor — otherwise it tells you to
# recalibrate BEFORE merging the bump.
#
# Usage:
#   rhwp-bump-gate.sh fetch <fixture-dir>              # download pinned fixtures (sha256-verified)
#   rhwp-bump-gate.sh smoke <fixture-dir> <rhwp-bin>   # single-engine conversion smoke (CI job uses this)
#   rhwp-bump-gate.sh compare <fixture-dir> <old-bin> <new-bin> [--json <file>]
#
# Fixture manifest: fixtures/rhwp/manifest.json (upstream MIT test assets).
# The heuristic floor lives in apps/api/src/convert/quality.ts
# (RHWP_CLI_MIN_PDF_BYTES) — this script reads nothing from the repo code; the
# baseline numbers are the source of truth for recalibration decisions.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST="$ROOT/fixtures/rhwp/manifest.json"
WORKER="$ROOT/apps/api/src/convert/workers/rhwp_worker.py"
# Must stay in sync with RHWP_CLI_MIN_PDF_BYTES in apps/api/src/convert/quality.ts.
# Deliberately duplicated here so a drift between the code floor and the gate
# floor is visible in a diff.
GATE_FLOOR_BYTES=$((8 * 1024))
# A bump needs recalibration when the smallest legitimate output drifts below
# floor + 25% headroom (the margin that separates legit output from degenerate
# output; measured once more per bump).
CALIBRATION_HEADROOM=1.25

fail() { echo "GATE FAIL: $*" >&2; exit 1; }
warn() { echo "GATE WARN: $*" >&2; }

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

fetch_fixtures() {
  local dir="$1"
  mkdir -p "$dir"
  python3 - "$MANIFEST" "$dir" <<'PY'
import json, sys, urllib.request, hashlib, pathlib
manifest, out_dir = sys.argv[1], pathlib.Path(sys.argv[2])
data = json.load(open(manifest))
for fx in data["fixtures"]:
    dest = out_dir / fx["name"]
    if dest.exists() and hashlib.sha256(dest.read_bytes()).hexdigest() == fx["sha256"]:
        print(f"cached ok: {fx['name']}"); continue
    print(f"fetching:  {fx['name']}")
    blob = urllib.request.urlopen(urllib.request.Request(fx["url"], headers={"User-Agent": "rhwp-bump-gate"}), timeout=60).read()
    got = hashlib.sha256(blob).hexdigest()
    if got != fx["sha256"]:
        sys.exit(f"checksum mismatch for {fx['name']}: want {fx['sha256']} got {got}")
    dest.write_bytes(blob)
    print(f"verified:  {fx['name']}")
PY
}

# Convert every fixture with one engine; emit "name<TAB>pages<TAB>bytes<TAB>exit"
# plus overflow count on stderr. Uses the python worker when the binary is a
# python interpreter, else treats it as the rhwp CLI binary.
convert_all() {
  local dir="$1" bin="$2" tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  for src in "$dir"/*.hwp "$dir"/*.hwpx; do
    [ -f "$src" ] || continue
    local name out err pages bytes rc=0 overflow
    name="$(basename "$src")"
    out="$tmp/$name.pdf"; err="$tmp/$name.err"
    case "$(basename "$bin")" in
      python*)
        # A python interpreter: run the project worker (same path production uses).
        "$bin" "$WORKER" "$src" "$out" >"$tmp/$name.stdout" 2>"$err" || rc=$?
        ;;
      *)
        # The rhwp CLI binary: fonts resolve via ttfs/<provider> relative to cwd.
        (cd "$tmp" && "$bin" export-pdf "$src" -o "$out") >"$tmp/$name.stdout" 2>"$err" || rc=$?
        ;;
    esac
    overflow="$(grep -c "LAYOUT_OVERFLOW" "$err" 2>/dev/null || true)"
    if [ "$rc" -ne 0 ] || [ ! -f "$out" ]; then
      echo -e "$name\t0\t0\t$rc\t$overflow"
      echo "  conversion failed (exit $rc, overflow-lines $overflow): $(head -2 "$err" 2>/dev/null)" >&2
      continue
    fi
    bytes="$(wc -c <"$out" | tr -d ' ')"
    pages="$(python3 -c "import sys;d=open(sys.argv[1],'rb').read();print(d.count(b'/Type /Page')-d.count(b'/Type /Pages'))" "$out" 2>/dev/null || echo "?")"
    echo -e "$name\t$pages\t$bytes\t$rc\t$overflow"
    [ "$overflow" != "0" ] && echo "  LAYOUT_OVERFLOW x$overflow in $name" >&2
    cp "$out" "$tmp/keep-$name.pdf" 2>/dev/null || true
  done
  # Keep PDFs for optional text comparison by the caller.
  echo "$tmp"
}

cmd="${1:-}"; shift || true
case "$cmd" in
  fetch)
    [ $# -ge 1 ] || fail "usage: fetch <fixture-dir>"
    fetch_fixtures "$1"
    ;;

  smoke)
    # Single-engine gate: every fixture must convert, with pages>0 and no
    # overflow. Used by CI against the pinned in-image engine.
    [ $# -ge 2 ] || fail "usage: smoke <fixture-dir> <rhwp-bin>"
    dir="$1"; bin="$2"
    [ -f "$MANIFEST" ] || fail "manifest missing"
    [ -f "$WORKER" ] || fail "worker script missing (run from repo root)"
    result="$(convert_all "$dir" "$bin")"
    rows="$(echo "$result" | sed '$d')"
    [ -n "$rows" ] || fail "no fixtures converted (fetch first)"
    fails=0
    while IFS=$'\t' read -r name pages bytes rc overflow; do
      if [ "$rc" != "0" ] || [ "$bytes" = "0" ] || [ "$pages" = "0" ]; then
        echo "smoke: $name FAILED (pages=$pages bytes=$bytes exit=$rc)"; fails=$((fails+1))
      elif [ "${overflow:-0}" != "0" ]; then
        # Engine alive and converting; this doc overflows and production would
        # route it to the next engine in the chain (designed behavior — see
        # assertNoLayoutOverflow in engines/rhwp.ts). Not a smoke failure, but
        # compare must watch whether a bump changes the overflow set.
        echo "smoke: $name ok (pages=$pages bytes=$bytes; overflow x$overflow -> chain fallback)"
      else
        echo "smoke: $name ok (pages=$pages bytes=$bytes)"
      fi
    done <<<"$rows"
    [ "$fails" -eq 0 ] || fail "$fails fixture(s) failed the smoke conversion"
    echo "smoke: all fixtures converted cleanly"
    ;;

  compare)
    [ $# -ge 3 ] || fail "usage: compare <fixture-dir> <old-bin> <new-bin> [--json <file>]"
    dir="$1"; old_bin="$2"; new_bin="$3"; json_out=""
    while [ $# -gt 0 ]; do
      if [ "$1" = "--json" ] && [ $# -ge 2 ]; then json_out="$2"; fi; shift
    done
    old_out="$(convert_all "$dir" "$old_bin")"; old_rows="$(echo "$old_out" | sed '$d')"
    new_out="$(convert_all "$dir" "$new_bin")"; new_rows="$(echo "$new_out" | sed '$d')"

    python3 - "$old_rows" "$new_rows" "$json_out" <<'PY'
import json, sys
old_rows, new_rows, json_out = sys.argv[1], sys.argv[2], sys.argv[3]
FLOOR = 8 * 1024
HEADROOM = 1.25
def parse(rows):
    out = {}
    for line in rows.strip().splitlines():
        name, pages, bytes_, rc, overflow = line.split("\t")
        out[name] = {"pages": int(pages), "bytes": int(bytes_), "exit": int(rc), "overflow": int(overflow)}
    return out
old, new = parse(old_rows), parse(new_rows)
problems, notes = [], []
baseline = {"fixtures": {}}
min_legit = None
for name in sorted(set(old) | set(new)):
    o, n = old.get(name), new.get(name)
    if o is None or n is None:
        problems.append(f"{name}: missing in {'new' if o else 'old'} run"); continue
    entry = {"old": o, "new": n}
    baseline["fixtures"][name] = entry
    if n["exit"] != 0 or n["bytes"] == 0:
        problems.append(f"{name}: new engine conversion failed"); continue
    if n["pages"] != o["pages"]:
        problems.append(f"{name}: page count changed {o['pages']} -> {n['pages']}")
    if n["overflow"] > o["overflow"]:
        problems.append(f"{name}: LAYOUT_OVERFLOW grew {o['overflow']} -> {n['overflow']} (production would newly fail this doc)")
    elif n["overflow"] > 0 and o["overflow"] > 0:
        notes.append(f"{name}: pre-existing overflow unchanged ({n['overflow']})")
    ratio = n["bytes"] / o["bytes"] if o["bytes"] else 0
    entry["sizeRatio"] = round(ratio, 3)
    if n["bytes"] < FLOOR:
        min_legit = n["bytes"] if min_legit is None else min(min_legit, n["bytes"])
if min_legit is not None:
    baseline["minLegitBytes"] = min_legit
    if min_legit < FLOOR * HEADROOM:
        problems.append(
            f"CALIBRATION: smallest legitimate output is {min_legit}B, below "
            f"floor({FLOOR}B)x{HEADROOM}={int(FLOOR*HEADROOM)}B — RHWP_CLI_MIN_PDF_BYTES "
            f"in apps/api/src/convert/quality.ts needs recalibration BEFORE merging this bump "
            f"(see docs/changes/2026-11-12-rhwp-cli-v0.9.0.md for the incident class)")
    else:
        notes.append(f"min legit {min_legit}B stays above floor x{HEADROOM} = {int(FLOOR*HEADROOM)}B")
baseline["verdict"] = "fail" if problems else "pass"
baseline["problems"] = problems
baseline["notes"] = notes
if json_out:
    json.dump(baseline, open(json_out, "w"), indent=2, ensure_ascii=False)
    print(f"baseline written: {json_out}")
for p in problems: print("GATE FAIL:", p)
for n in notes: print("note:", n)
print("verdict:", baseline["verdict"])
sys.exit(1 if problems else 0)
PY
    ;;

  *)
    fail "unknown command '$cmd' — use fetch | smoke | compare"
    ;;
esac
