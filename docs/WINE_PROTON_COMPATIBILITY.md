# Wine/Proton Compatibility for ARK Server on Linux

## Overview

Starting with ARK: Survival Ascended Server version **83.21**, the dedicated server exhibits a critical freeze during startup when running under Wine/Proton on Linux. This document explains the issue, the fix, and configuration options.

## The Problem

### Symptoms
- Server process starts but freezes after ~41 log lines
- Last log entry before freeze: `[LogSentrySdk: Verbose: request handled in XXXms]`
- Server consumes minimal CPU and appears completely hung
- No error messages or crash dumps generated
- Issue affects **ALL** versions of Cerious AASM (not application-specific)

### Root Cause
ARK Server v83.21+ introduced incompatibilities with Wine/Proton's Windows compatibility layer:

1. **Sentry SDK Initialization Hang**: The Unreal Engine crash reporting system (Sentry) hangs during HTTP requests due to Wine's networking stack issues
2. **Hang Detection System**: Unreal Engine's hang detection mechanism itself causes freezes when running under Wine
3. **Steam API Conflicts**: Unnecessary Steam API integration interferes with Wine's process management
4. **RHI Threading Issues**: Render Hardware Interface threading causes deadlocks in Wine's threading implementation

## The Fix

Cerious AASM now automatically applies Wine/Proton compatibility fixes on Linux:

### 1. Wine DLL Overrides
**File**: `electron/utils/ark/ark-server/ark-server-paths.utils.ts`

Forces native Wine implementations for critical networking and crypto libraries:
```typescript
WINEDLLOVERRIDES: 'mshtml=d;winhttp=n,b;bcrypt=n,b;crypt32=n,b'
```

- `mshtml=d`: Disables IE/HTML rendering (not needed)
- `winhttp=n,b`: Native Wine HTTP implementation
- `bcrypt=n,b`: Native Wine cryptography
- `crypt32=n,b`: Native Wine certificate handling

### 2. Unreal Engine Compatibility Flags
**File**: `electron/utils/ark/ark-args.utils.ts`

Automatically adds these command-line flags on Linux:
```typescript
-NoHangDetection  // Disables hang detection system
-NOSTEAM          // Disables Steam API
-norhithread      // Disables RHI rendering thread
```

These flags are **automatically applied** when:
- Platform is Linux
- `disableWineCompatFlags` is not set to `true`

## Configuration Option

### Disabling Compatibility Flags (Advanced Users Only)

If these flags cause issues with your specific setup, you can disable them:

**In Server Configuration JSON**:
```json
{
  "id": "my-server",
  "name": "My ARK Server",
  "disableWineCompatFlags": true
}
```

**Warning**: Disabling these flags will likely cause the server to freeze during startup on ARK v83.21+. Only disable if:
- You're using a custom Wine/Proton build with fixes
- You've downgraded to ARK Server < v83.21
- You're testing alternative workarounds

## Verification

After applying the fix, verify the server starts successfully:

1. Start your ARK server through Cerious AASM
2. Monitor the log file: `~/.local/share/cerious-aasm/AASMServer/ShooterGame/Saved/Logs/ShooterGame.log`
3. Server should progress past the Sentry initialization line
4. Look for startup completion indicators like:
   - `[LogWorld: Log: Bringing World /Game/Maps/TheIsland_WP.TheIsland_WP up for play`
   - `[LogNet: Log: Game class is 'ShooterGameMode'`

## Troubleshooting

### Server Still Freezes

1. **Check Wine Version**: Ensure you're using GE-Proton 10-15 or newer
2. **Verify Flags Applied**: Check server process with `ps aux | grep ArkAscendedServer`
3. **Check Wine Prefix**: Delete and recreate: `rm -rf ~/.local/share/cerious-aasm/.wine-ark`
4. **Enable Debug Logging**: Temporarily add to `ark-server-paths.utils.ts`:
   ```typescript
   PROTON_LOG: '1',
   WINEDEBUG: '+timestamp,+seh'
   ```
   Check logs in `~/steam-*.log`

### Performance Issues

If the server runs but has performance problems:

1. Try disabling individual flags to identify the culprit
2. Test without `-norhithread` first (least likely to affect dedicated servers)
3. Consider upgrading Proton version
4. Check Wine/Proton GitHub issues for ARK-specific fixes

## Technical Details

### Why This Affects All Versions

The freeze is caused by the **ARK Server executable itself** (version 83.21+), not Cerious AASM code. This means:
- Rolling back Cerious AASM versions doesn't help
- The issue persists until ARK Server is downgraded or Wine/Proton is fixed
- All server management tools running ARK under Wine are affected

### Platform Detection

The fix is platform-specific:
- **Windows**: Native execution, no flags needed
- **Linux**: Wine/Proton compatibility flags automatically applied

### Future ARK Updates

Monitor ARK Server updates for:
- Built-in Wine/Proton support
- Sentry SDK updates fixing Wine compatibility
- Official `-NoWine` or similar flags from Unreal Engine

## References

- ARK Server Version: 83.21+
- Proton Version: GE-Proton 10-15
- Issue Discovered: March 1, 2026
- Fix Applied: March 1, 2026

## Contributing

If you discover alternative fixes or workarounds, please contribute:
1. Test thoroughly on a clean Wine prefix
2. Document which ARK Server versions work
3. Note any side effects or performance impacts
4. Submit a pull request with your findings
