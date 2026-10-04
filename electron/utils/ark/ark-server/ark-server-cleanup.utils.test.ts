import {
  cleanupOrphanedArkProcesses,
  holdStartsUntil,
  killInstanceProcesses,
  rememberInstanceProcessMarker,
  waitForProcessSweeps
} from './ark-server-cleanup.utils';

jest.mock('child_process', () => ({ execFile: jest.fn() }));
jest.mock('../../platform.utils', () => ({ getPlatform: jest.fn() }));
jest.mock('./ark-server-paths.utils', () => ({
  getInstallProcessMarker: jest.fn(),
  getInstanceProcessMarker: jest.fn()
}));

type ExecCallback = (error: (Error & { code?: number | string }) | null) => void;

const { execFile } = jest.requireMock('child_process') as { execFile: jest.Mock };
const { getPlatform } = jest.requireMock('../../platform.utils') as { getPlatform: jest.Mock };
const paths = jest.requireMock('./ark-server-paths.utils') as {
  getInstallProcessMarker: jest.Mock;
  getInstanceProcessMarker: jest.Mock;
};

// Constant: the marker reaches PowerShell through AASM_PROCESS_PATTERN, never inside the script.
const STOP_SCRIPT =
  "Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('ArkAscendedServer.exe','AsaApiLoader.exe') " +
  '-and $_.CommandLine -like $env:AASM_PROCESS_PATTERN } | ' +
  'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }';

let pending: ExecCallback[];

/** Finishes the oldest kill command still running. */
function finish(error: (Error & { code?: number | string }) | null = null): void {
  pending.shift()!(error);
}

function exitCode(code: number): Error & { code: number } {
  return Object.assign(new Error(`Command failed with exit code ${code}`), { code });
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('ark-server-cleanup.utils', () => {
  beforeEach(() => {
    pending = [];
    execFile.mockImplementation((_file: string, _args: string[], _options: object, callback: ExecCallback) => {
      pending.push(callback);
    });
  });

  // Sweeps queued behind others only spawn once those finish.
  afterEach(async () => {
    do {
      while (pending.length) finish();
      await flush();
    } while (pending.length);
  });

  describe('on Windows', () => {
    beforeEach(() => getPlatform.mockReturnValue('windows'));

    // Startup used to run `taskkill /F /IM ArkAscendedServer.exe`, killing every ASA server on the
    // host, including ones other tools run, without a save.
    it('stops only the ARK processes launched from this install', () => {
      paths.getInstallProcessMarker.mockReturnValue('C:\\Users\\O\'Brien\\AppData\\Roaming\\Cerious AASM\\AASMServer\\');

      void cleanupOrphanedArkProcesses();

      expect(execFile).toHaveBeenCalledWith(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', STOP_SCRIPT],
        expect.objectContaining({
          windowsHide: true,
          timeout: 15000,
          env: expect.objectContaining({
            AASM_PROCESS_PATTERN: '*C:\\Users\\O\'Brien\\AppData\\Roaming\\Cerious AASM\\AASMServer\\*'
          })
        }),
        expect.any(Function)
      );
    });

    // PowerShell also treats the typographic quotes as string delimiters, so no user text may
    // ever be spliced into the script.
    it('passes a path with typographic quotes and wildcards without touching the script', () => {
      paths.getInstallProcessMarker.mockReturnValue('D:\\Jo\u2019s [SSD]\\AASM*\\AASMServer\\');

      void cleanupOrphanedArkProcesses();

      const [, args, options] = execFile.mock.calls[0];
      expect(args[3]).toBe(STOP_SCRIPT);
      expect(options.env.AASM_PROCESS_PATTERN).toBe('*D:\\Jo\u2019s `[SSD`]\\AASM`*\\AASMServer\\*');
    });

    // The old `-like '*<id>*'` matched any process whose command line held the id, AASM included.
    it('stops one instance\'s leftovers by the marker only it carries', () => {
      paths.getInstanceProcessMarker.mockReturnValue('AltSaveDirectoryName=Servers\\a1\\SavedArks');

      void killInstanceProcesses('a1');

      expect(paths.getInstanceProcessMarker).toHaveBeenCalledWith('a1');
      expect(execFile.mock.calls[0][2].env.AASM_PROCESS_PATTERN).toBe('*AltSaveDirectoryName=Servers\\a1\\SavedArks*');
    });

    // Installing or removing AsaApi switches an instance between isolated and shared, and with it
    // the marker; the processes still running carry the one they were launched with.
    it('sweeps by the marker the instance was launched with, even after it has changed', () => {
      paths.getInstanceProcessMarker.mockReturnValue('AltSaveDirectoryName=Servers\\m1\\SavedArks');
      rememberInstanceProcessMarker('m1');
      paths.getInstanceProcessMarker.mockReturnValue('C:\\servers\\m1\\');

      void killInstanceProcesses('m1');

      expect(execFile.mock.calls[0][2].env.AASM_PROCESS_PATTERN).toBe('*AltSaveDirectoryName=Servers\\m1\\SavedArks*');
    });

    it('works the marker out at sweep time for an instance it never launched', () => {
      paths.getInstanceProcessMarker.mockImplementationOnce(() => { throw new Error('not installed'); });
      rememberInstanceProcessMarker('m2');
      paths.getInstanceProcessMarker.mockReturnValue('C:\\servers\\m2\\');

      void killInstanceProcesses('m2');

      expect(execFile.mock.calls[0][2].env.AASM_PROCESS_PATTERN).toBe('*C:\\servers\\m2\\*');
    });

    it('reports a PowerShell that exits 1', async () => {
      paths.getInstanceProcessMarker.mockReturnValue('AltSaveDirectoryName=Servers\\a1\\SavedArks');

      const sweep = killInstanceProcesses('a1');
      finish(exitCode(1));
      await sweep;

      expect(console.warn).toHaveBeenCalled();
    });
  });

  describe('on Linux', () => {
    beforeEach(() => getPlatform.mockReturnValue('linux'));

    it('pkills by the marker as a fixed string', () => {
      paths.getInstallProcessMarker.mockReturnValue('Z:\\home\\o.brien\\.local\\share\\cerious-aasm\\AASMServer\\');

      void cleanupOrphanedArkProcesses();

      expect(execFile).toHaveBeenCalledWith(
        'pkill',
        ['-f', 'Z:\\\\home\\\\o\\.brien\\\\\\.local\\\\share\\\\cerious-aasm\\\\AASMServer\\\\'],
        expect.objectContaining({ timeout: 15000 }),
        expect.any(Function)
      );
    });

    it('escapes every regular expression metacharacter', () => {
      paths.getInstanceProcessMarker.mockReturnValue('a.b*c+d?e(f)g[h]i{j}k|l^m$n');

      void killInstanceProcesses('a1');

      expect(execFile.mock.calls[0][1]).toEqual(['-f', 'a\\.b\\*c\\+d\\?e\\(f\\)g\\[h\\]i\\{j\\}k\\|l\\^m\\$n']);
    });

    it('treats pkill\'s "nothing matched" as success', async () => {
      paths.getInstanceProcessMarker.mockReturnValue('AltSaveDirectoryName=Servers/a1/SavedArks');

      const sweep = killInstanceProcesses('a1');
      finish(exitCode(1));
      await sweep;

      expect(console.warn).not.toHaveBeenCalled();
    });

    it('warns when pkill itself fails', async () => {
      paths.getInstanceProcessMarker.mockReturnValue('AltSaveDirectoryName=Servers/a1/SavedArks');

      const sweep = killInstanceProcesses('a1');
      finish(exitCode(3));
      await sweep;

      expect(console.warn).toHaveBeenCalled();
    });
  });

  // A sweep still running when the next process spawns would match, and kill, the new run.
  describe('waitForProcessSweeps', () => {
    beforeEach(() => {
      getPlatform.mockReturnValue('linux');
      paths.getInstallProcessMarker.mockReturnValue('Z:\\ark\\');
      paths.getInstanceProcessMarker.mockImplementation((id: string) => `AltSaveDirectoryName=Servers/${id}/SavedArks`);
    });

    it('waits for a sweep of the same instance', async () => {
      void killInstanceProcesses('a1');
      const settled = jest.fn();

      void waitForProcessSweeps('a1').then(settled);
      await flush();
      expect(settled).not.toHaveBeenCalled();

      finish();
      await flush();
      expect(settled).toHaveBeenCalled();
    });

    it('waits for the startup sweep', async () => {
      void cleanupOrphanedArkProcesses();
      const settled = jest.fn();

      void waitForProcessSweeps('a1').then(settled);
      await flush();
      expect(settled).not.toHaveBeenCalled();

      finish();
      await flush();
      expect(settled).toHaveBeenCalled();
    });

    it('does not wait for another instance\'s sweep', async () => {
      void killInstanceProcesses('b2');

      await expect(waitForProcessSweeps('a1')).resolves.toBeUndefined();
    });

    // A second sweep used to replace the first in the registry, so a start waited for it alone.
    it('waits for every overlapping sweep of the instance, running them one after the other', async () => {
      void killInstanceProcesses('a1');
      void killInstanceProcesses('a1');
      const settled = jest.fn();
      void waitForProcessSweeps('a1').then(settled);
      await flush();
      expect(execFile).toHaveBeenCalledTimes(1);

      finish();
      await flush();
      expect(execFile).toHaveBeenCalledTimes(2);
      expect(settled).not.toHaveBeenCalled();

      finish();
      await flush();
      expect(settled).toHaveBeenCalled();
    });

    it('chains a second startup sweep behind the first', async () => {
      void cleanupOrphanedArkProcesses();
      void cleanupOrphanedArkProcesses();
      const settled = jest.fn();
      void waitForProcessSweeps('a1').then(settled);
      await flush();
      expect(execFile).toHaveBeenCalledTimes(1);

      finish();
      await flush();
      expect(execFile).toHaveBeenCalledTimes(2);
      expect(settled).not.toHaveBeenCalled();

      finish();
      await flush();
      expect(settled).toHaveBeenCalled();
    });

    it('waits for a teardown the instance registered', async () => {
      let finishTeardown: () => void = () => undefined;
      void holdStartsUntil('a1', new Promise<void>(resolve => { finishTeardown = resolve; }));
      const settled = jest.fn();
      void waitForProcessSweeps('a1').then(settled);
      await flush();
      expect(settled).not.toHaveBeenCalled();

      finishTeardown();
      await flush();
      expect(settled).toHaveBeenCalled();
    });

    // One failure used to leave a rejected promise behind that every later start of the instance
    // awaited, and failed on, until the app restarted.
    it('is not held up for good by a teardown that failed', async () => {
      await holdStartsUntil('a1', Promise.reject(new Error('taskkill exploded')));

      await expect(waitForProcessSweeps('a1')).resolves.toBeUndefined();
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('a1'), 'taskkill exploded');
    });

    it('still runs a sweep queued behind a teardown that failed', async () => {
      void holdStartsUntil('a1', Promise.reject(new Error('taskkill exploded')));
      void killInstanceProcesses('a1');
      await flush();

      expect(execFile).toHaveBeenCalledTimes(1);
    });
  });

  // execFile throws synchronously for arguments it rejects (ERR_INVALID_ARG_VALUE, a NUL byte).
  it.each(['windows', 'linux'])('resolves, and logs, a sweep that cannot be spawned on %s', async platform => {
    getPlatform.mockReturnValue(platform);
    paths.getInstanceProcessMarker.mockReturnValue('AltSaveDirectoryName=Servers/a1/SavedArks');
    execFile.mockImplementation(() => { throw new Error('The argument \'args[3]\' must be a string without null bytes'); });

    await expect(killInstanceProcesses('a1')).resolves.toBeUndefined();
    await expect(waitForProcessSweeps('a1')).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });

  it('kills nothing when the instance cannot be resolved', async () => {
    paths.getInstanceProcessMarker.mockImplementation(() => { throw new Error('Invalid instance ID format'); });

    await expect(killInstanceProcesses('../x')).resolves.toBeUndefined();
    expect(execFile).not.toHaveBeenCalled();
  });
});
