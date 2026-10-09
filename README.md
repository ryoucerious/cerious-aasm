# Cerious AASM

Ark: Survival Ascended Server Manager, a desktop app and headless web UI for installing,
configuring, and running ARK: Survival Ascended dedicated servers on Windows and Linux.

## Features

- Install and update ARK servers via SteamCMD; an update downloads while the servers keep running
- Manage multiple server instances, including clusters
- Live player count, server status, and port checks
- RCON command support
- Scheduled and on-demand backups
- Mod browsing (CurseForge) and install, loaded at launch with `-mods=`
- Crash detection and scheduled restarts
- Graceful shutdown with player broadcasts
- Headless web UI with optional authentication and per-user accounts

## Running modes

### Desktop (default)

Launch the built application, or `npm run electron:dev` for a development build with
hot reload.

### Headless

Runs without a GUI window and serves the web UI over HTTP.

```bash
# No authentication
npm run headless

# Custom port
npm run headless -- --port=8080

# With authentication
npm run headless -- --auth-enabled --username=<name> --password=<password>
```

The same flags work on an installed Linux package:

```bash
cerious-aasm --no-sandbox --headless --auth-enabled --username=admin --password=<password>
```

`--no-sandbox` is required for headless mode on Linux because of Chromium sandbox
restrictions; it isn't needed for the desktop GUI.

Authentication can also be set with environment variables instead of flags:
`AASM_AUTH_ENABLED=true`, `AASM_USERNAME` and `AASM_PASSWORD`. The app reads them when the
corresponding command-line flag isn't given. This is how the Docker image configures login
(see [docs/DOCKER.md](docs/DOCKER.md)).

#### Command-line parameters

- `--port=<port>`: web server port (default: 3000)
- `--auth-enabled`: require sign-in for the web interface
- `--username=<username>`: admin username (default: admin)
- `--password=<password>`: admin password, at least 8 characters. Applied on every start
  and not changeable from inside the app. Additional users are added under
  Settings > Users & Roles.
- `--help` / `-h`: show help

## Installation

No ARK files are bundled with this application. ARK server files are downloaded directly
from Steam using SteamCMD, which logs in anonymously, so a Steam account is not required.

See [docs/INSTALLATION.md](docs/INSTALLATION.md) for Windows and Linux installation, and
[docs/DOCKER.md](docs/DOCKER.md) to run it in Docker on a Linux server or with Docker
Desktop on Windows or Mac.

## Documentation

- [docs/INSTALLATION.md](docs/INSTALLATION.md): install on Windows or Linux
- [docs/DOCKER.md](docs/DOCKER.md): run in Docker
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md): common problems
- [docs/WINE_PROTON_COMPATIBILITY.md](docs/WINE_PROTON_COMPATIBILITY.md): Proton
  compatibility on Linux
- [docs/README.md](docs/README.md): index of the above

For bugs and feature requests, use [GitHub Issues](https://github.com/ryoucerious/cerious-aasm/issues).

## Legal

Cerious AASM does not redistribute, modify, or bundle any copyrighted ARK: Survival
Ascended files. All downloads go through the official SteamCMD tool, directly from
Steam's servers. Users are responsible for complying with Studio Wildcard's and Valve's
terms of service. This project is not affiliated with or endorsed by either company.

## Credits

- ARK: Survival Ascended is © Studio Wildcard.
- SteamCMD is © Valve Corporation.
- Maintained by r YOU cerious.

[![GitHub stars](https://img.shields.io/github/stars/ryoucerious/cerious-aasm?style=flat-square)](https://github.com/ryoucerious/cerious-aasm/stargazers)
[![GitHub release](https://img.shields.io/github/v/release/ryoucerious/cerious-aasm?style=flat-square)](https://github.com/ryoucerious/cerious-aasm/releases)
[![License](https://img.shields.io/github/license/ryoucerious/cerious-aasm?style=flat-square)](LICENSE)

Discord: [Cerious - AASM](https://discord.gg/n5SxyDRPAa)
