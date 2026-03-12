# Changelog

All notable changes to Cerious AASM (ARK: Survival Ascended Server Manager) will be documented in this file.

## [Unreleased]

## [1.0.9] - 2026-03-11

### Bug Fixes

- **RCON Crash — Password Stored as Number**: The `rcon` library's `send()` method calls `Buffer.byteLength()` which requires a string. When `serverAdminPassword` was stored as a plain number in `config.json` (e.g. `123456`), passing it directly caused an uncaught `ERR_INVALID_ARG_TYPE` exception that crashed the main process. The password is now coerced with `String()` before being passed to the RCON constructor. The RCON port is similarly coerced with `parseInt()` for consistency.
- **Servers Stuck in "Stopping" State After Auto ARK Update**: When `performClusterUpdate` restarted servers after a SteamCMD update, it passed empty no-op callbacks (`() => {}`) for log and state events. As a result, state transitions (`starting` → `running`) were never broadcast to the UI, leaving every restarted server permanently shown as "stopping". The cluster update sequence now retrieves proper `onLog`/`onState` callbacks via `serverInstanceService.getStandardEventCallbacks()` for each instance, ensuring server state and player polling are correctly broadcast to all connected windows after an auto-update restart.

### New Features

- **Cryopod Settings Added**: Three new `[ServerSettings]` options are now available in the Misc → Engrams & Crafting tab: **Disable Cryopod Fridge Requirement** (`DisableCryopodFridgeRequirement`), **Disable Cryopod Enemy Check** (`DisableCryopodEnemyCheck`), and **Allow Cryofridge On Saddle** (`AllowCryoFridgeOnSaddle`).

## [1.0.8] - 2026-03-08

### Bug Fixes

- **Backup Failing with "Array buffer allocation failed"**: The backup zip builder used `stat()` which follows Windows junction points. Instance directories contain junctions to `ShooterGame/Content` (~70 GB) and `Engine` (~3 GB) for game file isolation. The backup attempted to read all those bytes into memory, exhausting Node's V8 heap. Switched to `lstat()` and skip any `isSymbolicLink()` entry so junctions are never traversed.
- **Backup Including ~200 MB of Redundant Binaries**: Even after junction-skipping, the actual `ShooterGame/Binaries/Win64` exe/dll files (~200 MB) were copied into every backup unnecessarily — they are always re-copied from the shared install on server start and are never unique per instance. Files directly inside the `Win64` root are now skipped; subdirectories (e.g. `ArkApi/` plugins) are still archived so user-installed plugins are preserved.
- **App Update Banner Never Showing**: The `update-available` and `update-downloaded` events from `electron-updater` fired during the first few seconds after app ready, before Angular had finished booting and subscribing to `app-update-status`. The events were broadcast and discarded silently. `AutoUpdateService` now caches `lastStatus`; a new `get-app-update-status` IPC handler lets the renderer request a replay on init; `UpdateBannerComponent` sends this request immediately after subscribing so it always receives the current state regardless of timing.

### Improvements

- **App Updates Are Now User-Initiated**: `autoDownload` and `autoInstallOnAppQuit` are now `false`. The app checks for updates but never downloads without user consent. The update banner now shows a "Download Update" button when a new version is available; a progress bar appears during download; "Restart to Update" appears only after the download completes.
- **Periodic Update Checks**: The app now re-checks for updates every 4 hours while running, in addition to the check on startup. Previously the app only checked once at launch.

## [1.0.7] - 2026-03-06

### Bug Fixes

- **RCON Never Connecting — Missing ServerAdminPassword**: ARK only opens the RCON listener when `ServerAdminPassword` is present in the launch arguments. The parameter was conditionally omitted when the user had not explicitly set an admin password, meaning the RCON port was never bound and every connection attempt received `ECONNREFUSED`. The auto-generated `rconPassword` is now used as a fallback so ARK always receives a password and the RCON port is reliably opened.
- **RCON Triggered Too Early by Premature Startup Indicators**: Startup indicators such as `Full Startup:`, `Listening on port`, `StartPlay RPC completed`, and `Initializing Game Engine Completed` were firing 30–60 seconds before ARK actually binds the RCON port. The entire 90-second retry window was consumed on a port that had not yet opened. RCON connection is now only triggered by the definitive `"Server has completed startup and is now advertising for join"` log line.
- **RCON Concurrent Retry Loop Stacking**: Multiple independent RCON retry chains were spawning simultaneously — the initial startup connect, the player-poll passive reconnect every 30 s, and potentially service-level calls all launched separate 30-attempt loops. Their log entries appeared milliseconds apart and all failed. A `rconConnecting` guard set now ensures only one active retry chain exists per instance at any time. Exported `isRconConnecting()` for monitoring-service checks.
- **Update Checker Always Reporting Update with Custom Data Directory**: `ark-server-install.utils.ts` had its own local `getArkServerDir()` that always returned the default install path, ignoring any custom Server Data Directory. `getCurrentInstalledVersion()` and `isArkServerInstalled()` both called through this function, so the manifest was never found in the custom directory and every poll reported an update. The local function now delegates to `ArkPathUtils.getArkServerDir()` which correctly respects the configured custom path.
- **Log Watcher Polling Wrong Directory with Custom Data Directory**: `getLogsDir()` in `ark-server-logging.utils.ts` called `getArkServerDir()` from `ark-server-install.utils.ts`, which (before the fix above) always returned the default path. Log tailing and startup detection were watching the wrong directory, causing servers using a custom location to appear permanently stuck in "Starting". Fixed as a side-effect of the `ark-server-install.utils.ts` delegation fix.
- **Slow Server Start on First Run with Custom Data Directory**: Win64 binaries (~200 MB) were unconditionally copied on every server start. A size + mtime check now skips copying files that are already current, mirroring `rsync --update` behaviour. Only the initial run or after a game update performs the full copy.
- **Mods Preventing Server Start (CurseForge Unreachable)**: `-automanagedmods` instructed ARK to download mods from CurseForge at startup. When CurseForge was unreachable (`LogCFCore: serverUnreachable`), ARK exited without starting. The flag has been removed; mods configured in the UI are passed via `-mods=` IDs only.
- **Mod IDs Validated as Numeric**: Non-numeric strings (e.g. mod names or URLs) could be added to the mod list. Both the Mods tab and server page now validate that a mod ID matches `/^\d+$/` before adding, with a clear error notification directing users to CurseForge for the numeric ID.
- **High RAM Usage on Linux (13+ GB RSS)**: `getInstanceLogs()` used `fs.readFileSync` to load the entire ARK log file into memory on every call. ARK logs grow to multiple gigabytes over time, causing the Electron process to balloon to 13–14 GB RSS on Linux. The function now reads only the last 64 KB of the file using byte-range reads, capping memory impact regardless of log file size. Per-instance log isolation is unchanged.
- **RCON Passive Reconnect Guard**: The player-polling passive reconnect now also checks `isRconConnecting()` before launching a new attempt, preventing redundant chains from being queued when the previous chain is still running.
- **CurseForge API Key Injection Failing on Linux (403 Errors)**: The `sed` command in the GitHub Actions Linux build step used `/` as the delimiter (`s/PLACEHOLDER/KEY/g`). CurseForge API keys contain `/` characters, which silently broke the substitution and left the placeholder in the bundle, producing 403 responses for all mod API calls. The delimiter is now `|` (`s|PLACEHOLDER|KEY|g`).

### New Features

- **Clear Custom Server Data Directory**: A red × button next to the Server Data Directory field in Settings resets the path back to the default install location. The button is disabled when no custom path is set.

## [1.0.6] - 2026-03-04

### Bug Fixes

- **Admin Password / RCON Password Mixup**: Fixed a critical bug where the server admin password was being written as `RCONPassword=` (not a real ARK parameter, ignored entirely) and the auto-generated internal RCON password was overwriting `ServerAdminPassword=` in the launch arguments. This caused in-game admin commands to fail with the user's configured password, while RCON appeared to work. ARK now receives `ServerAdminPassword` correctly from the user-configured value, used for both in-game admin access and RCON authentication.

## [1.0.5] - 2026-03-03

### Improvements

- **CurseForge Mod Browser — No API Key Required**: The CurseForge API key is now embedded at build time via a CI secret, so the mod browser works out of the box for all installs with no user configuration. The API key field has been removed from the Settings page.

## [1.0.4] - 2026-03-02

### New Features

- **CurseForge Mod Browser**: Browse and search ARK: Survival Ascended mods directly within the app from the Mods tab. Features a card grid layout with mod thumbnails, category tags, download counts, author names, and per-card "Add to server" and "View on CurseForge" buttons. Sort options include Popular, Most Downloaded, Recently Updated, A–Z Name, and Featured. An installed badge highlights mods already on the server. Because ARK:SA is a restricted game on the CurseForge API (third-party keys receive a 403), a clear inline error banner explains the restriction and provides a one-click link to browse the full mod catalogue on CurseForge.com.
- **Professional Application Logging**: Integrated `electron-log` for structured, timestamped, level-aware logging in the Electron main process. All existing `console.*` output is automatically captured and written to `%APPDATA%\Cerious-AASM\logs\cerious-aasm.log` on Windows (`~/.config/Cerious-AASM/logs/cerious-aasm.log` on Linux) with 10 MB auto-rotation. Log level is `debug` in development and `info` in production. A startup banner logs the active log file path.

### Improvements

- **External URL Handling**: All "View on CurseForge" and "Browse on CurseForge.com" links now open in the OS default browser in both Electron and headless web mode. In Electron, `shell.openExternal()` is used; in web mode, `window.open()` is used.
- **CurseForge Browser UI Consistency**: Buttons in the CurseForge browse modal now use the app's standard `btn-ghost` style. The sort dropdown matches the custom dropdown design used by the Map selector on the General tab (styled panel, `arrow_drop_down` icon, highlighted active option) rather than a native `<select>` element.

## [1.0.3] - 2026-03-02

### Bug Fixes

- **Linux: ARK Server Freeze at Startup (Wine/Proton)**: Fixed critical issue where ARK Server v83.21+ would freeze during Sentry SDK initialization when running under Wine/Proton on Linux. Added Wine-specific DLL overrides for networking/crypto libraries (`winhttp`, `bcrypt`, `crypt32`) and Unreal Engine compatibility flags (`-NoHangDetection`, `-NOSTEAM`, `-norhithread`) to prevent hang detection and Steam API conflicts. This issue affected all versions of Cerious AASM after ARK Server updated to v83.21.

## [1.0.2] - 2026-03-01

### Bug Fixes

- **Linux: ALSA Symbol Error on Headless Servers**: Fixed `cerious-aasm: undefined symbol: snd_device_name_get_hint` crash when launching on headless systems that have no audio stack. Electron no longer attempts to initialize ALSA in `--headless` mode (`--disable-audio-output` switch added in `main.ts` and both headless launcher scripts).
- **Linux: RCON Connection Flood During Startup**: RCON connections were attempted every 2 seconds starting from t=0, producing hundreds of `ECONNREFUSED` log entries before ARK even finished loading. RCON is now event-driven — a single connection attempt fires the instant log tailing detects the server's startup-complete log line. No polling, no arbitrary delay. A 15-minute safety-net fires one attempt if the log file is never parsed (e.g. Proton swallows stdout).
- **Linux: 32-bit Library Install Failure**: Installing ARK server dependencies failed with `Unable to locate package libc6:i386` because `dpkg --add-architecture i386` had not been run. `system-deps.utils.ts` now detects when an `:i386` package is needed and enables the i386 architecture before running `apt-get update`.
- **Install / Update ARK Server — Silent Failure**: The "Install/Update ARK Server" button silently froze or crashed the UI on Linux. Four issues fixed: (1) catch block in `install-handler.ts` was missing `message`/`step`/`phase` fields causing a null-crash in the frontend; (2) `pty.spawn()` in `installer.utils.ts` was not wrapped in try/catch; (3) `steamcmd.sh` was not `chmod 755` after extraction; (4) `settings.component.ts` called `progress.message.includes()` without a null guard. The install modal now shows a red error state with an error toast when installation fails.

### Improvements

- **Linux Headless Launcher Scripts**: Both `cerious-aasm-headless.sh` and `cerious-aasm-headless-appimage.sh` now pass `--disable-audio-output` to prevent ALSA crashes regardless of how the binary is invoked.

## [1.0.1] - 2026-02-28

### New Features

- **Expert Mode INI Editor**: New toggle in the server settings header switches to a raw INI file editor for `GameUserSettings.ini` and `Game.ini`. Changes saved in Expert Mode are synced back to the normal UI fields automatically.
- **ArkApi Plugin Management**: New ArkApi tab in server settings supports installing plugins directly from a URL or a local ZIP file, listing installed plugins with version info, and removing them.
- **Start All / Stop All Confirmation**: Clicking Start All or Stop All in the sidebar now shows a confirmation dialog before executing.
- **"Preparing to start" State**: Servers queued in a staggered Start All now immediately show a "Preparing to start" status (with matching sidebar icon) instead of showing "Stopped" while waiting in the queue.

### Bug Fixes

- **Start All / Stop All — Status Icons**: Server status icons in the sidebar and the server detail page now update correctly when multiple servers start or stop around the same time. State was previously being set in the wrong order causing icons to cross-contaminate between instances.
- **Start All / Stop All — UI Lag**: The frontend no longer blocks waiting for all staggered starts to complete before receiving a response. Status updates are broadcast immediately per-instance.
- **Start All — Start Order**: Servers now start in the order they are listed in the sidebar (respecting user-defined drag-and-drop sort order) rather than arbitrary filesystem order.
- **Start All — Already Running**: Servers that are already running, starting, or queued are correctly skipped when Start All is pressed a second time.
- **Server Detail Page — Stale State on Navigation**: Navigating to a server that is queued but not yet started no longer shows "Stopped". The backend state is set to `queued` immediately so `get-server-instance-state` returns the correct status.
- **Linux RCON — IPv6 Connection Failure**: RCON was connecting to `localhost` which resolves to `::1` (IPv6) on most Linux systems. ARK running under Proton only binds to IPv4, causing silent connection failures. Fixed by using `127.0.0.1` explicitly.
- **Linux RCON — Fallback Never Connected**: The RCON running-state fallback was calling `executeRconCommand` which requires an existing connection. If log tailing missed the startup line (common on Linux/Proton), RCON was never connected and the fallback did nothing for 5 minutes. Now proactively calls `connectRcon` when not yet connected.
- **Linux App Icon Not Showing**: The icon path used `__dirname` which resolves incorrectly inside a packaged ASAR. Fixed to use `app.getAppPath()`. Logo assets (`logo.png`, `logo-square-256.png`, `logo.ico`) were also missing from the electron-builder `files` array and are now included. Linux now uses `logo-square-256.png` as required by GTK/DE launchers.
- **Browse CurseForge Button**: Removed the Browse CurseForge button from the Mods tab (functionality preserved in code for future use).

### Improvements

- **Start All / Stop All Wording**: Removed "Cluster" language from confirmation dialogs and notification titles.

## [1.0.0] - 2026-02-26

### New Features

- **Auto-Updater**: The application now automatically checks for updates on startup via GitHub Releases and notifies the user when a new version is available.
  - **Windows (NSIS .exe)**: Full auto-update — downloads silently in the background and prompts the user to restart.
  - **Linux (AppImage)**: Full auto-update via electron-updater.
  - **Linux (.deb/.rpm)**: Custom update path — downloads the correct package from GitHub Releases and installs via `pkexec` (native OS password prompt).
  - **Update Banner**: A slim, VS Code-style notification bar appears at the top of the application showing download progress and a "Restart to Update" button when ready.
  - Headless mode is excluded (no GUI to prompt).
  - Includes a `--test-update` dev flag to simulate the update lifecycle for visual testing.

## [1.0.0-beta.8] - 2026-02-24

### Bug Fixes

- **Server Status Detection**: Fixed server status showing "starting" when the server was actually running. Improved log tailing with position-based byte reading and polling fallback, added 7 startup detection strings, and added RCON-based running state fallback.
- **Settings: Rates Tab**: Fixed broken field mapping for Lay Egg Interval Multiplier and Mating Speed Multiplier caused by incorrect casing (`LayEggIntervalMultiplier` → `layEggIntervalMultiplier`, `MatingSpeedMultiplier` → `matingSpeedMultiplier`).
- **Settings: Orphaned Fields**: Fixed 9 rate fields that were defined in metadata but not assigned to any category, making them invisible in the UI.
- **Settings: Duplicate Model Property**: Removed duplicate `structurePreventResourceRadiusMultiplier` in the server instance model that caused build errors.
- **ARK Server Update Check**: Fixed update detection not working. The handler was creating its own `ArkUpdateService` instance instead of sharing the one from main.ts, causing the comparison logic to always suppress the first detection and never report updates. Both manual and background checks now correctly compare installed vs. latest build IDs from Steam.

### New Features

- **Launch Arguments**: Added a launch arguments field to the General tab for passing custom command-line arguments (e.g., `-MapModID=`, `-TotalConversionMod=`) to the server on startup.
- **Missing Config Settings**: Added ~40+ missing ARK server configuration settings across all tabs including breeding multipliers, world settings, loot quality, structure options, and administration settings.
- **Drag & Drop Server Reorder**: Servers in the sidebar can now be reordered via drag and drop using Angular CDK. Sort order persists across sessions.
- **Copy Config Between Servers**: New "Copy From" button in the server settings header opens a modal to copy configuration categories from one server to another. Supports selective category copying with grouped toggles.

### Improvements

- **Settings Tab Reorganization**: Completely reorganized settings tabs for better discoverability:
  - **Rates Tab**: Added "Loot Quality" section. Moved passive taming and oviraptor multipliers from Miscellaneous to Rates.
  - **Structures Tab**: Organized into 3 sub-sections — Damage & Decay, Platform Saddles, and Building Rules. Moved platform saddle multi-floors from Miscellaneous.
  - **Miscellaneous Tab**: Organized 38+ settings into 7 sub-sections — Game Mode, PvP & Combat, HUD & Visual, Chat, Creatures & Taming, Engrams & Crafting, and Administration.
- **Settings Field Ordering**: Boolean toggles are now grouped at the bottom of each settings section, with number/text inputs appearing first for a cleaner visual layout.
- **Copy Config Modal**: Redesigned with grouped categories (Game Settings, Server Configuration, Features & Integrations), toggle switches instead of checkboxes, custom dropdown matching the app's design system, and wider layout with multi-column grid.
- **Modal Component**: Added `maxWidth` input property to the reusable modal component for per-instance width control.

## [1.0.0-beta.7] - 2026-02-15

### Features

- Config import/export functionality
- Multiple bug fixes and settings audit

## [1.0.0-beta.6.5] - 2026-02-10

### Fixes

- Temporarily hide Players tab and add handler debugging
- Dynamic version display in About page
- Players tab not detecting when server is running
- Stat multipliers not saving or updating properly

## [1.0.0-beta.6.4] - 2026-02-08

### Fixes

- Fix missing axios dependency for Discord service

## [1.0.0-beta.6.3] - 2026-02-07

### Fixes

- Fix GitHub Actions build - prevent redundant native dependency rebuilds

## [1.0.0-beta.6] - 2026-02-05

### Features

- Standardize UI Design
- Automatic Saving
- Add Lost Colony Map
