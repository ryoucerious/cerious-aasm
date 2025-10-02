import { cleanupAllArkServers, cleanupOrphanedArkProcesses } from './ark-server-cleanup.utils';
import { getPlatform } from '../../platform.utils';
import { arkServerProcesses } from './ark-server-state.utils';

jest.mock('../../platform.utils');
jest.mock('child_process', () => ({
  execSync: jest.fn(),
  spawn: jest.fn(() => ({
    on: jest.fn(),
    kill: jest.fn(),
    pid: 1234,
    killed: false
  }))
}));

const mockExecSync = require('child_process').execSync;
const mockSpawn = require('child_process').spawn;

function createMockProcess(pid = 1234, killed = false) {
  return {
    pid,
    killed,
    kill: jest.fn(),
    on: jest.fn()
  };
}

describe('ark-server-cleanup.utils', () => {
  let platformSpy: jest.SpyInstance<string>;
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(arkServerProcesses).forEach(key => delete arkServerProcesses[key]);
    platformSpy = jest.spyOn(require('../../platform.utils'), 'getPlatform');
  });

  function createChildProcessMock(pid = 1234, killed = false) {
    return {
      pid,
      killed,
      kill: jest.fn(),
      on: jest.fn(),
      stdin: null,
      stdout: null,
      stderr: null,
      stdio: [],
      exitCode: null,
      signalCode: null,
      connected: true,
      spawnargs: [],
      spawnfile: '',
      send: jest.fn(),
      disconnect: jest.fn(),
      unref: jest.fn(),
      ref: jest.fn(),
      addListener: jest.fn(),
      emit: jest.fn(),
      once: jest.fn(),
      prependListener: jest.fn(),
      prependOnceListener: jest.fn(),
      removeAllListeners: jest.fn(),
      removeListener: jest.fn(),
      listeners: jest.fn(),
      eventNames: jest.fn(),
      getMaxListeners: jest.fn(),
      setMaxListeners: jest.fn(),
    };
  }

  describe('cleanupAllArkServers', () => {
    it('should kill all processes on Windows', () => {
    platformSpy.mockReturnValue('windows');
    const proc1 = createChildProcessMock(111, false) as any;
    const proc2 = createChildProcessMock(222, false) as any;
    arkServerProcesses['inst1'] = proc1;
    arkServerProcesses['inst2'] = proc2;
    cleanupAllArkServers();
    expect(proc1.kill).toHaveBeenCalledWith('SIGTERM');
    expect(proc2.kill).toHaveBeenCalledWith('SIGTERM');
    expect(Object.keys(arkServerProcesses).length).toBe(0);
    });

    it('should kill all processes and process groups on Linux', () => {
  platformSpy.mockReturnValue('linux');
  arkServerProcesses['inst1'] = createChildProcessMock(111, false) as any;
      cleanupAllArkServers();
      expect(Object.keys(arkServerProcesses).length).toBe(0);
      expect(mockExecSync).toHaveBeenCalledWith('pkill -f ArkAscendedServer', { stdio: 'ignore' });
      expect(mockExecSync).toHaveBeenCalledWith('pkill -f "proton.*ArkAscendedServer"', { stdio: 'ignore' });
      expect(mockExecSync).toHaveBeenCalledWith('pkill -f "Xvfb.*ArkAscendedServer"', { stdio: 'ignore' });
    });

    it('should handle errors gracefully', () => {
  platformSpy.mockReturnValue('windows');
  const proc = createChildProcessMock(111, false);
  proc.kill.mockImplementation(() => { throw new Error('fail'); });
  arkServerProcesses['inst1'] = proc as any;
      expect(() => cleanupAllArkServers()).not.toThrow();
    });
  });

  describe('cleanupOrphanedArkProcesses', () => {
    it('should cleanup orphaned processes on Linux', () => {
  platformSpy.mockReturnValue('linux');
      cleanupOrphanedArkProcesses();
      expect(mockExecSync).toHaveBeenCalledWith('pkill -f ArkAscendedServer', { stdio: 'ignore' });
      expect(mockExecSync).toHaveBeenCalledWith('pkill -f "proton.*ArkAscendedServer"', { stdio: 'ignore' });
      expect(mockExecSync).toHaveBeenCalledWith('pkill -f "Xvfb.*ArkAscendedServer"', { stdio: 'ignore' });
      expect(mockExecSync).toHaveBeenCalledWith('pkill -f "wine.*ArkAscendedServer"', { stdio: 'ignore' });
    });

    it('should cleanup orphaned processes on Windows', () => {
  platformSpy.mockReturnValue('windows');
      cleanupOrphanedArkProcesses();
      expect(mockExecSync).toHaveBeenCalledWith('taskkill /F /IM ArkAscendedServer.exe', { stdio: 'ignore' });
    });

    it('should handle errors gracefully', () => {
  platformSpy.mockReturnValue('windows');
      mockExecSync.mockImplementation(() => { throw new Error('fail'); });
      expect(() => cleanupOrphanedArkProcesses()).not.toThrow();
    });
  });
});
