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
