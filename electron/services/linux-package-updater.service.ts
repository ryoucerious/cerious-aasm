import { app } from 'electron';
import axios from 'axios';
import { execSync, spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  fetchLatestRelease,
  isNewerVersion,
  UPDATER_USER_AGENT,
  type GitHubReleaseAsset
} from '../utils/github-release.utils';
import { messagingService } from './messaging.service';

type PackageFormat = 'deb' | 'rpm';

interface DownloadedPackage {
  version: string;
  dir: string;
  file: string;
}

const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
// Older versions downloaded into a fixed "cerious-aasm-update" folder; it is cleared up too.
const DOWNLOAD_DIR_PATTERN = /^cerious-aasm-update(-|$)/;

function commandExists(command: 'dpkg' | 'rpm'): boolean {
  try {
    execSync(`which ${command}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// dpkg marks the Debian family; rpm Fedora, RHEL and SUSE.
function detectPackageFormat(): PackageFormat | null {
  if (commandExists('dpkg')) return 'deb';
  if (commandExists('rpm')) return 'rpm';
  return null;
}

function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', chunk => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

function removeDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    console.warn(`[linux-package-updater] Could not remove ${dir}:`, error);
  }
}

/** Packages an earlier run downloaded and never installed. Only this user's own folders. */
function removeStaleDownloads(): void {
  const tmp = os.tmpdir();
  let entries: string[];
  try {
    entries = fs.readdirSync(tmp);
  } catch {
    return;
  }
  for (const entry of entries.filter(name => DOWNLOAD_DIR_PATTERN.test(name))) {
    const dir = path.join(tmp, entry);
    try {
      const stats = fs.lstatSync(dir);
      if (stats.isDirectory() && (process.getuid === undefined || stats.uid === process.getuid())) {
        removeDir(dir);
      }
    } catch {
      // Gone already.
    }
  }
}

/**
 * Updates .deb and .rpm installs, which electron-updater cannot: finds the package in the latest
 * GitHub release, downloads it as soon as it is found, and on request installs it with pkexec so
 * the user sees the system's own password prompt, then relaunches.
 */
export class LinuxPackageUpdaterService {
  private readonly packageFormat: PackageFormat | null;
  private download: DownloadedPackage | null = null;

  constructor() {
    this.packageFormat = process.platform === 'linux' ? detectPackageFormat() : null;
  }

  isSupported(): boolean {
    return this.packageFormat !== null;
  }

  isUpdateReady(): boolean {
    return this.download !== null;
  }

  async checkForUpdates(): Promise<void> {
    try {
      this.sendStatus({ status: 'checking' });

      const release = await fetchLatestRelease();
      if (!release) {
        this.sendStatus({ status: 'error', error: 'Could not fetch latest release.' });
        return;
      }

      const current = app.getVersion();
      if (!isNewerVersion(release.tag_name, current)) {
        console.log(`[linux-package-updater] App is up to date (${current})`);
        this.sendStatus({ status: 'up-to-date', version: current });
        return;
      }

      const asset = this.findMatchingAsset(release.assets);
      if (!asset) {
        console.warn(`[linux-package-updater] No .${this.packageFormat} asset in release ${release.tag_name}`);
        this.sendStatus({ status: 'error', error: `No .${this.packageFormat} package in the latest release.` });
        return;
      }

      const version = release.tag_name.replace(/^v/, '');
      console.log(`[linux-package-updater] Update available: v${version} (${asset.name})`);
      this.sendStatus({ status: 'available', version, releaseNotes: release.body, releaseDate: release.published_at });

      if (this.download?.version !== version || !fs.existsSync(this.download.file)) {
        await this.downloadAsset(asset, version);
      }
      this.sendStatus({ status: 'downloaded', version, releaseNotes: '', releaseDate: '' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[linux-package-updater] Update check failed:', message);
      this.sendStatus({ status: 'error', error: message });
    }
  }

  /** Installs the downloaded package with pkexec, then relaunches. A failed install keeps it for another try. */
  quitAndInstall(): void {
    const download = this.download;
    if (!download) {
      console.warn('[linux-package-updater] No update downloaded yet.');
      return;
    }

    const [command, ...args] = this.packageFormat === 'deb'
      ? ['pkexec', 'dpkg', '-i', download.file]
      : ['pkexec', 'rpm', '-U', '--force', download.file];
    console.log(`[linux-package-updater] Installing: ${command} ${args.join(' ')}`);

    const child = spawn(command, args, { stdio: 'inherit', detached: true });
    child.on('exit', code => {
      if (code === 0) {
        console.log('[linux-package-updater] Package installed; relaunching');
        this.discardDownload();
        app.relaunch();
        app.exit(0);
        return;
      }
      console.error(`[linux-package-updater] Install failed with exit code ${code}`);
      this.sendStatus({
        status: 'error',
        error: `Package installation failed (exit code ${code}). You may need to install manually.`
      });
    });
    child.on('error', error => {
      console.error('[linux-package-updater] Could not start the installer:', error.message);
      this.sendStatus({ status: 'error', error: `Failed to start installer: ${error.message}` });
    });
  }

  private sendStatus(status: Record<string, unknown>): void {
    messagingService.sendToAllRenderers('app-update-status', status);
  }

  /** The asset for this package format, preferably built for this architecture. */
  private findMatchingAsset(assets: GitHubReleaseAsset[]): GitHubReleaseAsset | null {
    const extension = this.packageFormat === 'deb' ? '.deb' : '.rpm';
    const arch = os.arch();
    const archNames = arch === 'x64' ? ['amd64', 'x86_64', 'x64'] : [arch, 'aarch64'];
    const packages = assets.filter(asset => asset.name.toLowerCase().endsWith(extension));
    return packages.find(asset => archNames.some(name => asset.name.toLowerCase().includes(name))) ?? packages[0] ?? null;
  }

  private async downloadAsset(asset: GitHubReleaseAsset, version: string): Promise<void> {
    this.discardDownload();
    removeStaleDownloads();

    // pkexec installs this file as root, so it goes in a new folder only this user can write:
    // mkdtemp creates it 0700 with a name nobody can guess.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cerious-aasm-update-'));
    const file = path.join(dir, path.basename(asset.name));
    console.log(`[linux-package-updater] Downloading ${asset.name} to ${file}`);
    try {
      await this.fetchAsset(asset, file);
      await this.verifyDigest(asset, file);
    } catch (error) {
      removeDir(dir);
      throw error;
    }
    this.download = { version, dir, file };
    console.log(`[linux-package-updater] Download complete: ${file}`);
  }

  private async fetchAsset(asset: GitHubReleaseAsset, file: string): Promise<void> {
    const response = await axios.get(asset.browser_download_url, {
      responseType: 'stream',
      headers: { 'User-Agent': UPDATER_USER_AGENT },
      timeout: DOWNLOAD_TIMEOUT_MS
    });
    const total = Number(response.headers['content-length'] ?? asset.size) || 0;
    const startedAt = Date.now();
    let received = 0;

    await new Promise<void>((resolve, reject) => {
      const writer = fs.createWriteStream(file, { mode: 0o600 });
      response.data.on('data', (chunk: Buffer) => {
        received += chunk.length;
        const elapsedSeconds = (Date.now() - startedAt) / 1000 || 1;
        this.sendStatus({
          status: 'downloading',
          percent: total > 0 ? (received / total) * 100 : 0,
          bytesPerSecond: received / elapsedSeconds,
          transferred: received,
          total
        });
      });
      response.data.on('error', reject);
      writer.on('error', reject);
      writer.on('finish', resolve);
      response.data.pipe(writer);
    });
  }

  private async verifyDigest(asset: GitHubReleaseAsset, file: string): Promise<void> {
    const expected = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest ?? '')?.[1]?.toLowerCase();
    if (!expected) {
      console.warn(`[linux-package-updater] The release publishes no sha256 digest for ${asset.name}; it cannot be verified`);
      return;
    }
    if ((await sha256(file)) !== expected) {
      throw new Error(`The downloaded ${asset.name} does not match its published checksum.`);
    }
  }

  private discardDownload(): void {
    if (this.download) {
      removeDir(this.download.dir);
      this.download = null;
    }
  }
}

export const linuxPackageUpdaterService = new LinuxPackageUpdaterService();
