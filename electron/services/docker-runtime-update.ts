import axios from 'axios';
import { spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { appVersion } from '../utils/app-version';
import { fetchLatestRelease, isNewerVersion, UPDATER_USER_AGENT, type GitHubReleaseAsset } from '../utils/github-release.utils';
import { getDefaultInstallDir, isRunningInDocker } from '../utils/platform.utils';

/** Published next to the desktop installers. The container applies this without pulling a new image. */
export const RUNTIME_ASSET_NAME = 'cerious-aasm-runtime.tar.gz';

/** The entrypoint relaunches the app process on this code and leaves the container running. */
export const RELAUNCH_EXIT_CODE = 75;

const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

export function runtimeRoot(): string {
  return path.join(getDefaultInstallDir(), 'runtime');
}

export function findRuntimeAsset(assets: GitHubReleaseAsset[]): GitHubReleaseAsset | null {
  return assets.find(asset => asset.name === RUNTIME_ASSET_NAME) || null;
}

/** Rejects an archive that could write outside the directory it is extracted into. */
export function assertArchivePaths(entries: string[]): void {
  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, '/');
    if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
      throw new Error('The runtime archive contains an unsafe path.');
    }
  }
}

/**
 * Downloads the release's runtime archive onto the data volume. The entrypoint copies it
 * over the image's app files on the next process start, so the container is not recreated.
 */
export async function stageDockerRuntimeUpdate(current = appVersion()): Promise<{ version: string }> {
  if (!isRunningInDocker()) {
    throw new Error('In-place app update runs inside the Docker install.');
  }
  const release = await fetchLatestRelease();
  const remote = (release?.tag_name || '').replace(/^v/, '');
  if (!release || !remote) throw new Error('Could not fetch the latest release.');
  if (!isNewerVersion(remote, current)) throw new Error(`This install is already on ${current}.`);
  const asset = findRuntimeAsset(release.assets || []);
  if (!asset) {
    throw new Error('This release has no in-place runtime archive. On the Docker host, run: docker compose pull && docker compose up -d');
  }

  const download = path.join(os.tmpdir(), `cerious-aasm-runtime-${process.pid}.tar.gz`);
  const staging = `${runtimeRoot()}.staging`;
  try {
    await downloadAsset(asset, download);
    await verifyDigest(asset, download);
    const entries = await listArchive(download);
    assertArchivePaths(entries);
    if (!entries.some(entry => entry.replace(/\\/g, '/') === 'package.json')) {
      throw new Error('The runtime archive has no package.json.');
    }
    if (!entries.some(entry => entry.replace(/\\/g, '/').startsWith('electron/main.js'))) {
      throw new Error('The runtime archive has no app.');
    }
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    await extractArchive(download, staging);
    const stagedVersion = readStagedVersion(staging);
    if (!isNewerVersion(stagedVersion, current)) {
      throw new Error(`The archive is ${stagedVersion}, which is not newer than ${current}.`);
    }
    const root = runtimeRoot();
    fs.rmSync(root, { recursive: true, force: true });
    fs.renameSync(staging, root);
    return { version: stagedVersion };
  } finally {
    fs.rmSync(download, { force: true });
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

/** Leaves the container's entrypoint running and starts the app process again. */
export function relaunchInPlace(): void {
  console.log('[docker-runtime] Restarting the app process in place');
  try {
    const { app } = require('electron') as { app?: { exit?: (code: number) => void } };
    if (typeof app?.exit === 'function') {
      app.exit(RELAUNCH_EXIT_CODE);
      return;
    }
  } catch {
    // Running outside Electron.
  }
  process.exit(RELAUNCH_EXIT_CODE);
}

function readStagedVersion(dir: string): string {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { version?: string };
  if (!pkg.version) throw new Error('The runtime archive has no version.');
  return String(pkg.version);
}

function downloadAsset(asset: GitHubReleaseAsset, file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    axios.get(asset.browser_download_url, {
      responseType: 'stream',
      headers: { 'User-Agent': UPDATER_USER_AGENT },
      timeout: DOWNLOAD_TIMEOUT_MS
    }).then(response => {
      const writer = fs.createWriteStream(file, { mode: 0o600 });
      response.data.pipe(writer);
      writer.on('finish', () => resolve());
      writer.on('error', reject);
      response.data.on('error', reject);
    }).catch(reject);
  });
}

async function verifyDigest(asset: GitHubReleaseAsset, file: string): Promise<void> {
  const digest = asset.digest || '';
  if (!digest.startsWith('sha256:')) return;
  const expected = digest.slice('sha256:'.length).toLowerCase();
  const actual = await sha256(file);
  if (actual !== expected) throw new Error('The runtime archive did not match its published checksum.');
}

function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('close', () => resolve(hash.digest('hex')));
  });
}

function listArchive(file: string): Promise<string[]> {
  return runTar(['-tzf', file]).then(output => output.split('\n').map(line => line.trim()).filter(Boolean));
}

function extractArchive(file: string, dest: string): Promise<string> {
  return runTar(['--no-absolute-names', '-xzf', file, '-C', dest]);
}

function runTar(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', chunk => out.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => err.push(Buffer.from(chunk)));
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(Buffer.concat(err).toString('utf8').trim() || `tar exited ${code}`));
        return;
      }
      resolve(Buffer.concat(out).toString('utf8'));
    });
  });
}
