#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALL_DIR="${RHWP_CLI_INSTALL_DIR:-$ROOT/bin}"
VERSION="${RHWP_CLI_VERSION:-main}"
REPO_URL="${RHWP_CLI_REPO_URL:-https://github.com/edwardkim/rhwp.git}"
SOURCE_DIR="${RHWP_CLI_SOURCE_DIR:-$ROOT/.rhwp-src}"

mkdir -p "$INSTALL_DIR"

if [ -n "${RHWP_CLI_URL:-}" ]; then
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  case "$RHWP_CLI_URL" in
    *.tar.gz|*.tgz)
      curl -fsSL "$RHWP_CLI_URL" -o "$TMP/rhwp.tar.gz"
      mkdir -p "$TMP/extract"
      tar -xzf "$TMP/rhwp.tar.gz" -C "$TMP/extract"
      RHWP_BIN="$(find "$TMP/extract" -type f -name rhwp -perm -111 | head -n 1)"
      if [ -z "$RHWP_BIN" ]; then
        RHWP_BIN="$(find "$TMP/extract" -type f -name rhwp | head -n 1)"
      fi
      if [ -z "$RHWP_BIN" ]; then
        echo "Could not find rhwp binary in $RHWP_CLI_URL" >&2
        exit 1
      fi
      install -m 0755 "$RHWP_BIN" "$INSTALL_DIR/rhwp"
      ;;
    *)
      curl -fsSL "$RHWP_CLI_URL" -o "$TMP/rhwp"
      install -m 0755 "$TMP/rhwp" "$INSTALL_DIR/rhwp"
      ;;
  esac
  echo "RHWP_CLI_PATH=$INSTALL_DIR/rhwp"
  exit 0
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo is required. Install Rust first, or set RHWP_CLI_URL to a release binary." >&2
  exit 1
fi

rm -rf "$SOURCE_DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
if [ -n "${RHWP_CLI_ARCHIVE_URL:-}" ]; then
  ARCHIVE_URL="$RHWP_CLI_ARCHIVE_URL"
elif [ "$VERSION" = "main" ]; then
  ARCHIVE_URL="${REPO_URL%.git}/archive/refs/heads/main.tar.gz"
else
  ARCHIVE_URL="${REPO_URL%.git}/archive/refs/tags/$VERSION.tar.gz"
fi
mkdir -p "$SOURCE_DIR"
curl -fsSL "$ARCHIVE_URL" -o "$TMP/rhwp.tar.gz"
tar -xzf "$TMP/rhwp.tar.gz" -C "$SOURCE_DIR" --strip-components=1
(
  cd "$SOURCE_DIR"
  cargo build --release --bin rhwp
)
install -m 0755 "$SOURCE_DIR/target/release/rhwp" "$INSTALL_DIR/rhwp"

echo "RHWP_CLI_PATH=$INSTALL_DIR/rhwp"
echo "Set RHWP_CLI_ENABLED=1 in .env.standalone after validating quality reports."
