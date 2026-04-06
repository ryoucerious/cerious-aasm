


jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
  readFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  watch: jest.fn(),
  openSync: jest.fn().mockReturnValue(42),
  readSync: jest.fn(),
  closeSync: jest.fn(),
}));
jest.mock('path', () => ({
  join: (...args: string[]) => args.filter(Boolean).join('/'),
  basename: (p: string) => (p || '').split('/').pop() || '',
  dirname: (p: string) => (p || '').split('/').slice(0, -1).join('/') || '.',
  extname: (p: string) => { const b = (p || '').split('/').pop() || ''; const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; },
}));
jest.mock('./ark-server-install.utils', () => ({ getArkServerDir: jest.fn() }));
jest.mock('../../ark/instance.utils', () => ({ getDefaultInstancesBaseDir: jest.fn() }));
jest.mock('./ark-server-state.utils', () => ({ getInstanceState: jest.fn(), setInstanceState: jest.fn() }));

const fs = require('fs');
const logUtils = require('./ark-server-logging.utils');

describe('ark-server-logging.utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getInstanceLogs', () => {
    it('should return last N lines from log file', () => {
      // Mock state and config
  const { getInstanceState } = require('./ark-server-state.utils');
  const { getDefaultInstancesBaseDir } = require('../../ark/instance.utils');
  const { getArkServerDir } = require('./ark-server-install.utils');
  getInstanceState.mockReturnValue('running');
  getDefaultInstancesBaseDir.mockReturnValue('/instances');
  getArkServerDir.mockReturnValue('/ark');
      const logContent = 'SessionName=TestSession\nLine1\nLine2';
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => p.includes('Logs') || p.includes('config.json'));
      (fs.readFileSync as jest.Mock)
        .mockImplementation((p: string) => p.includes('config.json') ? JSON.stringify({ sessionName: 'TestSession' }) : logContent);
      (fs.readdirSync as jest.Mock).mockReturnValue(['ShooterGame.log']);
      (fs.statSync as jest.Mock).mockReturnValue({ mtimeMs: 1, size: Buffer.byteLength(logContent) });
      (fs.openSync as jest.Mock).mockReturnValue(42);
      (fs.readSync as jest.Mock).mockImplementation((_fd: number, buf: Buffer) => {
        buf.write(logContent);
        return logContent.length;
      });
      (fs.closeSync as jest.Mock).mockImplementation(() => {});
      const result = logUtils.getInstanceLogs('instance1', 2);
      expect(result).toEqual(['Line1', 'Line2']);
    });
    it('should return empty array if not running', () => {
  const { getInstanceState } = require('./ark-server-state.utils');
  getInstanceState.mockReturnValue('stopped');
      const result = logUtils.getInstanceLogs('instance1');
      expect(result).toEqual([]);
    });
    it('should return empty array if no log file found', () => {
  const { getInstanceState } = require('./ark-server-state.utils');
  const { getDefaultInstancesBaseDir } = require('../../ark/instance.utils');
  const { getArkServerDir } = require('./ark-server-install.utils');
  getInstanceState.mockReturnValue('running');
  getDefaultInstancesBaseDir.mockReturnValue('/instances');
  getArkServerDir.mockReturnValue('/ark');
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const result = logUtils.getInstanceLogs('instance1');
      expect(result).toEqual([]);
    });
  });

  describe('startArkLogTailing', () => {
    it('should attach watcher and call onLog for new lines', (done) => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readdirSync as jest.Mock).mockReturnValue(['ShooterGame.log']);
      // First call returns initial size (position set to 20), subsequent calls return grown size (40)
      let statCallCount = 0;
      (fs.statSync as jest.Mock).mockImplementation(() => {
        statCallCount++;
        return { mtimeMs: 1, size: statCallCount <= 2 ? 20 : 40 };
      });
      const newContent = 'Line1\nLine2\n';
      (fs.openSync as jest.Mock).mockReturnValue(42);
      (fs.readSync as jest.Mock).mockImplementation((_fd: number, buf: Buffer) => {
        buf.write(newContent);
        return newContent.length;
      });
      (fs.closeSync as jest.Mock).mockImplementation(() => {});
      let logCallbackCalled = false;
      (fs.watch as jest.Mock).mockImplementation((_file: string, cb: Function) => {
        setTimeout(() => {
          cb('change');
          setTimeout(() => {
            expect(watcher).toHaveProperty('close');
            expect(logCallbackCalled).toBe(true);
            done();
          }, 50);
        }, 50);
        return { close: jest.fn(), on: jest.fn() };
      });
      const watcher = logUtils.startArkLogTailing('/instance', () => { logCallbackCalled = true; });
    });
  });

  describe('cleanupOldLogFiles', () => {
    it('should delete log files containing session name', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readdirSync as jest.Mock).mockReturnValue(['ShooterGame.log']);
      (fs.readFileSync as jest.Mock).mockReturnValue('SessionName=TestSession\nServer has completed startup');
      const unlinkMock = jest.fn();
      (fs.unlinkSync as jest.Mock) = unlinkMock;
      logUtils.cleanupOldLogFiles({ sessionName: 'TestSession' }, undefined);
      expect(unlinkMock).toHaveBeenCalled();
    });
    it('should not delete log files without session name', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readdirSync as jest.Mock).mockReturnValue(['ShooterGame.log']);
      (fs.readFileSync as jest.Mock).mockReturnValue('OtherSession\nNo startup');
      const unlinkMock = jest.fn();
      (fs.unlinkSync as jest.Mock) = unlinkMock;
      logUtils.cleanupOldLogFiles({ sessionName: 'TestSession' }, undefined);
      expect(unlinkMock).not.toHaveBeenCalled();
    });
  });

  describe('setupLogTailing', () => {
    it('should set up log tailing and call onLog/onState', async () => {
      const { getArkServerDir } = require('./ark-server-install.utils');
      getArkServerDir.mockReturnValue('/ark');
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readdirSync as jest.Mock).mockReturnValue(['ShooterGame.log']);
      const logContent = 'Server has completed startup and is now advertising for join.\n';
      let statCallCount = 0;
      (fs.statSync as jest.Mock).mockImplementation(() => {
        statCallCount++;
        // Calls 1-2: detectAndRegisterLogFile/tryAttachWatcher initial position reads → size 0
        // Calls 3+: readNewContent after watch fires → full size
        return { mtimeMs: 2, size: statCallCount <= 2 ? 0 : Buffer.byteLength(logContent) };
      });
      (fs.readFileSync as jest.Mock).mockReturnValue('SessionName=TestSession');
      (fs.openSync as jest.Mock).mockReturnValue(42);
      (fs.readSync as jest.Mock).mockImplementation((_fd: number, buf: Buffer) => {
        buf.write(logContent);
        return Buffer.byteLength(logContent);
      });
      (fs.closeSync as jest.Mock).mockImplementation(() => {});
      (fs.watch as jest.Mock).mockImplementation((_file: string, cb: Function) => {
        setImmediate(() => cb('change'));
        return { close: jest.fn(), on: jest.fn() };
      });
      const onLog = jest.fn();
      const onState = jest.fn();

      jest.useFakeTimers({ doNotFake: ['setImmediate', 'queueMicrotask'] });

      // Step 1: Register the log file via detectAndRegisterLogFile (with empty snapshot so file appears new)
      logUtils.detectAndRegisterLogFile('instance1', 'TestSession', new Map(), 1);
      // Advance past detectAndRegisterLogFile delay (2000ms)
      jest.advanceTimersByTime(2000);

      // Step 2: Now call setupLogTailing - it will find the registered log file
      logUtils.setupLogTailing('instance1', '/instance', { sessionName: 'TestSession' }, onLog, onState);
      // Advance past setupLogTailing initial delay (1000ms) to trigger trySetupTailing
      jest.advanceTimersByTime(1000);

      // Restore real timers and let setImmediate (watch callback) fire
      jest.useRealTimers();
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(onLog).toHaveBeenCalled();
      expect(onState).toHaveBeenCalledWith('running');

      // Cleanup
      logUtils.unregisterLogFile('instance1');
    });
  });
});
