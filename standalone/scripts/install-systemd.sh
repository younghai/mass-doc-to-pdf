#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo standalone/scripts/install-systemd.sh" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT/.env.standalone"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Create it from standalone/env.example first." >&2
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

# Run services as the deploy user (the one invoking sudo), not www-data:
# LibreOffice/Java (H2Orestart) hang under www-data's restricted environment,
# and SQLite needs a writable, owned data directory.
DEPLOY_USER="${SUDO_USER:-root}"
DEPLOY_HOME="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
DEPLOY_HOME="${DEPLOY_HOME:-/root}"

mkdir -p "$ROOT/data/objects"
chown -R "$DEPLOY_USER":"$DEPLOY_USER" "$ROOT/data"
# Let nginx (www-data) traverse into the deploy user's home to serve the SPA.
chmod o+x "$DEPLOY_HOME" 2>/dev/null || true

sed -e "s#__ROOT__#$ROOT#g" -e "s#__USER__#$DEPLOY_USER#g" -e "s#__HOME__#$DEPLOY_HOME#g" \
  "$ROOT/standalone/systemd/mass-doc-to-pdf-api.service.in" \
  > /etc/systemd/system/mass-doc-to-pdf-api.service
sed -e "s#__ROOT__#$ROOT#g" -e "s#__USER__#$DEPLOY_USER#g" -e "s#__HOME__#$DEPLOY_HOME#g" \
  "$ROOT/standalone/systemd/mass-doc-to-pdf-sidecar.service.in" \
  > /etc/systemd/system/mass-doc-to-pdf-sidecar.service
sed -e "s#__ROOT__#$ROOT#g" -e "s#__USER__#$DEPLOY_USER#g" -e "s#__HOME__#$DEPLOY_HOME#g" \
  "$ROOT/standalone/systemd/mass-doc-to-pdf-worker.service.in" \
  > /etc/systemd/system/mass-doc-to-pdf-worker.service
sed "s#__ROOT__#$ROOT#g" "$ROOT/standalone/nginx/mass-doc-to-pdf.conf.in" \
  > /etc/nginx/sites-available/mass-doc-to-pdf.conf

ln -sf /etc/nginx/sites-available/mass-doc-to-pdf.conf /etc/nginx/sites-enabled/mass-doc-to-pdf.conf
rm -f /etc/nginx/sites-enabled/default

systemctl daemon-reload
if [ "${OFFICE_ENGINE:-builtin}" = "hwp-sidecar" ]; then
  systemctl enable --now mass-doc-to-pdf-sidecar
else
  systemctl disable --now mass-doc-to-pdf-sidecar 2>/dev/null || true
fi
systemctl enable --now mass-doc-to-pdf-api
systemctl enable --now mass-doc-to-pdf-worker
nginx -t
systemctl reload nginx

echo "Standalone services installed."
