import * as os from 'os';
import * as path from 'path';
let app: any = undefined;
try { app = require('electron').app; } catch (e) { app = undefined; }

export class PlatformService {

  /**
   * Get the Node.js version.
   * @returns The Node.js version
   */
  getNodeVersion(): string | null {
    return process?.versions?.node || null;
  }

  /**
   * Get the Electron version.
   * @returns The Electron version
   */
  getElectronVersion(): string | null {
    return process?.versions?.electron || null;
  }

  /**
   * Get the operating system platform.
   * @returns The operating system platform (Windows, macOS, Linux, etc.)
   */
  getPlatform(): string {
    const platform = process.platform || 'unknown';
    if (platform === 'win32') return 'Windows';
    if (platform === 'darwin') return 'macOS';
    if (platform === 'linux') return 'Linux';
    return platform;
  }

  /**
   * Get the path to the configuration directory.
   * @returns The path to the configuration directory
   */
  getConfigPath(): string {
    try {
      if (app && typeof app.getPath === 'function') {
        const base = app.getPath('appData') || app.getPath('userData');
        return path.join(base, 'Cerious AASM');
      }
      const platform = process.platform;
      const home = os.homedir();
      if (platform === 'win32') return path.join(home, 'AppData', 'Roaming', 'Cerious AASM');
      if (platform === 'linux') return path.join(home, '.config', 'Cerious AASM');
      if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Cerious AASM');
    } catch (e) {
      // fallback
    }
    return 'Unknown';
  }
}

export const platformService = new PlatformService();
