


jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
  readFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  watch: jest.fn(),
}));
jest.mock('path');
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
      (fs.existsSync as jest.Mock).mockImplementation((p) => p.includes('Logs') || p.includes('config.json'));
      (fs.readFileSync as jest.Mock)
        .mockImplementation((p) => p.includes('config.json') ? JSON.stringify({ sessionName: 'TestSession' }) : 'SessionName=TestSession\nLine1\nLine2');
      (fs.readdirSync as jest.Mock).mockReturnValue(['ShooterGame.log']);
      (fs.statSync as jest.Mock).mockReturnValue({ mtimeMs: 1 });
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
      (fs.statSync as jest.Mock).mockReturnValue({ mtimeMs: 1, size: 20 });
      let logCallbackCalled = false;
      (fs.readFileSync as jest.Mock).mockReturnValue('Line1\nLine2');
      (fs.watch as jest.Mock).mockImplementation((file, cb) => {
        setTimeout(() => {
          cb('change');
          setTimeout(() => {
            expect(watcher).toHaveProperty('close');
            expect(logCallbackCalled).toBe(true);
            done();
          }, 10);
        }, 10);
        return { close: jest.fn() };
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
    it('should set up log tailing and call onLog/onState', (done) => {
  const { getArkServerDir } = require('./ark-server-install.utils');
  getArkServerDir.mockReturnValue('/ark');
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readdirSync as jest.Mock).mockReturnValue(['ShooterGame.log']);
      (fs.statSync as jest.Mock).mockReturnValue({ mtimeMs: 1 });
      (fs.readFileSync as jest.Mock).mockReturnValue('SessionName=TestSession\nServer has completed startup and is now advertising for join.');
      const onLog = jest.fn();
      const onState = jest.fn();
      logUtils.setupLogTailing('instance1', '/instance', { sessionName: 'TestSession' }, onLog, onState);
      setTimeout(() => {
        expect(onLog).toHaveBeenCalled();
        expect(onState).toHaveBeenCalledWith('running');
        done();
      }, 1100);
    });
  });
});
