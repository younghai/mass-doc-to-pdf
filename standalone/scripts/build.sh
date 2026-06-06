#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

corepack enable
pnpm install --frozen-lockfile
pnpm --filter @hwptopdf/api exec prisma generate
# Build first (topological): @hwptopdf/shared must emit dist/ before the api/web
# typecheck and tests can resolve it on a clean checkout.
pnpm -r build
pnpm -r typecheck
pnpm -r test

mkdir -p data/objects

echo "Build complete."
echo "Web root: $ROOT/apps/web/dist"
echo "API entry: $ROOT/apps/api/dist/server.js"
