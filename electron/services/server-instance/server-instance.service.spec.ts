import { serverInstanceService } from './server-instance.service';

// Mock all dependencies
jest.mock('child_process');
jest.mock('../../utils/ark/instance.utils');
jest.mock('../../utils/validation.utils');
jest.mock('../automation/automation.service');
jest.mock('../rcon.service');
jest.mock('../../utils/platform.utils');
jest.mock('../messaging.service');
jest.mock('./server-lifecycle.service');
jest.mock('./server-monitoring.service');
jest.mock('./server-management.service');
jest.mock('./server-operations.service');
jest.mock('./server-process.service');
jest.mock('fs');
jest.mock('path');
jest.mock('os');

describe('ServerInstanceService', () => {
  let messagingServiceMock: any;
  let serverLifecycleServiceMock: any;
  let serverMonitoringServiceMock: any;
  let serverManagementServiceMock: any;
  let automationServiceMock: any;
  let rconServiceMock: any;
  let instanceUtilsMock: any;
  let validateInstanceIdMock: any;
  let getPlatformMock: any;
  let serverOperationsServiceMock: any;
  let serverProcessServiceMock: any;
  let fsMock: any;
  let pathMock: any;
  let osMock: any;
  let processKillSpy: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock setTimeout to execute immediately for testing
    jest.spyOn(global, 'setTimeout').mockImplementation((cb: any) => cb());

    // Setup mocks
    messagingServiceMock = {
      sendToAll: jest.fn()
    };
    jest.mocked(require('../messaging.service')).messagingService = messagingServiceMock;

    serverLifecycleServiceMock = {
      startArkServerInstance: jest.fn()
    };
    jest.mocked(require('./server-lifecycle.service')).serverLifecycleService = serverLifecycleServiceMock;

    serverMonitoringServiceMock = {
      startMemoryPolling: jest.fn((instanceId, callback) => callback(instanceId, 100)),
      startPlayerPolling: jest.fn((instanceId, callback) => callback(instanceId, 5)),
      stopMemoryPolling: jest.fn(),
      stopPlayerPolling: jest.fn()
    };
    jest.mocked(require('./server-monitoring.service')).serverMonitoringService = serverMonitoringServiceMock;

    serverManagementServiceMock = {
      getAllInstances: jest.fn(),
      importFromBackup: jest.fn()
    };
    jest.mocked(require('./server-management.service')).serverManagementService = serverManagementServiceMock;

    automationServiceMock = {
      setManuallyStopped: jest.fn()
    };
    jest.mocked(require('../automation/automation.service')).automationService = automationServiceMock;

    rconServiceMock = {
      forceDisconnectRcon: jest.fn()
    };
    jest.mocked(require('../rcon.service')).rconService = rconServiceMock;

    instanceUtilsMock = {
      getInstance: jest.fn()
    };
    jest.mocked(require('../../utils/ark/instance.utils')).getInstance = instanceUtilsMock.getInstance;

    validateInstanceIdMock = jest.fn();
    jest.mocked(require('../../utils/validation.utils')).validateInstanceId = validateInstanceIdMock;

    getPlatformMock = jest.fn();
    jest.mocked(require('../../utils/platform.utils')).getPlatform = getPlatformMock;

    serverOperationsServiceMock = {
      connectRcon: jest.fn()
    };
    jest.mocked(require('./server-operations.service')).serverOperationsService = serverOperationsServiceMock;

    serverProcessServiceMock = {
      getServerProcess: jest.fn(),
      setInstanceState: jest.fn()
    };
    jest.mocked(require('./server-process.service')).serverProcessService = serverProcessServiceMock;

    fsMock = {
      writeFileSync: jest.fn(),
      unlinkSync: jest.fn()
    };
    jest.mocked(require('fs')).writeFileSync = fsMock.writeFileSync;
    jest.mocked(require('fs')).unlinkSync = fsMock.unlinkSync;

    pathMock = {
      join: jest.fn()
    };
    jest.mocked(require('path')).join = pathMock.join;

    osMock = {
      tmpdir: jest.fn()
    };
    jest.mocked(require('os')).tmpdir = osMock.tmpdir;

    processKillSpy = jest.spyOn(process, 'kill').mockReturnValue(true);
  });

  afterEach(() => {
    jest.useRealTimers();
    processKillSpy.mockRestore();
    (jest.spyOn(global, 'setTimeout') as any).mockRestore();
  });

  describe('getStandardEventCallbacks', () => {
    it('should return standard event callbacks', () => {
      const instanceId = 'test-instance';
      const callbacks = serverInstanceService.getStandardEventCallbacks(instanceId);

      expect(callbacks.onLog).toBeDefined();
      expect(callbacks.onState).toBeDefined();
      expect(typeof callbacks.onLog).toBe('function');
      expect(typeof callbacks.onState).toBe('function');
    });

    it('should call messagingService.sendToAll for onLog', () => {
      const instanceId = 'test-instance';
      const callbacks = serverInstanceService.getStandardEventCallbacks(instanceId);

      const log = 'test log';
      callbacks.onLog(log);

      expect(messagingServiceMock.sendToAll).toHaveBeenCalledWith('server-instance-log', { log, instanceId });
    });

    it('should handle onState running', async () => {
      const instanceId = 'test-instance';
      const callbacks = serverInstanceService.getStandardEventCallbacks(instanceId);

      serverManagementServiceMock.getAllInstances.mockResolvedValue({ instances: [] });
      serverOperationsServiceMock.connectRcon.mockResolvedValue({ success: true, connected: true });

      await callbacks.onState('running');

      expect(messagingServiceMock.sendToAll).toHaveBeenCalledWith('server-instance-state', { state: 'running', instanceId });
      expect(serverMonitoringServiceMock.startMemoryPolling).toHaveBeenCalled();
      expect(serverMonitoringServiceMock.startPlayerPolling).toHaveBeenCalled();
      expect(messagingServiceMock.sendToAll).toHaveBeenCalledWith('server-instance-memory', { instanceId, memory: 100 });
      expect(messagingServiceMock.sendToAll).toHaveBeenCalledWith('server-instance-players', { instanceId, count: 5 });
      expect(serverOperationsServiceMock.connectRcon).toHaveBeenCalledWith(instanceId);
      expect(messagingServiceMock.sendToAll).toHaveBeenCalledWith('rcon-status', { instanceId, connected: true });
    });

    it('should handle onState not running', async () => {
      const instanceId = 'test-instance';
      const callbacks = serverInstanceService.getStandardEventCallbacks(instanceId);

      serverManagementServiceMock.getAllInstances.mockResolvedValue({ instances: [] });

      await callbacks.onState('stopped');

      expect(serverMonitoringServiceMock.stopMemoryPolling).toHaveBeenCalledWith(instanceId);
      expect(serverMonitoringServiceMock.stopPlayerPolling).toHaveBeenCalledWith(instanceId);
    });

    it('should handle RCON connection failure', async () => {
      const instanceId = 'test-instance';
      const callbacks = serverInstanceService.getStandardEventCallbacks(instanceId);

      serverManagementServiceMock.getAllInstances.mockResolvedValue({ instances: [] });
      serverOperationsServiceMock.connectRcon.mockResolvedValue({ success: false, connected: false, error: 'connection failed' });

      await callbacks.onState('running');

      expect(messagingServiceMock.sendToAll).toHaveBeenCalledWith('server-instance-state', { state: 'running', instanceId });
      expect(serverMonitoringServiceMock.startMemoryPolling).toHaveBeenCalled();
      expect(serverMonitoringServiceMock.startPlayerPolling).toHaveBeenCalled();
      expect(serverOperationsServiceMock.connectRcon).toHaveBeenCalledWith(instanceId);
      expect(messagingServiceMock.sendToAll).toHaveBeenCalledWith('rcon-status', { instanceId, connected: false });
    });

    it('should handle RCON connection error', async () => {
      const instanceId = 'test-instance';
      const callbacks = serverInstanceService.getStandardEventCallbacks(instanceId);

      serverManagementServiceMock.getAllInstances.mockResolvedValue({ instances: [] });
      serverOperationsServiceMock.connectRcon.mockRejectedValue(new Error('connection error'));

      await callbacks.onState('running');

      expect(messagingServiceMock.sendToAll).toHaveBeenCalledWith('server-instance-state', { state: 'running', instanceId });
      expect(serverMonitoringServiceMock.startMemoryPolling).toHaveBeenCalled();
      expect(serverMonitoringServiceMock.startPlayerPolling).toHaveBeenCalled();
      expect(serverOperationsServiceMock.connectRcon).toHaveBeenCalledWith(instanceId);
      expect(messagingServiceMock.sendToAll).toHaveBeenCalledWith('rcon-status', { instanceId, connected: false });
    });
  });

  describe('startServerInstance', () => {
    it('should start server instance successfully', async () => {
      const instanceId = 'test-instance';
      const onLog = jest.fn();
      const onStateChange = jest.fn();

      serverLifecycleServiceMock.startArkServerInstance.mockResolvedValue({ started: true, portError: undefined });
      instanceUtilsMock.getInstance.mockResolvedValue({ name: 'Test Server' });

      const result = await serverInstanceService.startServerInstance(instanceId, onLog, onStateChange);

      expect(result).toEqual({
        started: true,
        portError: undefined,
        instanceId,
        instanceName: 'Test Server'
      });
      expect(messagingServiceMock.sendToAll).toHaveBeenCalledWith('server-instance-state', { state: 'starting', instanceId });
      expect(automationServiceMock.setManuallyStopped).toHaveBeenCalledWith(instanceId, false);
    });

    it('should handle start failure', async () => {
      const instanceId = 'test-instance';
      const onLog = jest.fn();
      const onStateChange = jest.fn();

      serverLifecycleServiceMock.startArkServerInstance.mockResolvedValue({ started: false, portError: 'Port conflict' });

      const result = await serverInstanceService.startServerInstance(instanceId, onLog, onStateChange);

      expect(result).toEqual({
        started: false,
        portError: 'Port conflict',
        instanceId,
        instanceName: instanceId
      });
    });

    it('should handle exception', async () => {
      const instanceId = 'test-instance';
      const onLog = jest.fn();
      const onStateChange = jest.fn();

      serverLifecycleServiceMock.startArkServerInstance.mockRejectedValue(new Error('Start failed'));

      const result = await serverInstanceService.startServerInstance(instanceId, onLog, onStateChange);

      expect(result).toEqual({
        started: false,
        portError: 'Start failed',
        instanceId
      });
    });
  });

  describe('importServerFromBackup', () => {
    it('should import server from backup file path', async () => {
      const serverName = 'Test Server';
      const backupFilePath = '/path/to/backup.zip';

      serverManagementServiceMock.importFromBackup.mockResolvedValue({ success: true, instance: { id: 'new-instance' } });

      const result = await serverInstanceService.importServerFromBackup(serverName, backupFilePath);

      expect(result).toEqual({ success: true, instance: { id: 'new-instance' } });
      expect(serverManagementServiceMock.importFromBackup).toHaveBeenCalledWith(backupFilePath, serverName);
    });

    it('should import server from file data', async () => {
      const serverName = 'Test Server';
      const fileData = 'base64data';
      const fileName = 'backup.zip';

      osMock.tmpdir.mockReturnValue('/tmp');
      pathMock.join.mockReturnValue('/tmp/import_123_backup.zip');
      serverManagementServiceMock.importFromBackup.mockResolvedValue({ success: true, instance: { id: 'new-instance' } });

      const result = await serverInstanceService.importServerFromBackup(serverName, undefined, fileData, fileName);

      expect(result).toEqual({ success: true, instance: { id: 'new-instance' } });
      expect(fsMock.writeFileSync).toHaveBeenCalledWith('/tmp/import_123_backup.zip', Buffer.from(fileData, 'base64'));
      expect(serverManagementServiceMock.importFromBackup).toHaveBeenCalledWith('/tmp/import_123_backup.zip', serverName);
      expect(fsMock.unlinkSync).toHaveBeenCalledWith('/tmp/import_123_backup.zip');
    });

    it('should handle missing parameters', async () => {
      const result = await serverInstanceService.importServerFromBackup('');

      expect(result).toEqual({
        success: false,
        error: 'Server name and backup file (path or data) are required'
      });
    });

    it('should handle file save failure', async () => {
      const serverName = 'Test Server';
      const fileData = 'base64data';
      const fileName = 'backup.zip';

      fsMock.writeFileSync.mockImplementation(() => { throw new Error('Write failed'); });

      const result = await serverInstanceService.importServerFromBackup(serverName, undefined, fileData, fileName);

      expect(result).toEqual({
        success: false,
        error: 'Failed to save uploaded backup file'
      });
    });

    it('should handle import failure', async () => {
      const serverName = 'Test Server';
      const backupFilePath = '/path/to/backup.zip';

      serverManagementServiceMock.importFromBackup.mockRejectedValue(new Error('Import failed'));

      const result = await serverInstanceService.importServerFromBackup(serverName, backupFilePath);

      expect(result).toEqual({
        success: false,
        error: 'Import failed'
      });
    });
  });

  describe('forceStopInstance', () => {
    it('should force stop instance on Windows', async () => {
      const instanceId = 'test-instance';

      validateInstanceIdMock.mockReturnValue(true);
      getPlatformMock.mockReturnValue('windows');
      instanceUtilsMock.getInstance.mockResolvedValue({ name: 'Test Server' });
      const mockProcess = { killed: false, kill: jest.fn() };
      serverProcessServiceMock.getServerProcess.mockReturnValue(mockProcess);

      const result = await serverInstanceService.forceStopInstance(instanceId);

      expect(result).toEqual({
        success: true,
        instanceId,
        instanceName: 'Test Server',
        shouldNotifyAutomation: true
      });
      expect(rconServiceMock.forceDisconnectRcon).toHaveBeenCalledWith(instanceId);
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
      expect(serverProcessServiceMock.setInstanceState).toHaveBeenCalledWith(instanceId, 'stopping');
    });

    it('should force stop instance on Linux', async () => {
      const instanceId = 'test-instance';

      validateInstanceIdMock.mockReturnValue(true);
      getPlatformMock.mockReturnValue('linux');
      instanceUtilsMock.getInstance.mockResolvedValue({ name: 'Test Server' });
      const mockProcess = { killed: false, pid: 123, kill: jest.fn() };
      serverProcessServiceMock.getServerProcess.mockReturnValue(mockProcess);

      const result = await serverInstanceService.forceStopInstance(instanceId);

      expect(result).toEqual({
        success: true,
        instanceId,
        instanceName: 'Test Server',
        shouldNotifyAutomation: true
      });
      expect(process.kill).toHaveBeenCalledWith(-123, 'SIGKILL');
    });

    it('should handle invalid instance ID', async () => {
      const instanceId = 'invalid';

      validateInstanceIdMock.mockReturnValue(false);

      const result = await serverInstanceService.forceStopInstance(instanceId);

      expect(result).toEqual({
        success: false,
        error: 'Invalid instance ID'
      });
    });

    it('should handle exception', async () => {
      const instanceId = 'test-instance';

      validateInstanceIdMock.mockReturnValue(true);
      rconServiceMock.forceDisconnectRcon.mockRejectedValue(new Error('Disconnect failed'));

      const result = await serverInstanceService.forceStopInstance(instanceId);

      expect(result).toEqual({
        success: false,
        error: 'Disconnect failed',
        instanceId
      });
    });
  });

  describe('cleanupOrphanedArkProcesses', () => {
    let execSyncMock: any;

    beforeEach(() => {
      execSyncMock = jest.mocked(require('child_process')).execSync;
    });

    it('should cleanup on Linux', () => {
      getPlatformMock.mockReturnValue('linux');

      serverInstanceService.cleanupOrphanedArkProcesses();

      expect(execSyncMock).toHaveBeenCalledWith('pkill -f ArkAscendedServer', { stdio: 'ignore' });
      expect(execSyncMock).toHaveBeenCalledWith('pkill -f "proton.*ArkAscendedServer"', { stdio: 'ignore' });
      expect(execSyncMock).toHaveBeenCalledWith('pkill -f "Xvfb.*ArkAscendedServer"', { stdio: 'ignore' });
      expect(execSyncMock).toHaveBeenCalledWith('pkill -f "wine.*ArkAscendedServer"', { stdio: 'ignore' });
    });

    it('should cleanup on Windows', () => {
      getPlatformMock.mockReturnValue('windows');

      serverInstanceService.cleanupOrphanedArkProcesses();

      expect(execSyncMock).toHaveBeenCalledWith('taskkill /F /IM ArkAscendedServer.exe', { stdio: 'ignore' });
    });

    it('should handle errors gracefully', () => {
      getPlatformMock.mockReturnValue('linux');
      execSyncMock.mockImplementation(() => { throw new Error('Command failed'); });

      // Should not throw
      expect(() => serverInstanceService.cleanupOrphanedArkProcesses()).not.toThrow();
    });
  });
});