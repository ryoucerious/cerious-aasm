# Cerious-AASM  
**Ark: Survival Ascended Server Manager (Desktop + Headless)**  

## Overview
Cerious-AASM is a desktop application for managing ARK: Survival Ascended dedicated servers. It provides a user-friendly interface for installing, configuring, and controlling ARK servers on your machine. The application supports both desktop (GUI) and headless (web-based) modes.

## Join on Discord
- Cerious - AASM https://discord.gg/n5SxyDRPAa

## Features
- Install and update ARK servers using SteamCMD
- Manage multiple server instances
- Live player count and server status
- RCON command support
- Automated port checks and notifications
- Graceful server shutdown with broadcast
- **Web interface with optional authentication for headless mode**
- **Command-line parameters for server deployment**

## Running Modes

### Desktop Mode (Default)
Standard Electron application with full GUI interface.

### Headless Mode
Run the application without GUI, providing web-based access.

#### Development Mode (npm scripts)
```bash
# Run without authentication
npm run headless

# Run with custom port
npm run headless -- --port=8080

# Run with default authentication (username: admin, password: admin123)
npm run headless:auth

# Run with custom credentials
npm run headless:auth:custom
```

#### Production Mode (Installed Package)
When using the installed `.deb`, `.rpm`, or AppImage package on Linux:

```bash
# Basic headless mode
cerious-aasm --no-sandbox --headless

# With custom port
cerious-aasm --no-sandbox --headless --port=8080

# With authentication (default username: admin)
cerious-aasm --no-sandbox --headless --auth-enabled --password=admin123 --port=3000

# With custom credentials
cerious-aasm --no-sandbox --headless --auth-enabled --username=myuser --password=mypassword

# Full example with all options
cerious-aasm --no-sandbox --headless --port=5000 --auth-enabled --username=admin --password=secret123
```

**Note for Linux users:** The `--no-sandbox` flag is required when running in headless mode on Linux due to Chrome sandbox restrictions. This flag is only needed for headless mode, not for the GUI version.

#### Command Line Parameters
- `--port=<port>` - Set web server port (default: 3000)
- `--auth-enabled` - Enable authentication for web interface
- `--username=<username>` - Set authentication username (default: admin)
- `--password=<password>` - Set authentication password (required with --auth-enabled)
- `--help` or `-h` - Show help message

#### Examples
```bash
# Development: Headless on port 8080 without authentication
npm run headless -- --port=8080

# Production: Headless with authentication on default port
cerious-aasm --no-sandbox --headless --auth-enabled --username=admin --password=secret123

# Production: Headless with authentication on custom port
cerious-aasm --no-sandbox --headless --port=5000 --auth-enabled --password=mypassword
```

## Installation Process
- **No ARK files are bundled or distributed with this application.**
- All ARK server files are downloaded directly from Steam's official servers using SteamCMD.
- The app uses the public SteamCMD tool and logs in anonymously to fetch the latest ARK server files.
- You must have a valid Steam account and comply with Studio Wildcard's terms of service.

## Legal & Compliance Notice
- Cerious-AASM does **not** redistribute, modify, or bundle any copyrighted ARK: Survival Ascended files.
- All downloads are performed via the official SteamCMD tool, directly from Steam's servers.
- Users are responsible for ensuring they have the right to run ARK servers and for complying with all relevant EULAs and terms of service.
- This tool is intended for legitimate server management only.

## Support & Documentation
- For help, bug reports, or feature requests, please visit the project repository or contact the developer.
- For ARK server documentation, see the [official ARK wiki](https://ark.wiki.gg/).

## Credits
- ARK: Survival Ascended is © Studio Wildcard.
- SteamCMD is © Valve Corporation.
- This project is not affiliated with or endorsed by Studio Wildcard or Valve.
[![GitHub stars](https://img.shields.io/github/stars/ryoucerious/cerious-aasm?style=flat-square)](https://github.com/ryoucerious/cerious-aasm/stargazers)  
[![GitHub release](https://img.shields.io/github/v/release/ryoucerious/cerious-aasm?style=flat-square)](https://github.com/ryoucerious/cerious-aasm/releases)  
[![License](https://img.shields.io/github/license/ryoucerious/cerious-aasm?style=flat-square)](LICENSE)  
[![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-blue?style=flat-square)](#-linux-support)  

---

## 🚀 Overview  
**Cerious-AASM** is a cross-platform tool for hosting and managing **ARK: Survival Ascended** dedicated servers.  

It’s **free**, **open-source**, and offers **first-class Linux support**. Whether you’re running a desktop server at home or deploying headless on a Linux host, Cerious-AASM makes server management simple, reliable, and automated.  

---

## 🧰 Key Features  

- 🖥️ **Cross-Platform** – Works seamlessly on **Windows** and **Linux**  
- ⚙️ **Server Automation**  
  - 🔄 **Auto Start** – Servers launch automatically with Cerious-AASM  
  - 💥 **Crash Recovery** – Detects crashes and auto-restarts servers  
  - ⏰ **Scheduled Restarts** – Keep servers fresh with automated restart schedules  
- 📦 **Mod Support** – Easy install & update, with support for `-automanagemods`  
- 🗄️ **Backup & Restore** – Scheduled and on-demand backups of saves, configs, and clusters  
- 🔗 **Cluster Management** – Run and sync multiple servers from one manager  
- 📡 **RCON Integration** – Send admin commands and monitor servers remotely  
- 🛡️ **Headless Mode** – Web-based control panel with optional authentication  
- 📝 **Graceful Shutdowns** – Warn players before reboots or shutdowns  
- 📊 **Server Monitoring** – Real-time status, player counts, and port checks  

---

## 🎯 Use Cases  

### Desktop Mode  
Run Cerious-AASM with a full GUI — perfect for personal or LAN servers.  

### Headless Mode (Remote / Server)  
Run in **web mode** for browser-based management on a VPS or dedicated box:  

```bash
npm run headless -- --port=8080
```

With authentication enabled:  

```bash
npm run headless -- --auth-enabled --username=admin --password=secret
```

---

## ✅ Linux Support  
- Fully tested on **Ubuntu, Debian, Fedora, and CentOS**  
- Identical features on Linux and Windows — no compromises  
- Perfect for dedicated servers or cloud instances  

---

## 📦 Installation  

1. Download the latest [release build](https://github.com/ryoucerious/cerious-aasm/releases)  
2. Install / unpack for your OS  
3. Configure your server via the UI or configs  
4. Launch in desktop or headless mode  

---

## 📚 Documentation  

- Use [GitHub Issues](https://github.com/ryoucerious/cerious-aasm/issues) for bugs & feature requests  
- Guides for Mods, Backups, and Automation (coming soon in Wiki)  
- Community support via ARK forums & subreddits  

---

## ⚖️ Legal & Compliance  

- Cerious-AASM uses **SteamCMD** for downloading ARK: Survival Ascended servers  
- No ARK game files are bundled or redistributed  
- Not affiliated with Studio Wildcard or Valve  

---

## 💡 Why Choose Cerious-AASM?  

- ✅ **Free & Open-Source** — MIT licensed, community-driven  
- ✅ **Cross-Platform** — full support for both Linux & Windows  
- ✅ **Automation Built-In** — auto start, crash recovery, scheduled restarts  
- ✅ **Safe & Reliable** — backups, graceful shutdowns, cluster management  
- ✅ **Mod-Friendly** — install and auto-manage mods with ease  

---

## 🧷 Credits  

- ARK: Survival Ascended – Studio Wildcard  
- SteamCMD – Valve Corporation  
- Maintained and developed by r YOU cerious  
