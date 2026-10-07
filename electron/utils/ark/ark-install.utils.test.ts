import * as fs from 'fs';
import { InstallCancelledError, InstallerOptions, runInstaller } from '../installer.utils';
import { getPlatform } from '../platform.utils';
import { getCurrentInstalledVersion, installArkServer, isArkServerInstalled } from './ark-install.utils';

jest.mock('../installer.utils', () => ({
  ...jest.requireActual('../installer.utils'),
  runInstaller: jest.fn()
}));
jest.mock('../platform.utils', () => ({ getPlatform: jest.fn(() => 'windows') }));
jest.mock('../steamcmd.utils', () => ({
  getSteamCmdDir: jest.fn(() => '/steamcmd'),
  getSteamCmdExecutable: jest.fn(() => '/steamcmd/steamcmd.exe')
}));
jest.mock('./ark-server/ark-server-paths.utils', () => ({
  ARK_APP_ID: '2430930',
  getArkServerDir: jest.fn(() => '/ark'),
  getArkExecutablePath: jest.fn(() => '/ark/ShooterGame/Binaries/Win64/ArkAscendedServer.exe')
}));

const mockFs = jest.mocked(fs);
const mockRunInstaller = jest.mocked(runInstaller);
const MANIFEST = '/ark/steamapps/appmanifest_2430930.acf';

function existing(...files: string[]): void {
  mockFs.existsSync.mockImplementation(file => files.includes(String(file)));
}

describe('ark-install.utils', () => {
  beforeEach(() => {
    mockFs.existsSync.mockReset();
    mockFs.readFileSync.mockReset();
    mockRunInstaller.mockReset();
    jest.mocked(getPlatform).mockReturnValue('windows');
  });

  describe('isArkServerInstalled', () => {
    it.each([true, false])('reports whether the server executable exists (%p)', exists => {
      mockFs.existsSync.mockReturnValue(exists);

      expect(isArkServerInstalled()).toBe(exists);
      expect(mockFs.existsSync).toHaveBeenCalledWith('/ark/ShooterGame/Binaries/Win64/ArkAscendedServer.exe');
    });
  });

  describe('getCurrentInstalledVersion', () => {
    it('prefers the build id in the Steam manifest over version.txt', async () => {
      existing('/ark/steamapps', MANIFEST, '/ark/version.txt');
      mockFs.readFileSync.mockImplementation(file =>
        file === MANIFEST ? '"AppState"\n{\n\t"buildid"\t\t"19934105"\n}' : '1.2.3\n'
      );

      await expect(getCurrentInstalledVersion()).resolves.toBe('19934105');
    });

    // An update downloads into a copy of the install beside it; its build is read from there.
    it('reads the build of another install folder', async () => {
      existing('/ark-update/steamapps/appmanifest_2430930.acf');
      mockFs.readFileSync.mockReturnValue('"buildid"\t\t"20000000"');

      await expect(getCurrentInstalledVersion('/ark-update')).resolves.toBe('20000000');
    });

    it('falls back to version.txt when there is no manifest', async () => {
      existing('/ark/version.txt');
      mockFs.readFileSync.mockReturnValue('1.2.3\n');

      await expect(getCurrentInstalledVersion()).resolves.toBe('1.2.3');
    });

    it('returns null when nothing is installed', async () => {
      mockFs.existsSync.mockReturnValue(false);

      await expect(getCurrentInstalledVersion()).resolves.toBeNull();
    });

    it('returns null when the files cannot be read', async () => {
      existing('/ark/steamapps', MANIFEST);
      mockFs.readFileSync.mockImplementation(() => { throw new Error('EACCES'); });

      await expect(getCurrentInstalledVersion()).resolves.toBeNull();
    });
  });

  describe('installArkServer', () => {
    function lastOptions(): InstallerOptions {
      return mockRunInstaller.mock.calls[mockRunInstaller.mock.calls.length - 1][0];
    }

    it('fails without running anything when SteamCMD is missing', () => {
      mockFs.existsSync.mockReturnValue(false);
      const done = jest.fn();

      installArkServer(done);

      expect(done).toHaveBeenCalledWith(new Error('SteamCMD not found. Please install SteamCMD first.'));
      expect(mockRunInstaller).not.toHaveBeenCalled();
    });

    it('runs SteamCMD against the shared install and reports its result', () => {
      existing('/steamcmd/steamcmd.exe');
      mockRunInstaller.mockImplementation((_options, _onProgress, onDone) => onDone(null));
      const done = jest.fn();

      installArkServer(done);

      expect(lastOptions()).toEqual(expect.objectContaining({
        command: '/steamcmd/steamcmd.exe',
        args: ['+force_install_dir', '/ark', '+login', 'anonymous', '+app_update', '2430930', 'validate', '+quit'],
        cwd: '/steamcmd',
        stallTimeoutMs: 30 * 60 * 1000
      }));
      expect(done).toHaveBeenCalledWith(null);
    });

    it('runs SteamCMD against another install folder when given one', () => {
      existing('/steamcmd/steamcmd.exe');
      mockRunInstaller.mockImplementation((_options, _onProgress, onDone) => onDone(null));

      installArkServer(jest.fn(), undefined, undefined, '/ark-update');

      expect(lastOptions().args.slice(0, 2)).toEqual(['+force_install_dir', '/ark-update']);
    });

    it('requests the Windows depot on Linux and removes a stuck app manifest first', () => {
      jest.mocked(getPlatform).mockReturnValue('linux');
      mockFs.existsSync.mockImplementation(file => String(file).endsWith('steamcmd.exe') || file === MANIFEST);
      mockFs.readFileSync.mockReturnValue('"UpdateResult"\t\t"6"');
      mockRunInstaller.mockImplementation((_options, _onProgress, onDone) => onDone(null));

      installArkServer(jest.fn());

      expect(mockFs.unlinkSync).toHaveBeenCalledWith(MANIFEST);
      expect(lastOptions().args.slice(0, 2)).toEqual(['+@sSteamCmdForcePlatformType', 'windows']);
    });

    it('retries a failed SteamCMD run twice before giving up', () => {
      existing('/steamcmd/steamcmd.exe');
      mockRunInstaller.mockImplementation((_options, _onProgress, onDone) => onDone(new Error('Failed to download.')));
      const done = jest.fn();

      installArkServer(done);

      expect(mockRunInstaller).toHaveBeenCalledTimes(3);
      expect(done).toHaveBeenCalledTimes(1);
      expect(done).toHaveBeenCalledWith(new Error('Failed to download.'));
    });

    it('does not retry a cancelled install', () => {
      existing('/steamcmd/steamcmd.exe');
      const cancelled = new InstallCancelledError();
      mockRunInstaller.mockImplementation((_options, _onProgress, onDone) => onDone(cancelled));
      const done = jest.fn();

      installArkServer(done);

      expect(mockRunInstaller).toHaveBeenCalledTimes(1);
      expect(done).toHaveBeenCalledWith(cancelled);
    });

    it('hands its signal to each run, and stops retrying once it has aborted', () => {
      existing('/steamcmd/steamcmd.exe');
      const controller = new AbortController();
      mockRunInstaller.mockImplementation((_options, _onProgress, onDone) => {
        controller.abort();
        onDone(new InstallCancelledError());
      });
      const done = jest.fn();

      installArkServer(done, undefined, controller.signal);

      expect(lastOptions().signal).toBe(controller.signal);
      expect(mockRunInstaller).toHaveBeenCalledTimes(1);
      expect(done).toHaveBeenCalledWith(expect.any(InstallCancelledError));
    });

    it('still calls back when a progress report throws', () => {
      existing('/steamcmd/steamcmd.exe');
      mockRunInstaller.mockImplementation((_options, _onProgress, onDone) => onDone(null));
      const done = jest.fn();

      installArkServer(done, () => { throw new Error('socket closed'); });

      expect(done).toHaveBeenCalledWith(null);
    });

    it('passes the installer progress on', () => {
      existing('/steamcmd/steamcmd.exe');
      mockRunInstaller.mockImplementation((_options, onProgress, onDone) => {
        onProgress({ percent: 100, step: 'complete', message: 'Download complete.' });
        onDone(null);
      });
      const onProgress = jest.fn();

      installArkServer(jest.fn(), onProgress);

      expect(onProgress).toHaveBeenCalledWith({ percent: 0, step: 'download', message: 'Checking Ark Server...' });
      expect(onProgress).toHaveBeenCalledWith({ percent: 100, step: 'complete', message: 'Download complete.' });
    });

    describe('reading SteamCMD progress', () => {
      function parse(chunk: string) {
        existing('/steamcmd/steamcmd.exe');
        installArkServer(jest.fn());
        return lastOptions().parseProgress!(chunk);
      }

      it('reads the download percentage', () => {
        expect(parse(' Update state (0x61) downloading, progress: 42.57 (1234 / 5678)\r\n')).toEqual({
          percent: 42, step: 'downloading', message: 'Downloading Ark Server (42.6%)'
        });
      });

      it('treats verification as the end of the download', () => {
        expect(parse(' Update state (0x81) verifying update, progress: 3.10 (1 / 2)\r\n')).toEqual({
          percent: 100, step: 'downloading', message: 'Verifying Ark Server installation...'
        });
      });

      it('ignores other output', () => {
        expect(parse('Logging in user anonymous to Steam Public...OK\r\n')).toBeNull();
        expect(parse('[ 45%] Downloading update (12,345 of 67,890 KB)...\r\n')).toBeNull();
      });
    });
  });
});
