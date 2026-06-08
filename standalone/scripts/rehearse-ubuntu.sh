#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env.standalone}"
REPORT_DIR="${REPORT_DIR:-$ROOT/rehearsal-reports/$(date +%Y%m%d-%H%M%S)}"
INSTALL_DEPS="${INSTALL_DEPS:-1}"
RUN_SYSTEMD="${RUN_SYSTEMD:-1}"
PRECHECK_ONLY="${PRECHECK_ONLY:-0}"
FORCE_REHEARSAL="${FORCE_REHEARSAL:-0}"
SUDO_CMD="${SUDO_CMD:-sudo}"

mkdir -p "$REPORT_DIR"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Create it from standalone/env.example first." >&2
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

API_PORT="${PORT:-18010}"
SIDECAR_PORT_VALUE="${SIDECAR_PORT:-18080}"
NGINX_PORT="${NGINX_LISTEN_PORT:-80}"

log() {
  printf "[rehearsal] %s\n" "$*" | tee -a "$REPORT_DIR/rehearsal.log"
}

port_owner() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp 2>/dev/null | awk -v port=":$port" '$4 ~ port "$" {print}'
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
  fi
}

check_port() {
  local name="$1"
  local port="$2"
  local owner
  owner="$(port_owner "$port")"
  if [ -n "$owner" ]; then
    log "port conflict: $name port $port is already listening"
    printf "%s\n" "$owner" | tee -a "$REPORT_DIR/rehearsal.log"
    return 1
  fi
  log "port free: $name port $port"
}

run_step() {
  local name="$1"
  shift
  log "start: $name"
  "$@" > "$REPORT_DIR/$name.log" 2>&1
  log "done: $name"
}

run_root_step() {
  local name="$1"
  shift
  if [ "$(id -u)" -eq 0 ]; then
    run_step "$name" "$@"
  else
    run_step "$name" "$SUDO_CMD" "$@"
  fi
}

conflicts=0
check_port api "$API_PORT" || conflicts=$((conflicts + 1))
if [ "${OFFICE_ENGINE:-builtin}" = "hwp-sidecar" ]; then
  check_port sidecar "$SIDECAR_PORT_VALUE" || conflicts=$((conflicts + 1))
fi
if [ "$RUN_SYSTEMD" = "1" ]; then
  check_port nginx "$NGINX_PORT" || conflicts=$((conflicts + 1))
fi

if [ "$conflicts" -gt 0 ] && [ "$FORCE_REHEARSAL" != "1" ]; then
  log "blocked: resolve port conflicts or set FORCE_REHEARSAL=1 after choosing non-conflicting ports"
  exit 2
fi

if [ "$PRECHECK_ONLY" = "1" ]; then
  log "precheck complete"
  exit 0
fi

if [ "$INSTALL_DEPS" = "1" ]; then
  run_root_step install-ubuntu "$ROOT/standalone/scripts/install-ubuntu.sh"
fi
run_step build "$ROOT/standalone/scripts/build.sh"
run_step init-db "$ROOT/standalone/scripts/init-db.sh"
if [ "$RUN_SYSTEMD" = "1" ]; then
  run_root_step install-systemd "$ROOT/standalone/scripts/install-systemd.sh"
fi
run_step smoke-test "$ROOT/standalone/scripts/smoke-test.sh"

log "complete: report_dir=$REPORT_DIR"
