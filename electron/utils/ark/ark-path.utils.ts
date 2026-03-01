// --- Imports ---
import * as path from 'path';
import { getPlatform, getDefaultInstallDir } from '../platform.utils';

// --- Path Utilities ---
export class ArkPathUtils {
  /**
   * Gets the ARK server installation directory
   */
  static getArkServerDir(): string {
      try {
        const { loadGlobalConfig } = require('../global-config.utils');
        const config = loadGlobalConfig();
        if (config.serverDataDir) {
            return path.join(config.serverDataDir, 'AASMServer');
        }
      } catch (e) {}
    return path.join(getDefaultInstallDir(), 'AASMServer');
  }

  /**
   * Gets the ARK server executable path for the current platform.
   * On Windows: ArkAscendedServer.exe
   * On Linux: Uses Proton to run the Windows executable
   */
  static getArkExecutablePath(): string {
    const arkServerDir = ArkPathUtils.getArkServerDir();
    const windowsExePath = path.join(arkServerDir, 'ShooterGame', 'Binaries', 'Win64', 'ArkAscendedServer.exe');

    if (getPlatform() === 'windows') {
      return windowsExePath;
    } else {
      // On Linux, we still point to the Windows executable but run it via Proton
      return windowsExePath;
    }
  }

  /**
   * Gets the ARK server config directory.
   * Windows: WindowsServer
   * Linux: LinuxServer (but we use WindowsServer when running via Proton)
   */
  static getArkConfigDir(): string {
    const arkServerDir = ArkPathUtils.getArkServerDir();
    return path.join(arkServerDir, 'ShooterGame', 'Saved', 'Config', 'WindowsServer');
  }

  /**
   * Gets the ARK server saved data directory
   */
  static getArkSavedDir(): string {
    const arkServerDir = ArkPathUtils.getArkServerDir();
    return path.join(arkServerDir, 'ShooterGame', 'Saved');
  }

  /**
   * Gets the ARK server logs directory
   */
  static getArkLogsDir(): string {
    const arkServerDir = ArkPathUtils.getArkServerDir();
    return path.join(arkServerDir, 'ShooterGame', 'Saved', 'Logs');
  }
}

// --- Constants ---
export const ARK_APP_ID = '2430930';
export const POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes