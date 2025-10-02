// --- Imports ---
import * as path from 'path';
import { getPlatform, getDefaultInstallDir } from '../platform.utils';
import { getProtonBinaryPath, isProtonInstalled, ensureProtonPrefixExists } from '../proton.utils';
import { ARK_APP_ID } from './ark-path.utils';

// --- Command Preparation Helpers ---
export class ArkCommandUtils {
  /**
   * Prepare ARK server command for cross-platform execution
   * On Windows: Direct execution
   * On Linux: Execute via Proton
   */
  static prepareArkServerCommand(arkExecutable: string, arkArgs: string[], env?: any): any {
    const workingDir = path.dirname(arkExecutable); // Set working directory to executable location

    if (getPlatform() === 'windows') {
      // Add Steam environment variables for Windows
      const steamEnv = {
        SteamAppId: ARK_APP_ID,
        ...env
      };
      return { command: arkExecutable, args: arkArgs, env: steamEnv, cwd: workingDir };
    } else {
      // Linux: Use Proton to run the Windows executable
      if (!isProtonInstalled()) {
        throw new Error('Proton is required to run ARK server on Linux but is not installed');
      }

      // Ensure proton prefix exists so Proton's filelock can create pfx.lock
      ensureProtonPrefixExists();

      const protonBinary = getProtonBinaryPath();
      const prefixDir = path.join(getDefaultInstallDir(), 'proton-prefix');

      const protonEnv = {
        WINEPREFIX: prefixDir,
        STEAM_COMPAT_DATA_PATH: prefixDir,
        STEAM_COMPAT_CLIENT_INSTALL_PATH: path.join(getDefaultInstallDir(), '.steam'),
        WINEDLLOVERRIDES: 'mshtml=d',
        SteamAppId: ARK_APP_ID,
        ...env
      };

      return {
        command: 'xvfb-run',
        args: ['-a', '--server-args=-screen 0 1024x768x24', protonBinary, 'run', arkExecutable, ...arkArgs],
        env: protonEnv,
        cwd: workingDir
      };
    }
  }
}