#!/bin/bash
# Headless launcher for the INSTALLED Cerious AASM AppImage / deb / rpm.
#
# Usage:
#   cerious-aasm-headless-appimage.sh [--password=<password>] [--port=<port>] [extra args...]
#
# On Linux, Electron initialises GTK at the native layer before any JavaScript
# runs.  GTK requires a live display connection (X11 or Wayland).  When no
# display is available the process crashes with:
#   Gtk-ERROR: Can't create a GtkStyleContext without a display connection
#
# xvfb-run creates a temporary virtual framebuffer that satisfies GTK without
# needing a real monitor.  Install it with:
#   sudo apt install xvfb          (Debian/Ubuntu)
#   sudo dnf install xorg-x11-server-Xvfb   (Fedora/RHEL)
#
# After installing xvfb, put this script somewhere on $PATH and run:
#   cerious-aasm-headless-appimage.sh --auth-enabled --password=admin123 --port=3000

# --------------------------------------------------------------------------
# Locate the Cerious AASM binary  (AppImage, or system-installed executable)
# --------------------------------------------------------------------------
APP_BIN=""

# 1. Explicit override via $CERIOUS_AASM_BIN
if [ -n "$CERIOUS_AASM_BIN" ]; then
  APP_BIN="$CERIOUS_AASM_BIN"

# 2. Check common system install paths (deb/rpm)
elif command -v cerious-aasm &>/dev/null; then
  APP_BIN="$(command -v cerious-aasm)"

# 3. Look for AppImage in current directory
else
  APPIMAGE=$(ls ./*.AppImage 2>/dev/null | grep -i 'cerious' | head -n 1)
  if [ -n "$APPIMAGE" ]; then
    APP_BIN="$APPIMAGE"
  fi
fi

if [ -z "$APP_BIN" ]; then
  echo "[cerious-aasm] ERROR: Could not locate Cerious AASM binary."
  echo "  Set CERIOUS_AASM_BIN=/path/to/cerious-aasm and retry."
  exit 1
fi

echo "[cerious-aasm] Using binary: $APP_BIN"

# --------------------------------------------------------------------------
# Launch with xvfb-run if no display is available
# --------------------------------------------------------------------------
if [ -z "$DISPLAY" ] && command -v xvfb-run &>/dev/null; then
  echo "[cerious-aasm] No display detected — launching via xvfb-run (virtual framebuffer)"
  exec xvfb-run -a "$APP_BIN" --no-sandbox --headless "$@"
elif [ -z "$DISPLAY" ]; then
  echo "[cerious-aasm] WARNING: No display and xvfb-run not found."
  echo "  Install xvfb:  sudo apt install xvfb  OR  sudo dnf install xorg-x11-server-Xvfb"
  echo "  Then re-run this script."
  exit 1
else
  echo "[cerious-aasm] Display detected ($DISPLAY) — launching normally"
  exec "$APP_BIN" --no-sandbox --headless "$@"
fi
