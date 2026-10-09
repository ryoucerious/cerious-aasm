const files = new Map<string, { data: Buffer; mtimeMs: number }>();
const openFds = new Map<number, string>();
let nextFd = 10;
let clock = 1000;

jest.mock('fs', () => ({
  existsSync: jest.fn((p: string) => p.endsWith('/Logs')),
  readdirSync: jest.fn((dir: string) =>
    [...files.keys()].filter(p => p.startsWith(`${dir}/`)).map(p => p.slice(dir.length + 1))
  ),
  statSync: jest.fn((p: string) => {
    const file = files.get(p);
    if (!file) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
    return { size: file.data.length, mtimeMs: file.mtimeMs };
  }),
  openSync: jest.fn((p: string) => {
    if (!files.has(p)) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
    openFds.set(nextFd, p);
    return nextFd++;
  }),
  readSync: jest.fn((fd: number, buffer: Buffer, offset: number, length: number, position: number) => {
    const data = files.get(openFds.get(fd)!)!.data;
    return data.copy(buffer, offset, position, position + length);
  }),
  closeSync: jest.fn((fd: number) => openFds.delete(fd)),
  watch: jest.fn(() => ({ close: jest.fn(), on: jest.fn() }))
}));
jest.mock('./ark-server-paths.utils', () => ({
  getArkServerDir: jest.fn(() => '/ark'),
  getInstanceLogsDir: jest.fn((id: string) => `/instances/${id}/ShooterGame/Saved/Logs`)
}));

import * as fs from 'fs';
import {
  detectAndRegisterLogFile,
  getInstanceLogs,
  getRegisteredLogFile,
  readLogTail,
  setupLogTailing,
  snapshotLogFiles,
  unregisterLogFile
} from './ark-server-logging.utils';
import { getInstanceState, setInstanceState } from './ark-server-state.utils';

const SHARED_LOG = '/ark/ShooterGame/Saved/Logs/ShooterGame.log';
const A_LOG = '/instances/a1/ShooterGame/Saved/Logs/ShooterGame.log';
const B_LOG = '/instances/b2/ShooterGame/Saved/Logs/ShooterGame.log';

function write(filePath: string, text: string | Buffer): void {
  const existing = files.get(filePath)?.data ?? Buffer.alloc(0);
  files.set(filePath, { data: Buffer.concat([existing, Buffer.from(text)]), mtimeMs: ++clock });
}

function rewrite(filePath: string, text: string): void {
  files.set(filePath, { data: Buffer.from(text), mtimeMs: ++clock });
}

/** Start `instanceId` the way server-process does: snapshot, create its log, detect, tail. */
function start(instanceId: string, logPath: string, onLog = jest.fn(), onState = jest.fn()) {
  detectAndRegisterLogFile(instanceId, snapshotLogFiles(instanceId));
  write(logPath, 'Log file open\n');
  setupLogTailing(instanceId, onLog, onState);
  jest.advanceTimersByTime(2000);
  return { onLog, onState };
}

function poll(): void {
  jest.advanceTimersByTime(3000);
}

function logged(onLog: jest.Mock): string[] {
  return onLog.mock.calls.map(([line]) => line).filter(line => !line.startsWith('[INFO]'));
}

describe('ark-server-logging.utils', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    files.clear();
    openFds.clear();
  });

  afterEach(() => {
    ['a1', 'b2'].forEach(unregisterLogFile);
    jest.useRealTimers();
  });

  describe('log file detection', () => {
    it('registers the file that appeared after the snapshot', () => {
      write(SHARED_LOG, 'another server\n');
      detectAndRegisterLogFile('a1', snapshotLogFiles('a1'));
      write(A_LOG, 'a1 starting\n');

      jest.advanceTimersByTime(2000);

      expect(getRegisteredLogFile('a1')).toBe(A_LOG);
    });

    // Proton rewrites ShooterGame.log in place rather than starting a new file.
    it('registers a file rewritten since the snapshot', () => {
      write(A_LOG, 'previous run\n');
      detectAndRegisterLogFile('a1', snapshotLogFiles('a1'));
      rewrite(A_LOG, 'this run\n');

      jest.advanceTimersByTime(2000);

      expect(getRegisteredLogFile('a1')).toBe(A_LOG);
    });

    it('never claims a file another instance has registered', () => {
      detectAndRegisterLogFile('b2', snapshotLogFiles('b2'));
      write(SHARED_LOG, 'b2 starting\n');
      jest.advanceTimersByTime(2000);
      detectAndRegisterLogFile('a1', snapshotLogFiles('a1'));
      write(SHARED_LOG, 'b2 still going\n');

      jest.advanceTimersByTime(40000);

      expect(getRegisteredLogFile('b2')).toBe(SHARED_LOG);
      expect(getRegisteredLogFile('a1')).toBeNull();
    });

    // A server that exits within the detection window used to have its old retries re-register a
    // path afterwards, which then blocked other instances from claiming the shared log.
    it('stops retrying once the instance is unregistered', () => {
      detectAndRegisterLogFile('a1', snapshotLogFiles('a1'));
      jest.advanceTimersByTime(5000);

      unregisterLogFile('a1');
      expect(jest.getTimerCount()).toBe(0);
      write(A_LOG, 'late\n');
      jest.advanceTimersByTime(40000);

      expect(getRegisteredLogFile('a1')).toBeNull();
    });
  });

  describe('setupLogTailing', () => {
    it('streams new lines and reports the server running on the advertising line', () => {
      const { onLog, onState } = start('a1', A_LOG);
      setInstanceState('a1', 'starting');

      write(A_LOG, 'Loading map\nServer has completed startup and is now advertising for join.\n');
      poll();

      expect(logged(onLog)).toEqual(['Loading map', 'Server has completed startup and is now advertising for join.']);
      expect(onState).toHaveBeenCalledWith('running');
      expect(getInstanceState('a1')).toBe('running');
    });

    // A stop requested during startup used to be overwritten with 'running' by the late advertising
    // line, and the exit that followed was then reported as a crash.
    it('does not report a server that is already stopping as running', () => {
      const { onState } = start('a1', A_LOG);
      setInstanceState('a1', 'stopping');

      write(A_LOG, 'Server has completed startup and is now advertising for join.\n');
      poll();

      expect(onState).not.toHaveBeenCalledWith('running');
      expect(getInstanceState('a1')).toBe('stopping');
    });

    it('reports stopping on a shutdown line', () => {
      const { onState } = start('a1', A_LOG);

      write(A_LOG, 'Server shutting down\n');
      poll();

      expect(onState).toHaveBeenCalledWith('stopping');
    });

    it('reports stopping on the shutdown line as ARK writes it, after its time and frame', () => {
      const { onState } = start('a1', A_LOG);

      write(A_LOG, '[2026.09.11-22.33.00:824][837]Closing by request\n');
      poll();

      expect(onState).toHaveBeenCalledWith('stopping');
    });

    // Chat is logged too; a player typing the words must not make a later crash read as a stop.
    it('ignores the shutdown words inside another line, such as chat', () => {
      const { onState } = start('a1', A_LOG);

      write(A_LOG, [
        '[2026.09.11-22.30.00:000][500]2026.09.11_22.30.00: Bob (Tribe): Server shutting down',
        '[2026.09.11-22.30.01:000][501]2026.09.11_22.30.01: Bob (Tribe): Closing by request lol',
        ''
      ].join('\n'));
      poll();

      expect(onState).not.toHaveBeenCalledWith('stopping');
    });

    // Lines arrive in whatever pieces ARK flushed; a split advertising line used to leave the
    // state stuck at starting until the 15-minute fallback.
    it('reassembles a line split across two reads', () => {
      const { onLog, onState } = start('a1', A_LOG);
      setInstanceState('a1', 'starting');

      write(A_LOG, 'Server has completed startup and is now adver');
      poll();
      expect(logged(onLog)).toEqual([]);

      write(A_LOG, 'tising for join.\r\n');
      poll();

      expect(logged(onLog)).toEqual(['Server has completed startup and is now advertising for join.']);
      expect(onState).toHaveBeenCalledWith('running');
    });

    it('reassembles a character split across two reads', () => {
      const { onLog } = start('a1', A_LOG);
      const name = `Zo${String.fromCharCode(0xeb)}`;
      const line = Buffer.from(`Player ${name} joined\n`);
      const split = line.indexOf(Buffer.from(name)) + name.length;

      write(A_LOG, line.subarray(0, split));
      poll();
      write(A_LOG, line.subarray(split));
      poll();

      expect(logged(onLog)).toEqual([`Player ${name} joined`]);
    });

    // Each start used to add a tailer that never stopped. On Proton the log is rewritten in place,
    // so the stale tailer saw the truncation and replayed the new run's lines a second time.
    it('does not duplicate lines after a restart', () => {
      const first = start('a1', A_LOG);
      rewrite(A_LOG, 'Log file open\n');
      const second = start('a1', A_LOG);
      jest.advanceTimersByTime(1000);

      write(A_LOG, 'second run line\n');
      poll();
      poll();

      expect(logged(first.onLog)).not.toContain('second run line');
      expect(logged(second.onLog)).toEqual(['second run line']);
    });

    it('starts over when the file is rewritten in place', () => {
      const { onLog } = start('a1', A_LOG);
      write(A_LOG, 'first run\n');
      poll();

      rewrite(A_LOG, 'new\n');
      poll();

      expect(logged(onLog)).toEqual(['first run', 'new']);
    });

    it('never falls back to another instance\'s log', () => {
      detectAndRegisterLogFile('b2', snapshotLogFiles('b2'));
      write(B_LOG, 'b2 starting\n');
      jest.advanceTimersByTime(2000);
      const onLog = jest.fn();
      detectAndRegisterLogFile('a1', snapshotLogFiles('a1'));
      setupLogTailing('a1', onLog);

      write(B_LOG, 'b2 line\n');
      jest.advanceTimersByTime(61000);

      expect(onLog).not.toHaveBeenCalledWith('b2 line');
      expect(onLog).toHaveBeenCalledWith('[WARN] Still waiting for this server to write its log file');
    });

    // A server new to a machine (a move, a fresh Proton prefix) can take minutes to write its log.
    // After the first minute it was never tailed: no lines, and starting until the 15-minute net.
    it('keeps looking for a log that is slow to appear, and follows it when it does', () => {
      const onLog = jest.fn();
      setInstanceState('a1', 'starting');
      const onState = jest.fn();
      detectAndRegisterLogFile('a1', snapshotLogFiles('a1'));
      setupLogTailing('a1', onLog, onState);

      jest.advanceTimersByTime(3 * 60_000);
      write(A_LOG, 'Log file open\n');
      jest.advanceTimersByTime(10_000);
      write(A_LOG, 'Server has completed startup and is now advertising for join.\n');
      poll();

      expect(onLog).toHaveBeenCalledWith('[WARN] Still waiting for this server to write its log file');
      expect(onLog).toHaveBeenCalledWith('Server has completed startup and is now advertising for join.');
      expect(getInstanceState('a1')).toBe('running');
    });

    it('stops looking for the file once unregistered', () => {
      const onLog = jest.fn();
      detectAndRegisterLogFile('a1', snapshotLogFiles('a1'));
      setupLogTailing('a1', onLog);

      unregisterLogFile('a1');
      write(A_LOG, 'late\n');
      jest.advanceTimersByTime(61000);

      expect(onLog).not.toHaveBeenCalled();
      expect(fs.watch).not.toHaveBeenCalled();
    });

    it('emits what the server wrote before it exited, then stops', () => {
      const { onLog } = start('a1', A_LOG);

      write(A_LOG, 'Fatal error!\npartial');
      unregisterLogFile('a1');
      write(A_LOG, ' more\nafter exit\n');
      poll();

      expect(logged(onLog)).toEqual(['Fatal error!', 'partial']);
      const watcher = (fs.watch as jest.Mock).mock.results[0].value;
      expect(watcher.close).toHaveBeenCalled();
    });

    it('does not report a server that exited as running from its last lines', () => {
      const { onState } = start('a1', A_LOG);
      setInstanceState('a1', 'starting');

      write(A_LOG, 'Server has completed startup and is now advertising for join.\n');
      unregisterLogFile('a1');

      expect(onState).not.toHaveBeenCalledWith('running');
    });

    it('survives the file vanishing between polls', () => {
      const { onLog } = start('a1', A_LOG);

      files.delete(A_LOG);

      expect(() => poll()).not.toThrow();
      write(A_LOG, 'back\n');
      poll();
      expect(logged(onLog)).toEqual(['back']);
    });

    it('closes the descriptor when a read fails', () => {
      start('a1', A_LOG);
      (fs.readSync as jest.Mock).mockImplementationOnce(() => { throw new Error('EBUSY'); });

      write(A_LOG, 'line\n');
      poll();

      expect(openFds.size).toBe(0);
    });
  });

  describe('getInstanceLogs', () => {
    it('returns the last lines of the registered file while the server is up', () => {
      start('a1', A_LOG);
      setInstanceState('a1', 'running');
      write(A_LOG, 'one\ntwo\nthree\n');

      expect(getInstanceLogs('a1', 2)).toEqual(['two', 'three']);
    });

    it('returns nothing for a stopped server', () => {
      start('a1', A_LOG);
      setInstanceState('a1', 'stopped');

      expect(getInstanceLogs('a1')).toEqual([]);
    });

    it('returns nothing rather than another instance\'s log', () => {
      detectAndRegisterLogFile('b2', snapshotLogFiles('b2'));
      write(B_LOG, 'b2 line\n');
      jest.advanceTimersByTime(2000);
      setInstanceState('a1', 'starting');

      expect(getInstanceLogs('a1')).toEqual([]);
    });
  });

  describe('readLogTail', () => {
    it('reads only the end of a large file and drops the cut-off first line', () => {
      write(A_LOG, `${'x'.repeat(70 * 1024)}\nlast line\n`);

      expect(readLogTail(A_LOG, 5)).toEqual(['last line']);
      // The encoding sniff reads the first bytes; the tail read is the last call.
      const readCalls = (fs.readSync as jest.Mock).mock.calls;
      expect(readCalls[readCalls.length - 1][3]).toBe(64 * 1024);
    });

    it('returns nothing for a missing file', () => {
      expect(readLogTail('/nope.log', 5)).toEqual([]);
    });
  });

  describe('log encoding', () => {
    const UTF16_BOM = Buffer.from([0xff, 0xfe]);

    it('reads a UTF-16 LE log as text', () => {
      write(A_LOG, Buffer.concat([UTF16_BOM, Buffer.from('first line\r\nsecond line\r\n', 'utf16le')]));

      expect(readLogTail(A_LOG, 5)).toEqual(['first line', 'second line']);
    });

    it('drops the byte order mark of a UTF-8 log', () => {
      write(A_LOG, '\uFEFF[2026.10.04-01.02.03:004][  0]Log file open\n');

      expect(readLogTail(A_LOG, 5)).toEqual(['[2026.10.04-01.02.03:004][  0]Log file open']);
    });

    it('streams lines from a UTF-16 LE log', () => {
      detectAndRegisterLogFile('a1', snapshotLogFiles('a1'));
      write(A_LOG, Buffer.concat([UTF16_BOM, Buffer.from('Log file open\r\n', 'utf16le')]));
      const onLog = jest.fn();
      const onState = jest.fn();
      setupLogTailing('a1', onLog, onState);
      jest.advanceTimersByTime(2000);

      write(A_LOG, Buffer.from('Server has completed startup and is now advertising for join.\r\n', 'utf16le'));
      poll();

      expect(logged(onLog)).toEqual(['Server has completed startup and is now advertising for join.']);
      expect(onState).toHaveBeenCalledWith('running');
    });
  });
});
