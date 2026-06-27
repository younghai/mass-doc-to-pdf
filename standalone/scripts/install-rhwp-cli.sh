#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALL_DIR="${RHWP_CLI_INSTALL_DIR:-$ROOT/bin}"
# Pin to a released tag for reproducible CLI quality. `main` is still accepted
# but disables the prebuilt-binary path (no release assets exist for it) and
# forces a source build.
VERSION="${RHWP_CLI_VERSION:-v0.7.17}"
REPO_URL="${RHWP_CLI_REPO_URL:-https://github.com/edwardkim/rhwp.git}"
SOURCE_DIR="${RHWP_CLI_SOURCE_DIR:-$ROOT/.rhwp-src}"

mkdir -p "$INSTALL_DIR"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# Pull the rhwp binary out of an extracted release archive and install it.
install_extracted_binary() {
  local extract_dir="$1"
  local bin
  bin="$(find "$extract_dir" -type f -name rhwp -perm -111 | head -n 1)"
  if [ -z "$bin" ]; then
    bin="$(find "$extract_dir" -type f -name rhwp | head -n 1)"
  fi
  if [ -z "$bin" ]; then
    return 1
  fi
  install -m 0755 "$bin" "$INSTALL_DIR/rhwp"
}

# 1) Explicit URL override — operator supplies an exact binary or tarball.
if [ -n "${RHWP_CLI_URL:-}" ]; then
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  case "$RHWP_CLI_URL" in
    *.tar.gz|*.tgz)
      curl -fsSL "$RHWP_CLI_URL" -o "$TMP/rhwp.tar.gz"
      mkdir -p "$TMP/extract"
      tar -xzf "$TMP/rhwp.tar.gz" -C "$TMP/extract"
      if ! install_extracted_binary "$TMP/extract"; then
        echo "Could not find rhwp binary in $RHWP_CLI_URL" >&2
        exit 1
      fi
      ;;
    *)
      curl -fsSL "$RHWP_CLI_URL" -o "$TMP/rhwp"
      install -m 0755 "$TMP/rhwp" "$INSTALL_DIR/rhwp"
      ;;
  esac
  echo "RHWP_CLI_PATH=$INSTALL_DIR/rhwp"
  exit 0
fi

# 2) Preferred default: download the official prebuilt release binary for this
# platform and verify it against the release SHA256SUMS. Avoids the Rust
# toolchain entirely. Falls through to the source build on any failure (e.g. an
# unpublished platform like linux-aarch64, or a checksum mismatch).
if [ "$VERSION" != "main" ] && [ "${RHWP_CLI_FROM_SOURCE:-0}" != "1" ]; then
  OS="$(uname -s)"
  ARCH="$(uname -m)"
  ASSET_PLATFORM=""
  case "$OS:$ARCH" in
    Linux:x86_64|Linux:amd64) ASSET_PLATFORM="linux-x86_64" ;;
    Darwin:arm64|Darwin:aarch64) ASSET_PLATFORM="macos-aarch64" ;;
    Darwin:x86_64) ASSET_PLATFORM="macos-x86_64" ;;
  esac

  if [ -n "$ASSET_PLATFORM" ]; then
    ASSET="rhwp-${VERSION}-${ASSET_PLATFORM}.tar.gz"
    BASE="${REPO_URL%.git}/releases/download/${VERSION}"
    TMP="$(mktemp -d)"
    trap 'rm -rf "$TMP"' EXIT
    if curl -fsSL "$BASE/$ASSET" -o "$TMP/$ASSET" \
       && curl -fsSL "$BASE/SHA256SUMS.txt" -o "$TMP/SHA256SUMS.txt"; then
      want="$(grep -F "$ASSET" "$TMP/SHA256SUMS.txt" | awk '{print $1}' | head -n 1)"
      got="$(sha256_of "$TMP/$ASSET")"
      if [ -n "$want" ] && [ "$want" = "$got" ]; then
        mkdir -p "$TMP/extract"
        tar -xzf "$TMP/$ASSET" -C "$TMP/extract"
        if install_extracted_binary "$TMP/extract"; then
          echo "RHWP_CLI_PATH=$INSTALL_DIR/rhwp (prebuilt ${VERSION} ${ASSET_PLATFORM}, sha256 verified)"
          echo "Set RHWP_CLI_ENABLED=1 in .env.standalone after validating quality reports."
          exit 0
        fi
        echo "WARN: prebuilt ${ASSET} had no rhwp binary; falling back to source build." >&2
      else
        echo "WARN: checksum mismatch/missing for ${ASSET} (want=${want:-none} got=${got}); falling back to source build." >&2
      fi
    else
      echo "WARN: prebuilt ${ASSET} not available; falling back to source build." >&2
    fi
    rm -rf "$TMP"
    trap - EXIT
  fi
fi

# 3) Source build fallback (requires Rust). Used for `main`, unpublished
# platforms, RHWP_CLI_FROM_SOURCE=1, or when the prebuilt path failed above.
if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo is required for the source build. Install Rust first, or set RHWP_CLI_URL to a release binary." >&2
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

echo "RHWP_CLI_PATH=$INSTALL_DIR/rhwp (built from source ${VERSION})"
echo "Set RHWP_CLI_ENABLED=1 in .env.standalone after validating quality reports."
