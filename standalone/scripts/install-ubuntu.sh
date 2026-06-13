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
  python3-pip \
  python3-flask \
  poppler-utils \
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

# rhwp precision engine: installed into a project venv so the system python
# stays clean. Pinned for reproducible rendering quality. rhwp is an optional
# engine, so a failed install only warns — the boot-time preflight excludes it
# from the chain (check /health/engines after boot) and HWP conversion falls
# back to LibreOffice/H2Orestart.
RHWP_PYTHON_VERSION="${RHWP_PYTHON_VERSION:-0.7.0}"
APP_DIR="${APP_DIR:-/opt/mass-doc-to-pdf}"
mkdir -p "${APP_DIR}"
python3 -m venv "${APP_DIR}/venv"
if "${APP_DIR}/venv/bin/pip" install --no-cache-dir "rhwp-python==${RHWP_PYTHON_VERSION}"; then
  # rhwp-python 0.7.0's manylinux wheel bundles a freetype that predates
  # FT_Palette_Select, so `import rhwp` fails with "undefined symbol:
  # FT_Palette_Select". Repoint the bundled lib at the distro freetype (>=2.10
  # exports the symbol) so the precision engine actually loads instead of
  # silently falling back to H2Orestart. No-op if the wheel layout changes.
  SYS_FT="$(ls /usr/lib/*/libfreetype.so.6 2>/dev/null | head -1)"
  if [ -n "${SYS_FT}" ]; then
    find "${APP_DIR}/venv" -path '*/rhwp_python.libs/libfreetype-*.so.6' \
      -exec ln -sf "${SYS_FT}" {} + 2>/dev/null || true
  fi
  if ! "${APP_DIR}/venv/bin/python3" -c "import rhwp" 2>/dev/null; then
    echo "WARN: rhwp installed but 'import rhwp' fails — HWP conversion will fall back to LibreOffice/H2Orestart (check /health/engines after boot)." >&2
  fi
else
  echo "WARN: rhwp-python install failed — HWP conversion will fall back to LibreOffice/H2Orestart (check /health/engines after boot)." >&2
fi

echo "Standalone dependencies installed."
