// --- Imports ---
import * as path from 'path';
import { getPlatform, getDefaultInstallDir } from '../platform.utils';
import { getProtonBinaryPath, isProtonInstalled, ensureProtonPrefixExists, getProtonPrefixDir } from '../proton.utils';
import { ARK_APP_ID } from './ark-path.utils';

// --- Command Preparation Helpers ---
export class ArkCommandUtils {
  /**
   * Prepare ARK server command for cross-platform execution
   * On Windows: Direct execution
   * On Linux: Execute via Proton with a per-instance prefix
   */
  static prepareArkServerCommand(arkExecutable: string, arkArgs: string[], env?: any, instanceId?: string): any {
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
      if (!instanceId) {
        throw new Error('instanceId is required to isolate the Proton prefix on Linux');
      }

      // Ensure per-instance proton prefix exists so Proton's filelock can create pfx.lock
      ensureProtonPrefixExists(instanceId);

      const protonBinary = getProtonBinaryPath();
      const prefixDir = getProtonPrefixDir(instanceId);

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