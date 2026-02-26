import { app } from 'electron';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { messagingService } from './messaging.service';

/**
 * GitHub release asset metadata.
 */
interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
  content_type: string;
}

interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  assets: GitHubAsset[];
}

/**
 * LinuxPackageUpdaterService
 *
 * Provides auto-update support for .deb and .rpm Linux installations where
 * electron-updater is not available. Uses the GitHub Releases API to detect
 * new versions, downloads the correct package, and installs it via pkexec
 * (polkit privilege escalation) so the user only sees a native password prompt.
 *
 * Flow:
 *   1. Query GitHub Releases API for the latest release
 *   2. Compare tag version with the running app version
 *   3. Download the matching .deb or .rpm asset to a temp directory
 *   4. Broadcast download progress to the renderer via messagingService
 *   5. On "install" request, run `pkexec dpkg -i <file>` or `pkexec rpm -U <file>`
 *   6. Restart the application
 */
export class LinuxPackageUpdaterService {
  private readonly owner = 'ryoucerious';
  private readonly repo = 'cerious-aasm';
  private readonly packageFormat: 'deb' | 'rpm' | null;

  private downloadedPackagePath: string | null = null;
  private latestVersion: string | null = null;
  private updateDownloaded = false;

  constructor() {
    this.packageFormat = this.detectPackageFormat();
  }

  // ---------------------------------------------------------------------------
  // Detection helpers
  // ---------------------------------------------------------------------------

  /**
   * Detect whether the host system uses dpkg (Debian/Ubuntu) or rpm (Fedora/RHEL/SUSE).
   * Returns null if neither is available.
   */
  private detectPackageFormat(): 'deb' | 'rpm' | null {
    try {
      // dpkg is the canonical indicator for Debian-family distros
      const dpkg = this.commandExistsSync('dpkg');
      if (dpkg) return 'deb';
    } catch { /* ignore */ }

    try {
      const rpm = this.commandExistsSync('rpm');
      if (rpm) return 'rpm';
    } catch { /* ignore */ }

    return null;
  }

  /**
   * Synchronously check whether a command exists on PATH.
   */
  private commandExistsSync(cmd: string): boolean {
    try {
      const { execSync } = require('child_process');
      execSync(`which ${cmd}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Whether this service can operate (Linux + recognized package manager).
   */
  isSupported(): boolean {
    return process.platform === 'linux' && this.packageFormat !== null;
  }

  // ---------------------------------------------------------------------------
  // Version comparison
  // ---------------------------------------------------------------------------

  /**
   * Normalise a version tag (strip leading "v") and compare using semver-ish logic.
   * Returns true when remoteTag is newer than the running app version.
   */
  private isNewerVersion(remoteTag: string): boolean {
    const normalize = (v: string) => v.replace(/^v/, '');
    const remote = normalize(remoteTag);
    const current = normalize(app.getVersion());

    // Split on '-' to separate semver core from pre-release
    const [remoteCore, remotePre] = remote.split('-');
    const [currentCore, currentPre] = current.split('-');

    const remoteParts = remoteCore.split('.').map(Number);
    const currentParts = currentCore.split('.').map(Number);

    for (let i = 0; i < Math.max(remoteParts.length, currentParts.length); i++) {
      const r = remoteParts[i] ?? 0;
      const c = currentParts[i] ?? 0;
      if (r > c) return true;
      if (r < c) return false;
    }

    // Same core version — compare pre-release (if any).
    // A version *without* pre-release is newer than one *with* (e.g., 1.0.0 > 1.0.0-beta.1).
    if (currentPre && !remotePre) return true;
    if (!currentPre && remotePre) return false;
    if (currentPre && remotePre) {
      return remotePre.localeCompare(currentPre, undefined, { numeric: true, sensitivity: 'base' }) > 0;
    }

    return false; // identical
  }

  // ---------------------------------------------------------------------------
  // GitHub Releases API
  // ---------------------------------------------------------------------------

  /**
   * Check GitHub for a newer release and notify the renderer.
   */
  async checkForUpdates(): Promise<void> {
    try {
      messagingService.sendToAllRenderers('app-update-status', { status: 'checking' });

      const release = await this.fetchLatestRelease();
      if (!release) {
        messagingService.sendToAllRenderers('app-update-status', { status: 'error', error: 'Could not fetch latest release.' });
        return;
      }

      if (!this.isNewerVersion(release.tag_name)) {
        console.log(`[LinuxPackageUpdater] App is up to date (${app.getVersion()})`);
        messagingService.sendToAllRenderers('app-update-status', { status: 'up-to-date', version: app.getVersion() });
        return;
      }

      const asset = this.findMatchingAsset(release.assets);
      if (!asset) {
        console.warn(`[LinuxPackageUpdater] No .${this.packageFormat} asset found in release ${release.tag_name}`);
        messagingService.sendToAllRenderers('app-update-status', { status: 'error', error: `No .${this.packageFormat} package in the latest release.` });
        return;
      }

      const version = release.tag_name.replace(/^v/, '');
      this.latestVersion = version;

      console.log(`[LinuxPackageUpdater] Update available: v${version} (${asset.name})`);
      messagingService.sendToAllRenderers('app-update-status', {
        status: 'available',
        version,
        releaseNotes: release.body,
        releaseDate: release.published_at,
      });

      // Start downloading immediately (silent download)
      await this.downloadAsset(asset, version);
    } catch (err: any) {
      console.error('[LinuxPackageUpdater] Error checking for updates:', err.message);
      messagingService.sendToAllRenderers('app-update-status', { status: 'error', error: err.message });
    }
  }

  /**
   * Fetch the latest release from GitHub.
   */
  private async fetchLatestRelease(): Promise<GitHubRelease | null> {
    try {
      const url = `https://api.github.com/repos/${this.owner}/${this.repo}/releases/latest`;
      const resp = await axios.get<GitHubRelease>(url, {
        headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'cerious-aasm-updater' },
        timeout: 15000,
      });
      return resp.data;
    } catch (err: any) {
      console.error('[LinuxPackageUpdater] GitHub API error:', err.message);
      return null;
    }
  }

  /**
   * Find the .deb or .rpm asset matching the current architecture.
   */
  private findMatchingAsset(assets: GitHubAsset[]): GitHubAsset | null {
    const arch = os.arch(); // 'x64', 'arm64', etc.
    const ext = this.packageFormat === 'deb' ? '.deb' : '.rpm';

    // Try to find an asset matching both extension and architecture
    const archPatterns = arch === 'x64' ? ['amd64', 'x86_64', 'x64'] : [arch, 'aarch64'];

    // First pass: match extension + arch
    for (const asset of assets) {
      const name = asset.name.toLowerCase();
      if (name.endsWith(ext) && archPatterns.some(p => name.includes(p))) {
        return asset;
      }
    }

    // Second pass: match extension only (single-arch releases)
    for (const asset of assets) {
      if (asset.name.toLowerCase().endsWith(ext)) {
        return asset;
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Download
  // ---------------------------------------------------------------------------

  /**
   * Download the release asset to a temporary directory, broadcasting progress.
   */
  private async downloadAsset(asset: GitHubAsset, version: string): Promise<void> {
    const tmpDir = path.join(os.tmpdir(), 'cerious-aasm-update');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    const destPath = path.join(tmpDir, asset.name);

    console.log(`[LinuxPackageUpdater] Downloading ${asset.name} to ${destPath}`);

    const resp = await axios.get(asset.browser_download_url, {
      responseType: 'stream',
      headers: { 'User-Agent': 'cerious-aasm-updater' },
      timeout: 300000, // 5 min timeout for large files
    });

    const totalBytes = parseInt(resp.headers['content-length'] ?? String(asset.size), 10);
    let receivedBytes = 0;
    const startTime = Date.now();

    const writer = fs.createWriteStream(destPath);

    await new Promise<void>((resolve, reject) => {
      resp.data.on('data', (chunk: Buffer) => {
        receivedBytes += chunk.length;
        const elapsed = (Date.now() - startTime) / 1000 || 1;
        const bytesPerSecond = receivedBytes / elapsed;
        const percent = totalBytes > 0 ? (receivedBytes / totalBytes) * 100 : 0;

        messagingService.sendToAllRenderers('app-update-status', {
          status: 'downloading',
          percent,
          bytesPerSecond,
          transferred: receivedBytes,
          total: totalBytes,
        });
      });

      resp.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
      resp.data.on('error', reject);
    });

    this.downloadedPackagePath = destPath;
    this.updateDownloaded = true;

    console.log(`[LinuxPackageUpdater] Download complete: ${destPath}`);
    messagingService.sendToAllRenderers('app-update-status', {
      status: 'downloaded',
      version,
      releaseNotes: '',
      releaseDate: '',
    });
  }

  // ---------------------------------------------------------------------------
  // Install
  // ---------------------------------------------------------------------------

  /**
   * Install the downloaded package using pkexec for privilege escalation,
   * then relaunch the application.
   */
  quitAndInstall(): void {
    if (!this.updateDownloaded || !this.downloadedPackagePath) {
      console.warn('[LinuxPackageUpdater] No update downloaded yet.');
      return;
    }

    const pkgPath = this.downloadedPackagePath;
    const installCmd = this.packageFormat === 'deb'
      ? ['pkexec', 'dpkg', '-i', pkgPath]
      : ['pkexec', 'rpm', '-U', '--force', pkgPath];

    console.log(`[LinuxPackageUpdater] Installing: ${installCmd.join(' ')}`);

    const child = spawn(installCmd[0], installCmd.slice(1), {
      stdio: 'inherit',
      detached: true,
    });

    child.on('exit', (code) => {
      // Clean up the downloaded package
      try { fs.unlinkSync(pkgPath); } catch { /* ignore */ }

      if (code === 0) {
        console.log('[LinuxPackageUpdater] Package installed successfully. Relaunching...');
        app.relaunch();
        app.exit(0);
      } else {
        console.error(`[LinuxPackageUpdater] Install failed with exit code ${code}`);
        messagingService.sendToAllRenderers('app-update-status', {
          status: 'error',
          error: `Package installation failed (exit code ${code}). You may need to install manually.`,
        });
      }
    });

    child.on('error', (err) => {
      console.error('[LinuxPackageUpdater] Install spawn error:', err.message);
      messagingService.sendToAllRenderers('app-update-status', {
        status: 'error',
        error: `Failed to start installer: ${err.message}`,
      });
    });
  }

  /**
   * Returns whether an update has been downloaded and is ready to install.
   */
  isUpdateReady(): boolean {
    return this.updateDownloaded;
  }
}

// Export singleton
export const linuxPackageUpdaterService = new LinuxPackageUpdaterService();
