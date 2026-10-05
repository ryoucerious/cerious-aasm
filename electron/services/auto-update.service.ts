import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import { fetchLatestRelease, isNewerVersion, LATEST_RELEASE_PAGE } from '../utils/github-release.utils';
import { messagingService } from './messaging.service';
import { linuxPackageUpdaterService } from './linux-package-updater.service';
import { platformService } from './platform.service';
import { stageDockerRuntimeUpdate } from './docker-runtime-update';
import { isRunningInDocker } from '../utils/platform.utils';

export interface AppUpdateApplyResult {
  success: boolean;
  error?: string;
  relaunch?: boolean;
  version?: string;
}

type UpdateStatus = Record<string, unknown>;

/**
 * App updates from GitHub Releases:
 *   - Windows (NSIS), Linux AppImage and macOS: electron-updater, downloading only when the user asks.
 *   - Linux .deb/.rpm: LinuxPackageUpdaterService, installing with pkexec.
 *   - Headless and the web UI: a newer release is reported with steps to apply it, never installed.
 */
export class AutoUpdateService {
  private updateDownloaded = false;
  private supported = true;
  private manualOnly = false;
  private useLinuxPackageUpdater = false;
  /** Replayed to renderers that connect after the event fired. */
  private lastStatus: UpdateStatus | null = null;
  private periodicCheck: NodeJS.Timeout | null = null;

  constructor() {
    if (process.argv.includes('--headless')) {
      this.manualOnly = true;
      console.log('[auto-update] Headless mode reports updates and does not install them.');
      return;
    }

    // electron-updater handles only the AppImage on Linux.
    if (process.platform === 'linux' && !process.env.APPIMAGE) {
      if (linuxPackageUpdaterService.isSupported()) {
        this.useLinuxPackageUpdater = true;
        console.log('[auto-update] Using the Linux package updater for .deb/.rpm.');
      } else {
        this.supported = false;
        console.log('[auto-update] Auto-update disabled: no supported package manager detected.');
      }
      return;
    }

    // Do NOT auto-download: the user decides when to download and install.
    // autoInstallOnAppQuit is also disabled for the same reason.
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    this.setupEventHandlers();
  }

  private broadcast(payload: UpdateStatus): void {
    this.lastStatus = payload;
    messagingService.sendToAllRenderers('app-update-status', payload);
  }

  private setupEventHandlers(): void {
    autoUpdater.on('checking-for-update', () => {
      console.log('[auto-update] Checking for an application update');
      this.broadcast({ status: 'checking' });
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      console.log(`[auto-update] Update available: v${info.version}`);
      this.broadcast({
        status: 'available',
        version: info.version,
        releaseNotes: info.releaseNotes,
        releaseDate: info.releaseDate,
      });
    });

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      console.log(`[auto-update] App is up to date (v${info.version})`);
      this.broadcast({ status: 'up-to-date', version: info.version });
    });

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      console.log(`[auto-update] Download progress: ${progress.percent.toFixed(1)}%`);
      this.broadcast({
        status: 'downloading',
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      });
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      console.log(`[auto-update] Update downloaded: v${info.version}`);
      this.updateDownloaded = true;
      this.broadcast({
        status: 'downloaded',
        version: info.version,
        releaseNotes: info.releaseNotes,
        releaseDate: info.releaseDate,
      });
    });

    autoUpdater.on('error', (err: Error) => {
      console.error('[auto-update] Update error:', err.message);
      this.broadcast({ status: 'error', error: err.message });
    });
  }

  /** Looks for a newer release. Does nothing where updates are not supported. */
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
      // Only checks: autoDownload is off.
      await autoUpdater.checkForUpdates();
    } catch (error) {
      console.error('[auto-update] Failed to check for updates:', error instanceof Error ? error.message : error);
    }
  }

  /** Downloads an available update. Only after the user has asked for it. */
  async downloadUpdate(): Promise<void> {
    if (this.manualOnly || !this.supported || this.useLinuxPackageUpdater) return;
    // Straight away, so the UI moves on before the first progress event (or an error) arrives.
    this.broadcast({ status: 'downloading', percent: 0 });
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[auto-update] Failed to download the update:', message);
      this.broadcast({ status: 'error', error: message });
    }
  }

  /** Checks every `intervalMs` (4 hours by default). */
  startPeriodicUpdateCheck(intervalMs = 4 * 60 * 60 * 1000): void {
    if ((!this.supported && !this.manualOnly) || this.periodicCheck) return;
    this.periodicCheck = setInterval(() => {
      this.checkForUpdates().catch(error => console.error('[auto-update] Periodic check failed:', error));
    }, intervalMs);
    this.periodicCheck.unref();
  }

  /** Dev only (--test-update): plays a fake update to the renderers so the banner can be checked. */
  simulateUpdateLifecycleForDev(): void {
    console.log('[auto-update] Simulating an update lifecycle for dev testing');
    const release = {
      version: '99.0.0',
      releaseNotes: 'Test release notes for dev simulation.',
      releaseDate: new Date().toISOString(),
    };
    const steps = 10;
    const stepBytes = 5 * 1024 * 1024;
    const sendAt = (delayMs: number, status: UpdateStatus) => {
      setTimeout(() => messagingService.sendToAllRenderers('app-update-status', status), delayMs);
    };

    sendAt(2000, { status: 'checking' });
    sendAt(3000, { status: 'available', ...release });
    for (let step = 1; step <= steps; step++) {
      sendAt(3000 + step * 500, {
        status: 'downloading',
        percent: (step / steps) * 100,
        bytesPerSecond: 2 * 1024 * 1024,
        transferred: step * stepBytes,
        total: steps * stepBytes,
      });
    }
    sendAt(3000 + (steps + 1) * 500, { status: 'downloaded', ...release });
  }

  /**
   * Downloads a newer release and installs it on this machine.
   * A Docker node stages the runtime archive and relaunches the app process. The container stays up.
   */
  async applyAvailableUpdate(): Promise<AppUpdateApplyResult> {
    if (isRunningInDocker()) {
      try {
        const staged = await stageDockerRuntimeUpdate(this.currentVersion());
        return { success: true, relaunch: true, version: staged.version };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Could not update the app.' };
      }
    }
    if (this.manualOnly || !this.supported) {
      return { success: false, error: 'This install cannot update itself. Install the latest package, then restart the service.' };
    }
    if (this.useLinuxPackageUpdater) {
      await linuxPackageUpdaterService.checkForUpdates();
      if (!linuxPackageUpdaterService.isUpdateReady()) {
        return { success: false, error: 'No newer package is ready to install.' };
      }
      return { success: true, relaunch: true };
    }
    try {
      const checked = await autoUpdater.checkForUpdates();
      const remote = checked?.updateInfo?.version || '';
      if (!remote || !isNewerVersion(remote, this.currentVersion())) {
        return { success: false, error: 'This install is already on the latest version.' };
      }
      await autoUpdater.downloadUpdate();
      this.updateDownloaded = true;
      return { success: true, relaunch: true, version: remote };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Could not update the app.' };
    }
  }

  /** Quits and installs a downloaded update. */
  quitAndInstall(): void {
    if (this.manualOnly) return;

    if (this.useLinuxPackageUpdater) {
      linuxPackageUpdaterService.quitAndInstall();
      return;
    }

    if (this.updateDownloaded) {
      console.log('[auto-update] Quitting to install the update');
      autoUpdater.quitAndInstall();
    } else {
      console.warn('[auto-update] No update downloaded yet.');
    }
  }

  getLastStatus(): UpdateStatus | null {
    return this.lastStatus;
  }

  isUpdateReady(): boolean {
    if (this.manualOnly) return false;
    if (this.useLinuxPackageUpdater) {
      return linuxPackageUpdaterService.isUpdateReady();
    }
    return this.updateDownloaded;
  }

  /** Headless: tells the web UI about a newer release and how to apply it; downloads nothing. */
  private async checkForManualUpdate(): Promise<void> {
    this.broadcast({ status: 'checking' });

    const current = this.currentVersion();
    const release = await fetchLatestRelease();
    const remote = (release?.tag_name || '').replace(/^v/, '');
    if (!release || !remote) {
      this.broadcast({ status: 'error', error: 'Could not check for an update.' });
      return;
    }
    if (!isNewerVersion(remote, current)) {
      console.log(`[auto-update] App is up to date (v${current})`);
      this.broadcast({ status: 'up-to-date', version: current, manual: true });
      return;
    }

    console.log(`[auto-update] Update available for manual install: v${remote}`);
    this.broadcast({
      status: 'available',
      version: remote,
      releaseNotes: release.body,
      releaseDate: release.published_at,
      manual: true,
      instructions: this.manualInstructions(remote),
      instructionsUrl: LATEST_RELEASE_PAGE,
    });
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

  private manualInstructions(version: string): string {
    if (platformService.isRunningInDocker()) {
      return [
        `Version ${version} is available.`,
        '',
        'Settings, Mesh can apply it on this container: the app process restarts and the container stays up.',
        'That needs the runtime archive from the release. When a release does not include one, on the Docker host:',
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

export const autoUpdateService = new AutoUpdateService();
