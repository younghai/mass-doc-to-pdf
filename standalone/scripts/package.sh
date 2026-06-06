#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${1:-$ROOT/standalone/release}"
APP_DIR="$OUT_DIR/mass-doc-to-pdf"

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"

cd "$ROOT"
tar \
  --exclude ".git" \
  --exclude ".DS_Store" \
  --exclude ".claude" \
  --exclude ".codex" \
  --exclude ".debug-journal.md" \
  --exclude ".env" \
  --exclude ".env.*" \
  --exclude ".omc" \
  --exclude ".omx/state" \
  --exclude "node_modules" \
  --exclude "apps/web/dist" \
  --exclude "apps/api/dist" \
  --exclude "packages/shared/dist" \
  --exclude "apps/api/prisma/*.db" \
  --exclude "data" \
  --exclude "tmp" \
  --exclude "standalone/release" \
  -cf - . | tar -C "$APP_DIR" -xf -

tar -C "$OUT_DIR" -czf "$OUT_DIR/mass-doc-to-pdf-standalone.tar.gz" mass-doc-to-pdf

echo "Standalone folder: $APP_DIR"
echo "Archive: $OUT_DIR/mass-doc-to-pdf-standalone.tar.gz"
