# Feature Implementation Plan & Gap Analysis

Based on user feedback (Power User / Cluster Admin) and a code analysis of the current `Cerious-AASM` codebase (Angular 19+ Frontend, Electron Backend).

## Current State Analysis

The current codebase has the following limitations regarding the user's request:
*   **Storage:** The path is hardcoded in `electron/services/directory.service.ts` to `getDefaultInstallDir()`, forcing usage of `%AppData%`.
*   **Shared Files:** The app currently uses a shared binary approach. `DirectoryService` points all instances to a subdirectory of a single `ShooterGame` install. This saves disk space but breaks `ArkApi` plugins which require per-instance configuration in the binary folder (`Win64/ArkApi`).
*   **Automation:** Backend services exist (`AutomationService`, `CrashDetectionService`, `ScheduledRestartService`), but they appear to be either not fully exposed in the UI or lacking the specific "Auto-Update" component requested.
*   **Configuration:** `ArkConfigService.ts` uses a hardcoded `asaSettingsMapping` array. Settings not in this array cannot be changed. There is no raw INI read/write capability.
*   **Memory Reporting:** `ServerMonitoringService` attempts to poll memory, but often reports "0MB", likely because `getProcessMemoryUsage` fails to latch onto the correct child PID after the launcher spawns the actual game server.

---

## Prioritized Feature List & Implementation Details

### 1. Fix Installation & Storage (Critical UX)
**Problem:** Hardcoded `%AppData%` path, cryptic install errors, and inconsistent progress bars.
**Implementation:**
*   **Settings Store:** Modify `DirectoryService.ts` to read from a persistent `user-config.json` (separate from the app) that stores the `installPath`.
*   **Installer Logic:** Update `electron/services/server-installer.service.ts` to catch specific SteamCMD errors (disk space, network) and surface structured error codes to the UI instead of generic failures.
*   **UI Workflow:** Add a "First Run" wizard in Angular that asks for the install location before initializing the application.

### 2. Implement "Structure Isolation" (Server API Support)
**Problem:** Shared binaries prevent usage of Server API plugins which need per-server configs.
**Implementation:**
*   **Strategy:** Move from "Shared Binaries" to "Junction Links" (Directory Junctions).
*   **Logic:** When creating a new instance:
    1.  Create a specific folder for the server (e.g., `servers/Instance_A`).
    2.  Use `fs.symlink` (or `mklink /J` on Windows) to link the heavy `Content` and `ShooterGame/Binaries` folders from a "Master" install.
    3.  **Exception:** Keep `ShooterGame/Binaries/Win64/ArkApi` and `ShooterGame/Saved` as *real*, separate folders within the instance. 
*   **Benefit:** Plugins work per-server (isolated configs), invalid webhooks don't crash the whole cluster, but disk space usage remains low (90% shared).

### 3. Advanced / INI Editor Mode
**Problem:** Power users cannot configure settings missing from the hardcoded mapping or handle mod-specific INI sections.
**Implementation:**
*   **Backend:** Add `electron/services/ini-file.service.ts`. Use a custom parser to preserve comments (critical for Ark config navigation).
*   **API:** create endpoints `getIniFile(instanceId, 'GameUserSettings.ini')` and `saveIniFile(...)`.
*   **Frontend:** Add an "Expert Mode" tab. Use the Monaco Editor wrapper for Angular (`ngx-monaco-editor`) to provide syntax highlighting for `.ini` files.
*   **Toggle:** Add a generic "Managed by AASM" boolean per server. if `false`, disable the UI form fields and only allow raw text editing.

### 4. Automatic Update System
**Problem:** Missing completely from the current automation suite.
**Implementation:**
*   **New Service:** Create `electron/services/automation/auto-update.service.ts`.
*   **Logic:**
    1.  **Poll:** Run `steamcmd +login anonymous +app_info_update 2430930 +app_info_print 2430930 +quit` every 15-30 minutes.
    2.  **Compare:** Check the `buildid` against the currently installed version / local manifest.
    3.  **Trigger:** If different, trigger `MessagingService` to warn players (RCON broadcast), wait 15m, issue `ServerInstanceService.stop()`, run `ArkUpdateService`, and finally `ServerInstanceService.start()`.
    4.  **Cluster Awareness:** Update all linked servers in a cluster sequentially or effectively simultaneously to minimize downtime.

### 5. Robust Process Management (Memory & Stop Logic)
**Problem:** 0MB memory reporting and hangs on stop.
**Implementation:**
*   **Memory:** The `ShooterGameServer.exe` spawns a child process. The current `process.pid` likely points to the launcher. Use `ps-list` to find the child process consuming the most memory with the same name.
*   **Stop Timeout:** In `ServerInstanceService`, the stop logic sends `DoExit`. If the server is saving, it ignores this.
    *   **Fix:** Send RCON `SaveWorld` first. Wait for "World Saved" log line (regex match). *Then* send `DoExit`.
    *   **Force Kill:** Add a hard timeout (configurable, default 2m). If still running, use `tree-kill` on the PID.

### 6. Server API Plugin Manager
**Problem:** Essential for cluster plugins (CrossChat, Shop, Permissions).
**Implementation:**
*   **Integration:** Relies on the isolation from Step #2.
*   **Download:** Automate downloading the latest `version.json` from the ArkServerApi repository.
*   **UI:** Create a view to list folders in `.../Win64/ArkApi/Plugins`. Read `PluginInfo.json` to display version/author in the UI.

### 7. Cluster Control "Start/Stop All"
**Problem:** Managing 4 servers one-by-one is tedious.
**Implementation:**
*   **Batch Operations:** Add `ServerManagementService.startCluster(clusterId)`.
*   **Staggering:** Implement a queue to prevent CPU choking: Start Server 1 -> Wait for "Server is up" log line -> Start Server 2.

### 8. CurseForge Integration (Nice to Have)
**Problem:** Manual ID lists are outdated UX.
**Implementation:**
*   **Frontend:** Add a "Mod Browser" component using the CurseForge API.
*   **Backend:** Proxy requests through Electron to avoid CORS issues if necessary.
*   **Action:** "Install" button simply appends the Mod ID to the `ActiveMods` string in `GameUserSettings.ini`.

---

## Priority suggestions

1.  **P0 - Critical:** Fix Storage Location (#1) & Stop Logic/Process Management (#5).
2.  **P1 - High:** Auto-Updates (#4) & Server Structure Isolation (#2).
3.  **P2 - Medium:** INI Editor (#3) & Cluster Controls (#7).
4.  **P3 - Low:** CurseForge Integration (#8).
