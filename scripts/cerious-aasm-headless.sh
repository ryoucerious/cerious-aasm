#!/bin/bash
# Launcher script for Cerious AASM in headless mode (development / source builds)
#
# On Linux, Electron initialises GTK at the native layer before any JavaScript
# runs.  GTK requires a live display connection (X11 or Wayland).  When no
# display is available (e.g. a headless server) the process crashes with:
#   Gtk-ERROR: Can't create a GtkStyleContext without a display connection
#
# xvfb-run creates a temporary virtual framebuffer that GTK can connect to,
# completely transparently.  Install it with:
#   sudo apt install xvfb          (Debian/Ubuntu)
#   sudo dnf install xorg-x11-server-Xvfb   (Fedora/RHEL)

export ELECTRON_DISABLE_SANDBOX=1

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Navigate to the project root (parent of scripts directory)
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

ELECTRON_BIN="$PROJECT_ROOT/node_modules/.bin/electron"
if [ ! -e "$ELECTRON_BIN" ]; then
  echo "[cerious-aasm] ERROR: Electron not found at $ELECTRON_BIN - run 'npm ci' in $PROJECT_ROOT first." >&2
  exit 1
fi

npx tsc -p tsconfig.electron.json || { echo "[cerious-aasm] TypeScript compilation failed"; exit 1; }

# Prefer xvfb-run to provide a virtual framebuffer GTK can connect to.
# If a real display is already available (DISPLAY is set), skip xvfb-run.
if [ -z "$DISPLAY" ] && command -v xvfb-run &>/dev/null; then
  echo "[cerious-aasm] No display detected - launching via xvfb-run (virtual framebuffer)"
  exec xvfb-run -a "$ELECTRON_BIN" electron/main.js --headless --disable-audio-output "$@"
elif [ -z "$DISPLAY" ]; then
  echo "[cerious-aasm] WARNING: No display and xvfb-run not found."
  echo "  Install xvfb:  sudo apt install xvfb  OR  sudo dnf install xorg-x11-server-Xvfb"
  echo "  Then re-run this script."
  exit 1
else
  echo "[cerious-aasm] Display detected ($DISPLAY) - launching normally"
  exec "$ELECTRON_BIN" electron/main.js --headless --disable-audio-output "$@"
fi
