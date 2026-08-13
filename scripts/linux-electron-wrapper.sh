#!/bin/bash
# Linux entrypoint for packaged Cerious AASM (deb / rpm / AppImage).
#
# Electron initialises GTK at the native-binary level BEFORE any JavaScript
# runs.  Without a display connection the process dies with:
#   Gtk-ERROR: Can't create a GtkStyleContext without a display connection
#
# This wrapper runs *instead of* the Electron binary so we can attach a
# virtual framebuffer (xvfb-run) before GTK ever loads.  The real Electron
# binary lives beside this script as "<name>.bin".
#
# Installed by scripts/after-pack.js during electron-builder packaging.

set -euo pipefail

SELF="$(readlink -f "$0" 2>/dev/null || realpath "$0" 2>/dev/null || echo "$0")"
DIR="$(cd "$(dirname "$SELF")" && pwd)"
BIN="$DIR/$(basename "$SELF").bin"

if [ ! -x "$BIN" ]; then
  echo "[cerious-aasm] ERROR: Electron binary not found at: $BIN" >&2
  exit 1
fi

export ELECTRON_DISABLE_SANDBOX=1

has_display=0
if [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; then
  has_display=1
fi

is_headless=0
for arg in "$@"; do
  case "$arg" in
    --headless) is_headless=1 ;;
  esac
done

if [ "$has_display" -eq 0 ]; then
  if [ "$is_headless" -eq 1 ]; then
    if command -v xvfb-run >/dev/null 2>&1; then
      echo "[cerious-aasm] No display detected — launching via xvfb-run (virtual framebuffer)"
      exec xvfb-run -a "$BIN" "$@"
    fi
    echo "[cerious-aasm] ERROR: No display server and xvfb-run not found." >&2
    echo "  Headless mode on Linux requires a virtual framebuffer." >&2
    echo "  Install xvfb:  sudo apt install xvfb   (Debian/Ubuntu)" >&2
    echo "                 sudo dnf install xorg-x11-server-Xvfb  (Fedora/RHEL)" >&2
    exit 1
  fi

  echo "[cerious-aasm] ERROR: No display server available." >&2
  echo "  GUI mode needs X11/Wayland. For servers, re-run with --headless" >&2
  echo "  (requires xvfb: sudo apt install xvfb)." >&2
  exit 1
fi

exec "$BIN" "$@"
