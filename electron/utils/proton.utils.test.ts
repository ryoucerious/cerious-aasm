import * as fs from 'fs';
import * as os from 'os';
import * as childProcess from 'child_process';
import * as pty from 'node-pty';
import { onInstallCancel } from './installer.utils';
import { getDefaultInstallDir } from './platform.utils';
import { downloadFile, extractTarball } from './steamcmd.utils';
import {
  ensureProtonPrefixExists,
  getProtonBinaryPath,
  getProtonDir,
  getProtonPrefixDir,
  installProton,
  isProtonInstalled
} from './proton.utils';

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  chmodSync: jest.fn(),
  accessSync: jest.fn(),
  rmSync: jest.fn(),
  mkdtempSync: jest.fn(),
  readdirSync: jest.fn(),
  renameSync: jest.fn(),
  constants: { W_OK: 2, R_OK: 4 }
}));
jest.mock('os', () => ({ homedir: jest.fn() }));
jest.mock('node-pty', () => ({ spawn: jest.fn() }));
jest.mock('./platform.utils', () => ({ getDefaultInstallDir: jest.fn() }));
jest.mock('./installer.utils', () => ({
  ...jest.requireActual('./installer.utils'),
  onInstallCancel: jest.fn()
}));
jest.mock('./steamcmd.utils', () => ({ downloadFile: jest.fn(), extractTarball: jest.fn() }));

const mockFs = jest.mocked(fs);
const mockDownload = jest.mocked(downloadFile);
const mockExtract = jest.mocked(extractTarball);
const mockOnInstallCancel = jest.mocked(onInstallCancel);
const mockReaddir = mockFs.readdirSync as unknown as jest.Mock<string[], [string]>;

const INSTALL = '/mock/install/dir';
const HOME = '/mock/home';
const PROTON = `${INSTALL}/proton`;
const SCAFFOLDING = [`${INSTALL}/.wine-ark`, `${INSTALL}/.steam-compat`, `${INSTALL}/.steam`, `${HOME}/.config/protonfixes`];

describe('proton.utils', () => {
  beforeEach(() => {
    jest.mocked(getDefaultInstallDir).mockReturnValue(INSTALL);
    jest.mocked(os.homedir).mockReturnValue(HOME);
    mockFs.existsSync.mockReset().mockReturnValue(false);
    mockFs.mkdirSync.mockReset();
    mockFs.chmodSync.mockReset();
    mockFs.accessSync.mockReset();
    mockFs.rmSync.mockReset();
  });

  describe('paths', () => {
    it('keeps Proton in the install dir', () => {
      expect(getProtonDir()).toBe(PROTON);
    });

    it('gives each instance its own prefix', () => {
      expect(getProtonPrefixDir('server-a')).toBe(`${INSTALL}/proton-prefix/server-a`);
    });

    it('refuses a prefix without an instance', () => {
      expect(() => getProtonPrefixDir('')).toThrow('instanceId is required for a Proton prefix directory');
    });
  });

  describe('isProtonInstalled', () => {
    it('is false without a Proton binary', () => {
      expect(isProtonInstalled()).toBe(false);
      expect(mockFs.existsSync).toHaveBeenCalledWith(`${PROTON}/proton`);
      expect(mockFs.existsSync).toHaveBeenCalledWith(`${PROTON}/dist/bin/proton`);
    });

    // Starting a server recreates the scaffolding, so a missing folder must not read as "not installed".
    it('is true when the binary exists, whatever the scaffolding folders', () => {
      mockFs.existsSync.mockImplementation(file => file === `${PROTON}/proton`);

      expect(isProtonInstalled()).toBe(true);
    });

    it('accepts the binary in dist/bin', () => {
      mockFs.existsSync.mockImplementation(file => file === `${PROTON}/dist/bin/proton`);

      expect(isProtonInstalled()).toBe(true);
    });
  });

  describe('getProtonBinaryPath', () => {
    it('prefers the top-level binary', () => {
      mockFs.existsSync.mockReturnValue(true);

      expect(getProtonBinaryPath()).toBe(`${PROTON}/proton`);
    });

    it('falls back to dist/bin', () => {
      mockFs.existsSync.mockImplementation(file => file === `${PROTON}/dist/bin/proton`);

      expect(getProtonBinaryPath()).toBe(`${PROTON}/dist/bin/proton`);
    });

    it('throws when Proton is not installed', () => {
      expect(() => getProtonBinaryPath()).toThrow('Proton binary not found. Please install Proton first.');
    });
  });

  describe('installProton', () => {
    const STAGING = `${INSTALL}/proton-staging-abc123`;
    const ARCHIVE = `${STAGING}/GE-Proton10-15.tar.gz`;
    const UNPACKED = `${STAGING}/proton`;
    let unregisterCancel: jest.Mock;
    let onProgress: jest.Mock;

    function install(): Promise<Error | null> {
      return new Promise(resolve => installProton(resolve, onProgress));
    }

    beforeEach(() => {
      unregisterCancel = jest.fn();
      mockOnInstallCancel.mockReset().mockReturnValue(unregisterCancel);
      mockDownload.mockReset().mockResolvedValue(undefined);
      mockExtract.mockReset().mockResolvedValue(undefined);
      mockFs.mkdtempSync.mockReset().mockReturnValue(STAGING);
      mockFs.renameSync.mockReset();
      mockReaddir.mockReset().mockReturnValue([]);
      onProgress = jest.fn();
    });

    it('downloads the pinned release and unpacks it in a staging folder beside the Proton dir', async () => {
      expect(await install()).toBeNull();

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(INSTALL, { recursive: true });
      expect(mockFs.mkdtempSync).toHaveBeenCalledWith(`${INSTALL}/proton-staging-`);
      expect(mockDownload).toHaveBeenCalledWith(
        'https://github.com/GloriousEggroll/proton-ge-custom/releases/download/GE-Proton10-15/GE-Proton10-15.tar.gz',
        ARCHIVE,
        expect.any(AbortSignal),
        expect.any(Function)
      );
      expect(mockFs.mkdirSync).toHaveBeenCalledWith(UNPACKED, { recursive: true });
      expect(mockExtract).toHaveBeenCalledWith(ARCHIVE, { cwd: UNPACKED, strip: 1 });
    });

    // A half-unpacked Proton in place would count as installed and fail every server start.
    it('moves Proton into place only once it is fully unpacked', async () => {
      await install();

      expect(mockFs.rmSync).toHaveBeenCalledWith(PROTON, { recursive: true, force: true });
      expect(mockFs.renameSync).toHaveBeenCalledWith(UNPACKED, PROTON);
      expect(mockFs.renameSync.mock.invocationCallOrder[0]).toBeGreaterThan(mockExtract.mock.invocationCallOrder[0]);
    });

    it('leaves the current Proton dir alone when unpacking fails', async () => {
      mockExtract.mockRejectedValue(new Error('unexpected end of file'));

      expect(await install()).toEqual(new Error('unexpected end of file'));

      expect(mockFs.renameSync).not.toHaveBeenCalled();
      expect(mockFs.rmSync).not.toHaveBeenCalledWith(PROTON, expect.anything());
      expect(mockFs.rmSync).toHaveBeenCalledWith(STAGING, { recursive: true, force: true });
    });

    it('clears staging folders a crashed install left behind', async () => {
      mockReaddir.mockReturnValue(['proton', 'proton-staging-old1', 'proton-prefix']);

      await install();

      expect(mockFs.rmSync).toHaveBeenCalledWith(`${INSTALL}/proton-staging-old1`, { recursive: true, force: true });
      expect(mockFs.rmSync).not.toHaveBeenCalledWith(`${INSTALL}/proton-prefix`, expect.anything());
    });

    it('never starts a shell or a child process', async () => {
      await install();

      expect(childProcess.spawn).not.toHaveBeenCalled();
      expect(pty.spawn).not.toHaveBeenCalled();
    });

    it('deletes the staging folder, archive included, once Proton is in place', async () => {
      await install();

      expect(mockFs.rmSync).toHaveBeenLastCalledWith(STAGING, { recursive: true, force: true });
    });

    it('deletes a partial download and reports the error when the download fails', async () => {
      mockDownload.mockRejectedValue(new Error('socket hang up'));

      expect(await install()).toEqual(new Error('socket hang up'));

      expect(mockFs.rmSync).toHaveBeenCalledWith(STAGING, { recursive: true, force: true });
      expect(mockExtract).not.toHaveBeenCalled();
      expect(mockFs.chmodSync).not.toHaveBeenCalled();
      expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ step: 'error', message: 'socket hang up' }));
    });

    it('still reports the result when the staging folder cannot be deleted', async () => {
      mockFs.rmSync.mockImplementation(dir => {
        if (dir === STAGING) throw new Error('EBUSY');
      });

      expect(await install()).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[proton]'), expect.any(Error));
    });

    it('makes the binary executable and creates the scaffolding', async () => {
      mockFs.existsSync.mockImplementation(file => file === `${PROTON}/proton`);

      await install();

      expect(mockFs.chmodSync).toHaveBeenCalledWith(`${PROTON}/proton`, 0o755);
      for (const dir of SCAFFOLDING) {
        expect(mockFs.mkdirSync).toHaveBeenCalledWith(dir, { recursive: true });
      }
    });

    it('warns, and still succeeds, when the binary cannot be made executable', async () => {
      mockFs.existsSync.mockImplementation(file => file === `${PROTON}/proton`);
      mockFs.chmodSync.mockImplementation(() => { throw new Error('EPERM'); });

      expect(await install()).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[proton]'), expect.any(Error));
    });

    it('reports the download in bytes, then the extraction', async () => {
      mockDownload.mockImplementation(async (_url, _file, _signal, onBytes) => {
        onBytes(250, 1000);
        onBytes(1000, 1000);
      });

      await install();

      expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
        { percent: 0, step: 'download', message: 'Downloading Proton...' },
        { percent: 20, step: 'download', message: 'Downloading Proton... (20%)' },
        { percent: 80, step: 'download', message: 'Downloading Proton... (80%)' },
        { percent: 80, step: 'extract', message: 'Download complete. Extracting...' },
        { percent: 100, step: 'complete', message: 'Proton installed.' }
      ]);
    });

    it('still calls back when a progress report throws', async () => {
      onProgress.mockImplementation(() => { throw new Error('socket closed'); });

      expect(await install()).toBeNull();
    });

    it('lets cancelInstaller abort the download, and unregisters when done', async () => {
      let signal: AbortSignal | undefined;
      mockDownload.mockImplementation(async (_url, _file, abortSignal) => { signal = abortSignal; });

      await install();
      mockOnInstallCancel.mock.calls[0][0]();

      expect(signal?.aborted).toBe(true);
      expect(unregisterCancel).toHaveBeenCalled();
    });

    it('keeps going when a scaffolding folder cannot be created', async () => {
      mockFs.mkdirSync.mockImplementation(dir => {
        if (SCAFFOLDING.includes(String(dir))) throw new Error('EACCES');
        return undefined;
      });

      expect(await install()).toBeNull();
      expect(console.warn).toHaveBeenCalled();
    });
  });

  describe('ensureProtonPrefixExists', () => {
    it('creates the instance prefix and the shared scaffolding', () => {
      ensureProtonPrefixExists('server-a');

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(`${INSTALL}/proton-prefix/server-a`, { recursive: true });
      for (const dir of SCAFFOLDING) {
        expect(mockFs.mkdirSync).toHaveBeenCalledWith(dir, { recursive: true });
      }
    });

    it('puts the protonfixes folder in the home directory the OS reports', () => {
      const home = process.env.HOME;
      process.env.HOME = '/somewhere/else';
      try {
        ensureProtonPrefixExists('server-a');
      } finally {
        process.env.HOME = home;
      }

      expect(mockFs.mkdirSync).toHaveBeenCalledWith(`${HOME}/.config/protonfixes`, { recursive: true });
    });

    it('creates nothing that already exists', () => {
      mockFs.existsSync.mockReturnValue(true);

      ensureProtonPrefixExists('server-a');

      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
    });

    it('opens up a prefix it cannot write to', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.accessSync.mockImplementation(() => { throw new Error('EACCES'); });

      ensureProtonPrefixExists('server-b');

      expect(mockFs.chmodSync).toHaveBeenCalledWith(`${INSTALL}/proton-prefix/server-b`, 0o700);
    });

    it('warns and carries on when the permissions cannot be fixed', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.accessSync.mockImplementation(() => { throw new Error('EACCES'); });
      mockFs.chmodSync.mockImplementation(() => { throw new Error('EPERM'); });

      expect(() => ensureProtonPrefixExists('server-a')).not.toThrow();
      expect(console.warn).toHaveBeenCalled();
    });

    it('warns and carries on when a folder cannot be created', () => {
      mockFs.mkdirSync.mockImplementation(() => { throw new Error('EACCES'); });

      expect(() => ensureProtonPrefixExists('server-a')).not.toThrow();
      expect(console.warn).toHaveBeenCalled();
    });
  });
});
