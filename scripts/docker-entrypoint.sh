#!/bin/bash
# Container entrypoint for headless Cerious AASM.
#
# Maps AASM_* environment variables onto the existing CLI flags and starts
# Electron on a virtual display. GTK initializes before any JavaScript runs,
# so the display has to exist before the Electron binary is executed.
#
# xvfb-run is not used here. As PID 1 it waits on SIGUSR1 from Xvfb, and that
# wait never returns inside a container, so Electron would never start.

set -euo pipefail

cd /app

PORT="${AASM_PORT:-3000}"
if ! [[ "$PORT" =~ ^[0-9]+$ ]]; then
  echo "[cerious-aasm] AASM_PORT must be a number, got: ${PORT}" >&2
  exit 1
fi

args=(
  --headless
  --no-sandbox
  --disable-gpu
  --disable-dev-shm-usage
  --disable-audio-output
  --port="${PORT}"
)

if [ "${AASM_AUTH_ENABLED:-false}" = "true" ]; then
  if [ -z "${AASM_PASSWORD:-}" ]; then
    echo "[cerious-aasm] AASM_PASSWORD is required when AASM_AUTH_ENABLED=true" >&2
    exit 1
  fi
  args+=(
    --auth-enabled
    --username="${AASM_USERNAME:-admin}"
    --password="${AASM_PASSWORD}"
  )
fi

# Docker Desktop on Apple Silicon runs this amd64 image under Rosetta, and 32-bit x86
# through qemu, where SteamCMD's 32-bit build segfaults loading the Steam API.
# steamcmd.sh runs the 64-bit build instead when STEAM_PLATFORM names it.
if [ -z "${STEAM_PLATFORM:-}" ] && grep -q VirtualApple /proc/cpuinfo 2>/dev/null; then
  export STEAM_PLATFORM=linux64
fi

export DISPLAY="${DISPLAY:-:99}"
display_num="${DISPLAY#:}"
rm -f "/tmp/.X${display_num}-lock"
Xvfb "$DISPLAY" -screen 0 1280x1024x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
XVFB_PID=$!

ready=0
for _ in $(seq 1 50); do
  if [ -S "/tmp/.X11-unix/X${display_num}" ]; then
    ready=1
    break
  fi
  sleep 0.1
done
if [ "$ready" -ne 1 ]; then
  echo "[cerious-aasm] Xvfb did not start. Log:" >&2
  cat /tmp/xvfb.log >&2 || true
  exit 1
fi

npx electron electron/main.js "${args[@]}" "$@" &
APP_PID=$!

shutdown() {
  kill -TERM "$APP_PID" 2>/dev/null || true
  wait "$APP_PID" 2>/dev/null || true
  kill "$XVFB_PID" 2>/dev/null || true
}
trap shutdown TERM INT

wait "$APP_PID"
status=$?
kill "$XVFB_PID" 2>/dev/null || true
exit "$status"
