import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as pty from 'node-pty';
import axios from 'axios';
import { onInstallCancel } from './installer.utils';
import { getDefaultInstallDir, getPlatform } from './platform.utils';
import {
  extractTarball,
  getSteamCmdDir,
  getSteamCmdExecutable,
  installSteamCmd,
  isSteamCmdInstalled
} from './steamcmd.utils';

jest.mock('fs', () => {
  // The automock omits createWriteStream, and `import * as fs` in the module under
  // test binds at import time, so it has to be present in the factory.
  const mocked = jest.createMockFromModule<typeof import('fs')>('fs');
  mocked.createWriteStream = jest.fn();
  return mocked;
});
jest.mock('path');
jest.mock('./platform.utils');
jest.mock('./installer.utils', () => ({
  ...jest.requireActual('./installer.utils'),
  onInstallCancel: jest.fn()
}));
jest.mock('node-pty', () => ({ spawn: jest.fn() }));
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('tar', () => ({ x: jest.fn() }));
jest.mock('adm-zip', () => {
  const extractAllTo = jest.fn();
  const ctor = jest.fn().mockImplementation(() => ({ extractAllTo }));
  return Object.assign(ctor, { __extractAllTo: extractAllTo });
});

const mockFs = jest.mocked(fs);
const mockGet = jest.mocked(axios.get);
const mockOnInstallCancel = jest.mocked(onInstallCancel);
const mockSpawn = jest.mocked(pty.spawn);
const tar = jest.requireMock<{ x: jest.Mock }>('tar');
const AdmZip = jest.requireMock<jest.Mock & { __extractAllTo: jest.Mock }>('adm-zip');

const STEAMCMD_DIR = '/mock/install/dir/steamcmd';

function setPlatform(platform: 'windows' | 'linux'): void {
  jest.mocked(getPlatform).mockReturnValue(platform);
}

/** A pty for SteamCMD's first-run initialisation that exits with the given codes, one per spawn. */
function steamCmdExits(...codes: number[]): void {
  for (const exitCode of codes) {
    mockSpawn.mockImplementationOnce(() => ({
      onData: jest.fn(),
      onExit: (listener: (result: { exitCode: number }) => void) => listener({ exitCode }),
      kill: jest.fn()
    }) as unknown as pty.IPty);
  }
}

describe('steamcmd.utils', () => {
  let unregisterCancel: jest.Mock;

  beforeEach(() => {
    jest.mocked(getDefaultInstallDir).mockReturnValue('/mock/install/dir');
    jest.mocked(path.join).mockImplementation((...parts: string[]) => parts.join('/'));
    setPlatform('windows');
    unregisterCancel = jest.fn();
    mockOnInstallCancel.mockReset().mockReturnValue(unregisterCancel);
    mockSpawn.mockReset();
    mockGet.mockReset();
    tar.x.mockReset().mockResolvedValue(undefined);
    AdmZip.mockClear();
    AdmZip.__extractAllTo.mockReset();
  });

  describe('paths', () => {
    it('keeps SteamCMD in the install dir', () => {
      expect(getSteamCmdDir()).toBe(STEAMCMD_DIR);
    });

    it.each([
      ['windows', `${STEAMCMD_DIR}/steamcmd.exe`],
      ['linux', `${STEAMCMD_DIR}/steamcmd.sh`]
    ] as const)('names the %s executable', (platform, executable) => {
      setPlatform(platform);

      expect(getSteamCmdExecutable()).toBe(executable);
    });

    it.each([true, false])('reports whether the executable exists (%p)', exists => {
      setPlatform('linux');
      mockFs.existsSync.mockReturnValue(exists);

      expect(isSteamCmdInstalled()).toBe(exists);
      expect(mockFs.existsSync).toHaveBeenCalledWith(`${STEAMCMD_DIR}/steamcmd.sh`);
    });
  });

  describe('extractTarball', () => {
    it('unpacks with the options it is given', async () => {
      await extractTarball('/proton/GE.tar.gz', { cwd: '/proton', strip: 1 });

      expect(tar.x).toHaveBeenCalledWith({ file: '/proton/GE.tar.gz', cwd: '/proton', strip: 1 });
    });
  });

  describe('installSteamCmd', () => {
    let onData: jest.Mock;
    let writeStream: EventEmitter & { destroy?: jest.Mock };

    /**
     * Stand in for the axios response stream. `pipe` is what the download ultimately
     * calls, so that is where the fake bytes are delivered from.
     */
    function stubDownload(opts: { total?: number; chunks?: number[]; failWith?: Error } = {}) {
      const total = opts.total === undefined ? 1000 : opts.total;
      const chunks = opts.chunks || [400, 600];
      const responseStream = Object.assign(new EventEmitter(), {
        destroy: jest.fn(),
        pipe: jest.fn(() => {
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
        })
      });
      mockGet.mockResolvedValue({
        headers: total ? { 'content-length': String(total) } : {},
        data: responseStream,
      });
      return responseStream;
    }

    /** installSteamCmd is callback-style over a promise chain, so tests must await it. */
    function runInstall(withOnData = true): Promise<Error | null> {
      return new Promise(resolve => installSteamCmd(resolve, withOnData ? onData : undefined));
    }

    beforeEach(() => {
      onData = jest.fn();
      writeStream = Object.assign(new EventEmitter(), { destroy: jest.fn() });
      jest.mocked(mockFs.createWriteStream).mockReturnValue(writeStream as unknown as fs.WriteStream);
      mockFs.existsSync.mockReturnValue(false);
      steamCmdExits(0);
    });

    it('should download the Windows zip and extract it in-process', async () => {
      stubDownload();

      const err = await runInstall();

      expect(err).toBeNull();
      expect(mockFs.mkdirSync).toHaveBeenCalledWith(STEAMCMD_DIR, { recursive: true });
      expect(mockGet).toHaveBeenCalledWith(
        'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip',
        expect.objectContaining({ responseType: 'stream' })
      );
      expect(mockFs.createWriteStream).toHaveBeenCalledWith(STEAMCMD_DIR + '/steamcmd.zip');
      expect(AdmZip).toHaveBeenCalledWith(STEAMCMD_DIR + '/steamcmd.zip');
      expect(AdmZip.__extractAllTo).toHaveBeenCalledWith(STEAMCMD_DIR, true);
      expect(tar.x).not.toHaveBeenCalled();
    });

    it('should download the Linux tarball, untar it, and chmod steamcmd.sh', async () => {
      setPlatform('linux');
      mockFs.existsSync.mockReturnValue(true);
      stubDownload();

      const err = await runInstall();

      expect(err).toBeNull();
      expect(mockGet).toHaveBeenCalledWith(
        'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz',
        expect.objectContaining({ responseType: 'stream' })
      );
      expect(tar.x).toHaveBeenCalledWith({ file: STEAMCMD_DIR + '/steamcmd_linux.tar.gz', cwd: STEAMCMD_DIR });
      expect(AdmZip).not.toHaveBeenCalled();
      expect(mockFs.chmodSync).toHaveBeenCalledWith(STEAMCMD_DIR + '/steamcmd.sh', '755');
    });

    // node-pty survives only to run steamcmd itself during first-time initialization.
    it('should never spawn a shell to download or extract', async () => {
      for (const platform of ['windows', 'linux'] as const) {
        setPlatform(platform);
        stubDownload();
        steamCmdExits(0);

        await runInstall();
      }

      const shells = ['powershell.exe', 'pwsh.exe', 'cmd.exe', 'bash', 'bash.exe', 'sh'];
      for (const [command] of mockSpawn.mock.calls) {
        // Compare the basename: 'steamcmd.exe' legitimately contains 'cmd.exe'.
        expect(shells).not.toContain(String(command).toLowerCase().split('/').pop());
      }
    });

    it('should skip directory creation if the directory already exists', async () => {
      mockFs.existsSync.mockReturnValue(true);
      stubDownload();

      await runInstall();

      expect(mockFs.existsSync).toHaveBeenCalledWith(STEAMCMD_DIR);
      expect(mockFs.mkdirSync).not.toHaveBeenCalled();
    });

    it('should report byte-accurate download progress across the 0-50% phase', async () => {
      // 1000 bytes delivered as 400 then 600 => 40% and 100% of the download phase,
      // which map onto 20% and 50% of the overall bar.
      stubDownload({ total: 1000, chunks: [400, 600] });

      await runInstall();

      const progress = onData.mock.calls.map(([report]) => report);
      expect(progress).toContainEqual({ percent: 20, step: 'download', message: 'Downloading... (20%)' });
      expect(progress).toContainEqual({ percent: 50, step: 'download', message: 'Downloading... (50%)' });
      expect(progress).toContainEqual(expect.objectContaining({ percent: 50, step: 'extract' }));
      expect(progress).toContainEqual(expect.objectContaining({ percent: 100, step: 'complete' }));
    });

    it('should not report download percentages when Content-Length is missing', async () => {
      stubDownload({ total: 0 });

      const err = await runInstall();

      expect(err).toBeNull();
      const downloadPercents = onData.mock.calls
        .map(([report]) => report)
        .filter(report => report.step === 'download' && report.percent > 0);
      expect(downloadPercents).toEqual([]);
    });

    it('should surface a download failure through the callback', async () => {
      stubDownload({ failWith: new Error('socket hang up') });

      const err = await runInstall();

      expect(err).toEqual(new Error('socket hang up'));
      expect(onData).toHaveBeenCalledWith(expect.objectContaining({ step: 'error', message: 'socket hang up' }));
    });

    it('should surface an extraction failure through the callback', async () => {
      setPlatform('linux');
      stubDownload();
      tar.x.mockRejectedValue(new Error('unexpected end of file'));

      const err = await runInstall();

      expect(err).toEqual(new Error('unexpected end of file'));
      expect(onData).toHaveBeenCalledWith(expect.objectContaining({ step: 'error' }));
    });

    it('should reject when the request fails before streaming starts', async () => {
      mockGet.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

      const err = await runInstall();

      expect(err).toEqual(new Error('getaddrinfo ENOTFOUND'));
    });

    // Cancel has to reach an in-process download, which has no pty to kill.
    it('lets cancelInstaller stop the download while it runs', async () => {
      stubDownload();

      await runInstall();

      expect(mockOnInstallCancel).toHaveBeenCalledWith(expect.any(Function));
      expect(unregisterCancel).toHaveBeenCalled();
    });

    it('should pass the abort signal to axios and reject when it fires', async () => {
      const responseStream = Object.assign(new EventEmitter(), { destroy: jest.fn(), pipe: jest.fn() });
      mockGet.mockResolvedValue({ headers: { 'content-length': '1000' }, data: responseStream });

      const pending = runInstall();
      const cancel = mockOnInstallCancel.mock.calls[0][0];
      await new Promise(resolve => process.nextTick(resolve));
      cancel();

      const err = await pending;
      expect(err).toEqual(new Error('Install cancelled.'));
      expect(mockGet).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    });

    it('reports a cancel that arrives before the download starts as a cancel', async () => {
      mockGet.mockImplementation((_url, config) => new Promise((_resolve, reject) => {
        config?.signal?.addEventListener?.('abort', () => reject(new Error('canceled')));
      }));

      const pending = runInstall();
      mockOnInstallCancel.mock.calls[0][0]();

      expect(await pending).toEqual(new Error('Install cancelled.'));
    });

    it('should work without an onData callback', async () => {
      stubDownload();

      const err = await runInstall(false);

      expect(err).toBeNull();
    });

    it('should initialize SteamCMD after extraction and retry on non-zero exit', async () => {
      mockSpawn.mockReset();
      steamCmdExits(7, 0);
      stubDownload();

      const err = await runInstall();

      expect(mockSpawn).toHaveBeenCalledTimes(2);
      expect(mockSpawn).toHaveBeenCalledWith(STEAMCMD_DIR + '/steamcmd.exe', ['+quit'], { cwd: STEAMCMD_DIR });
      expect(err).toBeNull();
      expect(onData).toHaveBeenCalledWith(
        expect.objectContaining({ step: 'init', message: expect.stringContaining('Initializing') })
      );
    });

    it('should handle pty.spawn failure during initialization gracefully', async () => {
      mockSpawn.mockReset().mockImplementation(() => { throw new Error('pty spawn failed'); });
      stubDownload();

      // Init is best-effort; the install itself still succeeded.
      expect(await runInstall()).toBeNull();
    });

    it('keeps Cancel registered until the install has finished initialising', async () => {
      stubDownload();
      mockSpawn.mockReset().mockImplementationOnce(() => ({
        onData: jest.fn(),
        onExit: (listener: (result: { exitCode: number }) => void) => {
          expect(unregisterCancel).not.toHaveBeenCalled();
          listener({ exitCode: 0 });
        },
        kill: jest.fn()
      }) as unknown as pty.IPty);

      expect(await runInstall()).toBeNull();
      expect(unregisterCancel).toHaveBeenCalledTimes(1);
    });

    it('stops first-run initialisation on cancel and ends the install cancelled', async () => {
      const init = { onData: jest.fn(), onExit: jest.fn(), kill: jest.fn() };
      mockSpawn.mockReset().mockReturnValueOnce(init as unknown as pty.IPty);
      stubDownload();

      const pending = runInstall();
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      mockOnInstallCancel.mock.calls[0][0]();

      expect(await pending).toEqual(new Error('Install cancelled.'));
      expect(init.kill).toHaveBeenCalled();
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(unregisterCancel).toHaveBeenCalled();
    });

    it('does not initialise after a cancel that arrives during extraction', async () => {
      setPlatform('linux');
      stubDownload();
      tar.x.mockImplementation(async () => mockOnInstallCancel.mock.calls[0][0]());

      expect(await runInstall()).toEqual(new Error('Install cancelled.'));
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('still calls back when a progress report throws', async () => {
      stubDownload();
      onData.mockImplementation(() => { throw new Error('socket closed'); });

      expect(await runInstall()).toBeNull();
    });

    describe('when an initialisation run hangs', () => {
      beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick'] }));
      afterEach(() => jest.useRealTimers());

      it('stops it after ten minutes and moves on', async () => {
        const hung = { onData: jest.fn(), onExit: jest.fn(), kill: jest.fn() };
        mockSpawn.mockReset().mockReturnValueOnce(hung as unknown as pty.IPty);
        steamCmdExits(0);
        stubDownload();

        const pending = runInstall();
        await jest.advanceTimersByTimeAsync(10 * 60 * 1000);

        expect(hung.kill).toHaveBeenCalled();
        expect(await pending).toBeNull();
        expect(mockSpawn).toHaveBeenCalledTimes(2);
      });
    });
  });
});
