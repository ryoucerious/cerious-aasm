// ark-server-paths.utils.ts
// Utility functions for ARK server paths and cross-platform handling

import * as path from 'path';
import * as fs from 'fs';
import { getPlatform } from '../../platform.utils';
import { getArkServerDir } from './ark-server-install.utils';
import { isProtonInstalled, getProtonBinaryPath, ensureProtonPrefixExists, getProtonPrefixDir } from '../../proton.utils';
import { getDefaultInstallDir } from '../../platform.utils';

export const ASA_API_LOADER_EXE = 'AsaApiLoader.exe';
export const ARK_SERVER_EXE = 'ArkAscendedServer.exe';

export interface ResolvedServerLaunch {
  /** Absolute path to the executable to spawn */
  executable: string;
  /** Working directory for the process (must be Win64 for AsaApi) */
  cwd: string;
  /** True when launching via AsaApiLoader.exe */
  usesAsaApiLoader: boolean;
}

/**
 * Gets the ARK server executable path for the current platform.
 * On Windows: ArkAscendedServer.exe
 * On Linux: Uses Proton to run the Windows executable
 */
export function getArkExecutablePath(): string {
  const arkServerDir = getArkServerDir();
  const windowsExePath = path.join(arkServerDir, 'ShooterGame', 'Binaries', 'Win64', ARK_SERVER_EXE);

  if (getPlatform() === 'windows') {
    return windowsExePath;
  } else {
    // Linux: Return the Windows executable path - we'll wrap it with Proton
    return windowsExePath;
  }
}

/**
 * Resolve which executable to launch for a given instance.
 *
 * AsaApi requires starting AsaApiLoader.exe (not ArkAscendedServer.exe).
 * The loader injects the API and then starts the real server with the same args.
 * Working directory must be the instance Win64 folder so plugins/DLLs resolve.
 */
export function resolveServerLaunch(instanceId: string): ResolvedServerLaunch {
  const { getInstancesBaseDir } = require('../../ark/instance.utils');
  const instanceDir = path.join(getInstancesBaseDir(), instanceId);
  const instanceWin64 = path.join(instanceDir, 'ShooterGame', 'Binaries', 'Win64');
  const asaApiLoader = path.join(instanceWin64, ASA_API_LOADER_EXE);
  const instanceExe = path.join(instanceWin64, ARK_SERVER_EXE);
  const sharedExe = getArkExecutablePath();
  const sharedWin64 = path.dirname(sharedExe);

  if (getPlatform() === 'windows') {
    if (fs.existsSync(asaApiLoader)) {
      return {
        executable: asaApiLoader,
        cwd: instanceWin64,
        usesAsaApiLoader: true
      };
    }
    if (fs.existsSync(instanceExe)) {
      return {
        executable: instanceExe,
        cwd: instanceWin64,
        usesAsaApiLoader: false
      };
    }
    return {
      executable: sharedExe,
      cwd: sharedWin64,
      usesAsaApiLoader: false
    };
  }

  // Linux / Proton: AsaApi is a Windows-native loader; use the shared ARK install.
  // If a Proton-friendly loader layout is present under the instance, prefer it.
  if (fs.existsSync(asaApiLoader) && fs.existsSync(instanceExe)) {
    return {
      executable: asaApiLoader,
      cwd: getArkServerDir(),
      usesAsaApiLoader: true
    };
  }

  return {
    executable: sharedExe,
    cwd: getArkServerDir(),
    usesAsaApiLoader: false
  };
}

/**
 * The root of the directory tree ARK will actually run from for this instance.
 *
 * ARK resolves everything path-relative — config, saves, logs, the exclusive-join list —
 * against the tree that owns the executable it launched, NOT against the working directory
 * or the instance's config folder. An instance with isolated binaries therefore runs out of
 * its own folder; one that falls back to the shared executable runs out of the shared install.
 * Every "where will ARK read/write X" question must go through this function.
 */
export function getInstanceRuntimeRoot(instanceId: string): string {
  const launch = resolveServerLaunch(instanceId);
  // <root>/ShooterGame/Binaries/Win64/<exe> → <root>
  return path.resolve(path.dirname(launch.executable), '..', '..', '..');
}

/**
 * True when this instance runs from its own isolated tree rather than the shared install.
 */
export function isInstanceIsolated(instanceId: string): boolean {
  const { getInstancesBaseDir } = require('../../ark/instance.utils');
  const instanceDir = path.resolve(path.join(getInstancesBaseDir(), instanceId));
  return getInstanceRuntimeRoot(instanceId) === instanceDir;
}

/**
 * The config directory ARK will actually read GameUserSettings.ini / Game.ini from.
 */
export function getInstanceConfigDir(instanceId: string): string {
  return path.join(getInstanceRuntimeRoot(instanceId), 'ShooterGame', 'Saved', 'Config', 'WindowsServer');
}

/**
 * The directory ARK will actually write ShooterGame.log to.
 */
export function getInstanceLogsDir(instanceId: string): string {
  return path.join(getInstanceRuntimeRoot(instanceId), 'ShooterGame', 'Saved', 'Logs');
}

/**
 * The exclusive-join list path ARK reads when launched with -exclusivejoin.
 * ARK looks for it next to the executable, in the Win64 binaries folder.
 */
export function getInstanceWhitelistPath(instanceId: string): string {
  return path.join(getInstanceRuntimeRoot(instanceId), 'ShooterGame', 'Binaries', 'Win64', 'PlayersExclusiveJoinList.txt');
}

/**
 * The value to pass as ?AltSaveDirectoryName= for this instance.
 *
 * ARK appends this to <root>/ShooterGame/Saved/. An isolated instance is already rooted in
 * its own folder, so a plain 'SavedArks' is correct; a shared-install instance needs the
 * Servers/<id>/SavedArks path that lands it back inside its own instance folder.
 * In both cases the saves end up in the instance's historical SavedArks location.
 */
export function getInstanceAltSaveDirName(instanceId: string): string {
  return isInstanceIsolated(instanceId)
    ? 'SavedArks'
    : path.join('Servers', instanceId, 'SavedArks');
}

/**
 * True when AsaApiLoader.exe is installed for this instance.
 */
export function isAsaApiLoaderInstalled(instanceId: string): boolean {
  try {
    const { getInstancesBaseDir } = require('../../ark/instance.utils');
    const loader = path.join(
      getInstancesBaseDir(),
      instanceId,
      'ShooterGame',
      'Binaries',
      'Win64',
      ASA_API_LOADER_EXE
    );
    return fs.existsSync(loader);
  } catch {
    return false;
  }
}

/**
 * Gets the config directory path for the current platform.
 * Windows: WindowsServer
 * Linux: LinuxServer (but we use WindowsServer when running via Proton)
 */
export function getArkConfigDir(): string {
  const arkServerDir = getArkServerDir();
  // Always use WindowsServer since we're running Windows binaries via Proton on Linux
  return path.join(arkServerDir, 'ShooterGame', 'Saved', 'Config', 'WindowsServer');
}

/**
 * Prepares spawn command and args for running ARK server with Proton on Linux if needed.
 * On Linux, instanceId is required so each server gets an isolated Proton prefix.
 */
export function prepareArkServerCommand(arkExecutable: string, arkArgs: string[], instanceId?: string) {
  const platform = getPlatform();

  if (platform === 'windows') {
    return { command: arkExecutable, args: arkArgs };
  }

  // --- Linux (Proton) ---
  if (!isProtonInstalled()) throw new Error('Proton is required but not installed. Please install Proton first.');
  if (!instanceId) {
    throw new Error('instanceId is required to isolate the Proton prefix on Linux');
  }

  ensureProtonPrefixExists(instanceId);
  const protonBinary = getProtonBinaryPath();
  const prefixDir = getProtonPrefixDir(instanceId);

  // Set up Proton environment with Wine/Proton compatibility fixes.
  // WINEPREFIX and STEAM_COMPAT_DATA_PATH must be per-instance — sharing them
  // across servers causes wineserver lock contention and crashes under load.
  const { ARK_APP_ID } = require('./ark-server-install.utils');
  const protonEnv = {
    WINEPREFIX: prefixDir,
    STEAM_COMPAT_DATA_PATH: prefixDir,
    STEAM_COMPAT_CLIENT_INSTALL_PATH: path.join(getDefaultInstallDir(), '.steam'),
    SteamAppId: ARK_APP_ID,
    // Wine DLL overrides for compatibility:
    // - mshtml=d: Disable IE/HTML rendering components (not needed for dedicated server)
    // - winhttp/bcrypt/crypt32=n,b: Use native Wine implementations for networking/crypto
    //   (fixes hang during Sentry SDK initialization in ARK Server v83.21+)
    WINEDLLOVERRIDES: 'mshtml=d;winhttp=n,b;bcrypt=n,b;crypt32=n,b'
  };

  return {
    command: 'xvfb-run',
    args: ['-a', '--server-args=-screen 0 1024x768x24', protonBinary, 'run', arkExecutable, ...arkArgs],
    env: protonEnv
  };
}
