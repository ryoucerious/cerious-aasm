import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import * as fs from 'fs';
import * as path from 'path';
import { fetchLatestRelease, isNewerVersion, LATEST_RELEASE_PAGE } from '../utils/github-release.utils';
import { messagingService } from './messaging.service';
import { linuxPackageUpdaterService } from './linux-package-updater.service';
import { platformService } from './platform.service';
import { stageDockerRuntimeUpdate, findRuntimeAsset, relaunchInPlace, canApplyInPlace } from './docker-runtime-update';
import { isRunningInDocker } from '../utils/platform.utils';
import { clearHandOff, exitForInstaller, handOffExit, handOffLaunchArgs, restartApp, systemServiceUnit } from '../utils/app-relaunch';

/** electron-updater's NSIS and AppImage updaters; install() reports whether it started. */
type Installer = { install(isSilent?: boolean, isForceRunAfter?: boolean): boolean };

export interface UnattendedUpdate {
  unattended: boolean;
  reason: string | null;
}

function isWritable(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export interface AppUpdateApplyResult {
  success: boolean;
  error?: string;
  relaunch?: boolean;
  version?: string;
}

type UpdateStatus = Record<string, unknown>;

/**
 * App updates from GitHub Releases, installed from the app (its window, the web interface, or
 * another machine in the mesh) wherever the install can update itself:
 *   - Windows (NSIS), Linux AppImage and macOS: electron-updater, downloading only when asked.
 *   - Linux .deb/.rpm: LinuxPackageUpdaterService, installing as root.
 *   - Docker: download a runtime archive and relaunch the app inside the running container.
 *   - Anything else: report a newer release with manual installation steps.
 * Headless installs restart with the command line they were started with.
 */
export class AutoUpdateService {
  private updateDownloaded = false;
  private supported = true;
  private manualOnly = false;
  private useLinuxPackageUpdater = false;
  private readonly docker = isRunningInDocker();
  /** No one is at a window, so a download installs straight away, as in the container. */
  private readonly headless = process.argv.includes('--headless');
  private dockerDownload: Promise<AppUpdateApplyResult> | null = null;
  /** Replayed to renderers that connect after the event fired. */
  private lastStatus: UpdateStatus | null = null;
  private periodicCheck: NodeJS.Timeout | null = null;

  constructor() {
    if (this.docker) return;

    // electron-updater handles only the AppImage on Linux.
    if (process.platform === 'linux' && !process.env.APPIMAGE) {
      if (linuxPackageUpdaterService.canInstall()) {
        this.useLinuxPackageUpdater = true;
        linuxPackageUpdaterService.onStatus = status => this.broadcast(status);
        console.log('[auto-update] Using the Linux package updater for .deb/.rpm.');
      } else if (this.headless) {
        this.manualOnly = true;
        console.log('[auto-update] This install cannot run its package manager as root; it reports updates without installing them.');
      } else {
        this.supported = false;
        console.log('[auto-update] Auto-update disabled: no supported package manager detected.');
      }
      return;
    }

    if (this.headless && !this.isPackaged()) {
      this.manualOnly = true;
      console.log('[auto-update] An unpackaged headless run reports updates and does not install them.');
      return;
    }

    // Do NOT auto-download: the user decides when to download and install.
    // autoInstallOnAppQuit is also disabled for the same reason.
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    this.setupEventHandlers();
  }

  /** To the app's windows and every web client: anyone may read update status. */
  private broadcast(payload: UpdateStatus): void {
    if (this.manualOnly) payload = { manual: true, ...payload };
    if (this.installsAfterDownload()) payload = { ...payload, inPlace: true };
    this.lastStatus = payload;
    messagingService.sendToAllRenderers('app-update-status', payload);
    messagingService.broadcastToWebClients('app-update-status', payload);
  }

  /**
   * Whether an update installs with no one at this machine, as one started from another machine in
   * the mesh does, and if not, why. A UAC or password prompt would wait on its screen.
   */
  unattendedUpdate(): UnattendedUpdate {
    if (this.docker) {
      return canApplyInPlace()
        ? { unattended: true, reason: null }
        : { unattended: false, reason: 'This image cannot update in place. On its Docker host, run docker compose pull && docker compose up -d.' };
    }
    if (this.manualOnly || !this.supported) {
      return { unattended: false, reason: 'This install cannot update itself. Install the latest package on it.' };
    }
    if (this.useLinuxPackageUpdater) {
      return linuxPackageUpdaterService.installsUnattended()
        ? { unattended: true, reason: null }
        : { unattended: false, reason: 'Installing asks for an administrator password on its screen. Update it from its own window, or run it as root.' };
    }
    if (!this.isPackaged()) return { unattended: false, reason: 'A development run cannot update itself.' };
    const appImage = process.platform === 'linux' ? process.env.APPIMAGE : undefined;
    if (appImage && !isWritable(path.dirname(appImage))) {
      return { unattended: false, reason: `It cannot replace its AppImage in ${path.dirname(appImage)}.` };
    }
    // Installed for all users, under Program Files: the installer needs an administrator to approve it.
    if (process.platform === 'win32' && !isWritable(path.dirname(process.execPath))) {
      return { unattended: false, reason: 'It is installed for all users, so Windows asks an administrator to approve the update on its screen. Update it from its own window.' };
    }
    return { unattended: true, reason: null };
  }

  /** One step: a finished download installs and restarts at once. */
  installsAfterDownload(): boolean {
    return this.docker || (this.headless && !this.manualOnly && this.supported);
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
    if (this.manualOnly || this.docker) {
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
    if (this.docker) {
      const result = await this.applyAvailableUpdate();
      if (!result.success) throw new Error(result.error);
      return;
    }
    if (this.manualOnly || !this.supported) return;
    // Downloads as part of its check, so checking again retries a failed download.
    if (this.useLinuxPackageUpdater) {
      if (!linuxPackageUpdaterService.isUpdateReady()) await linuxPackageUpdaterService.checkForUpdates();
      return;
    }
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
      if (this.dockerDownload) return this.dockerDownload;
      this.dockerDownload = (async (): Promise<AppUpdateApplyResult> => {
        this.updateDownloaded = false;
        this.broadcast({ status: 'downloading', percent: 0 });
        try {
          const staged = await stageDockerRuntimeUpdate(this.currentVersion(), percent => this.broadcast({ status: 'downloading', percent }));
          this.updateDownloaded = true;
          this.broadcast({ status: 'downloaded', version: staged.version });
          return { success: true, relaunch: true, version: staged.version };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Could not update the app.';
          this.broadcast({ status: 'error', error: message });
          return { success: false, error: message };
        }
      })();
      try { return await this.dockerDownload; }
      finally { this.dockerDownload = null; }
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

  /**
   * Quits and installs a downloaded update, then starts the app again. Silently: the update may
   * come from another machine in the mesh, or the web interface, with no one here to click Next.
   */
  quitAndInstall(): void {
    if (this.docker) {
      if (this.updateDownloaded) relaunchInPlace();
      return;
    }
    if (this.manualOnly) return;

    if (this.useLinuxPackageUpdater) {
      linuxPackageUpdaterService.quitAndInstall();
      return;
    }

    if (this.updateDownloaded) {
      console.log('[auto-update] Quitting to install the update');
      this.installDownloadedUpdate();
    } else {
      console.warn('[auto-update] No update downloaded yet.');
    }
  }

  private installDownloadedUpdate(): void {
    const installer = autoUpdater as unknown as Partial<Installer>;
    if (typeof installer.install !== 'function' || process.platform === 'darwin') {
      autoUpdater.quitAndInstall(true, true);
      return;
    }
    if (process.platform === 'linux' && process.env.APPIMAGE) {
      this.installAppImage(installer as Installer, process.env.APPIMAGE);
      return;
    }
    // The installer starts the app again once it has replaced it, with only --updated.
    handOffLaunchArgs();
    if (!installer.install(true, true)) {
      clearHandOff();
      return;
    }
    exitForInstaller();
  }

  /**
   * electron-updater starts the new AppImage without the command line, so it is started only to
   * finish installing and exits; this process then starts it again with its own arguments.
   */
  private installAppImage(installer: Installer, current: string): void {
    let target = current;
    const renamed = (file: string) => { target = file; };
    const events = autoUpdater as unknown as NodeJS.EventEmitter;
    events.on('appimage-filename-updated', renamed);
    handOffExit();
    let installed = false;
    try {
      installed = installer.install(true, false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[auto-update] Failed to install the AppImage:', message);
      this.broadcast({ status: 'error', error: message });
    } finally {
      clearHandOff();
      events.removeListener('appimage-filename-updated', renamed);
    }
    if (!installed) return;
    // The new version's file name differs; the unit's ExecStart still names the old one.
    if (target !== current && systemServiceUnit()) {
      try {
        fs.symlinkSync(target, current);
      } catch (error) {
        console.warn(`[auto-update] Could not link ${current} to ${target}:`, error);
      }
    }
    restartApp(target);
  }

  private isPackaged(): boolean {
    try {
      return !!require('electron').app?.isPackaged;
    } catch {
      return false;
    }
  }

  getLastStatus(): UpdateStatus | null {
    return this.lastStatus;
  }

  isUpdateReady(): boolean {
    if (this.docker) return this.updateDownloaded;
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
      manual: !(this.docker && findRuntimeAsset(release.assets || []) && canApplyInPlace()),
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
      `Version ${version} is available. This install cannot update itself from this page.`,
      '',
      'A .deb or .rpm install updates itself when the app runs as root (as a systemd service does) or may',
      'run sudo without a password. Otherwise, install the latest package from the releases page, then',
      'restart the service.',
    ].join('\n');
  }
}

export const autoUpdateService = new AutoUpdateService();
