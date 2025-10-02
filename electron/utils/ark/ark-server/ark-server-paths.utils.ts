// ark-server-paths.utils.ts
// Utility functions for ARK server paths and cross-platform handling

import * as path from 'path';
import { getPlatform } from '../../platform.utils';
import { getArkServerDir } from './ark-server-install.utils';
import { isProtonInstalled, getProtonBinaryPath, ensureProtonPrefixExists, getProtonDir } from '../../proton.utils';
import { getDefaultInstallDir } from '../../platform.utils';

/**
 * Gets the ARK server executable path for the current platform.
 * On Windows: ArkAscendedServer.exe
 * On Linux: Uses Proton to run the Windows executable
 */
export function getArkExecutablePath(): string {
  const arkServerDir = getArkServerDir();
  const windowsExePath = path.join(arkServerDir, 'ShooterGame', 'Binaries', 'Win64', 'ArkAscendedServer.exe');

  if (getPlatform() === 'windows') {
    return windowsExePath;
  } else {
    // Linux: Return the Windows executable path - we'll wrap it with Proton
    return windowsExePath;
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
 */
export function prepareArkServerCommand(arkExecutable: string, arkArgs: string[]) {
  const platform = getPlatform();

  if (platform === 'windows') {
    return { command: arkExecutable, args: arkArgs };
  }

  // --- Linux (Proton) ---
  if (!isProtonInstalled()) throw new Error('Proton is required but not installed. Please install Proton first.');

  ensureProtonPrefixExists();
  const protonBinary = getProtonBinaryPath();

  // Set up Proton environment
  const protonEnv = {
    WINEPREFIX: path.join(getDefaultInstallDir(), '.wine-ark'),
    STEAM_COMPAT_DATA_PATH: path.join(getDefaultInstallDir(), '.steam-compat'),
    STEAM_COMPAT_CLIENT_INSTALL_PATH: path.join(getDefaultInstallDir(), '.steam'),
    // Disable GUI components
    WINEDLLOVERRIDES: 'mshtml=d'
  };

  return {
    command: 'xvfb-run',
    args: ['-a', '--server-args=-screen 0 1024x768x24', protonBinary, 'run', arkExecutable, ...arkArgs],
    env: protonEnv
  };
}