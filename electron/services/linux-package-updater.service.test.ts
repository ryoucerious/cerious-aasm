import { EventEmitter } from 'events';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import axios from 'axios';
import { app } from 'electron';
import { execSync, spawn, type ChildProcess } from 'child_process';
import { messagingService } from './messaging.service';
import { LinuxPackageUpdaterService } from './linux-package-updater.service';

// Real files in a sandbox: the point of these tests is where the package lands and who can reach it.
jest.mock('fs', () => jest.requireActual('fs'));
jest.mock('path', () => jest.requireActual('path'));
jest.mock('crypto', () => jest.requireActual('crypto'));
jest.mock('os', () => ({ ...jest.requireActual('os'), tmpdir: jest.fn() }));
jest.mock('electron', () => ({ app: { getVersion: jest.fn(), relaunch: jest.fn(), exit: jest.fn() } }));
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('child_process', () => ({ spawn: jest.fn(), execSync: jest.fn() }));
jest.mock('./messaging.service', () => ({ messagingService: { sendToAllRenderers: jest.fn() } }));

const realOs = jest.requireActual<typeof import('os')>('os');
const mockGet = jest.mocked(axios.get);
const mockSend = jest.mocked(messagingService.sendToAllRenderers);
const PACKAGE = Buffer.from('pretend .deb contents');
const ASSET_URL = 'https://github.com/ryoucerious/cerious-aasm/releases/download/v1.1.0/cerious-aasm_1.1.0_amd64.deb';
const posixOnly = process.platform === 'win32' ? it.skip : it;

function sha256(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function release(tag: string, digest?: string | null) {
  return {
    tag_name: tag,
    body: 'notes',
    published_at: '2026-09-01',
    assets: [
      { name: 'cerious-aasm-1.1.0.x86_64.rpm', browser_download_url: 'https://example.invalid/rpm', size: 1 },
      { name: 'cerious-aasm_1.1.0_amd64.deb', browser_download_url: ASSET_URL, size: PACKAGE.length, digest }
    ]
  };
}

/** The API answers with `latest`; the asset downloads return `contents`. */
function serve(latest: ReturnType<typeof release>, contents = PACKAGE): void {
  mockGet.mockImplementation(async (url: string) => {
    if (url.startsWith('https://api.github.com/')) return { data: latest };
    return { headers: { 'content-length': String(contents.length) }, data: Readable.from([contents]) };
  });
}

function statuses(): string[] {
  return mockSend.mock.calls.map(([, payload]) => (payload as { status: string }).status);
}

function downloadDirs(sandbox: string): string[] {
  return fs.readdirSync(sandbox).filter(entry => entry.startsWith('cerious-aasm-update'));
}

describe('LinuxPackageUpdaterService', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  let sandbox: string;

  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(realOs.tmpdir(), 'aasm-updater-test-'));
    jest.mocked(os.tmpdir).mockReturnValue(sandbox);
    Object.defineProperty(process, 'platform', { value: 'linux' });
    jest.mocked(app.getVersion).mockReturnValue('1.0.12');
    jest.mocked(execSync).mockReset().mockReturnValue(Buffer.from(''));
    mockGet.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', originalPlatform);
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  it('is not supported off Linux', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });

    expect(new LinuxPackageUpdaterService().isSupported()).toBe(false);
    expect(execSync).not.toHaveBeenCalled();
  });

  it('is not supported without dpkg or rpm', () => {
    jest.mocked(execSync).mockImplementation(() => { throw new Error('not found'); });

    expect(new LinuxPackageUpdaterService().isSupported()).toBe(false);
  });

  it('reports an app that is up to date', async () => {
    serve(release('v1.0.12'));
    const service = new LinuxPackageUpdaterService();

    await service.checkForUpdates();

    expect(statuses()).toEqual(['checking', 'up-to-date']);
    expect(service.isUpdateReady()).toBe(false);
  });

  it('reports a release it cannot fetch', async () => {
    mockGet.mockRejectedValue(new Error('getaddrinfo ENOTFOUND api.github.com'));

    await new LinuxPackageUpdaterService().checkForUpdates();

    expect(mockSend).toHaveBeenLastCalledWith('app-update-status', { status: 'error', error: 'Could not fetch latest release.' });
  });

  it('downloads the package for this system into a fresh private folder', async () => {
    serve(release('v1.1.0', `sha256:${sha256(PACKAGE)}`));
    const service = new LinuxPackageUpdaterService();

    await service.checkForUpdates();

    expect(service.isUpdateReady()).toBe(true);
    expect(mockGet).toHaveBeenCalledWith(ASSET_URL, expect.objectContaining({ responseType: 'stream' }));
    const [dir] = downloadDirs(sandbox);
    expect(dir).toMatch(/^cerious-aasm-update-.+/);
    expect(fs.readFileSync(path.join(sandbox, dir, 'cerious-aasm_1.1.0_amd64.deb'))).toEqual(PACKAGE);
    expect(statuses()).toEqual(['checking', 'available', 'downloading', 'downloaded']);
  });

  // pkexec installs the file as root, so no other user may be able to swap it.
  posixOnly('keeps the download folder to this user', async () => {
    serve(release('v1.1.0', `sha256:${sha256(PACKAGE)}`));

    await new LinuxPackageUpdaterService().checkForUpdates();

    const [dir] = downloadDirs(sandbox);
    expect(fs.statSync(path.join(sandbox, dir)).mode & 0o777).toBe(0o700);
  });

  it('throws away a download that does not match the published digest', async () => {
    serve(release('v1.1.0', `sha256:${sha256(Buffer.from('something else'))}`));
    const service = new LinuxPackageUpdaterService();

    await service.checkForUpdates();

    expect(service.isUpdateReady()).toBe(false);
    expect(downloadDirs(sandbox)).toEqual([]);
    expect(mockSend).toHaveBeenLastCalledWith('app-update-status', {
      status: 'error',
      error: 'The downloaded cerious-aasm_1.1.0_amd64.deb does not match its published checksum.'
    });
  });

  it('keeps a download the release publishes no digest for, and says so', async () => {
    serve(release('v1.1.0'));
    const service = new LinuxPackageUpdaterService();

    await service.checkForUpdates();

    expect(service.isUpdateReady()).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('no sha256 digest'));
  });

  it('does not download the same version twice', async () => {
    serve(release('v1.1.0'));
    const service = new LinuxPackageUpdaterService();

    await service.checkForUpdates();
    await service.checkForUpdates();

    expect(mockGet.mock.calls.filter(([url]) => url === ASSET_URL)).toHaveLength(1);
    expect(downloadDirs(sandbox)).toHaveLength(1);
    expect(statuses().slice(-1)).toEqual(['downloaded']);
  });

  it('clears out downloads left by earlier runs', async () => {
    fs.mkdirSync(path.join(sandbox, 'cerious-aasm-update'));
    fs.mkdirSync(path.join(sandbox, 'cerious-aasm-update-old123'));
    fs.writeFileSync(path.join(sandbox, 'cerious-aasm-update-old123', 'old.deb'), 'old');
    fs.mkdirSync(path.join(sandbox, 'unrelated'));
    serve(release('v1.1.0'));

    await new LinuxPackageUpdaterService().checkForUpdates();

    expect(downloadDirs(sandbox)).toHaveLength(1);
    expect(downloadDirs(sandbox)[0]).not.toBe('cerious-aasm-update-old123');
    expect(fs.existsSync(path.join(sandbox, 'unrelated'))).toBe(true);
  });

  describe('quitAndInstall', () => {
    function installer() {
      const child = new EventEmitter();
      jest.mocked(spawn).mockReset().mockReturnValue(child as unknown as ChildProcess);
      return child;
    }

    async function downloaded(): Promise<{ service: LinuxPackageUpdaterService; file: string }> {
      serve(release('v1.1.0'));
      const service = new LinuxPackageUpdaterService();
      await service.checkForUpdates();
      const [dir] = downloadDirs(sandbox);
      return { service, file: path.join(sandbox, dir, 'cerious-aasm_1.1.0_amd64.deb') };
    }

    it('warns when there is nothing to install', () => {
      new LinuxPackageUpdaterService().quitAndInstall();

      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('No update downloaded'));
    });

    it('installs the package with pkexec, removes the download and relaunches', async () => {
      const { service, file } = await downloaded();
      const child = installer();

      service.quitAndInstall();
      expect(spawn).toHaveBeenCalledWith('pkexec', ['dpkg', '-i', file], { stdio: 'inherit', detached: true });
      child.emit('exit', 0);

      expect(downloadDirs(sandbox)).toEqual([]);
      expect(app.relaunch).toHaveBeenCalled();
      expect(app.exit).toHaveBeenCalledWith(0);
    });

    // Dismissing the password prompt must leave the package there for another try.
    it('keeps the download when the install fails', async () => {
      const { service, file } = await downloaded();
      const child = installer();

      service.quitAndInstall();
      child.emit('exit', 126);

      expect(service.isUpdateReady()).toBe(true);
      expect(fs.existsSync(file)).toBe(true);
      expect(app.exit).not.toHaveBeenCalled();
      expect(mockSend).toHaveBeenLastCalledWith('app-update-status', expect.objectContaining({ status: 'error' }));
    });

    it('reports an installer that cannot be started', async () => {
      const { service } = await downloaded();
      const child = installer();

      service.quitAndInstall();
      child.emit('error', new Error('spawn pkexec ENOENT'));

      expect(mockSend).toHaveBeenLastCalledWith('app-update-status', {
        status: 'error',
        error: 'Failed to start installer: spawn pkexec ENOENT'
      });
    });
  });
});
