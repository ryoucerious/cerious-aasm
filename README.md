# Cerious-AASM  
**Ark: Survival Ascended Server Manager (Desktop + Headless)**  

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
