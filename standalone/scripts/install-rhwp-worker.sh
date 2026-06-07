#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VENV="${RHWP_VENV:-$ROOT/.venv-rhwp}"

python3 -m venv "$VENV"
"$VENV/bin/python" -m pip install --upgrade pip
"$VENV/bin/python" -m pip install rhwp-python==0.5.1

echo "RHWP_PYTHON=$VENV/bin/python"
