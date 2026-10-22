#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${1:-$ROOT/standalone/release}"
APP_DIR="$OUT_DIR/mass-doc-to-pdf"

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"

cd "$ROOT"
COPYFILE_DISABLE=1 tar \
  --disable-copyfile \
  --no-xattrs \
  --exclude ".git" \
  --exclude ".gitignore" \
  --exclude ".github" \
  --exclude ".DS_Store" \
  --exclude "._*" \
  --exclude "*/._*" \
  --exclude ".claude" \
  --exclude ".codex" \
  --exclude ".debug-journal.md" \
  --exclude ".env" \
  --exclude ".env.*" \
  --exclude ".omc" \
  --exclude ".omx" \
  --exclude "node_modules" \
  --exclude ".pnpm-store" \
  --exclude "newsletter" \
  --exclude "odysseus" \
  --exclude "apps/web/dist" \
  --exclude "apps/api/dist" \
  --exclude "packages/shared/dist" \
  --exclude "apps/api/prisma/*.db" \
  --exclude "data" \
  --exclude "tmp" \
  --exclude "standalone/release" \
  -cf - . | tar -C "$APP_DIR" -xf -

COPYFILE_DISABLE=1 tar \
  --disable-copyfile \
  --no-xattrs \
  -C "$OUT_DIR" \
  -czf "$OUT_DIR/mass-doc-to-pdf-standalone.tar.gz" \
  mass-doc-to-pdf

# Regression guard: the unrelated newsletter/odysseus workspaces leaked into a
# release tarball once (see README "2026-06-11"). Fail loudly if any forbidden path
# — those workspaces, dependency trees, or real secrets — survived the excludes,
# so a future exclude regression can't ship silently. Example/sample env templates
# are allowed, but real dot-env files remain forbidden.
FORBIDDEN="$(tar -tzf "$OUT_DIR/mass-doc-to-pdf-standalone.tar.gz" \
  | grep -Ei '(^|/)(newsletter|odysseus|node_modules)/|(^|/)\.env(\.|$)' \
  | grep -viE '\.(example|sample)$' || true)"
if [ -n "$FORBIDDEN" ]; then
  echo "ERROR: release archive contains forbidden paths (packaging exclude regressed):" >&2
  printf '%s\n' "$FORBIDDEN" | head -20 >&2
  exit 1
fi

echo "Standalone folder: $APP_DIR"
echo "Archive: $OUT_DIR/mass-doc-to-pdf-standalone.tar.gz"
echo "Package guard: no forbidden paths (newsletter/odysseus/node_modules/.env) in archive."
