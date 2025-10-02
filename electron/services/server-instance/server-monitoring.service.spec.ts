import { serverMonitoringService } from './server-monitoring.service';

// Mock all dependencies
jest.mock('../../utils/platform.utils');
jest.mock('../rcon.service');
jest.mock('../../utils/ark/ark-server/ark-server-logging.utils');
jest.mock('../../utils/ark/instance.utils');
jest.mock('../../utils/ark/ark-server/ark-server-state.utils');
jest.mock('path');
jest.mock('./server-lifecycle.service');

describe('ServerMonitoringService', () => {
  let getProcessMemoryUsageMock: any;
  let rconServiceMock: any;
  let setupLogTailingMock: any;
  let getInstanceMock: any;
  let getInstanceStateMock: any;
  let pathMock: any;
  let serverLifecycleServiceMock: any;
  let storedIntervalCallbacks: { [key: string]: Function } = {};

  // Helper to execute stored interval callbacks
  const executePollingCallbacks = async () => {
    for (const callback of Object.values(storedIntervalCallbacks)) {
      await callback();
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    storedIntervalCallbacks = {};

    // Mock setInterval to store callbacks for manual execution in tests
    jest.spyOn(global, 'setInterval').mockImplementation((cb: any, delay?: number) => {
      const id = `interval_${Object.keys(storedIntervalCallbacks).length}`;
      storedIntervalCallbacks[id] = cb;
      return id as any;
    });

    // Mock clearInterval to remove stored callbacks
    jest.spyOn(global, 'clearInterval').mockImplementation((id: any) => {
      if (storedIntervalCallbacks[id]) {
        delete storedIntervalCallbacks[id];
      }
    });

    // Setup mocks
    getProcessMemoryUsageMock = jest.fn();
    jest.mocked(require('../../utils/platform.utils')).getProcessMemoryUsage = getProcessMemoryUsageMock;

    rconServiceMock = {
      executeRconCommand: jest.fn()
    };
    jest.mocked(require('../rcon.service')).rconService = rconServiceMock;

    setupLogTailingMock = jest.fn();
    jest.mocked(require('../../utils/ark/ark-server/ark-server-logging.utils')).setupLogTailing = setupLogTailingMock;

    getInstanceMock = jest.fn();
    jest.mocked(require('../../utils/ark/instance.utils')).getInstance = getInstanceMock;
    jest.mocked(require('../../utils/ark/instance.utils')).getInstancesBaseDir = jest.fn(() => '/instances');

    getInstanceStateMock = jest.fn();
    jest.mocked(require('../../utils/ark/ark-server/ark-server-state.utils')).getInstanceState = getInstanceStateMock;

    pathMock = {
      join: jest.fn()
    };
    jest.mocked(require('path')).join = pathMock.join;

    serverLifecycleServiceMock = {
      getServerProcess: jest.fn()
    };
    jest.mocked(require('./server-lifecycle.service')).serverLifecycleService = serverLifecycleServiceMock;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getInstanceState', () => {
    it('should get instance state successfully', () => {
      getInstanceStateMock.mockReturnValue('running');

      const result = serverMonitoringService.getInstanceState('instance1');

      expect(result).toEqual({
        state: 'running',
        instanceId: 'instance1'
      });
    });

    it('should handle unknown state', () => {
      getInstanceStateMock.mockReturnValue(null);

      const result = serverMonitoringService.getInstanceState('instance1');

      expect(result).toEqual({
        state: 'unknown',
        instanceId: 'instance1'
      });
    });
  });

  describe('getInstanceLogs', () => {
    it('should get logs for running server', () => {
      getInstanceStateMock.mockReturnValue('running');
      const getInstanceLogsMock = jest.fn().mockReturnValue(['line1', 'line2']);
      jest.mocked(require('../../utils/ark/ark-server/ark-server-logging.utils')).getInstanceLogs = getInstanceLogsMock;

      const result = serverMonitoringService.getInstanceLogs('instance1', 100);

      expect(result).toEqual({
        log: 'line1\nline2',
        instanceId: 'instance1'
      });
      expect(getInstanceLogsMock).toHaveBeenCalledWith('instance1', 100);
    });

    it('should get logs for starting server', () => {
      getInstanceStateMock.mockReturnValue('starting');
      const getInstanceLogsMock = jest.fn().mockReturnValue(['starting log']);
      jest.mocked(require('../../utils/ark/ark-server/ark-server-logging.utils')).getInstanceLogs = getInstanceLogsMock;

      const result = serverMonitoringService.getInstanceLogs('instance1');

      expect(result).toEqual({
        log: 'starting log',
        instanceId: 'instance1'
      });
    });

    it('should get logs for stopping server', () => {
      getInstanceStateMock.mockReturnValue('stopping');
      const getInstanceLogsMock = jest.fn().mockReturnValue(['stopping log']);
      jest.mocked(require('../../utils/ark/ark-server/ark-server-logging.utils')).getInstanceLogs = getInstanceLogsMock;

      const result = serverMonitoringService.getInstanceLogs('instance1');

      expect(result).toEqual({
        log: 'stopping log',
        instanceId: 'instance1'
      });
    });

    it('should return empty logs for stopped server', () => {
      getInstanceStateMock.mockReturnValue('stopped');

      const result = serverMonitoringService.getInstanceLogs('instance1');

      expect(result).toEqual({
        log: '',
        instanceId: 'instance1'
      });
    });

    it('should handle exception', () => {
      getInstanceStateMock.mockReturnValue('running');
      const getInstanceLogsMock = jest.fn().mockImplementation(() => { throw new Error('Log error'); });
      jest.mocked(require('../../utils/ark/ark-server/ark-server-logging.utils')).getInstanceLogs = getInstanceLogsMock;

      const result = serverMonitoringService.getInstanceLogs('instance1');

      expect(result).toEqual({
        log: '',
        instanceId: 'instance1'
      });
    });
  });

  describe('setupLogMonitoring', () => {
    it('should setup log monitoring successfully', () => {
      const instance = { name: 'Server 1' };
      getInstanceMock.mockReturnValue(instance);
      pathMock.join.mockReturnValue('/instances/instance1');

      serverMonitoringService.setupLogMonitoring('instance1', instance, jest.fn(), jest.fn());

      expect(getInstanceMock).toHaveBeenCalledWith('instance1');
      expect(pathMock.join).toHaveBeenCalledWith('/instances', 'instance1');
      expect(setupLogTailingMock).toHaveBeenCalled();
      const callArgs = setupLogTailingMock.mock.calls[0];
      expect(callArgs[0]).toBe('instance1');
      expect(callArgs[1]).toBe('/instances/instance1');
      expect(callArgs[2]).toBe(instance);
      expect(typeof callArgs[3]).toBe('function');
      expect(typeof callArgs[4]).toBe('function');
    });

    it('should handle missing instance', () => {
      getInstanceMock.mockReturnValue(null);

      serverMonitoringService.setupLogMonitoring('instance1', {}, jest.fn(), jest.fn());

      expect(setupLogTailingMock).not.toHaveBeenCalled();
    });
  });

  describe('startPlayerPolling', () => {
    it('should start player polling', async () => {
      const callback = jest.fn();
      rconServiceMock.executeRconCommand.mockResolvedValue({
        success: true,
        response: 'There are 5 players connected'
      });

      serverMonitoringService.startPlayerPolling('instance1', callback);

      await executePollingCallbacks();

      expect(callback).toHaveBeenCalledWith('instance1', 5);
      expect(serverMonitoringService.getLatestPlayerCount('instance1')).toBe(5);
    });

    it('should not call callback if player count unchanged', async () => {
      const callback = jest.fn();
      rconServiceMock.executeRconCommand.mockResolvedValue({
        success: true,
        response: 'There are 3 players connected'
      });

      serverMonitoringService.startPlayerPolling('instance1', callback);

      // First poll
      await executePollingCallbacks();
      expect(callback).toHaveBeenCalledTimes(1);

      // Second poll with same count - should not call again
      await executePollingCallbacks();
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should handle polling errors silently', async () => {
      const callback = jest.fn();
      rconServiceMock.executeRconCommand.mockRejectedValue(new Error('RCON error'));

      serverMonitoringService.startPlayerPolling('instance1', callback);

      // Should not throw
      await executePollingCallbacks();

      expect(callback).not.toHaveBeenCalled();
    });

    it('should clear existing polling when starting new', async () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      serverMonitoringService.startPlayerPolling('instance1', callback1);
      serverMonitoringService.startPlayerPolling('instance1', callback2);

      rconServiceMock.executeRconCommand.mockResolvedValue({
        success: true,
        response: 'There are 2 players connected'
      });

      await executePollingCallbacks();

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledWith('instance1', 2);
    });
  });

  describe('stopPlayerPolling', () => {
    it('should stop player polling', () => {
      const callback = jest.fn();
      serverMonitoringService.startPlayerPolling('instance1', callback);

      serverMonitoringService.stopPlayerPolling('instance1');

      rconServiceMock.executeRconCommand.mockResolvedValue({
        success: true,
        response: 'There are 1 players connected'
      });

      jest.advanceTimersByTime(30000);

      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle stopping non-existent polling', () => {
      // Should not throw
      serverMonitoringService.stopPlayerPolling('nonexistent');
    });
  });

  describe('startMemoryPolling', () => {
    it('should start memory polling', async () => {
      const callback = jest.fn();
      const mockProcess = { pid: 123 };
      serverLifecycleServiceMock.getServerProcess.mockReturnValue(mockProcess);
      getProcessMemoryUsageMock.mockReturnValue(512);

      serverMonitoringService.startMemoryPolling('instance1', callback);

      await executePollingCallbacks();

      expect(callback).toHaveBeenCalledWith('instance1', 512);
      expect(serverLifecycleServiceMock.getServerProcess).toHaveBeenCalledWith('instance1');
      expect(getProcessMemoryUsageMock).toHaveBeenCalledWith(123);
    });

    it('should handle no process found', async () => {
      const callback = jest.fn();
      serverLifecycleServiceMock.getServerProcess.mockReturnValue(null);

      serverMonitoringService.startMemoryPolling('instance1', callback);

      await executePollingCallbacks();

      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle process without pid', async () => {
      const callback = jest.fn();
      serverLifecycleServiceMock.getServerProcess.mockReturnValue({});

      serverMonitoringService.startMemoryPolling('instance1', callback);

      await executePollingCallbacks();

      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle memory usage null', async () => {
      const callback = jest.fn();
      const mockProcess = { pid: 123 };
      serverLifecycleServiceMock.getServerProcess.mockReturnValue(mockProcess);
      getProcessMemoryUsageMock.mockReturnValue(null);

      serverMonitoringService.startMemoryPolling('instance1', callback);

      await executePollingCallbacks();

      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle polling errors silently', async () => {
      const callback = jest.fn();
      serverLifecycleServiceMock.getServerProcess.mockImplementation(() => { throw new Error('Process error'); });

      serverMonitoringService.startMemoryPolling('instance1', callback);

      // Should not throw
      await executePollingCallbacks();

      expect(callback).not.toHaveBeenCalled();
    });

    it('should clear existing polling when starting new', async () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      serverMonitoringService.startMemoryPolling('instance1', callback1);
      serverMonitoringService.startMemoryPolling('instance1', callback2);

      const mockProcess = { pid: 456 };
      serverLifecycleServiceMock.getServerProcess.mockReturnValue(mockProcess);
      getProcessMemoryUsageMock.mockReturnValue(256);

      await executePollingCallbacks();

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledWith('instance1', 256);
    });
  });

  describe('stopMemoryPolling', () => {
    it('should stop memory polling', () => {
      const callback = jest.fn();
      serverMonitoringService.startMemoryPolling('instance1', callback);

      serverMonitoringService.stopMemoryPolling('instance1');

      const mockProcess = { pid: 123 };
      serverLifecycleServiceMock.getServerProcess.mockReturnValue(mockProcess);
      getProcessMemoryUsageMock.mockReturnValue(512);

      jest.advanceTimersByTime(60000);

      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle stopping non-existent polling', () => {
      // Should not throw
      serverMonitoringService.stopMemoryPolling('nonexistent');
    });
  });

  describe('getPlayerCountFromRcon', () => {
    it('should parse standard player count format', async () => {
      rconServiceMock.executeRconCommand.mockResolvedValue({
        success: true,
        response: 'There are 7 players connected'
      });

      const result = await serverMonitoringService.getPlayerCountFromRcon('instance1');

      expect(result).toBe(7);
    });

    it('should parse alternative player count format', async () => {
      rconServiceMock.executeRconCommand.mockResolvedValue({
        success: true,
        response: 'There are 3 of a max 10 players connected'
      });

      const result = await serverMonitoringService.getPlayerCountFromRcon('instance1');

      expect(result).toBe(3);
    });

    it('should parse player list format', async () => {
      rconServiceMock.executeRconCommand.mockResolvedValue({
        success: true,
        response: '1. PlayerOne\n2. PlayerTwo\n3. PlayerThree\nSome other text'
      });

      const result = await serverMonitoringService.getPlayerCountFromRcon('instance1');

      expect(result).toBe(3);
    });

    it('should return 0 for no players connected', async () => {
      rconServiceMock.executeRconCommand.mockResolvedValue({
        success: true,
        response: 'No Players Connected'
      });

      const result = await serverMonitoringService.getPlayerCountFromRcon('instance1');

      expect(result).toBe(0);
    });

    it('should return 0 when unable to parse', async () => {
      rconServiceMock.executeRconCommand.mockResolvedValue({
        success: true,
        response: 'Some unparseable response'
      });

      const result = await serverMonitoringService.getPlayerCountFromRcon('instance1');

      expect(result).toBe(0);
    });

    it('should return null on command failure', async () => {
      rconServiceMock.executeRconCommand.mockResolvedValue({
        success: false
      });

      const result = await serverMonitoringService.getPlayerCountFromRcon('instance1');

      expect(result).toBeNull();
    });

    it('should return null on exception', async () => {
      rconServiceMock.executeRconCommand.mockRejectedValue(new Error('RCON error'));

      const result = await serverMonitoringService.getPlayerCountFromRcon('instance1');

      expect(result).toBeNull();
    });
  });

  describe('getLatestPlayerCount', () => {
    it('should return stored player count', () => {
      serverMonitoringService.updatePlayerCount('instance1', 5);

      const result = serverMonitoringService.getLatestPlayerCount('instance1');

      expect(result).toBe(5);
    });

    it('should return 0 for unknown instance', () => {
      const result = serverMonitoringService.getLatestPlayerCount('unknown');

      expect(result).toBe(0);
    });
  });

  describe('getPlayerCount', () => {
    it('should return player count result', () => {
      serverMonitoringService.updatePlayerCount('instance1', 8);

      const result = serverMonitoringService.getPlayerCount('instance1');

      expect(result).toEqual({
        instanceId: 'instance1',
        players: 8
      });
    });
  });

  describe('updatePlayerCount', () => {
    it('should update player count', () => {
      serverMonitoringService.updatePlayerCount('instance1', 12);

      expect(serverMonitoringService.getLatestPlayerCount('instance1')).toBe(12);
    });
  });
});