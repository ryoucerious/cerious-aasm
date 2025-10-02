# Installation Guide - Cerious AASM

## System Requirements

### Minimum Requirements
- **Operating System**: Windows 10 (64-bit) or Linux (Ubuntu 20.04+ / equivalent)
- **RAM**: 4GB minimum, 8GB recommended
- **Storage**: 50GB free space (for ARK server files)
- **CPU**: Dual-core processor, 2.5GHz or higher
- **Network**: Broadband internet connection for downloads
- **Graphics**: Any graphics card supporting hardware acceleration

### Recommended Requirements
- **Operating System**: Windows 11 or Ubuntu 22.04+ LTS
- **RAM**: 16GB or more
- **Storage**: 100GB+ SSD storage
- **CPU**: Quad-core processor, 3.0GHz or higher
- **Network**: High-speed broadband (100+ Mbps)

### Additional Requirements
- **Steam Account**: Required for downloading ARK server files
- **Firewall Access**: Ability to configure firewall rules for server ports
- **Administrator Privileges**: Required for installation and server management

## Windows Installation

### Method 1: Download from Releases (Recommended)

1. **Download the Installer**
   - Go to the [latest release page](https://github.com/cerious/cerious-aasm/releases/latest)
   - Download `Cerious AASM Setup X.X.X.exe`

2. **Run the Installer**
   - Right-click the downloaded file and select "Run as administrator"
   - Follow the installation wizard
   - Choose your installation directory (default: `C:\Program Files\Cerious AASM`)
   - The installer will create desktop and start menu shortcuts

3. **First Launch**
   - Launch "Cerious AASM" from the desktop shortcut or start menu
   - The application will perform initial setup automatically
   - SteamCMD will be downloaded and configured on first run

### Method 2: Build from Source

1. **Prerequisites**
   ```bash
   # Install Node.js 18+ from https://nodejs.org
   # Install Git from https://git-scm.com
   ```

2. **Clone and Build**
   ```bash
   git clone https://github.com/cerious/cerious-aasm.git
   cd cerious-aasm
   npm install
   npm run electron:package:windows
   ```

3. **Install the Built Package**
   - Navigate to `dist-electron/`
   - Run the generated setup file

## Linux Installation

### Method 1: AppImage (Universal)

1. **Download AppImage**
   - Go to the [latest release page](https://github.com/cerious/cerious-aasm/releases/latest)
   - Download `Cerious-AASM-X.X.X.AppImage`

2. **Make Executable and Run**
   ```bash
   chmod +x Cerious-AASM-*.AppImage
   ./Cerious-AASM-*.AppImage
   ```

3. **Optional: Desktop Integration**
   ```bash
   # Move to applications directory
   sudo mv Cerious-AASM-*.AppImage /opt/cerious-aasm.AppImage
   
   # Create desktop entry
   cat > ~/.local/share/applications/cerious-aasm.desktop << EOF
   [Desktop Entry]
   Name=Cerious AASM
   Exec=/opt/cerious-aasm.AppImage
   Icon=cerious-aasm
   Type=Application
   Categories=Game;
   EOF
   ```

### Method 2: DEB Package (Debian/Ubuntu)

1. **Download and Install**
   ```bash
   # Download the .deb file from releases
   wget https://github.com/cerious/cerious-aasm/releases/latest/download/cerious-aasm_X.X.X_amd64.deb
   
   # Install
   sudo dpkg -i cerious-aasm_*.deb
   sudo apt-get install -f  # Fix any dependency issues
   ```

2. **Launch**
   ```bash
   cerious-aasm
   # Or find it in your applications menu
   ```

### Method 3: RPM Package (Red Hat/Fedora/SUSE)

1. **Download and Install**
   ```bash
   # Download the .rpm file from releases
   wget https://github.com/cerious/cerious-aasm/releases/latest/download/cerious-aasm-X.X.X.x86_64.rpm
   
   # Install (Fedora/RHEL)
   sudo dnf install cerious-aasm-*.rpm
   
   # Or for older systems
   sudo rpm -i cerious-aasm-*.rpm
   ```

### Method 4: Build from Source

1. **Install Dependencies**
   ```bash
   # Ubuntu/Debian
   sudo apt update
   sudo apt install nodejs npm git build-essential

   # Fedora
   sudo dnf install nodejs npm git gcc-c++ make

   # Arch Linux
   sudo pacman -S nodejs npm git base-devel
   ```

2. **Clone and Build**
   ```bash
   git clone https://github.com/cerious/cerious-aasm.git
   cd cerious-aasm
   npm install
   npm run electron:package:linux
   ```

## Post-Installation Setup

### Initial Configuration

1. **Launch the Application**

2. **Configure Firewall**
   - The application will guide you through firewall configuration
   - Default ARK server ports: 7777, 7778, 27015
   - Web interface port: 3000 (configurable)

3. **Create Your First Server**
   - Click "Create New Server Instance"
   - Choose your server name and basic settings

### Command Line Usage (Headless Mode)

```bash
# Basic headless mode
cerious-aasm --headless

# With custom port
cerious-aasm --headless --port=8080

# With authentication
cerious-aasm --headless --auth-enabled --username=admin --password=yourpassword

# Get help
cerious-aasm --help
```

## Uninstallation

### Windows
1. Use "Add or Remove Programs" in Windows Settings
2. Or run the uninstaller from the installation directory

### Linux
```bash
# DEB package
sudo apt remove cerious-aasm

# RPM package
sudo dnf remove cerious-aasm

# AppImage
rm /opt/cerious-aasm.AppImage
rm ~/.local/share/applications/cerious-aasm.desktop
```

## Next Steps

After installation, see the [User Manual](USER_MANUAL.md) for detailed usage instructions and the [Troubleshooting Guide](TROUBLESHOOTING.md) if you encounter any issues.