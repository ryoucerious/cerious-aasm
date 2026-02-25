# Changelog

All notable changes to Cerious AASM (ARK: Survival Ascended Server Manager) will be documented in this file.

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
