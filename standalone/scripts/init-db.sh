#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT/.env.standalone"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Create it from standalone/env.example first." >&2
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

cd "$ROOT/apps/api"
corepack pnpm exec prisma migrate deploy

echo "Database schema is up to date."
