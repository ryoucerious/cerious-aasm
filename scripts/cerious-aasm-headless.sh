#!/bin/bash
# Launcher script for Cerious AASM in headless mode
# This script sets the ELECTRON_DISABLE_SANDBOX environment variable
# to disable the Chrome sandbox, which is required for headless mode on Linux

export ELECTRON_DISABLE_SANDBOX=1

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Navigate to the project root (parent of scripts directory)
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

# Compile TypeScript and run in headless mode
npx tsc -p tsconfig.electron.json && electron electron/main.js --headless "$@"
