import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import { messagingService } from './messaging.service';
import { linuxPackageUpdaterService } from './linux-package-updater.service';

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
 * Headless mode is excluded since there is no GUI to prompt for restart.
 */
export class AutoUpdateService {
  private updateDownloaded = false;
  private supported = true;
  /** When true, delegate to LinuxPackageUpdaterService instead of electron-updater */
  private useLinuxPackageUpdater = false;
  /** Last status payload — replayed to renderers that connect after the event fired */
  private lastStatus: Record<string, any> | null = null;

  constructor() {
    // Skip auto-update in headless mode — no GUI to show prompts
    if (process.argv.includes('--headless')) {
      this.supported = false;
      console.log('[AutoUpdateService] Auto-update disabled in headless mode.');
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
    if (!this.supported || this.useLinuxPackageUpdater) return;
    try {
      await autoUpdater.downloadUpdate();
    } catch (err: any) {
      console.error('[AutoUpdateService] Failed to download update:', err.message);
    }
  }

  /**
   * Start a periodic update check every `intervalMs` milliseconds (default 4 hours).
   * Call once from main.ts after the app is ready.
   */
  startPeriodicUpdateCheck(intervalMs = 4 * 60 * 60 * 1000): void {
    if (!this.supported) return;
    setInterval(() => {
      this.checkForUpdates().catch(console.error);
    }, intervalMs);
  }

  /**
   * Quit the app and install the downloaded update.
   * Only works after an update has been fully downloaded.
   */
  quitAndInstall(): void {
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
    if (this.useLinuxPackageUpdater) {
      return linuxPackageUpdaterService.isUpdateReady();
    }
    return this.updateDownloaded;
  }
}

// Export singleton
export const autoUpdateService = new AutoUpdateService();
