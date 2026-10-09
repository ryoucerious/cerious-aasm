# Installation Guide - Cerious AASM

## System Requirements

### Supported platforms

- **Windows**: 10 or 11, 64-bit
- **Linux, x64**: the `.deb` targets Debian/Ubuntu, the `.rpm` targets Fedora/RHEL-family
  distributions, and the AppImage runs on most x64 distributions with glibc and FUSE. CI
  builds the Linux packages on Ubuntu and runs the main-process tests on Ubuntu and Windows.
- macOS is not supported (ARK: Survival Ascended does not ship a macOS dedicated server).

### Hardware

- **RAM**: each running ARK server uses around 10 GB of memory, so 16 GB runs one server
  comfortably and two or three need 32 GB or more.
- **Storage**: plan for about 20 GB before you create any servers, most of it the ARK
  server files (installed once and shared by all your servers), plus room for saves,
  mods, and backups.
- **Network**: a broadband connection for downloads, plus the game, query, and RCON ports
  for each server reachable through your firewall/router (the in-app Firewall page lists
  the exact ports per server).

### Other

- **Steam account**: not required. SteamCMD logs in anonymously to download the ARK server
  files.
- **Node.js** (build from source only): `^20.19 || ^22.12 || >=24`, matching Angular 20's
  requirement.

## Windows Installation

### Method 1: Download from Releases (Recommended)

1. **Download the Installer**
   - Go to the [latest release page](https://github.com/ryoucerious/cerious-aasm/releases/latest)
   - Download `Cerious-AASM-Setup-X.X.X.exe`

2. **Run the Installer**
   - Run the downloaded file; it does not need administrator rights
   - In the wizard, choose whether to install for just your account or for all users, and
     the installation folder
   - The installer will create desktop and start menu shortcuts

3. **First Launch**
   - Launch "Cerious AASM" from the desktop shortcut or start menu
   - The application will perform initial setup automatically
   - SteamCMD will be downloaded and configured on first run

### Method 2: Build from Source

1. **Prerequisites**
   ```bash
   # Install Node.js (see System Requirements above) from https://nodejs.org
   # Install Git from https://git-scm.com
   ```

2. **Clone and Build**
   ```bash
   git clone https://github.com/ryoucerious/cerious-aasm.git
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
   - Go to the [latest release page](https://github.com/ryoucerious/cerious-aasm/releases/latest)
   - Download `Cerious-AASM-X.X.X.AppImage`

2. **Make Executable and Run**
   ```bash
   chmod +x Cerious-AASM-*.AppImage
   ./Cerious-AASM-*.AppImage
   ```

   If you see a `chrome-sandbox` / SUID sandbox FATAL on Ubuntu 24.04 with an
   older AppImage, launch with:
   ```bash
   ./Cerious-AASM-*.AppImage --no-sandbox --disable-setuid-sandbox
   # or:
   ELECTRON_DISABLE_SANDBOX=1 ./Cerious-AASM-*.AppImage
   ```
   Current builds include these flags automatically.

   SteamCMD, which downloads the ARK server, needs the 32-bit C library. The
   `.deb` and `.rpm` bring it when they are installed. An AppImage installs
   nothing as root, so install it once yourself; otherwise the app asks for a
   sudo password the first time it installs or updates ARK:
   ```bash
   sudo apt install lib32gcc-s1        # Debian / Ubuntu
   sudo dnf install glibc.i686         # Fedora / RHEL
   ```

3. **Optional: Desktop Integration**
   ```bash
   # Move to applications directory
   sudo mv Cerious-AASM-*.AppImage /opt/cerious-aasm.AppImage
   
   # Create desktop entry
   cat > ~/.local/share/applications/cerious-aasm.desktop << EOF
   [Desktop Entry]
   Name=Cerious AASM
   Exec=/opt/cerious-aasm.AppImage --no-sandbox --disable-setuid-sandbox
   Icon=cerious-aasm
   Type=Application
   Categories=Game;
   EOF
   ```

### Method 2: DEB Package (Debian/Ubuntu)

1. **Download and Install**
   ```bash
   # Download the .deb file from releases
   wget https://github.com/ryoucerious/cerious-aasm/releases/latest/download/Cerious-AASM-X.X.X.deb
   
   # Install
   sudo dpkg -i Cerious-AASM-*.deb
   sudo apt-get install -f  # Fix any dependency issues
   ```

   The package brings everything the app needs to install and update ARK,
   including the 32-bit C library SteamCMD runs on (`lib32gcc-s1`), so the
   account that runs the app never needs a sudo password for it.

2. **Launch**
   ```bash
   cerious-aasm
   # Or find it in your applications menu
   ```

### Method 3: RPM Package (Red Hat/Fedora/SUSE)

1. **Download and Install**
   ```bash
   # Download the .rpm file from releases
   wget https://github.com/ryoucerious/cerious-aasm/releases/latest/download/Cerious-AASM-X.X.X.rpm
   
   # Install (Fedora/RHEL)
   sudo dnf install Cerious-AASM-*.rpm
   
   # Or for older systems
   sudo rpm -i Cerious-AASM-*.rpm
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
   git clone https://github.com/ryoucerious/cerious-aasm.git
   cd cerious-aasm
   npm install
   npm run electron:package:linux
   ```

### Method 5: Docker Compose

The Docker image runs the headless app, managed from your browser, on a Linux server or on Windows and Mac with Docker Desktop. Download the Compose file and start it:

```bash
curl -fsSLO https://raw.githubusercontent.com/ryoucerious/cerious-aasm/main/docker-compose.yml
docker compose up -d
```

Then open `http://localhost:3000`. On an Apple Silicon Mac, add `docker-compose.arm64.yml` as described in the Docker guide. The [Docker guide](DOCKER.md) covers the rest: installing the ARK server, turning on sign-in, which ports your servers can use, host networking on Linux, updating, and troubleshooting.

## Post-Installation Setup

### Initial Configuration

1. **Launch the Application**

2. **Create Your First Server**
   - Click "Add Server" (on the Dashboard, or the + next to the server list in the sidebar)
   - Choose "Create New Server", enter a name, and click "Add"

3. **Open the Ports**
   - Default ARK server ports: 7777 and 7778 (UDP, game and peer), 27015 (UDP, query) and
     27020 (TCP, RCON)
   - Web interface port: 3000 (configurable)
   - Forward or allow these on your firewall and router; the Firewall page for each server
     lists exactly which ports it needs

### Command Line Usage (Headless Mode)

Cerious AASM can run as a headless background service that serves the web UI
(which talks to the app over a WebSocket) instead of launching a GUI window.  **On Linux, Electron still loads GTK at the
native level even with `--headless`, so a display connection is required.**
Current `.deb` / `.rpm` / AppImage packages install a launcher that automatically
uses `xvfb-run` when you pass `--headless` and no `DISPLAY`/`WAYLAND_DISPLAY`
is set. The `xvfb` package is pulled in as a dependency of the `.deb`/`.rpm`.

#### 1. Install (xvfb comes with the package on deb/rpm)

```bash
# Debian / Ubuntu — xvfb is a package dependency of cerious-aasm
sudo apt install ./Cerious-AASM-*.deb

# If you only have the AppImage, install xvfb once:
sudo apt install xvfb          # Debian / Ubuntu
sudo dnf install xorg-x11-server-Xvfb   # Fedora / RHEL / Rocky
```

#### 2. Run headless

```bash
# Basic headless mode (launcher attaches xvfb automatically when needed)
cerious-aasm --no-sandbox --headless

# With custom port
cerious-aasm --no-sandbox --headless --port=8080

# With authentication. --password is the admin login: it is applied on every
# start and cannot be changed in the app. Add other users under Settings → Users & Roles.
cerious-aasm --no-sandbox --headless --auth-enabled --username=<name> --password=<password>
```

Authentication can also be set with `AASM_AUTH_ENABLED=true`, `AASM_USERNAME`, and
`AASM_PASSWORD` environment variables instead of flags; the app reads them when the
matching flag isn't given.

Manual `xvfb-run -a …` still works and is useful for older builds (≤1.0.11) or
when invoking the raw Electron `.bin` directly. The helper script
[cerious-aasm-headless-appimage.sh](../scripts/cerious-aasm-headless-appimage.sh)
also wraps AppImages the same way.

#### 3. Run as a systemd service

```ini
[Unit]
Description=Cerious AASM headless service
After=network.target

[Service]
ExecStart=/usr/bin/cerious-aasm --no-sandbox --headless --auth-enabled --username=<name> --port=3000
Restart=on-failure
Environment=AASM_PASSWORD=<password>
Environment=ELECTRON_DISABLE_SANDBOX=1

[Install]
WantedBy=multi-user.target
```

**Note:** The `--no-sandbox` flag is required for headless mode on Linux due to Chrome sandbox restrictions. This is a security trade-off necessary for headless operation. For GUI mode simply run `cerious-aasm` without any flags (no `xvfb-run` needed if a desktop session is available).


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

After installation, see the [Troubleshooting Guide](TROUBLESHOOTING.md) if you run into
problems, or [DOCKER.md](DOCKER.md) if you'd rather run it in a container.
