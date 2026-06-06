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
  python3 \
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

curl -fsSL -o /tmp/H2Orestart.oxt \
  https://github.com/ebandal/H2Orestart/releases/latest/download/H2Orestart.oxt
HOME=/tmp unopkg add --shared /tmp/H2Orestart.oxt || true
rm -f /tmp/H2Orestart.oxt

echo "Standalone dependencies installed."
