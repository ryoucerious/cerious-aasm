import { getDefaultInstallDir, isRunningInDocker } from '../utils/platform.utils';

export class PlatformService {
  getNodeVersion(): string | null {
    return process.versions?.node || null;
  }

  getElectronVersion(): string | null {
    return process.versions?.electron || null;
  }

  isRunningInDocker(): boolean {
    return isRunningInDocker();
  }

  /** A display name: Windows, macOS, Linux or Linux (Docker). */
  getPlatform(): string {
    const platform = process.platform || 'unknown';
    if (platform === 'win32') return 'Windows';
    if (platform === 'darwin') return 'macOS';
    if (platform === 'linux') return this.isRunningInDocker() ? 'Linux (Docker)' : 'Linux';
    return platform;
  }

  /** Where the app keeps its config and, by default, the servers; 'Unknown' on other platforms. */
  getConfigPath(): string {
    try {
      return getDefaultInstallDir();
    } catch {
      return 'Unknown';
    }
  }
}

export const platformService = new PlatformService();
