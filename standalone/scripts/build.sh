#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

corepack enable
pnpm install --frozen-lockfile
pnpm --filter @hwptopdf/api exec prisma generate
pnpm -r typecheck
pnpm -r test
pnpm -r build

mkdir -p data/objects

echo "Build complete."
echo "Web root: $ROOT/apps/web/dist"
echo "API entry: $ROOT/apps/api/dist/server.js"
