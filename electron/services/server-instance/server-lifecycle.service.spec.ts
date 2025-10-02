import { serverLifecycleService } from './server-lifecycle.service';

// Mock all dependencies
jest.mock('child_process');
jest.mock('path');
jest.mock('fs');
jest.mock('../../utils/validation.utils');
jest.mock('../../utils/ark.utils');
jest.mock('../../utils/network.utils');
jest.mock('../../utils/platform.utils');
jest.mock('../rcon.service');
jest.mock('./server-management.service');
jest.mock('./server-process.service');
jest.mock('../../utils/ark/instance.utils');

describe('ServerLifecycleService', () => {
  let validateInstanceIdMock: any;
  let arkPathUtilsMock: any;
  let arkCommandUtilsMock: any;
  let buildArkServerArgsMock: any;
  let isPortInUseMock: any;
  let getPlatformMock: any;
  let rconServiceMock: any;
  let serverManagementServiceMock: any;
  let serverProcessServiceMock: any;
  let instanceUtilsMock: any;
  let fsMock: any;
  let execSyncMock: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mocks
    validateInstanceIdMock = jest.fn();
    jest.mocked(require('../../utils/validation.utils')).validateInstanceId = validateInstanceIdMock;

    arkPathUtilsMock = {
      getArkExecutablePath: jest.fn()
    };
    arkCommandUtilsMock = {};
    buildArkServerArgsMock = jest.fn();
    jest.mocked(require('../../utils/ark.utils')).ArkPathUtils = arkPathUtilsMock;
    jest.mocked(require('../../utils/ark.utils')).ArkCommandUtils = arkCommandUtilsMock;
    jest.mocked(require('../../utils/ark.utils')).buildArkServerArgs = buildArkServerArgsMock;

    isPortInUseMock = jest.fn();
    jest.mocked(require('../../utils/network.utils')).isPortInUse = isPortInUseMock;

    getPlatformMock = jest.fn();
    jest.mocked(require('../../utils/platform.utils')).getPlatform = getPlatformMock;

    rconServiceMock = {};
    jest.mocked(require('../rcon.service')).rconService = rconServiceMock;

    serverManagementServiceMock = {
      prepareInstanceConfiguration: jest.fn()
    };
    jest.mocked(require('./server-management.service')).serverManagementService = serverManagementServiceMock;

    serverProcessServiceMock = {
      startServerProcess: jest.fn(),
      setupProcessMonitoring: jest.fn(),
      setInstanceState: jest.fn(),
      stopServerProcess: jest.fn(),
      getNormalizedInstanceState: jest.fn()
    };
    jest.mocked(require('./server-process.service')).serverProcessService = serverProcessServiceMock;

    instanceUtilsMock = {
      getInstance: jest.fn()
    };
    jest.mocked(require('../../utils/ark/instance.utils')).getInstance = instanceUtilsMock.getInstance;

    fsMock = {
      existsSync: jest.fn()
    };
    jest.mocked(require('fs')).existsSync = fsMock.existsSync;

    execSyncMock = jest.mocked(require('child_process')).execSync;
  });

  describe('startServerInstance', () => {
    it('should start server instance successfully', async () => {
      const instanceId = 'test-instance';
      const instance = { gamePort: '7777', queryPort: '27015', rconPort: '32330' };

      validateInstanceIdMock.mockReturnValue(true);
      fsMock.existsSync.mockReturnValue(true);
      serverProcessServiceMock.getNormalizedInstanceState.mockReturnValue('stopped');
      isPortInUseMock.mockResolvedValue(false);
      serverManagementServiceMock.prepareInstanceConfiguration.mockResolvedValue(undefined);
      serverProcessServiceMock.startServerProcess.mockResolvedValue({ success: true });

      const result = await serverLifecycleService.startServerInstance(instanceId, instance);

      expect(result).toEqual({ success: true, instanceId });
      expect(serverManagementServiceMock.prepareInstanceConfiguration).toHaveBeenCalledWith(instanceId, instance);
      expect(serverProcessServiceMock.startServerProcess).toHaveBeenCalledWith(instanceId, instance);
      expect(serverProcessServiceMock.setupProcessMonitoring).toHaveBeenCalledWith(instanceId, instance, undefined, undefined);
    });

    it('should handle validation failure', async () => {
      const instanceId = 'invalid';
      const instance = {};

      validateInstanceIdMock.mockReturnValue(false);

      const result = await serverLifecycleService.startServerInstance(instanceId, instance);

      expect(result).toEqual({
        success: false,
        error: 'Invalid instance ID',
        instanceId
      });
    });

    it('should handle ARK not installed', async () => {
      const instanceId = 'test-instance';
      const instance = {};

      validateInstanceIdMock.mockReturnValue(true);
      fsMock.existsSync.mockReturnValue(false);

      const result = await serverLifecycleService.startServerInstance(instanceId, instance);

      expect(result).toEqual({
        success: false,
        error: 'ARK server is not installed',
        instanceId
      });
    });

    it('should handle instance already running', async () => {
      const instanceId = 'test-instance';
      const instance = {};

      validateInstanceIdMock.mockReturnValue(true);
      fsMock.existsSync.mockReturnValue(true);
      serverProcessServiceMock.getNormalizedInstanceState.mockReturnValue('running');

      const result = await serverLifecycleService.startServerInstance(instanceId, instance);

      expect(result).toEqual({
        success: false,
        error: 'Instance is already running or starting',
        instanceId
      });
    });

    it('should handle game port in use', async () => {
      const instanceId = 'test-instance';
      const instance = { gamePort: '7777', queryPort: '27015', rconPort: '32330' };

      validateInstanceIdMock.mockReturnValue(true);
      fsMock.existsSync.mockReturnValue(true);
      serverProcessServiceMock.getNormalizedInstanceState.mockReturnValue('stopped');
      isPortInUseMock.mockResolvedValueOnce(true);

      const result = await serverLifecycleService.startServerInstance(instanceId, instance);

      expect(result).toEqual({
        success: false,
        error: 'Game port 7777 is already in use',
        instanceId
      });
    });

    it('should handle query port in use', async () => {
      const instanceId = 'test-instance';
      const instance = { gamePort: '7777', queryPort: '27015', rconPort: '32330' };

      validateInstanceIdMock.mockReturnValue(true);
      fsMock.existsSync.mockReturnValue(true);
      serverProcessServiceMock.getNormalizedInstanceState.mockReturnValue('stopped');
      isPortInUseMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      const result = await serverLifecycleService.startServerInstance(instanceId, instance);

      expect(result).toEqual({
        success: false,
        error: 'Query port 27015 is already in use',
        instanceId
      });
    });

    it('should handle rcon port in use', async () => {
      const instanceId = 'test-instance';
      const instance = { gamePort: '7777', queryPort: '27015', rconPort: '32330' };

      validateInstanceIdMock.mockReturnValue(true);
      fsMock.existsSync.mockReturnValue(true);
      serverProcessServiceMock.getNormalizedInstanceState.mockReturnValue('stopped');
      isPortInUseMock.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      const result = await serverLifecycleService.startServerInstance(instanceId, instance);

      expect(result).toEqual({
        success: false,
        error: 'RCON port 32330 is already in use',
        instanceId
      });
    });

    it('should handle process start failure', async () => {
      const instanceId = 'test-instance';
      const instance = { gamePort: '7777', queryPort: '27015', rconPort: '32330' };

      validateInstanceIdMock.mockReturnValue(true);
      fsMock.existsSync.mockReturnValue(true);
      serverProcessServiceMock.getNormalizedInstanceState.mockReturnValue('stopped');
      isPortInUseMock.mockResolvedValue(false);
      serverManagementServiceMock.prepareInstanceConfiguration.mockResolvedValue(undefined);
      serverProcessServiceMock.startServerProcess.mockResolvedValue({ success: false, error: 'Process failed' });

      const result = await serverLifecycleService.startServerInstance(instanceId, instance);

      expect(result).toEqual({ success: false, error: 'Process failed' });
    });

    it('should handle exception', async () => {
      const instanceId = 'test-instance';
      const instance = { gamePort: '7777', queryPort: '27015', rconPort: '32330' };

      validateInstanceIdMock.mockReturnValue(true);
      fsMock.existsSync.mockReturnValue(true);
      serverProcessServiceMock.getNormalizedInstanceState.mockReturnValue('stopped');
      isPortInUseMock.mockResolvedValue(false);
      serverManagementServiceMock.prepareInstanceConfiguration.mockRejectedValue(new Error('Config failed'));

      const result = await serverLifecycleService.startServerInstance(instanceId, instance);

      expect(result).toEqual({
        success: false,
        error: 'Config failed',
        instanceId
      });
      expect(serverProcessServiceMock.setInstanceState).toHaveBeenCalledWith(instanceId, 'error');
    });
  });

  describe('stopServerInstance', () => {
    it('should stop server instance', async () => {
      const instanceId = 'test-instance';

      serverProcessServiceMock.stopServerProcess.mockResolvedValue({ success: true });

      const result = await serverLifecycleService.stopServerInstance(instanceId);

      expect(result).toEqual({ success: true });
      expect(serverProcessServiceMock.stopServerProcess).toHaveBeenCalledWith(instanceId);
    });
  });

  describe('restartServerInstance', () => {
    it('should restart server instance successfully', async () => {
      const instanceId = 'test-instance';
      const instance = { gamePort: '7777', queryPort: '27015', rconPort: '32330' };

      serverProcessServiceMock.stopServerProcess.mockResolvedValue({ success: true });
      validateInstanceIdMock.mockReturnValue(true);
      fsMock.existsSync.mockReturnValue(true);
      serverProcessServiceMock.getNormalizedInstanceState.mockReturnValue('stopped');
      isPortInUseMock.mockResolvedValue(false);
      serverManagementServiceMock.prepareInstanceConfiguration.mockResolvedValue(undefined);
      serverProcessServiceMock.startServerProcess.mockResolvedValue({ success: true });

      const result = await serverLifecycleService.restartServerInstance(instanceId, instance);

      expect(result).toEqual({ success: true, instanceId });
    });

    it('should handle stop failure', async () => {
      const instanceId = 'test-instance';
      const instance = {};

      serverProcessServiceMock.stopServerProcess.mockResolvedValue({ success: false, error: 'Stop failed' });

      const result = await serverLifecycleService.restartServerInstance(instanceId, instance);

      expect(result).toEqual({ success: false, error: 'Stop failed' });
    });

    it('should handle restart exception', async () => {
      const instanceId = 'test-instance';
      const instance = {};

      serverProcessServiceMock.stopServerProcess.mockRejectedValue(new Error('Stop error'));

      const result = await serverLifecycleService.restartServerInstance(instanceId, instance);

      expect(result).toEqual({
        success: false,
        error: 'Stop error',
        instanceId
      });
    });
  });

  describe('cleanupOrphanedArkProcesses', () => {
    it('should cleanup on Linux', () => {
      getPlatformMock.mockReturnValue('linux');

      serverLifecycleService.cleanupOrphanedArkProcesses();

      expect(execSyncMock).toHaveBeenCalledWith('pkill -f ArkAscendedServer', { stdio: 'ignore' });
      expect(execSyncMock).toHaveBeenCalledWith('pkill -f "proton.*ArkAscendedServer"', { stdio: 'ignore' });
      expect(execSyncMock).toHaveBeenCalledWith('pkill -f "Xvfb.*ArkAscendedServer"', { stdio: 'ignore' });
      expect(execSyncMock).toHaveBeenCalledWith('pkill -f "wine.*ArkAscendedServer"', { stdio: 'ignore' });
    });

    it('should cleanup on Windows', () => {
      getPlatformMock.mockReturnValue('windows');

      serverLifecycleService.cleanupOrphanedArkProcesses();

      expect(execSyncMock).toHaveBeenCalledWith('taskkill /F /IM ArkAscendedServer.exe', { stdio: 'ignore' });
    });

    it('should handle errors gracefully', () => {
      getPlatformMock.mockReturnValue('linux');
      execSyncMock.mockImplementation(() => { throw new Error('Command failed'); });

      expect(() => serverLifecycleService.cleanupOrphanedArkProcesses()).not.toThrow();
    });
  });

  describe('startArkServerInstance', () => {
    it('should start ARK server instance successfully', async () => {
      const instanceId = 'test-instance';
      const instance = { gamePort: '7777', queryPort: '27015', rconPort: '32330' };

      instanceUtilsMock.getInstance.mockReturnValue(instance);
      validateInstanceIdMock.mockReturnValue(true);
      fsMock.existsSync.mockReturnValue(true);
      serverProcessServiceMock.getNormalizedInstanceState.mockReturnValue('stopped');
      isPortInUseMock.mockResolvedValue(false);
      serverManagementServiceMock.prepareInstanceConfiguration.mockResolvedValue(undefined);
      serverProcessServiceMock.startServerProcess.mockResolvedValue({ success: true });

      const result = await serverLifecycleService.startArkServerInstance(instanceId);

      expect(result).toEqual({ started: true });
    });

    it('should handle instance not found', async () => {
      const instanceId = 'test-instance';

      instanceUtilsMock.getInstance.mockReturnValue(null);

      const result = await serverLifecycleService.startArkServerInstance(instanceId);

      expect(result).toEqual({ started: false, portError: 'Instance not found' });
    });

    it('should handle start failure', async () => {
      const instanceId = 'test-instance';
      const instance = { gamePort: '7777', queryPort: '27015', rconPort: '32330' };

      instanceUtilsMock.getInstance.mockReturnValue(instance);
      validateInstanceIdMock.mockReturnValue(true);
      fsMock.existsSync.mockReturnValue(true);
      serverProcessServiceMock.getNormalizedInstanceState.mockReturnValue('stopped');
      isPortInUseMock.mockResolvedValue(false);
      serverManagementServiceMock.prepareInstanceConfiguration.mockResolvedValue(undefined);
      serverProcessServiceMock.startServerProcess.mockResolvedValue({ success: false, error: 'Start failed' });

      const result = await serverLifecycleService.startArkServerInstance(instanceId);

      expect(result).toEqual({ started: false, portError: 'Start failed' });
    });
  });
});