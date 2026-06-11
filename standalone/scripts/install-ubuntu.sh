#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo standalone/scripts/install-ubuntu.sh" >&2
  exit 1
fi

apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  gnupg \
  nginx \
  openssl \
  sqlite3 \
  python3 \
  python3-venv \
  python3-flask \
  default-jre \
  libreoffice \
  libreoffice-java-common \
  fonts-nanum \
  fonts-noto-cjk

if ! command -v node >/dev/null 2>&1 || ! node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y nodejs
fi

corepack enable

H2ORESTART_VERSION="${H2ORESTART_VERSION:-v0.7.12}"
curl -fsSL -o /tmp/H2Orestart.oxt \
  "https://github.com/ebandal/H2Orestart/releases/download/${H2ORESTART_VERSION}/H2Orestart.oxt"
# || true preserves idempotency: re-running when the extension is already deployed
# returns a non-zero exit from unopkg, which is harmless.
HOME=/tmp unopkg add --shared /tmp/H2Orestart.oxt || true
if ! HOME=/tmp unopkg list --shared | grep -qi h2orestart; then
  echo "ERROR: H2Orestart extension is not installed — HWP conversion via LibreOffice will fail." >&2
  echo "       Re-run: HOME=/tmp unopkg add --shared /tmp/H2Orestart.oxt" >&2
  exit 1
fi
rm -f /tmp/H2Orestart.oxt

echo "Standalone dependencies installed."
