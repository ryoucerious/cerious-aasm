import * as fs from 'fs';
import * as pty from 'node-pty';
import {
  acquireInstallLock,
  cancelInstaller,
  clearStaleInstallLock,
  InstallCancelledError,
  InstallProgress,
  isInstallLocked,
  onInstallCancel,
  releaseInstallLock,
  releaseInstallLockIfHeld,
  reportSafely,
  runInstaller
} from './installer.utils';

jest.mock('fs', () => ({
  mkdirSync: jest.fn(),
  openSync: jest.fn(),
  writeFileSync: jest.fn(),
  closeSync: jest.fn(),
  unlinkSync: jest.fn(),
  readFileSync: jest.fn(),
  statSync: jest.fn(),
  utimesSync: jest.fn(),
  existsSync: jest.fn()
}));
jest.mock('node-pty', () => ({ spawn: jest.fn() }));
jest.mock('./platform.utils', () => ({ getDefaultInstallDir: jest.fn(() => '/install') }));

const mockFs = jest.mocked(fs);
const mockSpawn = jest.mocked(pty.spawn);

interface FakePty {
  kill: jest.Mock;
  emitData(data: string): void;
  emitExit(exitCode: number): void;
}

function fakePty(): FakePty {
  let onData: (data: string) => void = () => {};
  let onExit: (result: { exitCode: number }) => void = () => {};
  const child = {
    kill: jest.fn(),
    onData: (listener: typeof onData) => { onData = listener; return { dispose: jest.fn() }; },
    onExit: (listener: typeof onExit) => { onExit = listener; return { dispose: jest.fn() }; },
    emitData: (data: string) => onData(data),
    emitExit: (exitCode: number) => onExit({ exitCode })
  };
  mockSpawn.mockReturnValueOnce(child as unknown as pty.IPty);
  return child;
}

function errnoError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

const options = { command: '/steamcmd/steamcmd.sh', args: ['+quit'], cwd: '/steamcmd' };

describe('installer.utils', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
    mockFs.openSync.mockReset();
    mockFs.writeFileSync.mockReset();
    mockFs.unlinkSync.mockReset();
    mockFs.readFileSync.mockReset();
  });

  describe('install lock', () => {
    const LOCK = '/install/install.lock';
    const MINUTE = 60 * 1000;
    let kill: jest.SpyInstance;

    /** A lock file on disk naming `pid`, last touched `ageMs` ago. */
    function lockOnDisk(pid: string, ageMs = 0): void {
      mockFs.readFileSync.mockReturnValue(pid);
      mockFs.statSync.mockReturnValue({ mtimeMs: Date.now() - ageMs } as fs.Stats);
    }

    beforeEach(() => {
      kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
      mockFs.statSync.mockReset();
      mockFs.utimesSync.mockReset();
      mockFs.existsSync.mockReset();
    });

    afterEach(() => {
      releaseInstallLock();
      jest.useRealTimers();
    });

    it('creates the lock file exclusively, naming this process', () => {
      mockFs.openSync.mockReturnValue(7);

      expect(acquireInstallLock()).toBe(true);

      expect(mockFs.mkdirSync).toHaveBeenCalledWith('/install', { recursive: true });
      expect(mockFs.openSync).toHaveBeenCalledWith(LOCK, 'wx');
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(7, String(process.pid));
      expect(mockFs.closeSync).toHaveBeenCalledWith(7);
    });

    it('reports a lock that a running install holds', () => {
      mockFs.openSync.mockImplementation(() => { throw errnoError('EEXIST'); });
      lockOnDisk('4242');

      expect(acquireInstallLock()).toBe(false);
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });

    it('does not take a lock it already holds a second time', () => {
      mockFs.openSync.mockReturnValueOnce(7).mockImplementation(() => { throw errnoError('EEXIST'); });
      lockOnDisk(String(process.pid));

      expect(acquireInstallLock()).toBe(true);
      expect(acquireInstallLock()).toBe(false);
      expect(mockFs.unlinkSync).not.toHaveBeenCalled();
    });

    it('takes over a lock whose holder has stopped', () => {
      mockFs.openSync.mockImplementationOnce(() => { throw errnoError('EEXIST'); }).mockReturnValueOnce(7);
      lockOnDisk('4242', 4 * MINUTE);

      expect(acquireInstallLock()).toBe(true);
      expect(mockFs.unlinkSync).toHaveBeenCalledWith(LOCK);
      expect(mockFs.openSync).toHaveBeenCalledTimes(2);
    });

    it('throws when the lock cannot be created at all', () => {
      mockFs.openSync.mockImplementation(() => { throw errnoError('EACCES'); });

      expect(() => acquireInstallLock()).toThrow('EACCES');
    });

    // An empty lock file would otherwise block every install until the next restart.
    it('removes the lock again when writing it fails', () => {
      mockFs.openSync.mockReturnValue(7);
      mockFs.writeFileSync.mockImplementationOnce(() => { throw errnoError('ENOSPC'); });

      expect(() => acquireInstallLock()).toThrow('ENOSPC');
      expect(mockFs.closeSync).toHaveBeenCalledWith(7);
      expect(mockFs.unlinkSync).toHaveBeenCalledWith(LOCK);
    });

    it('releases the lock by removing the file', () => {
      releaseInstallLock();

      expect(mockFs.unlinkSync).toHaveBeenCalledWith(LOCK);
    });

    it('treats releasing a lock that is gone as done', () => {
      mockFs.unlinkSync.mockImplementationOnce(() => { throw errnoError('ENOENT'); });

      expect(() => releaseInstallLock()).not.toThrow();
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('warns when the lock cannot be removed', () => {
      mockFs.unlinkSync.mockImplementationOnce(() => { throw errnoError('EPERM'); });

      releaseInstallLock();

      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[installer]'), expect.any(Error));
    });

    describe('heartbeat', () => {
      beforeEach(() => jest.useFakeTimers());

      it('touches the lock file every minute while it is held', () => {
        mockFs.openSync.mockReturnValue(7);
        acquireInstallLock();

        jest.advanceTimersByTime(MINUTE);
        expect(mockFs.utimesSync).toHaveBeenCalledTimes(1);
        expect(mockFs.utimesSync).toHaveBeenCalledWith(LOCK, expect.any(Date), expect.any(Date));

        jest.advanceTimersByTime(MINUTE);
        expect(mockFs.utimesSync).toHaveBeenCalledTimes(2);
      });

      it('stops once the lock is released', () => {
        mockFs.openSync.mockReturnValue(7);
        acquireInstallLock();
        releaseInstallLock();

        jest.advanceTimersByTime(5 * MINUTE);

        expect(mockFs.utimesSync).not.toHaveBeenCalled();
        expect(jest.getTimerCount()).toBe(0);
      });

      it('warns and keeps going when the file cannot be touched', () => {
        mockFs.openSync.mockReturnValue(7);
        mockFs.utimesSync.mockImplementation(() => { throw errnoError('ENOENT'); });
        acquireInstallLock();

        jest.advanceTimersByTime(2 * MINUTE);

        expect(mockFs.utimesSync).toHaveBeenCalledTimes(2);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[installer]'), expect.any(Error));
      });
    });

    describe('releaseInstallLockIfHeld', () => {
      it('releases a lock this process holds', () => {
        mockFs.openSync.mockReturnValue(7);
        acquireInstallLock();

        releaseInstallLockIfHeld();

        expect(mockFs.unlinkSync).toHaveBeenCalledWith(LOCK);
      });

      it("leaves another process's lock alone", () => {
        releaseInstallLockIfHeld();

        expect(mockFs.unlinkSync).not.toHaveBeenCalled();
      });

      it('does nothing once the lock has been released', () => {
        mockFs.openSync.mockReturnValue(7);
        acquireInstallLock();
        releaseInstallLock();
        mockFs.unlinkSync.mockClear();

        releaseInstallLockIfHeld();

        expect(mockFs.unlinkSync).not.toHaveBeenCalled();
      });
    });

    describe('clearing a lock left behind at startup', () => {
      it('does nothing without a lock', () => {
        mockFs.statSync.mockImplementation(() => { throw errnoError('ENOENT'); });
        mockFs.readFileSync.mockImplementation(() => { throw errnoError('ENOENT'); });

        clearStaleInstallLock();

        expect(mockFs.unlinkSync).not.toHaveBeenCalled();
      });

      it('keeps a lock whose running process still touches it', () => {
        lockOnDisk('4242', 30 * 1000);

        clearStaleInstallLock();

        expect(kill).toHaveBeenCalledWith(4242, 0);
        expect(mockFs.unlinkSync).not.toHaveBeenCalled();
      });

      it("keeps a fresh lock held by another user's running process", () => {
        lockOnDisk('4242');
        kill.mockImplementation(() => { throw errnoError('EPERM'); });

        clearStaleInstallLock();

        expect(mockFs.unlinkSync).not.toHaveBeenCalled();
      });

      // The PID may since belong to another process (after a restart, often an Electron helper).
      it('removes a lock nobody has touched for three minutes, even if its PID is running', () => {
        lockOnDisk('4242', 3 * MINUTE + 1);

        clearStaleInstallLock();

        expect(mockFs.unlinkSync).toHaveBeenCalledWith(LOCK);
      });

      it('removes a lock whose process is gone', () => {
        lockOnDisk('4242\n');
        kill.mockImplementation(() => { throw errnoError('ESRCH'); });

        clearStaleInstallLock();

        expect(mockFs.unlinkSync).toHaveBeenCalledWith(LOCK);
      });

      // A container restarts the app with the same PID it had before.
      it('removes a lock that names this process', () => {
        lockOnDisk(String(process.pid));

        clearStaleInstallLock();

        expect(mockFs.unlinkSync).toHaveBeenCalledWith(LOCK);
      });

      it.each([
        ['a timestamp from an older version', '1790562909000'],
        ['nothing', ''],
        ['garbage', 'not a pid']
      ])('removes a lock holding %s', (_label, content) => {
        lockOnDisk(content);

        clearStaleInstallLock();

        expect(mockFs.unlinkSync).toHaveBeenCalledWith(LOCK);
        expect(kill).not.toHaveBeenCalled();
      });

      it('removes a lock it cannot read', () => {
        mockFs.statSync.mockReturnValue({ mtimeMs: Date.now() } as fs.Stats);
        mockFs.readFileSync.mockImplementation(() => { throw errnoError('EACCES'); });

        clearStaleInstallLock();

        expect(mockFs.unlinkSync).toHaveBeenCalledWith(LOCK);
      });
    });

    describe('isInstallLocked', () => {
      it('is locked while this process holds the lock', () => {
        mockFs.openSync.mockReturnValue(7);
        acquireInstallLock();

        expect(isInstallLocked()).toBe(true);
      });

      it('is locked while another running process keeps its lock fresh', () => {
        lockOnDisk('4242');

        expect(isInstallLocked()).toBe(true);
      });

      it('is free when there is no lock', () => {
        mockFs.statSync.mockImplementation(() => { throw errnoError('ENOENT'); });
        mockFs.readFileSync.mockImplementation(() => { throw errnoError('ENOENT'); });

        expect(isInstallLocked()).toBe(false);
      });

      it('is free when the lock is stale', () => {
        lockOnDisk('4242', 10 * MINUTE);

        expect(isInstallLocked()).toBe(false);
      });
    });
  });

  describe('runInstaller', () => {
    let onProgress: jest.Mock<void, [InstallProgress]>;
    let onDone: jest.Mock<void, [Error | null]>;

    beforeEach(() => {
      onProgress = jest.fn();
      onDone = jest.fn();
    });

    // Runs a test leaves unfinished stay registered for cancel; this ends them.
    afterEach(() => cancelInstaller());

    it('runs the command and reports success when it exits cleanly', () => {
      const child = fakePty();

      runInstaller(options, onProgress, onDone);
      child.emitExit(0);

      expect(mockSpawn).toHaveBeenCalledWith('/steamcmd/steamcmd.sh', ['+quit'], { cwd: '/steamcmd' });
      expect(onProgress).toHaveBeenLastCalledWith({ percent: 100, step: 'complete', message: 'Download complete.' });
      expect(onDone).toHaveBeenCalledTimes(1);
      expect(onDone).toHaveBeenCalledWith(null);
    });

    it("counts SteamCMD's success line even when it exits non-zero", () => {
      const child = fakePty();

      runInstaller(options, onProgress, onDone);
      child.emitData('Success! App \'2430930\' fully installed.\r\n');
      child.emitExit(7);

      expect(onDone).toHaveBeenCalledWith(null);
    });

    it('reports a failed download', () => {
      const child = fakePty();

      runInstaller(options, onProgress, onDone);
      child.emitExit(8);

      expect(onProgress).toHaveBeenLastCalledWith({ percent: 0, step: 'error', message: 'Failed to download.' });
      expect(onDone).toHaveBeenCalledWith(new Error('Failed to download.'));
    });

    it('reports a command that cannot be started, without throwing', () => {
      mockSpawn.mockImplementationOnce(() => { throw new Error('ENOENT'); });

      expect(() => runInstaller(options, onProgress, onDone)).not.toThrow();

      expect(onDone).toHaveBeenCalledWith(new Error('Failed to start process "/steamcmd/steamcmd.sh": ENOENT'));
    });

    it('passes on the progress the parser finds, and never lets it go backwards', () => {
      const child = fakePty();
      const parseProgress = jest.fn((chunk: string) => {
        const percent = Number(chunk);
        return Number.isNaN(percent) ? null : { percent, step: 'downloading', message: `${percent}%` };
      });

      runInstaller({ ...options, parseProgress }, onProgress, onDone);
      child.emitData('10');
      child.emitData('noise');
      child.emitData('5');
      child.emitData('40');

      expect(onProgress.mock.calls.map(([progress]) => progress.percent)).toEqual([10, 40]);
    });

    it('ends a cancelled run with a cancelled error and kills the child', () => {
      const child = fakePty();

      runInstaller(options, onProgress, onDone);
      cancelInstaller();

      expect(child.kill).toHaveBeenCalled();
      expect(onDone).toHaveBeenCalledTimes(1);
      expect(onDone.mock.calls[0][0]).toBeInstanceOf(InstallCancelledError);
    });

    it('ignores the exit of a child it cancelled', () => {
      const child = fakePty();

      runInstaller(options, onProgress, onDone);
      cancelInstaller();
      child.emitExit(0);

      expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('still reports the cancel when killing the child fails', () => {
      const child = fakePty();
      child.kill.mockImplementation(() => { throw new Error('already gone'); });

      runInstaller(options, onProgress, onDone);
      cancelInstaller();

      expect(onDone.mock.calls[0][0]).toBeInstanceOf(InstallCancelledError);
    });

    it('does not cancel a run that has already finished', () => {
      const child = fakePty();

      runInstaller(options, onProgress, onDone);
      child.emitExit(0);
      cancelInstaller();

      expect(child.kill).not.toHaveBeenCalled();
      expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('keeps each run to its own output when two overlap', () => {
      const first = fakePty();
      const second = fakePty();
      const firstDone = jest.fn();
      const secondDone = jest.fn();

      runInstaller(options, jest.fn(), firstDone);
      runInstaller(options, jest.fn(), secondDone);
      first.emitExit(0);
      second.emitData('Success! App \'2430930\' fully installed.\r\n');
      second.emitExit(6);

      expect(secondDone.mock.calls[0][0]).toBeNull();
      expect(firstDone.mock.calls[0][0]).toBeNull();
    });

    it('stops the child and reports a cancel when its signal aborts', () => {
      const child = fakePty();
      const controller = new AbortController();

      runInstaller({ ...options, signal: controller.signal }, onProgress, onDone);
      controller.abort();

      expect(child.kill).toHaveBeenCalled();
      expect(onDone.mock.calls[0][0]).toBeInstanceOf(InstallCancelledError);
    });

    it('does not start at all when its signal has already aborted', () => {
      const controller = new AbortController();
      controller.abort();

      runInstaller({ ...options, signal: controller.signal }, onProgress, onDone);

      expect(mockSpawn).not.toHaveBeenCalled();
      expect(onDone.mock.calls[0][0]).toBeInstanceOf(InstallCancelledError);
    });

    // The install lock is released further down onDone's chain; a throwing reporter must not skip it.
    it('still reports the result when a progress report throws', () => {
      const child = fakePty();
      onProgress.mockImplementation(() => { throw new Error('socket closed'); });

      runInstaller(options, onProgress, onDone);
      child.emitExit(0);

      expect(onDone).toHaveBeenCalledWith(null);
    });

    it('still reports a failed start when a progress report throws', () => {
      mockSpawn.mockImplementationOnce(() => { throw new Error('ENOENT'); });
      onProgress.mockImplementation(() => { throw new Error('socket closed'); });

      runInstaller(options, onProgress, onDone);

      expect(onDone).toHaveBeenCalledWith(expect.any(Error));
    });

    describe('with a stall timeout', () => {
      beforeEach(() => jest.useFakeTimers());
      afterEach(() => jest.useRealTimers());

      it('kills a child that has printed nothing for too long', () => {
        const child = fakePty();

        runInstaller({ ...options, stallTimeoutMs: 1000 }, onProgress, onDone);
        jest.advanceTimersByTime(999);
        expect(onDone).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1);
        expect(child.kill).toHaveBeenCalled();
        expect(onDone).toHaveBeenCalledWith(new Error('/steamcmd/steamcmd.sh made no progress for 1 s and was stopped.'));
      });

      // SteamCMD can hang while repeating the same status line.
      it('does not count the same output repeated as progress', () => {
        const child = fakePty();

        runInstaller({ ...options, stallTimeoutMs: 1000 }, onProgress, onDone);
        child.emitData(' Update state (0x61) downloading, progress: 12.34 (1 / 8)\r\n');
        jest.advanceTimersByTime(600);
        child.emitData(' Update state (0x61) downloading, progress: 12.34 (1 / 8)\r\n');
        jest.advanceTimersByTime(400);

        expect(child.kill).toHaveBeenCalled();
        expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('made no progress') }));
      });

      it('restarts the clock on every line of output', () => {
        const child = fakePty();

        runInstaller({ ...options, stallTimeoutMs: 1000 }, onProgress, onDone);
        jest.advanceTimersByTime(900);
        child.emitData('still working');
        jest.advanceTimersByTime(900);
        child.emitData('still working, further along');
        jest.advanceTimersByTime(900);

        expect(child.kill).not.toHaveBeenCalled();
        child.emitExit(0);
        expect(jest.getTimerCount()).toBe(0);
      });
    });
  });

  describe('reportSafely', () => {
    it('passes progress on, and logs a report that throws instead of throwing', () => {
      const onProgress = jest.fn(() => { throw new Error('socket closed'); });
      const report = reportSafely(onProgress);

      expect(() => report({ percent: 5, step: 'download', message: 'x' })).not.toThrow();
      expect(onProgress).toHaveBeenCalledWith({ percent: 5, step: 'download', message: 'x' });
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[installer]'), expect.any(Error));
    });

    it('accepts no reporter', () => {
      expect(() => reportSafely(undefined)({ percent: 5, step: 'download', message: 'x' })).not.toThrow();
    });
  });

  describe('onInstallCancel', () => {
    it('lets an in-process step be cancelled until it unregisters', () => {
      const cancel = jest.fn();
      const unregister = onInstallCancel(cancel);

      cancelInstaller();
      unregister();
      cancelInstaller();

      expect(cancel).toHaveBeenCalledTimes(1);
    });

    it('cancels the other steps when one of them throws', () => {
      const failing = onInstallCancel(() => { throw new Error('boom'); });
      const cancel = jest.fn();
      const unregister = onInstallCancel(cancel);

      cancelInstaller();

      expect(cancel).toHaveBeenCalled();
      failing();
      unregister();
    });
  });
});
