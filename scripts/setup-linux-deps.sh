#!/bin/bash

# Setup script for Linux-specific dependencies
# This script installs packages needed for ARK server management on Linux

set -e

echo "Setting up Linux dependencies for Cerious AASM..."

# Detect the Linux distribution
if [ -f /etc/os-release ]; then
    . /etc/os-release
    DISTRO=$ID
else
    echo "Warning: Cannot detect Linux distribution"
    DISTRO="unknown"
fi

echo "Detected distribution: $DISTRO"

# Function to install packages based on distribution
install_packages() {
    case $DISTRO in
        ubuntu|debian)
            echo "Installing packages for Debian/Ubuntu..."
            sudo apt update
            sudo apt install -y curl wget tar gzip unzip p7zip-full build-essential
            ;;
        fedora|rhel|centos)
            echo "Installing packages for Red Hat/Fedora..."
            sudo dnf install -y curl wget tar gzip unzip p7zip build-essential
            ;;
        arch|manjaro)
            echo "Installing packages for Arch Linux..."
            sudo pacman -S --noconfirm curl wget tar gzip unzip p7zip base-devel
            ;;
        opensuse*)
            echo "Installing packages for openSUSE..."
            sudo zypper install -y curl wget tar gzip unzip p7zip
            ;;
        *)
            echo "Unsupported distribution: $DISTRO"
            echo "Please manually install: curl, wget, tar, gzip, unzip, p7zip"
            echo "These packages are needed for downloading and extracting ARK server files"
            exit 1
            ;;
    esac
}

# Check if running as root (not recommended)
if [ "$EUID" -eq 0 ]; then
    echo "Warning: Running as root is not recommended"
    echo "Consider running this script as a regular user with sudo access"
fi

# Install system packages
echo "Installing system packages..."
install_packages

# Create directories for ARK server data
echo "Creating application directories..."
APP_DIR="$HOME/.local/share/cerious-aasm"
mkdir -p "$APP_DIR"
mkdir -p "$APP_DIR/.wine-ark"
mkdir -p "$APP_DIR/.steam-compat"
mkdir -p "$APP_DIR/.steam"

echo "Setting permissions..."
chmod 755 "$APP_DIR"

# Check if Steam is installed (optional but helpful)
if command -v steam >/dev/null 2>&1; then
    echo "✓ Steam is installed - this may help with compatibility"
else
    echo "ℹ Steam is not installed - not required but may improve compatibility"
    echo "  Consider installing Steam from your distribution's package manager"
fi

echo ""
echo "✓ Linux setup complete!"
echo ""
echo "Next steps:"
echo "1. Run 'npm install' to install Node.js dependencies"
echo "2. Run 'npm run build' to build the application"
echo "3. Run 'npm run electron' to start the application"
echo ""
echo "Note: Proton will be automatically downloaded when you first install an ARK server"
echo "      This may take some time depending on your internet connection"
