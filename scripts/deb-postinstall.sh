#!/bin/bash
# Post-install script for Cerious AASM .deb package.
# Runs as root immediately after the package is installed by dpkg/apt.
#
# Ubuntu 23.04+ renamed libasound2 to libasound2t64 (64-bit time_t transition).
# The deb 'depends' field uses alternative syntax (libasound2 | libasound2t64)
# which dpkg satisfies with whichever is already present — on Ubuntu 24.04 the
# transitional libasound2 stub is pre-installed, so dpkg never pulls in the real
# libasound2t64 and the app crashes with a symbol-lookup error.
#
# This postinst script explicitly ensures libasound2t64 is installed on systems
# that support it, then falls back to libasound2 on older distros.

if command -v apt-get >/dev/null 2>&1; then
  if apt-cache show libasound2t64 >/dev/null 2>&1; then
    apt-get install -y libasound2t64 >/dev/null 2>&1 || true
  else
    apt-get install -y libasound2 >/dev/null 2>&1 || true
  fi
fi
