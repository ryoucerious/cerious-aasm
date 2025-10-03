# Cerious-AASM: ARK Server Manager

## Overview
Cerious-AASM is a desktop application for managing ARK: Survival Ascended dedicated servers. It provides a user-friendly interface for installing, configuring, and controlling ARK servers on your machine. The application supports both desktop (GUI) and headless (web-based) modes.

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

---
**Bundled with Cerious-AASM v1.0 – Generated September 15, 2025**