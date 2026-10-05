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

# Unraid and other hosts bind-mount folders owned by their own user (Unraid's is
# nobody:users, 99:100) or by root, which aasm can't write to. Started as root, the
# container takes on PUID and PGID, gives aasm its folders, and runs as aasm from
# there. Without PUID and PGID it keeps aasm's own IDs, which Docker volumes use.
if [ "$(id -u)" = "0" ]; then
  PUID="${PUID:-$(id -u aasm)}"
  PGID="${PGID:-$(id -g aasm)}"
  if ! [[ "$PUID" =~ ^[0-9]+$ && "$PGID" =~ ^[0-9]+$ ]]; then
    echo "[cerious-aasm] PUID and PGID must be numbers, got: ${PUID}:${PGID}" >&2
    exit 1
  fi
  if [ "$PUID" = "0" ]; then
    echo "[cerious-aasm] PUID=0 would run the app as root; pick another user." >&2
    exit 1
  fi

  if [ "$PGID" != "$(id -g aasm)" ]; then
    groupmod -o -g "$PGID" aasm
  fi
  if [ "$PUID" != "$(id -u aasm)" ]; then
    usermod -o -u "$PUID" aasm
  fi

  # Checks every level, not just the top: a folder can be right while files inside it
  # were left by an earlier run as root or as aasm's old IDs. Only files with the wrong
  # owner are changed, so a restart doesn't rewrite a whole server install.
  own() {
    local dir=$1
    shift
    if [ -n "$(find "$dir" "$@" \( ! -user "$PUID" -o ! -group "$PGID" \) -print -quit)" ]; then
      echo "[cerious-aasm] Giving ${PUID}:${PGID} ownership of ${dir}"
      find "$dir" "$@" \( ! -user "$PUID" -o ! -group "$PGID" \) -exec chown -h "${PUID}:${PGID}" {} +
    fi
  }
  mkdir -p /home/aasm/.local/share/cerious-aasm /home/aasm/.config
  # The data folders, including anything mounted inside them.
  own /home/aasm/.local/share/cerious-aasm
  own /home/aasm/.config
  # The rest of the home folder; -xdev keeps it out of the mounts above.
  own /home/aasm -xdev

  exec setpriv --reuid=aasm --regid=aasm --init-groups "$0" "$@"
fi

if [ -n "${UMASK:-}" ]; then
  umask "$UMASK"
fi

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
  )
fi

# The password is deliberately not passed on argv, which every process in the
# container (ARK and Proton included) can read from /proc/*/cmdline. The app
# picks it up from AASM_PASSWORD in its inherited environment.

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

# One app per container, so a single-instance lock in the saved userData is stale.
rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/cerious-aasm/Singleton"*

node_modules/.bin/electron electron/main.js "${args[@]}" "$@" &
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
