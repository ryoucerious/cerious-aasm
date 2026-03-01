# Changelog

All notable changes to Cerious AASM (ARK: Survival Ascended Server Manager) will be documented in this file.

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
