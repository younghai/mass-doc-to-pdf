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

mkdir -p "$ROOT/data/objects"
chown -R www-data:www-data "$ROOT/data"

sed "s#__ROOT__#$ROOT#g" "$ROOT/standalone/systemd/mass-doc-to-pdf-api.service.in" \
  > /etc/systemd/system/mass-doc-to-pdf-api.service
sed "s#__ROOT__#$ROOT#g" "$ROOT/standalone/systemd/mass-doc-to-pdf-sidecar.service.in" \
  > /etc/systemd/system/mass-doc-to-pdf-sidecar.service
sed "s#__ROOT__#$ROOT#g" "$ROOT/standalone/nginx/mass-doc-to-pdf.conf.in" \
  > /etc/nginx/sites-available/mass-doc-to-pdf.conf

ln -sf /etc/nginx/sites-available/mass-doc-to-pdf.conf /etc/nginx/sites-enabled/mass-doc-to-pdf.conf
rm -f /etc/nginx/sites-enabled/default

systemctl daemon-reload
systemctl enable --now mass-doc-to-pdf-sidecar
systemctl enable --now mass-doc-to-pdf-api
nginx -t
systemctl reload nginx

echo "Standalone services installed."
