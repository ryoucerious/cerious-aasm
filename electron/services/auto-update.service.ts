import axios from 'axios';
import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import { messagingService } from './messaging.service';
import { linuxPackageUpdaterService } from './linux-package-updater.service';
import { platformService } from './platform.service';

/**
 * AutoUpdateService
 * 
 * Manages automatic application updates via GitHub Releases using electron-updater.
 * Downloads updates silently in the background, then notifies the renderer so the
 * user can choose when to restart and apply the update.
 *
 * Platform support:
 *   - Windows (NSIS .exe)  → full auto-update via electron-updater + latest.yml
 *   - Linux   (AppImage)   → full auto-update via electron-updater + latest-linux.yml
 *   - Linux   (.deb/.rpm)  → custom updater via GitHub Releases API + pkexec install
 *   - macOS   (dmg)        → full auto-update via electron-updater + latest-mac.yml (requires code-signing)
 *
 * Headless and the web UI report a newer release and explain how to apply it.
 * They do not download or restart the process.
 */
export class AutoUpdateService {
  private updateDownloaded = false;
  private supported = true;
  /** Headless: tell the web UI a release is available, and never install it. */
  private manualOnly = false;
  /** When true, delegate to LinuxPackageUpdaterService instead of electron-updater */
  private useLinuxPackageUpdater = false;
  /** Last status payload — replayed to renderers that connect after the event fired */
  private lastStatus: Record<string, any> | null = null;

  constructor() {
    // The browser has no installer. Still look for a newer release so the sidebar
    // can explain how to update.
    if (process.argv.includes('--headless')) {
      this.manualOnly = true;
      console.log('[AutoUpdateService] Headless mode reports updates and does not install them.');
      return;
    }

    // On Linux, auto-update only works natively for AppImage installs.
    // For .deb/.rpm we fall back to the custom Linux package updater.
    if (process.platform === 'linux' && !process.env.APPIMAGE) {
      if (linuxPackageUpdaterService.isSupported()) {
        this.useLinuxPackageUpdater = true;
        console.log('[AutoUpdateService] Using Linux package updater for .deb/.rpm.');
      } else {
        this.supported = false;
        console.log('[AutoUpdateService] Auto-update disabled — no supported package manager detected.');
      }
      return;
    }

    // Do NOT auto-download — the user decides when to download and install.
    // autoInstallOnAppQuit is also disabled for the same reason.
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    this.setupEventHandlers();
  }

  /**
   * Wire up electron-updater events to broadcast status via the messaging service.
   */
  private setupEventHandlers(): void {
    const broadcast = (payload: Record<string, any>) => {
      this.lastStatus = payload;
      messagingService.sendToAllRenderers('app-update-status', payload);
    };

    autoUpdater.on('checking-for-update', () => {
      console.log('[AutoUpdateService] Checking for application update...');
      broadcast({ status: 'checking' });
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      console.log(`[AutoUpdateService] Update available: v${info.version}`);
      broadcast({
        status: 'available',
        version: info.version,
        releaseNotes: info.releaseNotes,
        releaseDate: info.releaseDate,
      });
    });

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      console.log(`[AutoUpdateService] App is up to date (v${info.version})`);
      broadcast({
        status: 'up-to-date',
        version: info.version,
      });
    });

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      console.log(`[AutoUpdateService] Download progress: ${progress.percent.toFixed(1)}%`);
      broadcast({
        status: 'downloading',
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      });
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      console.log(`[AutoUpdateService] Update downloaded: v${info.version}`);
      this.updateDownloaded = true;
      broadcast({
        status: 'downloaded',
        version: info.version,
        releaseNotes: info.releaseNotes,
        releaseDate: info.releaseDate,
      });
    });

    autoUpdater.on('error', (err: Error) => {
      console.error('[AutoUpdateService] Update error:', err.message);
      broadcast({
        status: 'error',
        error: err.message,
      });
    });
  }

  /**
   * Check for updates. Call this on app ready and/or on a periodic interval.
   * No-ops gracefully on unsupported platforms or headless mode.
   */
  async checkForUpdates(): Promise<void> {
    if (this.manualOnly) {
      await this.checkForManualUpdate();
      return;
    }
    if (!this.supported) return;

    if (this.useLinuxPackageUpdater) {
      await linuxPackageUpdaterService.checkForUpdates();
      return;
    }

    try {
      // checkForUpdates() only checks — it does NOT download because autoDownload=false.
      await autoUpdater.checkForUpdates();
    } catch (err: any) {
      console.error('[AutoUpdateService] Failed to check for updates:', err.message);
    }
  }

  /**
   * Trigger the actual download of an available update.
   * Only call this after the user has explicitly opted in.
   */
  async downloadUpdate(): Promise<void> {
    if (this.manualOnly || !this.supported || this.useLinuxPackageUpdater) return;
    // Immediately signal that download is starting so the UI transitions before
    // the first download-progress event arrives (or before an error fires).
    this.lastStatus = { status: 'downloading', percent: 0 };
    messagingService.sendToAllRenderers('app-update-status', this.lastStatus);
    try {
      await autoUpdater.downloadUpdate();
    } catch (err: any) {
      console.error('[AutoUpdateService] Failed to download update:', err.message);
      this.lastStatus = { status: 'error', error: err.message };
      messagingService.sendToAllRenderers('app-update-status', this.lastStatus);
    }
  }

  /**
   * Start a periodic update check every `intervalMs` milliseconds (default 4 hours).
   * Call once from main.ts after the app is ready.
   */
  startPeriodicUpdateCheck(intervalMs = 4 * 60 * 60 * 1000): void {
    if (!this.supported && !this.manualOnly) return;
    setInterval(() => {
      this.checkForUpdates().catch(console.error);
    }, intervalMs);
  }

  /**
   * Quit the app and install the downloaded update.
   * Only works after an update has been fully downloaded.
   */
  quitAndInstall(): void {
    if (this.manualOnly) return;

    if (this.useLinuxPackageUpdater) {
      linuxPackageUpdaterService.quitAndInstall();
      return;
    }

    if (this.updateDownloaded) {
      console.log('[AutoUpdateService] Quitting and installing update...');
      autoUpdater.quitAndInstall();
    } else {
      console.warn('[AutoUpdateService] No update downloaded yet.');
    }
  }

  /**
   * Returns the last broadcast status so late-connecting renderers can replay it.
   */
  getLastStatus(): Record<string, any> | null {
    return this.lastStatus;
  }

  /**
   * Returns whether an update has been downloaded and is ready to install.
   */
  isUpdateReady(): boolean {
    if (this.manualOnly) return false;
    if (this.useLinuxPackageUpdater) {
      return linuxPackageUpdaterService.isUpdateReady();
    }
    return this.updateDownloaded;
  }

  /**
   * Ask GitHub whether a newer release exists. The web UI shows the result and
   * the steps to apply it; this process does not download the package.
   */
  private async checkForManualUpdate(): Promise<void> {
    const broadcast = (payload: Record<string, any>) => {
      this.lastStatus = payload;
      messagingService.sendToAllRenderers('app-update-status', payload);
    };

    broadcast({ status: 'checking' });
    try {
      const current = this.currentVersion();
      const release = await this.fetchLatestRelease();
      const remote = (release?.tag_name || '').replace(/^v/, '');
      if (!release || !remote) {
        broadcast({ status: 'error', error: 'Could not check for an update.' });
        return;
      }
      if (!this.isNewerVersion(remote, current)) {
        console.log(`[AutoUpdateService] App is up to date (v${current})`);
        broadcast({ status: 'up-to-date', version: current, manual: true });
        return;
      }

      console.log(`[AutoUpdateService] Update available for manual install: v${remote}`);
      broadcast({
        status: 'available',
        version: remote,
        releaseNotes: release.body,
        releaseDate: release.published_at,
        manual: true,
        instructions: this.manualInstructions(remote),
        instructionsUrl: 'https://github.com/ryoucerious/cerious-aasm/releases/latest',
      });
    } catch (err: any) {
      console.error('[AutoUpdateService] Failed to check for updates:', err.message);
      broadcast({ status: 'error', error: err.message || 'Could not check for an update.' });
    }
  }

  private currentVersion(): string {
    try {
      const { app } = require('electron');
      // A packaged build reports the app version. Running Electron directly, as
      // the container does, reports the Electron runtime version instead.
      if (app?.isPackaged && typeof app.getVersion === 'function') return String(app.getVersion());
    } catch {
      // Fall through to package.json.
    }
    try {
      const pkg = require('../../package.json');
      if (pkg?.version) return String(pkg.version);
    } catch {
      // Tests and unpackaged runs still compare against a version string.
    }
    return '0.0.0';
  }

  private async fetchLatestRelease(): Promise<{ tag_name?: string; body?: string; published_at?: string } | null> {
    const url = 'https://api.github.com/repos/ryoucerious/cerious-aasm/releases/latest';
    const resp = await axios.get(url, {
      headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'cerious-aasm-updater' },
      timeout: 15000,
    });
    return resp.data || null;
  }

  /** True when `remote` is a newer dotted version than `current`. */
  private isNewerVersion(remote: string, current: string): boolean {
    const parts = (value: string) => value.split('-')[0].split('.').map(part => Number(part) || 0);
    const remoteParts = parts(remote);
    const currentParts = parts(current);
    for (let i = 0; i < Math.max(remoteParts.length, currentParts.length); i++) {
      const r = remoteParts[i] ?? 0;
      const c = currentParts[i] ?? 0;
      if (r > c) return true;
      if (r < c) return false;
    }
    return false;
  }

  private manualInstructions(version: string): string {
    if (platformService.isRunningInDocker()) {
      return [
        `Version ${version} is available. This container cannot install it.`,
        '',
        'On the machine that runs Docker:',
        '',
        'docker compose pull',
        'docker compose up -d',
        '',
        'Server data in the aasm-data and aasm-config volumes is kept.',
      ].join('\n');
    }
    return [
      `Version ${version} is available. A headless install cannot update itself from this page.`,
      '',
      'Install the latest package from the releases page, then restart the service.',
    ].join('\n');
  }
}

// Export singleton
export const autoUpdateService = new AutoUpdateService();
