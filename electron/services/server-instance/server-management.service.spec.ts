import { serverManagementService } from './server-management.service';

// Mock all dependencies
jest.mock('../../utils/validation.utils');
jest.mock('../../utils/ark/instance.utils');
jest.mock('../backup/backup.service');
jest.mock('../../utils/crypto.utils');
jest.mock('./server-process.service');
jest.mock('./server-monitoring.service');
jest.mock('./server-lifecycle.service');
jest.mock('../../utils/ark/ark-server/ark-server-state.utils');
jest.mock('../../utils/platform.utils');
jest.mock('path');
jest.mock('fs');

describe('ServerManagementService', () => {
  let validateInstanceIdMock: any;
  let validateServerNameMock: any;
  let validatePortMock: any;
  let instanceUtilsMock: any;
  let backupServiceMock: any;
  let generateRandomPasswordMock: any;
  let serverProcessServiceMock: any;
  let serverMonitoringServiceMock: any;
  let serverLifecycleServiceMock: any;
  let getNormalizedInstanceStateMock: any;
  let getProcessMemoryUsageMock: any;
  let pathMock: any;
  let fsMock: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mocks
    validateInstanceIdMock = jest.fn();
    validateServerNameMock = jest.fn();
    validatePortMock = jest.fn();
    jest.mocked(require('../../utils/validation.utils')).validateInstanceId = validateInstanceIdMock;
    jest.mocked(require('../../utils/validation.utils')).validateServerName = validateServerNameMock;
    jest.mocked(require('../../utils/validation.utils')).validatePort = validatePortMock;

    instanceUtilsMock = {
      getAllInstances: jest.fn(),
      getInstance: jest.fn(),
      saveInstance: jest.fn(),
      deleteInstance: jest.fn(),
      getInstancesBaseDir: jest.fn()
    };
    jest.mocked(require('../../utils/ark/instance.utils')).getAllInstances = instanceUtilsMock.getAllInstances;
    jest.mocked(require('../../utils/ark/instance.utils')).getInstance = instanceUtilsMock.getInstance;
    jest.mocked(require('../../utils/ark/instance.utils')).saveInstance = instanceUtilsMock.saveInstance;
    jest.mocked(require('../../utils/ark/instance.utils')).deleteInstance = instanceUtilsMock.deleteInstance;
    jest.mocked(require('../../utils/ark/instance.utils')).getInstancesBaseDir = instanceUtilsMock.getInstancesBaseDir;

    backupServiceMock = {
      importBackupAsNewServer: jest.fn()
    };
    jest.mocked(require('../backup/backup.service')).backupService = backupServiceMock;

    generateRandomPasswordMock = jest.fn();
    jest.mocked(require('../../utils/crypto.utils')).generateRandomPassword = generateRandomPasswordMock;

    serverProcessServiceMock = {
      getServerProcess: jest.fn(),
      getNormalizedInstanceState: jest.fn(),
      stopServerInstance: jest.fn()
    };
  jest.mocked(require('./server-process.service')).serverProcessService = serverProcessServiceMock;

    serverMonitoringServiceMock = {
      getLatestPlayerCount: jest.fn(),
      stopPlayerPolling: jest.fn(),
      stopMemoryPolling: jest.fn()
    };
    jest.mocked(require('./server-monitoring.service')).serverMonitoringService = serverMonitoringServiceMock;

    serverLifecycleServiceMock = {
      stopServerInstance: jest.fn(),
      getNormalizedInstanceState: jest.fn()
    };
    jest.mocked(require('./server-lifecycle.service')).serverLifecycleService = serverLifecycleServiceMock;

    getNormalizedInstanceStateMock = jest.fn();
    jest.mocked(require('../../utils/ark/ark-server/ark-server-state.utils')).getNormalizedInstanceState = getNormalizedInstanceStateMock;

    getProcessMemoryUsageMock = jest.fn();
    jest.mocked(require('../../utils/platform.utils')).getProcessMemoryUsage = getProcessMemoryUsageMock;

    pathMock = {
      join: jest.fn()
    };
    jest.mocked(require('path')).join = pathMock.join;

    fsMock = {
      writeFileSync: jest.fn()
    };
    jest.mocked(require('fs')).writeFileSync = fsMock.writeFileSync;
  });

  describe('getAllInstances', () => {
    it('should get all instances with enhanced data', async () => {
      const instances = [
        { id: 'instance1', name: 'Server 1' },
        { id: 'instance2', name: 'Server 2' }
      ];

      instanceUtilsMock.getAllInstances.mockResolvedValue(instances);
  serverProcessServiceMock.getNormalizedInstanceState.mockReturnValue('running');
      serverProcessServiceMock.getServerProcess.mockReturnValue({ pid: 123 });
      getProcessMemoryUsageMock.mockReturnValue(512);
      serverMonitoringServiceMock.getLatestPlayerCount.mockReturnValue(5);

      const result = await serverManagementService.getAllInstances();

      expect(result).toEqual({
        instances: [
          {
            id: 'instance1',
            name: 'Server 1',
            state: 'running',
            memory: 512,
            players: 5
          },
          {
            id: 'instance2',
            name: 'Server 2',
            state: 'running',
            memory: 512,
            players: 5
          }
        ]
      });
    });

    it('should handle instances not running', async () => {
      const instances = [{ id: 'instance1', name: 'Server 1' }];

      instanceUtilsMock.getAllInstances.mockResolvedValue(instances);
  serverProcessServiceMock.getNormalizedInstanceState.mockReturnValue('stopped');
      serverProcessServiceMock.getServerProcess.mockReturnValue(null);

      const result = await serverManagementService.getAllInstances();

      expect(result.instances[0]).toEqual({
        id: 'instance1',
        name: 'Server 1',
        state: 'stopped',
        memory: undefined,
        players: undefined
      });
    });

    it('should handle exception', async () => {
      instanceUtilsMock.getAllInstances.mockRejectedValue(new Error('DB error'));

      const result = await serverManagementService.getAllInstances();

      expect(result).toEqual({ instances: [] });
    });
  });

  describe('getInstance', () => {
    it('should get instance by id', async () => {
      const instance = { id: 'instance1', name: 'Server 1' };
      instanceUtilsMock.getInstance.mockResolvedValue(instance);

      const result = await serverManagementService.getInstance('instance1');

      expect(result).toEqual({ instance });
    });

    it('should return null for empty id', async () => {
      const result = await serverManagementService.getInstance('');

      expect(result).toEqual({ instance: null });
    });

    it('should handle exception', async () => {
      instanceUtilsMock.getInstance.mockRejectedValue(new Error('DB error'));

      const result = await serverManagementService.getInstance('instance1');

      expect(result).toEqual({ instance: null });
    });
  });

  describe('saveInstance', () => {
    it('should save instance successfully', async () => {
      const instance = { id: 'instance1', name: 'Server 1', port: 7777 };
      const savedInstance = { ...instance, updatedAt: new Date().toISOString() };

      validateInstanceIdMock.mockReturnValue(true);
      validateServerNameMock.mockReturnValue(true);
      validatePortMock.mockReturnValue(true);
      instanceUtilsMock.saveInstance.mockResolvedValue(savedInstance);

      const result = await serverManagementService.saveInstance(instance);

      expect(result).toEqual({
        success: true,
        instance: savedInstance
      });
    });

    it('should handle invalid instance object', async () => {
      const result = await serverManagementService.saveInstance(null);

      expect(result).toEqual({
        success: false,
        error: 'Invalid instance object'
      });
    });

    it('should handle invalid instance id', async () => {
      const instance = { id: 'invalid', name: 'Server 1' };

      validateInstanceIdMock.mockReturnValue(false);

      const result = await serverManagementService.saveInstance(instance);

      expect(result).toEqual({
        success: false,
        error: 'Invalid instance ID'
      });
    });

    it('should handle invalid server name', async () => {
      const instance = { id: 'instance1', name: 'Invalid@Name' };

      validateInstanceIdMock.mockReturnValue(true);
      validateServerNameMock.mockReturnValue(false);

      const result = await serverManagementService.saveInstance(instance);

      expect(result).toEqual({
        success: false,
        error: 'Invalid server name'
      });
    });

    it('should handle invalid port', async () => {
      const instance = { id: 'instance1', name: 'Server 1', port: 99999 };

      validateInstanceIdMock.mockReturnValue(true);
      validateServerNameMock.mockReturnValue(true);
      validatePortMock.mockReturnValue(false);

      const result = await serverManagementService.saveInstance(instance);

      expect(result).toEqual({
        success: false,
        error: 'Invalid port number'
      });
    });

    it('should handle save error', async () => {
      const instance = { id: 'instance1', name: 'Server 1' };

      validateInstanceIdMock.mockReturnValue(true);
      validateServerNameMock.mockReturnValue(true);
      instanceUtilsMock.saveInstance.mockResolvedValue({ error: 'Save failed' });

      const result = await serverManagementService.saveInstance(instance);

      expect(result).toEqual({
        success: false,
        error: 'Save failed'
      });
    });

    it('should handle exception', async () => {
      const instance = { id: 'instance1', name: 'Server 1' };

      validateInstanceIdMock.mockReturnValue(true);
      validateServerNameMock.mockReturnValue(true);
      instanceUtilsMock.saveInstance.mockRejectedValue(new Error('DB error'));

      const result = await serverManagementService.saveInstance(instance);

      expect(result).toEqual({
        success: false,
        error: 'DB error'
      });
    });
  });

  describe('deleteInstance', () => {
    it('should delete instance successfully', async () => {
      const instanceId = 'instance1';
      const instance = { id: instanceId, name: 'Server 1' };

      validateInstanceIdMock.mockReturnValue(true);
      instanceUtilsMock.getInstance.mockResolvedValue(instance);
      serverProcessServiceMock.getNormalizedInstanceState.mockReturnValue('stopped');
      instanceUtilsMock.deleteInstance.mockResolvedValue(true);

      const result = await serverManagementService.deleteInstance(instanceId);

      expect(result).toEqual({
        success: true,
        id: instanceId
      });
      expect(serverMonitoringServiceMock.stopPlayerPolling).toHaveBeenCalledWith(instanceId);
      expect(serverMonitoringServiceMock.stopMemoryPolling).toHaveBeenCalledWith(instanceId);
    });

    it('should stop running server before deletion', async () => {
      const instanceId = 'instance1';
      const instance = { id: instanceId, name: 'Server 1' };

      validateInstanceIdMock.mockReturnValue(true);
      instanceUtilsMock.getInstance.mockResolvedValue(instance);
      serverProcessServiceMock.getNormalizedInstanceState.mockReturnValue('running');
      serverProcessServiceMock.stopServerInstance.mockResolvedValue({ success: true });
      instanceUtilsMock.deleteInstance.mockResolvedValue(true);

      const result = await serverManagementService.deleteInstance(instanceId);

      expect(serverLifecycleServiceMock.stopServerInstance).toHaveBeenCalledWith(instanceId);
    });

    it('should handle invalid instance id', async () => {
      validateInstanceIdMock.mockReturnValue(false);

      const result = await serverManagementService.deleteInstance('invalid');

      expect(result).toEqual({
        success: false,
        id: 'invalid'
      });
    });

    it('should handle instance not found', async () => {
      validateInstanceIdMock.mockReturnValue(true);
      instanceUtilsMock.getInstance.mockResolvedValue(null);

      const result = await serverManagementService.deleteInstance('instance1');

      expect(result).toEqual({
        success: false,
        id: 'instance1'
      });
    });

    it('should handle delete failure', async () => {
      const instanceId = 'instance1';
      const instance = { id: instanceId, name: 'Server 1' };

      validateInstanceIdMock.mockReturnValue(true);
      instanceUtilsMock.getInstance.mockResolvedValue(instance);
      serverLifecycleServiceMock.getNormalizedInstanceState.mockReturnValue('stopped');
      instanceUtilsMock.deleteInstance.mockResolvedValue(false);

      const result = await serverManagementService.deleteInstance(instanceId);

      expect(result).toEqual({
        success: false,
        id: instanceId
      });
    });

    it('should handle exception', async () => {
      const instanceId = 'instance1';

      validateInstanceIdMock.mockReturnValue(true);
      instanceUtilsMock.getInstance.mockRejectedValue(new Error('DB error'));

      const result = await serverManagementService.deleteInstance(instanceId);

      expect(result).toEqual({
        success: false,
        id: instanceId
      });
    });
  });

  describe('createInstance', () => {
    it('should create instance successfully', async () => {
      const instanceData = { name: 'New Server', port: 7777 };
      const savedInstance = { id: 'instance_123', name: 'New Server', port: 7777 };

      validateInstanceIdMock.mockReturnValue(true);
      validateServerNameMock.mockReturnValue(true);
      validatePortMock.mockReturnValue(true);
      instanceUtilsMock.saveInstance.mockResolvedValue(savedInstance);

      const result = await serverManagementService.createInstance(instanceData);

      expect(result.success).toBe(true);
      expect(result.instance).toEqual(savedInstance);
      expect(instanceUtilsMock.saveInstance).toHaveBeenCalled();
      const callArgs = instanceUtilsMock.saveInstance.mock.calls[0][0];
      expect(callArgs.id).toMatch(/^instance_\d+$/);
      expect(callArgs.name).toBe('New Server');
      expect(callArgs.port).toBe(7777);
      expect(typeof callArgs.createdAt).toBe('string');
      expect(typeof callArgs.updatedAt).toBe('string');
    });

    it('should handle save failure', async () => {
      const instanceData = { name: 'New Server' };

      validateInstanceIdMock.mockReturnValue(true);
      validateServerNameMock.mockReturnValue(true);
      instanceUtilsMock.saveInstance.mockResolvedValue({ error: 'Save failed' });

      const result = await serverManagementService.createInstance(instanceData);

      expect(result).toEqual({
        success: false,
        error: 'Save failed'
      });
    });

    it('should handle exception', async () => {
      const instanceData = { name: 'New Server' };

      validateInstanceIdMock.mockReturnValue(true);
      validateServerNameMock.mockReturnValue(true);
      instanceUtilsMock.saveInstance.mockRejectedValue(new Error('DB error'));

      const result = await serverManagementService.createInstance(instanceData);

      expect(result).toEqual({
        success: false,
        error: 'DB error'
      });
    });
  });

  describe('importFromBackup', () => {
    it('should import from backup successfully', async () => {
      const backupPath = '/path/to/backup.zip';
      const instanceName = 'Imported Server';
      const importedInstance = { id: 'instance1', name: instanceName };

      backupServiceMock.importBackupAsNewServer.mockResolvedValue(importedInstance);

      const result = await serverManagementService.importFromBackup(backupPath, instanceName);

      expect(result).toEqual({
        success: true,
        instance: importedInstance
      });
    });

    it('should handle invalid backup path', async () => {
      const result = await serverManagementService.importFromBackup('', 'Server Name');

      expect(result).toEqual({
        success: false,
        error: 'Invalid backup path'
      });
    });

    it('should handle invalid instance name', async () => {
      const result = await serverManagementService.importFromBackup('/path/backup.zip', '');

      expect(result).toEqual({
        success: false,
        error: 'Invalid instance name'
      });
    });



    it('should handle exception', async () => {
      backupServiceMock.importBackupAsNewServer.mockRejectedValue(new Error('Import error'));

      const result = await serverManagementService.importFromBackup('/path/backup.zip', 'Server Name');

      expect(result).toEqual({
        success: false,
        error: 'Import error'
      });
    });
  });

  describe('prepareInstanceConfiguration', () => {
    it('should generate RCON password when missing', async () => {
      const instanceId = 'instance1';
      const instance = { name: 'Server 1' };

      generateRandomPasswordMock.mockReturnValue('generated_password');
      instanceUtilsMock.getInstancesBaseDir.mockReturnValue('/instances');
      pathMock.join.mockReturnValue('/instances/instance1/config.json');

      await serverManagementService.prepareInstanceConfiguration(instanceId, instance);

      expect(generateRandomPasswordMock).toHaveBeenCalledWith(16);
      expect((instance as any).rconPassword).toBe('generated_password');
      expect(fsMock.writeFileSync).toHaveBeenCalledWith(
        '/instances/instance1/config.json',
        JSON.stringify(instance, null, 2),
        'utf8'
      );
    });

    it('should not generate password if already exists', async () => {
      const instanceId = 'instance1';
      const instance = { name: 'Server 1', rconPassword: 'existing_password' };

      await serverManagementService.prepareInstanceConfiguration(instanceId, instance);

      expect(generateRandomPasswordMock).not.toHaveBeenCalled();
      expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    });

    it('should handle file write error gracefully', async () => {
      const instanceId = 'instance1';
      const instance = { name: 'Server 1' };

      generateRandomPasswordMock.mockReturnValue('generated_password');
      fsMock.writeFileSync.mockImplementation(() => { throw new Error('Write failed'); });

      // Should not throw
      await serverManagementService.prepareInstanceConfiguration(instanceId, instance);
    });
  });

  describe('cloneInstance', () => {
    it('should clone instance successfully', async () => {
      const sourceInstanceId = 'source1';
      const newInstanceName = 'Cloned Server';
      const sourceInstance = { id: 'source1', name: 'Original Server', port: 7777 };
      const clonedInstance = { id: 'instance_123', name: newInstanceName, port: 7777 };

      validateInstanceIdMock.mockReturnValue(true);
      validateServerNameMock.mockReturnValue(true);
      validatePortMock.mockReturnValue(true);
      instanceUtilsMock.getInstance.mockResolvedValue(sourceInstance);
      instanceUtilsMock.saveInstance.mockResolvedValue(clonedInstance);

      const result = await serverManagementService.cloneInstance(sourceInstanceId, newInstanceName);

      expect(result.success).toBe(true);
      expect(result.instance).toEqual(clonedInstance);
      expect(instanceUtilsMock.saveInstance).toHaveBeenCalled();
      const callArgs = instanceUtilsMock.saveInstance.mock.calls[0][0];
      expect(callArgs.id).toMatch(/^instance_\d+$/);
      expect(callArgs.name).toBe(newInstanceName);
      expect(callArgs.port).toBe(7777);
      expect(typeof callArgs.createdAt).toBe('string');
      expect(typeof callArgs.updatedAt).toBe('string');
    });

    it('should handle invalid source instance id', async () => {
      validateInstanceIdMock.mockReturnValue(false);

      const result = await serverManagementService.cloneInstance('invalid', 'New Name');

      expect(result).toEqual({
        success: false,
        error: 'Invalid source instance ID'
      });
    });

    it('should handle invalid instance name', async () => {
      validateInstanceIdMock.mockReturnValue(true);
      validateServerNameMock.mockReturnValue(false);

      const result = await serverManagementService.cloneInstance('source1', 'Invalid@Name');

      expect(result).toEqual({
        success: false,
        error: 'Invalid instance name'
      });
    });

    it('should handle source instance not found', async () => {
      validateInstanceIdMock.mockReturnValue(true);
      validateServerNameMock.mockReturnValue(true);
      instanceUtilsMock.getInstance.mockResolvedValue(null);

      const result = await serverManagementService.cloneInstance('source1', 'New Name');

      expect(result).toEqual({
        success: false,
        error: 'Source instance not found'
      });
    });

    it('should handle save failure', async () => {
      const sourceInstance = { id: 'source1', name: 'Original Server' };

      validateInstanceIdMock.mockReturnValue(true);
      validateServerNameMock.mockReturnValue(true);
      instanceUtilsMock.getInstance.mockResolvedValue(sourceInstance);
      instanceUtilsMock.saveInstance.mockResolvedValue({ error: 'Save failed' });

      const result = await serverManagementService.cloneInstance('source1', 'New Name');

      expect(result).toEqual({
        success: false,
        error: 'Save failed'
      });
    });

    it('should handle exception', async () => {
      validateInstanceIdMock.mockReturnValue(true);
      validateServerNameMock.mockReturnValue(true);
      instanceUtilsMock.getInstance.mockRejectedValue(new Error('DB error'));

      const result = await serverManagementService.cloneInstance('source1', 'New Name');

      expect(result).toEqual({
        success: false,
        error: 'DB error'
      });
    });
  });
});