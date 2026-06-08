#!/usr/bin/env bash
set -euo pipefail

systemctl --no-pager --full status mass-doc-to-pdf-sidecar || true
systemctl --no-pager --full status mass-doc-to-pdf-api || true
systemctl --no-pager --full status mass-doc-to-pdf-worker || true
systemctl --no-pager --full status nginx || true
