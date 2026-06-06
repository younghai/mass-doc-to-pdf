#!/usr/bin/env bash
set -euo pipefail

WEB_URL="${WEB_URL:-http://localhost}"
API_URL="${API_URL:-http://127.0.0.1:18010}"
SIDECAR_URL="${SIDECAR_URL:-http://127.0.0.1:18080}"

printf "web: "
curl -fsS -o /dev/null -w "%{http_code}\n" "$WEB_URL"

printf "api: "
curl -fsS "$API_URL/health"
printf "\n"

printf "sidecar: "
curl -fsS "$SIDECAR_URL/health"
printf "\n"
