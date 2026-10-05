# Troubleshooting Guide - Cerious AASM

## Linux Installation Issues

**Error**: Permission denied (AppImage)
```bash
chmod +x Cerious-AASM-*.AppImage
```

**Error**: Missing dependencies
```bash
# Ubuntu/Debian
sudo apt install libnss3 libatk-bridge2.0-0 libdrm2 libgtk-3-0

# Fedora/RHEL
sudo dnf install nss atk at-spi2-atk gtk3
```

**Error**: AppImage won't run
```bash
# Enable FUSE
sudo apt install fuse
sudo modprobe fuse

# Or extract and run directly
./Cerious-AASM-*.AppImage --appimage-extract
./squashfs-root/cerious-aasm
```

**Error**: `The SUID sandbox helper binary was found, but is not configured correctly` / `chrome-sandbox`

**Cause**: Chromium requires `chrome-sandbox` to be root-owned with mode `4755`.
AppImages mount under `/tmp/.mount_*`, so that permission model is impossible.
Ubuntu 24.04 often aborts before Electron JS can disable the sandbox.

**Immediate workaround** (current AppImage):
```bash
./Cerious-AASM-*.AppImage --no-sandbox --disable-setuid-sandbox
# or:
ELECTRON_DISABLE_SANDBOX=1 ./Cerious-AASM-*.AppImage
```

Newer builds bake `--no-sandbox` into the AppImage/desktop launch args so a
plain `./Cerious-AASM-*.AppImage` start works without extra flags.

### Headless Mode Crashes on Linux (`Gtk-ERROR: Can't create a GtkStyleContext without a display connection`)

**Cause**: Electron initialises GTK at the native-binary level, *before* any
JavaScript runs.  GTK requires a live display connection (X11 or Wayland).
On a headless server where no display is available the process crashes
immediately with a core dump regardless of the `--headless` flag.

**Current packages (≥ 1.0.19)**: the installed `cerious-aasm`
command is a shell launcher that automatically runs `xvfb-run` when `--headless`
is passed and no display is available. The `.deb`/`.rpm` already depends on
`xvfb`, so this should just work:

```bash
cerious-aasm --no-sandbox --headless --auth-enabled --username=<name> --password=<password> --port=3000
```

**Older builds (e.g. 1.0.11)** or if you invoke the raw `cerious-aasm.bin`
directly: wrap with `xvfb-run` yourself.

1. **Install xvfb** (if not already pulled in by the package):
   ```bash
   # Debian / Ubuntu
   sudo apt install xvfb

   # Fedora / RHEL / Rocky
   sudo dnf install xorg-x11-server-Xvfb
   ```

2. **Manual / older packages**:
   ```bash
   xvfb-run -a cerious-aasm --no-sandbox --headless --auth-enabled --username=<name> --password=<password> --port=3000
   ```
   Or use [cerious-aasm-headless-appimage.sh](../scripts/cerious-aasm-headless-appimage.sh).

3. **Source / development builds** – use the existing helper script:
   ```bash
   ./scripts/cerious-aasm-headless.sh --auth-enabled --username=<name> --password=<password> --port=3000
   ```

4. **systemd** (current packages — launcher handles xvfb):
   ```ini
   [Service]
   ExecStart=/usr/bin/cerious-aasm --no-sandbox --headless --auth-enabled --username=<name> --port=3000
   Environment=AASM_PASSWORD=<password>
   ```

Authentication can also be set with `AASM_AUTH_ENABLED=true`, `AASM_USERNAME`, and
`AASM_PASSWORD` environment variables instead of flags.

## SteamCMD Download Fails

**Symptoms**: Initial setup fails, SteamCMD won't download

**Solutions**:
1. **Check Internet Connection**:
   - Verify stable internet connection
   - Test with other downloads

2. **Firewall / Antivirus**: make sure SteamCMD is allowed to make outbound connections. On
   Windows, from an elevated PowerShell:
   ```powershell
   New-NetFirewallRule -DisplayName "SteamCMD" -Direction Outbound -Program "$env:APPDATA\Cerious AASM\steamcmd\steamcmd.exe" -Action Allow
   ```

3. **Manual SteamCMD Installation**:
   - Download SteamCMD manually from Valve
   - Extract it to `%APPDATA%\Cerious AASM\steamcmd` (Windows) or
     `~/.local/share/cerious-aasm/steamcmd` (Linux)
   - Restart the application

## Ports

### Players Can't Connect

**Diagnostic Steps**:
1. Test locally with `127.0.0.1:<game port>` from the same machine.
2. Test from a different network, or use an online port checker.

**Solutions**:
1. **Router Configuration** — forward the server's game (UDP), query (UDP), and RCON (TCP)
   ports to the machine running Cerious AASM. The in-app Firewall page for each server
   lists the exact ports to open.
2. **Firewall Rules** (Windows example):
   ```powershell
   New-NetFirewallRule -DisplayName "ARK Server" -Direction Inbound -Protocol UDP -LocalPort 7777 -Action Allow
   New-NetFirewallRule -DisplayName "ARK RCON" -Direction Inbound -Protocol TCP -LocalPort 27020 -Action Allow
   ```
3. **Steam Visibility** — if the server has a join password, players need to enable the
   in-game filter for password-protected servers; ARK hides those by default. Allow a
   few minutes after startup for Steam to list the server, or join directly with the
   in-game console: `open <ip>:<game port>`.

### Web Interface Not Accessible

**Solutions**:
1. Check the application log (see Logs below) for a web server startup error or a port
   binding failure.
2. Check for a port conflict:
   ```powershell
   # Windows
   netstat -an | findstr "3000"
   ```
   ```bash
   # Linux
   ss -tuln | grep 3000
   ```
   If something else is using the port, change it under Settings > Web Server in the desktop
   app (the web server has to be stopped first) or start headless with `--port=<port>`. In
   Docker, set `AASM_PORT` instead.
3. Allow the port through the firewall if the browser is on a different machine.

### Behind a Reverse Proxy

If the page loads through a reverse proxy but never shows live data, or the browser reports
that its WebSocket connection failed, the proxy is probably not passing what the app needs:

- **Forward the Host header** (nginx: `proxy_set_header Host $host;`, or `$http_host` on a
  non-default port, where the port has to match too). The app refuses a
  WebSocket whose `Origin` doesn't match the request's `Host`, and logs a
  `Refused a WebSocket from origin` warning once for each origin and host pair it refuses.
  If the proxy has to rewrite `Host`, send the original in `X-Forwarded-Host` instead.
- **Pass WebSocket upgrades for `/ws`** (nginx: `proxy_http_version 1.1;`,
  `proxy_set_header Upgrade $http_upgrade;`, `proxy_set_header Connection "upgrade";`).
- The app does not trust `X-Forwarded-For`, so the sign-in limiter sees the proxy's address
  for every client: attempts on one username from anyone behind the proxy share one counter
  (10 per 15 minutes). The session cookie is marked `Secure` only when the app itself sees
  HTTPS, which behind a proxy it does not.

A minimal nginx example is in [DOCKER.md](DOCKER.md#behind-a-reverse-proxy).

## Logs

- **Application log**: `<userData>/logs/cerious-aasm.log` (rotates at 10 MB), where
  `<userData>` is Electron's per-user data directory: `%APPDATA%\cerious-aasm` on Windows
  and `~/.config/cerious-aasm` on Linux. This is not the `Cerious AASM` folder that holds
  your servers and SteamCMD. The app writes the exact path to the log at startup
  ("Cerious AASM starting, log: ...") and returns it for the `get-log-file-path` request.
- **Per-server log**: each instance's ARK/Proton stderr is captured to `stderr.log` in that
  server's own folder (`AASMServer/ShooterGame/Saved/Servers/<server id>/stderr.log` under
  your configured server data directory). This is the first place to look when a server
  won't start and no `ShooterGame.log` was produced.
- **Docker**: `docker compose logs -f aasm` for the app log; the per-server `stderr.log` is
  inside the `aasm-data` volume at the same relative path. See
  [DOCKER.md](DOCKER.md#when-something-goes-wrong).

## Getting Support

1. **Gather Information**: OS and version, Cerious AASM version, exact error messages,
   steps to reproduce.
2. **Collect Logs**: the application log and the relevant server's `stderr.log`.
3. **Try Basic Solutions**: restart the application, restart the server, check disk space.
4. Open a [GitHub Issue](https://github.com/ryoucerious/cerious-aasm/issues) with the above.
