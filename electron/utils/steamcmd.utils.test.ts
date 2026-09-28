import fs from 'fs';
import path from 'path';

jest.mock('fs', () => {
  // The automock omits createWriteStream, and `import * as fs` in the module under
  // test binds at import time, so it has to be present in the factory.
  const mocked: any = jest.createMockFromModule('fs');
  mocked.createWriteStream = jest.fn();
  return mocked;
});
jest.mock('path');
// test/setup.ts stubs crypto globally; package checksums need real SHA-256.
jest.mock('crypto', () => jest.requireActual('crypto'));
jest.mock('../utils/platform.utils');
jest.mock('../utils/installer.utils');
jest.mock('node-pty', () => ({
  spawn: jest.fn(() => ({
    onData: jest.fn(),
    onExit: jest.fn((cb: Function) => { cb({ exitCode: 0 }); }),
    kill: jest.fn(),
  })),
}));
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('tar', () => ({ x: jest.fn() }));
jest.mock('adm-zip', () => {
  const extractAllTo = jest.fn();
  const ctor: any = jest.fn().mockImplementation(() => ({ extractAllTo }));
  ctor.__extractAllTo = extractAllTo;
  return ctor;
});

const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedPath = path as jest.Mocked<typeof path>;
const { getDefaultInstallDir } = require('../utils/platform.utils');
const { setCurrentAbort } = require('../utils/installer.utils');
const axios = require('axios').default;
const tar = require('tar');
const AdmZip = require('adm-zip');
const { EventEmitter } = require('events');

// Mock process.platform
const originalPlatform = process.platform;
Object.defineProperty(process, 'platform', {
  writable: true,
  value: originalPlatform
});

const mockInstallDir = '/mock/install/dir';
const mockSteamCmdDir = '/mock/install/dir/steamcmd';

describe('steamcmd.utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mocks
    (getDefaultInstallDir as jest.Mock).mockReturnValue(mockInstallDir);
    mockedPath.join.mockImplementation((...args) => args.join('/'));
  });

  afterEach(() => {
    // Reset platform
    Object.defineProperty(process, 'platform', {
      writable: true,
      value: originalPlatform
    });
  });

  describe('getSteamCmdDir', () => {
    it('should return the correct steamcmd directory', () => {
      const result = require('../utils/steamcmd.utils').getSteamCmdDir();
      expect(result).toBe(mockSteamCmdDir);
      expect(getDefaultInstallDir).toHaveBeenCalled();
    });
  });

  describe('isSteamCmdInstalled', () => {
    it('should return true when steamcmd.exe exists on Windows', () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'win32' });
      mockedFs.existsSync.mockReturnValue(true);

      const result = require('../utils/steamcmd.utils').isSteamCmdInstalled();

      expect(result).toBe(true);
      expect(mockedFs.existsSync).toHaveBeenCalledWith('/mock/install/dir/steamcmd/steamcmd.exe');
    });

    it('should return false when steamcmd.exe does not exist on Windows', () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'win32' });
      mockedFs.existsSync.mockReturnValue(false);

      const result = require('../utils/steamcmd.utils').isSteamCmdInstalled();

      expect(result).toBe(false);
      expect(mockedFs.existsSync).toHaveBeenCalledWith('/mock/install/dir/steamcmd/steamcmd.exe');
    });

    it('should return true when steamcmd.sh exists on Linux', () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'linux' });
      mockedFs.existsSync.mockReturnValue(true);

      const result = require('../utils/steamcmd.utils').isSteamCmdInstalled();

      expect(result).toBe(true);
      expect(mockedFs.existsSync).toHaveBeenCalledWith('/mock/install/dir/steamcmd/steamcmd.sh');
    });

    it('should return false when steamcmd.sh does not exist on Linux', () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'linux' });
      mockedFs.existsSync.mockReturnValue(false);

      const result = require('../utils/steamcmd.utils').isSteamCmdInstalled();

      expect(result).toBe(false);
      expect(mockedFs.existsSync).toHaveBeenCalledWith('/mock/install/dir/steamcmd/steamcmd.sh');
    });

    // A bootstrap that never updated leaves steamcmd.sh behind, but nothing it can run.
    it('should return false on Linux when the first-time update never completed', () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'linux' });
      mockedFs.existsSync.mockImplementation(((file: string) =>
        !String(file).endsWith('linux32/steamclient.so')) as any);

      const result = require('../utils/steamcmd.utils').isSteamCmdInstalled();

      expect(result).toBe(false);
    });

    it('should return true when steamcmd.sh exists on macOS', () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'darwin' });
      mockedFs.existsSync.mockReturnValue(true);

      const result = require('../utils/steamcmd.utils').isSteamCmdInstalled();

      expect(result).toBe(true);
      expect(mockedFs.existsSync).toHaveBeenCalledWith('/mock/install/dir/steamcmd/steamcmd.sh');
    });
  });

  describe('installSteamCmd', () => {
    let onData: jest.Mock;
    let writeStream: any;

    /**
     * Stand in for the axios response stream. `pipe` is what the download ultimately
     * calls, so that is where the fake bytes are delivered from.
     */
    function stubDownload(opts: { total?: number; chunks?: number[]; failWith?: Error } = {}) {
      const total = opts.total === undefined ? 1000 : opts.total;
      const chunks = opts.chunks || [400, 600];
      const responseStream: any = new EventEmitter();
      responseStream.destroy = jest.fn();
      responseStream.pipe = jest.fn(() => {
        process.nextTick(() => {
          if (opts.failWith) {
            responseStream.emit('error', opts.failWith);
            return;
          }
          for (const size of chunks) {
            responseStream.emit('data', Buffer.alloc(size));
          }
          writeStream.emit('finish');
        });
      });
      (axios.get as jest.Mock).mockResolvedValue({
        headers: total ? { 'content-length': String(total) } : {},
        data: responseStream,
      });
      return responseStream;
    }

    /** installSteamCmd is callback-style over a promise chain, so tests must await it. */
    function runInstall(withOnData = true): Promise<{ err: Error | null; output?: string }> {
      const { installSteamCmd } = require('../utils/steamcmd.utils');
      return new Promise((resolve) => {
        installSteamCmd(
          (err: Error | null, output?: string) => resolve({ err: err, output: output }),
          withOnData ? onData : undefined
        );
      });
    }

    beforeEach(() => {
      onData = jest.fn();
      writeStream = new EventEmitter();
      writeStream.destroy = jest.fn();
      (mockedFs.createWriteStream as jest.Mock).mockReturnValue(writeStream);
      (tar.x as jest.Mock).mockResolvedValue(undefined);
      AdmZip.__extractAllTo.mockReset();
    });

    it('should download the Windows zip and extract it in-process', async () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'win32' });
      mockedFs.existsSync.mockReturnValue(false);
      stubDownload();

      const result = await runInstall();

      expect(result.err).toBeNull();
      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(mockSteamCmdDir, { recursive: true });
      expect(axios.get).toHaveBeenCalledWith(
        'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip',
        expect.objectContaining({ responseType: 'stream' })
      );
      expect(mockedFs.createWriteStream).toHaveBeenCalledWith(mockSteamCmdDir + '/steamcmd.zip');
      expect(AdmZip).toHaveBeenCalledWith(mockSteamCmdDir + '/steamcmd.zip');
      expect(AdmZip.__extractAllTo).toHaveBeenCalledWith(mockSteamCmdDir, true);
      expect(tar.x).not.toHaveBeenCalled();
    });

    it('should download the Linux tarball, untar it, and chmod steamcmd.sh', async () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'linux' });
      mockedFs.existsSync.mockReturnValue(true);
      stubDownload();

      const result = await runInstall();

      expect(result.err).toBeNull();
      expect(axios.get).toHaveBeenCalledWith(
        'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz',
        expect.objectContaining({ responseType: 'stream' })
      );
      expect(tar.x).toHaveBeenCalledWith({
        file: mockSteamCmdDir + '/steamcmd_linux.tar.gz',
        cwd: mockSteamCmdDir,
      });
      expect(AdmZip).not.toHaveBeenCalled();
      expect(mockedFs.chmodSync).toHaveBeenCalledWith(mockSteamCmdDir + '/steamcmd.sh', '755');
    });

    // The point of the change: no powershell.exe, no bash, no cmd.exe. node-pty survives,
    // but only to run steamcmd itself during first-time initialization.
    it('should never spawn a shell to download or extract', async () => {
      const pty = require('node-pty');
      for (const platform of ['win32', 'linux']) {
        jest.clearAllMocks();
        Object.defineProperty(process, 'platform', { writable: true, value: platform });
        (getDefaultInstallDir as jest.Mock).mockReturnValue(mockInstallDir);
        mockedPath.join.mockImplementation((...args: string[]) => args.join('/'));
        (mockedFs.createWriteStream as jest.Mock).mockReturnValue(writeStream);
        (tar.x as jest.Mock).mockResolvedValue(undefined);
        mockedFs.existsSync.mockReturnValue(false);
        stubDownload();

        await runInstall();

        const spawned = (pty.spawn as jest.Mock).mock.calls.map((c: any[]) => String(c[0]));
        const shells = ['powershell.exe', 'pwsh.exe', 'cmd.exe', 'bash', 'bash.exe', 'sh'];
        for (const command of spawned) {
          // Compare the basename: 'steamcmd.exe' legitimately contains 'cmd.exe'.
          const base = command.toLowerCase().split(/[\/]/).pop();
          expect(shells).not.toContain(base);
        }
      }
    });

    it('should skip directory creation if the directory already exists', async () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'win32' });
      mockedFs.existsSync.mockReturnValue(true);
      stubDownload();

      await runInstall();

      expect(mockedFs.existsSync).toHaveBeenCalledWith(mockSteamCmdDir);
      expect(mockedFs.mkdirSync).not.toHaveBeenCalled();
    });

    it('should report byte-accurate download progress across the 0-50% phase', async () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'win32' });
      mockedFs.existsSync.mockReturnValue(false);
      // 1000 bytes delivered as 400 then 600 => 40% and 100% of the download phase,
      // which map onto 20% and 50% of the overall bar.
      stubDownload({ total: 1000, chunks: [400, 600] });

      await runInstall();

      const progress = onData.mock.calls.map((c: any[]) => c[0]);
      expect(progress).toContainEqual({ percent: 20, step: 'download', message: 'Downloading... (20%)' });
      expect(progress).toContainEqual({ percent: 50, step: 'download', message: 'Downloading... (50%)' });
      expect(progress).toContainEqual(expect.objectContaining({ percent: 50, step: 'extract' }));
      expect(progress).toContainEqual(expect.objectContaining({ percent: 100, step: 'complete' }));
    });

    it('should not report download percentages when Content-Length is missing', async () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'win32' });
      mockedFs.existsSync.mockReturnValue(false);
      stubDownload({ total: 0 });

      const result = await runInstall();

      expect(result.err).toBeNull();
      const downloadPercents = onData.mock.calls
        .map((c: any[]) => c[0])
        .filter((prog: any) => prog.step === 'download' && prog.percent > 0);
      expect(downloadPercents).toEqual([]);
    });

    it('should surface a download failure through the callback', async () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'win32' });
      mockedFs.existsSync.mockReturnValue(false);
      stubDownload({ failWith: new Error('socket hang up') });

      const result = await runInstall();

      expect(result.err).toBeInstanceOf(Error);
      expect(result.err!.message).toBe('socket hang up');
      expect(onData).toHaveBeenCalledWith(expect.objectContaining({ step: 'error', message: 'socket hang up' }));
    });

    it('should surface an extraction failure through the callback', async () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'linux' });
      mockedFs.existsSync.mockReturnValue(false);
      stubDownload();
      (tar.x as jest.Mock).mockRejectedValue(new Error('unexpected end of file'));

      const result = await runInstall();

      expect(result.err).toBeInstanceOf(Error);
      expect(result.err!.message).toBe('unexpected end of file');
      expect(onData).toHaveBeenCalledWith(expect.objectContaining({ step: 'error' }));
    });

    it('should reject when the request fails before streaming starts', async () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'win32' });
      mockedFs.existsSync.mockReturnValue(false);
      (axios.get as jest.Mock).mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

      const result = await runInstall();

      expect(result.err).toBeInstanceOf(Error);
      expect(result.err!.message).toBe('getaddrinfo ENOTFOUND');
    });

    // Cancel has to reach an in-process download, which has no pty to kill.
    it('should register an AbortController so cancelInstaller can stop the download', async () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'win32' });
      mockedFs.existsSync.mockReturnValue(false);
      stubDownload();

      await runInstall();

      expect(setCurrentAbort).toHaveBeenCalledWith(expect.any(AbortController));
      // ...and cleared once the install settles, so a later cancel aborts nothing stale.
      const calls = (setCurrentAbort as jest.Mock).mock.calls;
      expect(calls[calls.length - 1]).toEqual([null]);
    });

    it('should pass the abort signal to axios and reject when it fires', async () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'win32' });
      mockedFs.existsSync.mockReturnValue(false);

      const responseStream: any = new EventEmitter();
      responseStream.destroy = jest.fn();
      responseStream.pipe = jest.fn(); // stall mid-download
      (axios.get as jest.Mock).mockResolvedValue({
        headers: { 'content-length': '1000' },
        data: responseStream,
      });

      const pending = runInstall();
      const controller = (setCurrentAbort as jest.Mock).mock.calls[0][0] as AbortController;
      await new Promise((r) => process.nextTick(r));
      controller.abort();

      const result = await pending;
      expect(result.err).toBeInstanceOf(Error);
      expect(result.err!.message).toBe('Install cancelled.');
      expect(axios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: controller.signal })
      );
    });

    it('should work without an onData callback', async () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'win32' });
      mockedFs.existsSync.mockReturnValue(false);
      stubDownload();

      const result = await runInstall(false);

      expect(result.err).toBeNull();
    });

    it('should initialize SteamCMD after extraction and retry on non-zero exit', async () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'win32' });
      const pty = require('node-pty');

      let spawnCount = 0;
      (pty.spawn as jest.Mock).mockImplementation(() => {
        spawnCount++;
        return {
          onData: jest.fn(),
          onExit: jest.fn((cb: Function) => { cb({ exitCode: spawnCount === 1 ? 7 : 0 }); }),
          kill: jest.fn(),
        };
      });
      mockedFs.existsSync.mockReturnValue(false);
      stubDownload();

      const result = await runInstall();

      expect(pty.spawn).toHaveBeenCalledTimes(2);
      expect(pty.spawn).toHaveBeenCalledWith(mockSteamCmdDir + '/steamcmd.exe', ['+quit'], { cwd: mockSteamCmdDir });
      expect(result.err).toBeNull();
      expect(onData).toHaveBeenCalledWith(
        expect.objectContaining({ step: 'init', message: expect.stringContaining('Initializing') })
      );
    });

    describe('Linux package fallback', () => {
      const crypto = require('crypto');
      const bins = Buffer.from('bins');
      const boot = Buffer.from('boot');
      const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
      const manifest = (binsSha = sha(bins)) => `"linux"
{
	"version"		"1788292693"
	"steamcmd_bins_linux"
	{
		"file"		"steamcmd_bins_linux.zip.1b6d"
		"size"		"4"
		"sha2"		"${binsSha}"
		"zipvz"		"steamcmd_bins_linux.zip.vz.3091_2456"
		"sha2vz"		"081b20a356f6dd74fca3e4023ca6da33924ecbffbcdf271b21051b1a3ad55e65"
	}
	"steamcmd_linux"
	{
		"file"		"steamcmd_linux.zip.917c"
		"size"		"4"
		"sha2"		"${sha(boot)}"
		"IsBootstrapperPackage"		"1"
	}
}
"kvsign2"
{
	"linux"		"eb45"
}`;

      /** Serves the tarball, the manifest, and each package from one axios.get mock. */
      function stubSteamHosts(manifestText: string | null) {
        (mockedFs.createWriteStream as jest.Mock).mockImplementation(() => {
          const out: any = new EventEmitter();
          out.destroy = jest.fn();
          return out;
        });
        (axios.get as jest.Mock).mockImplementation((url: string, opts: any) => {
          if (url.endsWith('/steam_cmd_linux')) {
            return manifestText === null
              ? Promise.reject(new Error('getaddrinfo ENOTFOUND'))
              : Promise.resolve({ headers: {}, data: manifestText });
          }
          const stream: any = new EventEmitter();
          stream.destroy = jest.fn();
          stream.pipe = jest.fn((out: any) => process.nextTick(() => out.emit('finish')));
          return Promise.resolve({ headers: {}, data: stream });
        });
        mockedFs.readFileSync.mockImplementation(((file: string) =>
          String(file).includes('steamcmd_bins_linux') ? bins : boot) as any);
      }

      // The 2018 bootstrapper leaves linux32/steamclient.so missing when its update host is down.
      function bootstrapFails() {
        mockedFs.existsSync.mockImplementation(((file: string) =>
          !String(file).endsWith('linux32/steamclient.so')) as any);
      }

      beforeEach(() => {
        Object.defineProperty(process, 'platform', { writable: true, value: 'linux' });
        mockedFs.readdirSync.mockReturnValue(['steamcmd', 'steamclient.so'] as any);
        require('node-pty').spawn.mockImplementation(() => ({
          onData: jest.fn(),
          onExit: jest.fn((cb: Function) => { cb({ exitCode: 0 }); }),
          kill: jest.fn(),
        }));
      });

      it('should install the current packages from the manifest when the bootstrap update fails', async () => {
        bootstrapFails();
        stubSteamHosts(manifest());
        const pty = require('node-pty');

        const result = await runInstall();

        expect(result.err).toBeNull();
        expect(axios.get).toHaveBeenCalledWith(
          'https://client-update.steamstatic.com/steam_cmd_linux',
          expect.objectContaining({ responseType: 'text' })
        );
        expect(axios.get).toHaveBeenCalledWith(
          'https://client-update.steamstatic.com/steamcmd_bins_linux.zip.1b6d',
          expect.objectContaining({ responseType: 'stream' })
        );
        expect(AdmZip).toHaveBeenCalledWith(mockSteamCmdDir + '/package/steamcmd_bins_linux.zip.1b6d');
        expect(AdmZip).toHaveBeenCalledWith(mockSteamCmdDir + '/package/steamcmd_linux.zip.917c');
        expect(AdmZip.__extractAllTo).toHaveBeenCalledWith(mockSteamCmdDir, true);
        // The zips carry no Unix permissions.
        expect(mockedFs.chmodSync).toHaveBeenCalledWith(mockSteamCmdDir + '/steamcmd.sh', 0o755);
        expect(mockedFs.chmodSync).toHaveBeenCalledWith(mockSteamCmdDir + '/linux64/steamcmd', 0o755);
        // The new steamcmd.sh is run once more so it can finish its own first start.
        expect(pty.spawn).toHaveBeenCalledTimes(2);
      });

      it('should try the next host when the first one fails', async () => {
        bootstrapFails();
        stubSteamHosts(manifest());
        const get = axios.get as jest.Mock;
        const serve = get.getMockImplementation()!;
        get.mockImplementation((url: string, opts: any) =>
          url.startsWith('https://client-update.steamstatic.com')
            ? Promise.reject(new Error('getaddrinfo ENOTFOUND'))
            : serve(url, opts));

        const result = await runInstall();

        expect(result.err).toBeNull();
        expect(get).toHaveBeenCalledWith(
          'https://media.steampowered.com/client/steamcmd_linux.zip.917c',
          expect.anything()
        );
      });

      it('should reject a package whose checksum does not match the manifest', async () => {
        bootstrapFails();
        stubSteamHosts(manifest('0'.repeat(64)));

        const result = await runInstall();

        expect(result.err).toBeInstanceOf(Error);
        expect(result.err!.message).toMatch(/SteamCMD could not finish its first-time update/);
        expect(result.err!.message).toMatch(/checksum/i);
        expect(AdmZip).not.toHaveBeenCalledWith(mockSteamCmdDir + '/package/steamcmd_bins_linux.zip.1b6d');
      });

      it('should report an error instead of succeeding when no host is reachable', async () => {
        bootstrapFails();
        stubSteamHosts(null);

        const result = await runInstall();

        expect(result.err).toBeInstanceOf(Error);
        expect(result.err!.message).toMatch(/SteamCMD could not finish its first-time update/);
        expect(onData).toHaveBeenCalledWith(expect.objectContaining({ step: 'error' }));
      });

      it('should leave a bootstrapped install alone', async () => {
        mockedFs.existsSync.mockReturnValue(true);
        stubSteamHosts(manifest());

        const result = await runInstall();

        expect(result.err).toBeNull();
        expect(axios.get).not.toHaveBeenCalledWith(expect.stringContaining('steam_cmd_linux'), expect.anything());
      });
    });

    it('should handle pty.spawn failure during initialization gracefully', async () => {
      Object.defineProperty(process, 'platform', { writable: true, value: 'win32' });
      const pty = require('node-pty');
      (pty.spawn as jest.Mock).mockImplementation(() => { throw new Error('pty spawn failed'); });
      mockedFs.existsSync.mockReturnValue(false);
      stubDownload();

      const result = await runInstall();

      // Init is best-effort; the install itself still succeeded.
      expect(result.err).toBeNull();
    });
  });
});
