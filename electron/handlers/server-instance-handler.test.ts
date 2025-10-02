// Mock the services
jest.mock('../services/messaging.service');
jest.mock('../services/server-instance/server-instance.service', () => ({
  serverInstanceService: {
    forceStopInstance: jest.fn(),
    startServerInstance: jest.fn(),
    getStandardEventCallbacks: jest.fn(() => ({ onLog: jest.fn(), onState: jest.fn() })),
    importServerFromBackup: jest.fn(),
  }
}));
jest.mock('../services/server-instance/server-process.service', () => ({
  serverProcessService: {
    getNormalizedInstanceState: jest.fn(),
  }
}));
jest.mock('../services/server-instance/server-monitoring.service', () => ({
  serverMonitoringService: {
    getInstanceLogs: jest.fn(),
    getPlayerCount: jest.fn(),
    stopPlayerPolling: jest.fn(),
    startPlayerPolling: jest.fn(),
    getInstanceState: jest.fn(),
  }
}));
jest.mock('../services/server-instance/server-operations.service', () => ({
  serverOperationsService: {
    connectRcon: jest.fn(),
    disconnectRcon: jest.fn(),
    executeRconCommand: jest.fn(),
    getRconStatus: jest.fn(),
  }
}));
jest.mock('../services/server-instance/server-management.service', () => ({
  serverManagementService: {
    getAllInstances: jest.fn(),
    getInstance: jest.fn(),
    saveInstance: jest.fn(),
    deleteInstance: jest.fn(),
    importFromBackup: jest.fn(),
  }
}));
jest.mock('../services/automation/automation.service', () => ({
  automationService: {
    setManuallyStopped: jest.fn()
  }
}));
jest.mock('../utils/ark/ark-server/ark-server-state.utils');

import { messagingService } from '../services/messaging.service';
import { serverInstanceService } from '../services/server-instance/server-instance.service';
import { serverProcessService } from '../services/server-instance/server-process.service';
import { serverMonitoringService } from '../services/server-instance/server-monitoring.service';
import { serverOperationsService } from '../services/server-instance/server-operations.service';
import { serverManagementService } from '../services/server-instance/server-management.service';
import { automationService } from '../services/automation/automation.service';
import * as arkServerStateUtils from '../utils/ark/ark-server/ark-server-state.utils';

const mockMessagingService = messagingService as jest.Mocked<typeof messagingService>;
const mockServerInstanceService = serverInstanceService as jest.Mocked<typeof serverInstanceService>;
const mockServerProcessService = serverProcessService as jest.Mocked<typeof serverProcessService>;
const mockServerMonitoringService = serverMonitoringService as jest.Mocked<typeof serverMonitoringService>;
const mockServerOperationsService = serverOperationsService as jest.Mocked<typeof serverOperationsService>;
const mockServerManagementService = serverManagementService as jest.Mocked<typeof serverManagementService>;
const mockAutomationService = automationService as jest.Mocked<typeof automationService>;
const mockGetNormalizedInstanceState = arkServerStateUtils.getNormalizedInstanceState as jest.Mock;


// Store handler functions for testing
let forceStopHandler: Function;
let getStateHandler: Function;
let getLogsHandler: Function;
let connectRconHandler: Function;
let disconnectRconHandler: Function;
let getRconStatusHandler: Function;
let rconCommandHandler: Function;
let startInstanceHandler: Function;
let getPlayersHandler: Function;
let getInstancesHandler: Function;
let getInstanceHandler: Function;
let saveInstanceHandler: Function;
let deleteInstanceHandler: Function;
let importBackupHandler: Function;

// Shared mock sender for all tests
const mockSender = {};

beforeAll(() => {
  // Import handler to register events
  require('./server-instance-handler');

  const mockOn = mockMessagingService.on as jest.Mock;
  mockOn.mock.calls.forEach(([event, handler]) => {
    switch (event) {
      case 'force-stop-server-instance':
        forceStopHandler = handler;
        break;
      case 'get-server-instance-state':
        getStateHandler = handler;
        break;
      case 'get-server-instance-logs':
        getLogsHandler = handler;
        break;
      case 'connect-rcon':
        connectRconHandler = handler;
        break;
      case 'disconnect-rcon':
        disconnectRconHandler = handler;
        break;
      case 'get-rcon-status':
        getRconStatusHandler = handler;
        break;
      case 'rcon-command':
        rconCommandHandler = handler;
        break;
      case 'start-server-instance':
        startInstanceHandler = handler;
        break;
      case 'get-server-instance-players':
        getPlayersHandler = handler;
        break;
      case 'get-server-instances':
        getInstancesHandler = handler;
        break;
      case 'get-server-instance':
        getInstanceHandler = handler;
        break;
      case 'save-server-instance':
        saveInstanceHandler = handler;
        break;
      case 'delete-server-instance':
        deleteInstanceHandler = handler;
        break;
      case 'import-server-from-backup':
        importBackupHandler = handler;
        break;
    }
  });
});

describe('Server Instance Handler', () => {

  describe('start-server-instance handler', () => {
    it('should not send notification if result.started is false and result.portError is set but sender has no send function', async () => {
      const payload = { id: 'instance-1', requestId: 'req-else' };
      const expectedResult = {
        started: false,
        portError: 'PORT ERROR',
        instanceId: 'instance-1',
        instanceName: 'Test Server',
        shouldNotifyAutomation: false,
        success: false
      };
      // sender does NOT have a send function
      const senderWithoutSend = {};
      mockServerInstanceService.startServerInstance.mockResolvedValue(expectedResult);
      mockServerInstanceService.getStandardEventCallbacks.mockReturnValue({ onLog: jest.fn(), onState: jest.fn() });
      await startInstanceHandler(payload, senderWithoutSend);
      // Should NOT send notification (neither info nor error)
      const notifCall = (mockMessagingService.sendToAll as any).mock.calls.find((c: any[]) => c[0] === 'notification');
      expect(notifCall).toBeUndefined();
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('start-server-instance', {
        success: false,
        instanceId: 'instance-1',
        error: 'PORT ERROR',
        requestId: 'req-else'
      }, senderWithoutSend);
    });
    it('should force stop server instance successfully', async () => {
      const payload = { id: 'instance-1', requestId: 'req-1' };
      const expectedResult = {
        success: true,
        instanceId: 'instance-1',
        instanceName: 'Test Server',
        shouldNotifyAutomation: true
      };
      mockServerInstanceService.forceStopInstance.mockResolvedValue(expectedResult);
      await forceStopHandler(payload, mockSender);
      expect(mockServerInstanceService.forceStopInstance).toHaveBeenCalledWith('instance-1');
      expect(mockMessagingService.sendToAll).toHaveBeenCalledWith('rcon-status', { instanceId: 'instance-1', connected: false });
      expect(mockMessagingService.sendToAll).toHaveBeenCalledWith('server-instance-log', { log: '[FORCE STOP] Server force stopped', instanceId: 'instance-1' });
      expect(mockServerMonitoringService.stopPlayerPolling).toHaveBeenCalledWith('instance-1');
      expect(mockAutomationService.setManuallyStopped).toHaveBeenCalledWith('instance-1', true);
      expect(mockMessagingService.sendToAll).toHaveBeenCalledWith('notification', {
        type: 'warning',
        message: 'Server Test Server force stopped.'
      });
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('force-stop-server-instance', {
        ...expectedResult,
        requestId: 'req-1'
      }, mockSender);
    });

    it('should handle force stop exception', async () => {
      const payload = { id: 'instance-1', requestId: 'req-1' };
      const error = new Error('System error');
      mockServerInstanceService.forceStopInstance.mockRejectedValue(error);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await forceStopHandler(payload, mockSender);
      expect(mockServerInstanceService.forceStopInstance).toHaveBeenCalledWith('instance-1');
      expect(consoleSpy).toHaveBeenCalledWith('[server-instance-handler] Failed to handle force-stop-server-instance:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('force-stop-server-instance', {
        success: false,
        error: 'System error',
        requestId: 'req-1'
      }, mockSender);
      consoleSpy.mockRestore();
    });

    it('should handle force stop exception with string error', async () => {
      const payload = { id: 'instance-1', requestId: 'req-1' };
      mockServerInstanceService.forceStopInstance.mockRejectedValue('fail');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await forceStopHandler(payload, mockSender);
      expect(mockServerInstanceService.forceStopInstance).toHaveBeenCalledWith('instance-1');
      expect(consoleSpy).toHaveBeenCalledWith('[server-instance-handler] Failed to handle force-stop-server-instance:', 'fail');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('force-stop-server-instance', {
        success: false,
        error: 'Failed to force stop server',
        requestId: 'req-1'
      }, mockSender);
      consoleSpy.mockRestore();
    });

    it('should handle force stop exception with undefined error', async () => {
      const payload = { id: 'instance-1', requestId: 'req-1' };
      mockServerInstanceService.forceStopInstance.mockRejectedValue(undefined);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await forceStopHandler(payload, mockSender);
      expect(mockServerInstanceService.forceStopInstance).toHaveBeenCalledWith('instance-1');
      expect(consoleSpy).toHaveBeenCalledWith('[server-instance-handler] Failed to handle force-stop-server-instance:', undefined);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('force-stop-server-instance', {
        success: false,
        error: 'Failed to force stop server',
        requestId: 'req-1'
      }, mockSender);
      consoleSpy.mockRestore();
    });

  });
});

  describe('get-server-instance-state handler', () => {
    it('should get server instance state successfully', async () => {
      const payload = { id: 'instance-1', requestId: 'req-1' };
      const expectedResult = {
        state: 'running',
        instanceId: 'instance-1'
      };

      mockGetNormalizedInstanceState.mockReturnValue('running');

      await getStateHandler(payload, mockSender);

      expect(mockGetNormalizedInstanceState).toHaveBeenCalledWith('instance-1');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-server-instance-state', {
        ...expectedResult,
        requestId: 'req-1'
      }, mockSender);
    });

    it('should handle get state exception with string error', async () => {
      const payload = { id: 'instance-1', requestId: 'req-1' };
      mockGetNormalizedInstanceState.mockImplementation(() => { throw 'fail'; });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await getStateHandler(payload, mockSender);
      expect(mockGetNormalizedInstanceState).toHaveBeenCalledWith('instance-1');
      expect(consoleSpy).toHaveBeenCalledWith('[server-instance-handler] Failed to handle get-server-instance-state:', 'fail');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-server-instance-state', {
        state: 'unknown',
        instanceId: 'instance-1',
        requestId: 'req-1'
      }, mockSender);
      consoleSpy.mockRestore();
    });
    it('should handle get state exception with undefined error', async () => {
      const payload = { id: 'instance-1', requestId: 'req-1' };
      mockGetNormalizedInstanceState.mockImplementation(() => { throw undefined; });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await getStateHandler(payload, mockSender);
      expect(mockGetNormalizedInstanceState).toHaveBeenCalledWith('instance-1');
      expect(consoleSpy).toHaveBeenCalledWith('[server-instance-handler] Failed to handle get-server-instance-state:', undefined);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-server-instance-state', {
        state: 'unknown',
        instanceId: 'instance-1',
        requestId: 'req-1'
      }, mockSender);
      consoleSpy.mockRestore();
    });
    it('should handle get state exception', async () => {
      const payload = { id: 'instance-1', requestId: 'req-1' };
      const error = new Error('State check failed');
      mockGetNormalizedInstanceState.mockImplementation(() => { throw error; });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await getStateHandler(payload, mockSender);
      expect(mockGetNormalizedInstanceState).toHaveBeenCalledWith('instance-1');
      expect(consoleSpy).toHaveBeenCalledWith('[server-instance-handler] Failed to handle get-server-instance-state:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-server-instance-state', {
        state: 'unknown',
        instanceId: 'instance-1',
        requestId: 'req-1'
      }, mockSender);
      consoleSpy.mockRestore();
    });
  });

  describe('get-server-instance-logs handler', () => {
    it('should handle get logs exception with string error', async () => {
      const payload = { id: 'instance-1', maxLines: 100, requestId: 'req-1' };
      mockServerMonitoringService.getInstanceLogs.mockImplementation(() => { throw 'fail'; });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await getLogsHandler(payload, mockSender);
      expect(mockServerMonitoringService.getInstanceLogs).toHaveBeenCalledWith('instance-1', 100);
      expect(consoleSpy).toHaveBeenCalledWith('[server-instance-handler] Failed to handle get-server-instance-logs:', 'fail');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-server-instance-logs', {
        log: '',
        instanceId: 'instance-1',
        requestId: 'req-1'
      }, mockSender);
      consoleSpy.mockRestore();
    });
    it('should handle get logs exception with undefined error', async () => {
      const payload = { id: 'instance-1', maxLines: 100, requestId: 'req-1' };
      mockServerMonitoringService.getInstanceLogs.mockImplementation(() => { throw undefined; });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await getLogsHandler(payload, mockSender);
      expect(mockServerMonitoringService.getInstanceLogs).toHaveBeenCalledWith('instance-1', 100);
      expect(consoleSpy).toHaveBeenCalledWith('[server-instance-handler] Failed to handle get-server-instance-logs:', undefined);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-server-instance-logs', {
        log: '',
        instanceId: 'instance-1',
        requestId: 'req-1'
      }, mockSender);
      consoleSpy.mockRestore();
    });
    it('should get server instance logs successfully', async () => {
      const payload = { id: 'instance-1', maxLines: 100, requestId: 'req-1' };
      const expectedResult = {
        log: 'Server log line',
        instanceId: 'instance-1'
      };

      mockServerMonitoringService.getInstanceLogs.mockReturnValue({ log: 'Server log line', instanceId: 'instance-1' });

      await getLogsHandler(payload, mockSender);

      expect(mockServerMonitoringService.getInstanceLogs).toHaveBeenCalledWith('instance-1', 100);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-server-instance-logs', {
        log: 'Server log line',
        instanceId: 'instance-1',
        requestId: 'req-1'
      }, mockSender);
      expect(mockMessagingService.sendToAll).toHaveBeenCalledWith('get-server-instance-logs', {
        log: 'Server log line',
        instanceId: 'instance-1',
        requestId: 'req-1'
      });
    });

    it('should handle get logs exception', async () => {
      const payload = { id: 'instance-1', requestId: 'req-1' };
      const error = new Error('Log retrieval failed');

      mockServerMonitoringService.getInstanceLogs.mockImplementation(() => {
        throw error;
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await getLogsHandler(payload, mockSender);

      expect(mockServerMonitoringService.getInstanceLogs).toHaveBeenCalledWith('instance-1', undefined);
      expect(consoleSpy).toHaveBeenCalledWith('[server-instance-handler] Failed to handle get-server-instance-logs:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-server-instance-logs', {
        log: '',
        instanceId: 'instance-1',
        requestId: 'req-1'
      }, mockSender);

      consoleSpy.mockRestore();
    });
  });

  describe('connect-rcon handler', () => {
    it('should connect RCON successfully', async () => {
      const payload = { id: 'instance-1', requestId: 'req-1' };
      const expectedResult = {
        success: true,
        connected: true,
        instanceId: 'instance-1'
      };

      mockServerOperationsService.connectRcon.mockResolvedValue(expectedResult);

      await connectRconHandler(payload, mockSender);

      expect(mockServerOperationsService.connectRcon).toHaveBeenCalledWith('instance-1');
      expect(mockMessagingService.sendToAll).toHaveBeenCalledWith('rcon-status', { instanceId: 'instance-1', connected: true });
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('connect-rcon', {
        ...expectedResult,
        requestId: 'req-1'
      }, mockSender);
    });

    it('should handle RCON connection failure', async () => {
      const payload = { id: 'instance-1', requestId: 'req-1' };
      const expectedResult = {
        success: false,
        connected: false,
        instanceId: 'instance-1',
        error: 'Connection failed'
      };

      mockServerOperationsService.connectRcon.mockResolvedValue(expectedResult);

      await connectRconHandler(payload, mockSender);

      expect(mockServerOperationsService.connectRcon).toHaveBeenCalledWith('instance-1');
      expect(mockMessagingService.sendToAll).toHaveBeenCalledWith('rcon-status', { instanceId: 'instance-1', connected: false });
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('connect-rcon', {
        ...expectedResult,
        requestId: 'req-1'
      }, mockSender);
    });

    it('should handle RCON connection exception', async () => {
      const payload = { id: 'instance-1', requestId: 'req-1' };
      const error = new Error('RCON connection error');

      mockServerOperationsService.connectRcon.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await connectRconHandler(payload, mockSender);

      expect(mockServerOperationsService.connectRcon).toHaveBeenCalledWith('instance-1');
      expect(consoleSpy).toHaveBeenCalledWith('[server-instance-handler] Failed to handle connect-rcon:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('connect-rcon', {
        success: false,
        connected: false,
        instanceId: 'instance-1',
        error: 'RCON connection error',
        requestId: 'req-1'
      }, mockSender);
      // sendToAll is not called in the catch block
      expect(mockMessagingService.sendToAll).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('disconnect-rcon handler', () => {
    it('should disconnect RCON successfully', async () => {
      const payload = { id: 'instance-1', requestId: 'req-1' };
      const expectedResult = {
        success: true,
        connected: false,
        instanceId: 'instance-1'
      };

      mockServerOperationsService.disconnectRcon.mockResolvedValue(expectedResult);

      await disconnectRconHandler(payload, mockSender);

      expect(mockServerOperationsService.disconnectRcon).toHaveBeenCalledWith('instance-1');
      expect(mockMessagingService.sendToAll).toHaveBeenCalledWith('rcon-status', { instanceId: 'instance-1', connected: false });
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('disconnect-rcon', {
        ...expectedResult,
        requestId: 'req-1'
      }, mockSender);
    });

    it('should handle RCON disconnect exception', async () => {
      const payload = { id: 'instance-1', requestId: 'req-1' };
      const error = new Error('RCON disconnect error');

      mockServerOperationsService.disconnectRcon.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await disconnectRconHandler(payload, mockSender);

      expect(mockServerOperationsService.disconnectRcon).toHaveBeenCalledWith('instance-1');
      expect(consoleSpy).toHaveBeenCalledWith('[server-instance-handler] Failed to handle disconnect-rcon:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('disconnect-rcon', {
        success: false,
        connected: false,
        instanceId: 'instance-1',
        requestId: 'req-1'
      }, mockSender);
      // sendToAll is not called in the catch block
      expect(mockMessagingService.sendToAll).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('get-rcon-status handler', () => {
    it('should get RCON status successfully', async () => {
      const payload = { id: 'instance-1', requestId: 'req-1' };
      const sender = { send: jest.fn() };
      const expectedResult = {
        success: true,
        connected: true,
        instanceId: 'instance-1'
      };

      mockServerOperationsService.getRconStatus.mockReturnValue(expectedResult);

      await getRconStatusHandler(payload, sender);

      expect(mockServerOperationsService.getRconStatus).toHaveBeenCalledWith('instance-1');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-rcon-status', {
        ...expectedResult,
        requestId: 'req-1'
      }, sender);
    });

    it('should handle get RCON status exception', async () => {
      const payload = { id: 'instance-1', requestId: 'req-1' };
      const sender = { send: jest.fn() };
      const error = new Error('RCON status check failed');

      mockServerOperationsService.getRconStatus.mockImplementation(() => {
        throw error;
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await getRconStatusHandler(payload, sender);

      expect(mockServerOperationsService.getRconStatus).toHaveBeenCalledWith('instance-1');
      expect(consoleSpy).toHaveBeenCalledWith('[server-instance-handler] Failed to handle get-rcon-status:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-rcon-status', {
        success: false,
        connected: false,
        instanceId: 'instance-1',
        requestId: 'req-1'
      }, sender);

      consoleSpy.mockRestore();
    });
  });

  describe('rcon-command handler', () => {
    it('should execute RCON command successfully', async () => {
      const payload = { id: 'instance-1', command: 'listplayers', requestId: 'req-1' };
      const sender = { send: jest.fn() };
      const expectedResult = {
        success: true,
        response: 'Player list response',
        instanceId: 'instance-1'
      };

      mockServerOperationsService.executeRconCommand.mockResolvedValue(expectedResult);

      await rconCommandHandler(payload, sender);

      expect(mockServerOperationsService.executeRconCommand).toHaveBeenCalledWith('instance-1', 'listplayers');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('rcon-command', {
        instanceId: 'instance-1',
        response: 'Player list response',
        requestId: 'req-1'
      }, sender);
    });

    it('should handle RCON command exception', async () => {
      const payload = { id: 'instance-1', command: 'invalid', requestId: 'req-1' };
      const sender = { send: jest.fn() };
      const error = new Error('RCON command failed');

      mockServerOperationsService.executeRconCommand.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await rconCommandHandler(payload, sender);

      expect(mockServerOperationsService.executeRconCommand).toHaveBeenCalledWith('instance-1', 'invalid');
      expect(consoleSpy).toHaveBeenCalledWith('[server-instance-handler] Failed to handle rcon-command:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('rcon-command', {
        instanceId: 'instance-1',
        response: 'RCON command failed',
        requestId: 'req-1'
      }, sender);

      consoleSpy.mockRestore();
    });
  });

  describe('get-server-instance-players handler', () => {
    it('should get server instance players successfully', async () => {
      const payload = { id: 'instance-1', requestId: 'req-1' };
      const sender = { send: jest.fn() };
      const expectedResult = {
        instanceId: 'instance-1',
        players: 5
      };

      mockServerMonitoringService.getPlayerCount.mockReturnValue(expectedResult);

      await getPlayersHandler(payload, sender);

      expect(mockServerMonitoringService.getPlayerCount).toHaveBeenCalledWith('instance-1');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-server-instance-players', {
        ...expectedResult,
        requestId: 'req-1'
      }, sender);
    });

    it('should handle get players exception', async () => {
      const payload = { id: 'instance-1', requestId: 'req-1' };
      const sender = { send: jest.fn() };
      const error = new Error('Player retrieval failed');

      mockServerMonitoringService.getPlayerCount.mockImplementation(() => {
        throw error;
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await getPlayersHandler(payload, sender);

      expect(mockServerMonitoringService.getPlayerCount).toHaveBeenCalledWith('instance-1');
      expect(consoleSpy).toHaveBeenCalledWith('[server-instance-handler] Failed to handle get-server-instance-players:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-server-instance-players', {
        instanceId: 'instance-1',
        players: 0,
        requestId: 'req-1'
      }, sender);

      consoleSpy.mockRestore();
    });
  });

  describe('get-server-instances handler', () => {
    it('should get server instances successfully', async () => {
      const payload = { requestId: 'req-1' };
      const sender = { send: jest.fn() };
      const expectedResult = {
        instances: [{ id: 'instance-1', name: 'Server 1' }]
      };

      mockServerManagementService.getAllInstances.mockReset();
      mockServerManagementService.getAllInstances.mockResolvedValue(expectedResult);

      await getInstancesHandler(payload, sender);

      expect(mockServerManagementService.getAllInstances).toHaveBeenCalled();
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-server-instances', {
        ...expectedResult,
        requestId: 'req-1'
      }, sender);
    });

    it('should handle get instances exception', async () => {
      const payload = { requestId: 'req-1' };
      const sender = { send: jest.fn() };
      const error = new Error('Instance retrieval failed');

      mockServerManagementService.getAllInstances.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await getInstancesHandler(payload, sender);

      expect(mockServerManagementService.getAllInstances).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('[server-instance-handler] Failed to handle get-server-instances:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-server-instances', {
        instances: [],
        requestId: 'req-1'
      }, sender);

      consoleSpy.mockRestore();
    });
  });

  describe('get-server-instance handler', () => {
    it('should get server instance successfully', async () => {
      const payload = { id: 'instance-1', requestId: 'req-1' };
      const sender = { send: jest.fn() };
      const expectedResult = {
        instance: { id: 'instance-1', name: 'Server 1' }
      };

      mockServerManagementService.getInstance.mockResolvedValue(expectedResult);

      await getInstanceHandler(payload, sender);

      expect(mockServerManagementService.getInstance).toHaveBeenCalledWith('instance-1');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-server-instance', {
        ...expectedResult,
        requestId: 'req-1'
      }, sender);
    });

    it('should handle get instance exception', async () => {
      const payload = { id: 'instance-1', requestId: 'req-1' };
      const sender = { send: jest.fn() };
      const error = new Error('Instance retrieval failed');

      mockServerManagementService.getInstance.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await getInstanceHandler(payload, sender);

      expect(mockServerManagementService.getInstance).toHaveBeenCalledWith('instance-1');
      expect(consoleSpy).toHaveBeenCalledWith('[server-instance-handler] Failed to handle get-server-instance:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-server-instance', {
        instance: null,
        requestId: 'req-1'
      }, sender);

      consoleSpy.mockRestore();
    });
  });

  describe('save-server-instance handler', () => {
    it('should save server instance successfully', async () => {
      const payload = { instance: { id: 'instance-1', name: 'Server 1' }, requestId: 'req-1' };
      const sender = { send: jest.fn() };
      const expectedResult = {
        success: true,
        instance: { id: 'instance-1', name: 'Server 1' }
      };

      mockServerManagementService.saveInstance.mockResolvedValue(expectedResult);

      await saveInstanceHandler(payload, sender);

      expect(mockServerManagementService.saveInstance).toHaveBeenCalledWith({ id: 'instance-1', name: 'Server 1' });
      expect(mockMessagingService.sendToAll).toHaveBeenCalledWith('server-instance-updated', { id: 'instance-1', name: 'Server 1' });
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('save-server-instance', {
        ...expectedResult,
        requestId: 'req-1'
      }, sender);
    });

    it('should handle save instance exception', async () => {
      const payload = { instance: { id: 'instance-1', name: 'Server 1' }, requestId: 'req-1' };
      const sender = { send: jest.fn() };
      const error = new Error('Save failed');

      mockServerManagementService.saveInstance.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await saveInstanceHandler(payload, sender);

      expect(mockServerManagementService.saveInstance).toHaveBeenCalledWith({ id: 'instance-1', name: 'Server 1' });
      expect(consoleSpy).toHaveBeenCalledWith('[server-instance-handler] Failed to handle save-server-instance:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('save-server-instance', {
        success: false,
        error: 'Save failed',
        requestId: 'req-1'
      }, sender);

      consoleSpy.mockRestore();
    });

    it('should send notification with Unknown fallback if name and id are missing', async () => {
      const oldInstance = undefined;
      const newInstance = {}; // no name, no id
      jest.spyOn(require('../utils/ark/instance.utils'), 'getInstance').mockResolvedValueOnce(oldInstance);
      mockServerManagementService.saveInstance.mockResolvedValue({ success: true, instance: newInstance });
      mockServerManagementService.getAllInstances.mockResolvedValue({ instances: [newInstance] });
      await saveInstanceHandler({ instance: newInstance }, mockSender);
      const call = (mockMessagingService.sendToAllOthers as any).mock.calls.find((c: any[]) => c[0] === 'notification');
      expect(call).toBeDefined();
      expect(call[1].message).toContain('Unknown');
      expect(call[1].message).toContain('added');
    });

    it('should not send notification if saveInstance result.success is false', async () => {
      const instance = { id: 'fail-id' };
      mockServerManagementService.saveInstance.mockResolvedValueOnce({ success: false, instance });
      await saveInstanceHandler({ instance }, mockSender);
      // Should not send notification
      const notifCall = (mockMessagingService.sendToAllOthers as any).mock.calls.find((c: any[]) => c[0] === 'notification');
      expect(notifCall).toBeUndefined();
      // Should send result to originator
      const call = (mockMessagingService.sendToOriginator as any).mock.calls.find((c: any[]) => c[0] === 'save-server-instance');
      expect(call).toBeDefined();
      expect(call[1].success).toBe(false);
      expect(call[1].instance).toEqual(instance);
    });

    it('should send updated notification if existingInstance exists and name is unchanged', async () => {
      const oldInstance = { id: 'id-1', name: 'Server 1' };
      const newInstance = { id: 'id-1', name: 'Server 1' };
      jest.spyOn(require('../utils/ark/instance.utils'), 'getInstance').mockResolvedValueOnce(oldInstance);
      mockServerManagementService.saveInstance.mockResolvedValue({ success: true, instance: newInstance });
      mockServerManagementService.getAllInstances.mockResolvedValue({ instances: [newInstance] });
      await saveInstanceHandler({ instance: newInstance }, mockSender);
      const call = (mockMessagingService.sendToAllOthers as any).mock.calls.find((c: any[]) => c[0] === 'notification');
      expect(call).toBeDefined();
      expect(call[1].message).toContain('updated');
      expect(call[1].message).toContain('Server 1');
    });
  });

  describe('delete-server-instance handler', () => {
    it('should delete server instance successfully', async () => {
      const payload = { id: 'instance-1', requestId: 'req-1' };
      const sender = { send: jest.fn() };
      const expectedResult = {
        success: true,
        id: 'instance-1'
      };

      mockServerManagementService.deleteInstance.mockResolvedValue(expectedResult);

      await deleteInstanceHandler(payload, sender);

      expect(mockServerManagementService.deleteInstance).toHaveBeenCalledWith('instance-1');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('delete-server-instance', {
        ...expectedResult,
        requestId: 'req-1'
      }, sender);
    });

    it('should handle delete instance exception (Error)', async () => {
      const payload = { id: 'instance-1', requestId: 'req-1' };
      const sender = { send: jest.fn() };
      const error = new Error('Delete failed');
      mockServerManagementService.deleteInstance.mockRejectedValue(error);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await deleteInstanceHandler(payload, sender);
      expect(consoleSpy).toHaveBeenCalledWith('[server-instance-handler] Failed to handle delete-server-instance:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('delete-server-instance', {
        success: false,
        id: 'instance-1',
        requestId: 'req-1'
      }, sender);
      consoleSpy.mockRestore();
    });

    it('should handle delete instance exception (string)', async () => {
      const payload = { id: 'instance-1', requestId: 'req-1' };
      const sender = { send: jest.fn() };
      mockServerManagementService.deleteInstance.mockRejectedValue('fail');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await deleteInstanceHandler(payload, sender);
      expect(consoleSpy).toHaveBeenCalledWith('[server-instance-handler] Failed to handle delete-server-instance:', 'fail');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('delete-server-instance', {
        success: false,
        id: 'instance-1',
        requestId: 'req-1'
      }, sender);
      consoleSpy.mockRestore();
    });

    it('should handle delete instance exception (undefined)', async () => {
      const payload = { id: 'instance-1', requestId: 'req-1' };
      const sender = { send: jest.fn() };
      mockServerManagementService.deleteInstance.mockRejectedValue(undefined);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await deleteInstanceHandler(payload, sender);
      expect(consoleSpy).toHaveBeenCalledWith('[server-instance-handler] Failed to handle delete-server-instance:', undefined);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('delete-server-instance', {
        success: false,
        id: 'instance-1',
        requestId: 'req-1'
      }, sender);
      consoleSpy.mockRestore();
    });

    it('should not send notification if result.success is false', async () => {
      mockServerManagementService.deleteInstance.mockResolvedValueOnce({ success: false, id: 'id-2' });
      await deleteInstanceHandler({ id: 'id-2', requestId: 'req-del-2' }, mockSender);
      const notifCall = (mockMessagingService.sendToAllOthers as any).mock.calls.find((c: any[]) => c[0] === 'notification');
      expect(notifCall).toBeUndefined();
      const call = (mockMessagingService.sendToOriginator as any).mock.calls.find((c: any[]) => c[0] === 'delete-server-instance');
      expect(call).toBeDefined();
      expect(call[1].success).toBe(false);
      expect(call[1].id).toBe('id-2');
      expect(call[1].requestId).toBe('req-del-2');
    });
  });

  // Fallback: payload undefined for all handlers
  describe('payload fallback coverage', () => {
    it('should send correct notification for server update with missing name but present id (save-server-instance)', async () => {
      const oldInstance = { id: 'id-xyz' }; // name missing
      const newInstance = { id: 'id-xyz' }; // name missing, id present
      jest.spyOn(require('../utils/ark/instance.utils'), 'getInstance').mockResolvedValueOnce(oldInstance);
      mockServerManagementService.saveInstance.mockResolvedValue({ success: true, instance: newInstance });
      mockServerManagementService.getAllInstances.mockResolvedValue({ instances: [newInstance] });
      await saveInstanceHandler({ instance: newInstance }, mockSender);
      const call = (mockMessagingService.sendToAllOthers as any).mock.calls.find((c: any[]) => c[0] === 'notification');
      expect(call).toBeDefined();
      expect(call[1].message).toContain('id-xyz');
      expect(call[1].message).toContain('updated');
      expect(call[1].message).not.toContain('Unknown');
    });

    it('should send correct notification for server add with missing name and id (save-server-instance)', async () => {
      const oldInstance = {}; // name and id missing
      const newInstance = {}; // name and id missing
      jest.spyOn(require('../utils/ark/instance.utils'), 'getInstance').mockResolvedValueOnce(oldInstance);
      mockServerManagementService.saveInstance.mockResolvedValue({ success: true, instance: newInstance });
      mockServerManagementService.getAllInstances.mockResolvedValue({ instances: [newInstance] });
      await saveInstanceHandler({ instance: newInstance }, mockSender);
      const call = (mockMessagingService.sendToAllOthers as any).mock.calls.find((c: any[]) => c[0] === 'notification');
      expect(call).toBeDefined();
      expect(call[1].message).toContain('Unknown');
      expect(call[1].message).toContain('added');
    });
    it('should send correct notification for server add with missing name but present id (save-server-instance)', async () => {
      jest.spyOn(require('../utils/ark/instance.utils'), 'getInstance').mockResolvedValueOnce(null);
      const newInstance = { id: 'id-xyz' }; // name missing, id present
      mockServerManagementService.saveInstance.mockResolvedValue({ success: true, instance: newInstance });
      mockServerManagementService.getAllInstances.mockResolvedValue({ instances: [newInstance] });
      await saveInstanceHandler({ instance: newInstance }, mockSender);
      const call = (mockMessagingService.sendToAllOthers as any).mock.calls.find((c: any[]) => c[0] === 'notification');
      expect(call).toBeDefined();
      expect(call[1].message).toContain('id-xyz');
      expect(call[1].message).not.toContain('Unknown');
    });
    it('should send correct notification for server add with missing name and id (save-server-instance)', async () => {
      jest.spyOn(require('../utils/ark/instance.utils'), 'getInstance').mockResolvedValueOnce(null);
      const newInstance = {};
      mockServerManagementService.saveInstance.mockResolvedValue({ success: true, instance: newInstance });
      mockServerManagementService.getAllInstances.mockResolvedValue({ instances: [newInstance] });
      await saveInstanceHandler({ instance: newInstance }, mockSender);
      const call = (mockMessagingService.sendToAllOthers as any).mock.calls.find((c: any[]) => c[0] === 'notification');
      expect(call).toBeDefined();
      expect(call[1].message).toContain('Unknown');
    });
    it('start-server-instance: should use fallback error message if thrown value is string', async () => {
      mockServerInstanceService.getStandardEventCallbacks.mockReturnValue({ onLog: jest.fn(), onState: jest.fn() });
      mockServerInstanceService.startServerInstance.mockRejectedValue('fail');
      await startInstanceHandler({ id: 'id1' }, mockSender);
      const call = (mockMessagingService.sendToOriginator as any).mock.calls.find((c: any[]) => c[0] === 'start-server-instance');
      expect(call).toBeDefined();
      expect(call[1].success).toBe(false);
      expect(call[1].error).toBe('Failed to start server');
    });

    it('connect-rcon: should use fallback error message if thrown value is string', async () => {
      mockServerOperationsService.connectRcon.mockRejectedValue('fail');
      await connectRconHandler({ id: 'id1' }, mockSender);
      const call = (mockMessagingService.sendToOriginator as any).mock.calls.find((c: any[]) => c[0] === 'connect-rcon');
      expect(call).toBeDefined();
      expect(call[1].success).toBe(false);
      expect(call[1].error).toBe('Failed to connect RCON');
    });

    it('rcon-command: should use fallback error message if thrown value is string', async () => {
      mockServerOperationsService.executeRconCommand.mockRejectedValue('fail');
      await rconCommandHandler({ id: 'id1', command: 'cmd' }, mockSender);
      const call = (mockMessagingService.sendToOriginator as any).mock.calls.find((c: any[]) => c[0] === 'rcon-command');
      expect(call).toBeDefined();
      expect(call[1].response).toBe('RCON command failed');
    });

    it('save-server-instance: should use fallback error message if thrown value is string', async () => {
      mockServerManagementService.saveInstance.mockRejectedValue('fail');
      await saveInstanceHandler({ instance: { id: 'id1' } }, mockSender);
      const call = (mockMessagingService.sendToOriginator as any).mock.calls.find((c: any[]) => c[0] === 'save-server-instance');
      expect(call).toBeDefined();
      expect(call[1].success).toBe(false);
      expect(call[1].error).toBe('Failed to save server instance');
    });

    it('import-server-from-backup: should use fallback error message if thrown value is string', async () => {
      mockServerInstanceService.importServerFromBackup.mockRejectedValue('fail');
      await importBackupHandler({ serverName: 's', backupFilePath: 'b', fileData: 'd', fileName: 'f' }, mockSender);
      const call = (mockMessagingService.sendToOriginator as any).mock.calls.find((c: any[]) => c[0] === 'import-server-from-backup');
      expect(call).toBeDefined();
      expect(call[1].success).toBe(false);
      expect(call[1].error).toBe('Failed to import server from backup');
    });

    it('should call sendToAll in startPlayerPolling callback (connect-rcon)', async () => {
      const instanceId = 'abc123';
      const count = 42;
      mockServerOperationsService.connectRcon.mockResolvedValue({ connected: true, success: true, instanceId });
      mockServerMonitoringService.startPlayerPolling.mockImplementation((id, cb) => {
        cb(instanceId, count);
      });
      await connectRconHandler({ id: instanceId }, mockSender);
      const call = (mockMessagingService.sendToAll as any).mock.calls.find(
        (c: any[]) => c[0] === 'server-instance-players'
      );
      expect(call).toBeDefined();
      expect(call[1]).toEqual({ instanceId, players: count });
    });

    it('should send portError notification if present and sender.send is function (start-server-instance)', async () => {
      const portError = 'Port in use';
      const senderWithSend = { send: jest.fn() };
      mockServerInstanceService.getStandardEventCallbacks.mockReturnValue({ onLog: jest.fn(), onState: jest.fn() });
      mockServerInstanceService.startServerInstance.mockResolvedValue({ started: false, portError, instanceId: 'id1' });
      await startInstanceHandler({ id: 'id1' }, senderWithSend);
      const call = (senderWithSend.send as any).mock.calls.slice(-1)[0];
      expect(call[0]).toBe('notification');
      expect(call[1].type).toBe('error');
      expect(call[1].message).toBe(portError);
    });

    it('should send correct notification for server rename (save-server-instance)', async () => {
      const oldInstance = { id: 'id1', name: 'OldName' };
      const newInstance = { id: 'id1', name: 'NewName' };
      jest.spyOn(require('../utils/ark/instance.utils'), 'getInstance').mockResolvedValueOnce(oldInstance);
      mockServerManagementService.saveInstance.mockResolvedValue({ success: true, instance: newInstance });
      mockServerManagementService.getAllInstances.mockResolvedValue({ instances: [newInstance] });
      await saveInstanceHandler({ instance: newInstance }, mockSender);
      const call = (mockMessagingService.sendToAllOthers as any).mock.calls.find((c: any[]) => c[0] === 'notification');
      expect(call).toBeDefined();
      expect(call[1].message).toContain('renamed');
    });

    it('should send correct notification for server add (save-server-instance)', async () => {
      jest.spyOn(require('../utils/ark/instance.utils'), 'getInstance').mockResolvedValueOnce(null);
      const newInstance = { id: 'id2', name: 'AddedName' };
      mockServerManagementService.saveInstance.mockResolvedValue({ success: true, instance: newInstance });
      mockServerManagementService.getAllInstances.mockResolvedValue({ instances: [newInstance] });
      await saveInstanceHandler({ instance: newInstance }, mockSender);
      const call = (mockMessagingService.sendToAllOthers as any).mock.calls.find((c: any[]) => c[0] === 'notification');
      expect(call).toBeDefined();
      expect(call[1].message).toContain('added');
    });

    it('should handle error in import-server-from-backup', async () => {
      mockServerInstanceService.importServerFromBackup.mockRejectedValue(new Error('fail import'));
      await importBackupHandler({ serverName: 's', backupFilePath: 'b', fileData: 'd', fileName: 'f' }, mockSender);
      const call = (mockMessagingService.sendToOriginator as any).mock.calls.find((c: any[]) => c[0] === 'import-server-from-backup');
      expect(call).toBeDefined();
      expect(call[1].success).toBe(false);
      expect(typeof call[1].error).toBe('string');
    });

    it('force-stop-server-instance: should handle undefined payload', async () => {
      mockServerInstanceService.forceStopInstance.mockResolvedValue({ success: true, instanceId: '' });
      await forceStopHandler(undefined, mockSender);
      expect(mockServerInstanceService.forceStopInstance).toHaveBeenCalled();
    });
    it('get-server-instance-state: should handle undefined payload', async () => {
      mockGetNormalizedInstanceState.mockReturnValue('stopped');
      await getStateHandler(undefined, mockSender);
      expect(mockGetNormalizedInstanceState).toHaveBeenCalled();
    });
    it('get-server-instance-logs: should handle undefined payload', async () => {
      mockServerMonitoringService.getInstanceLogs.mockReturnValue({ log: '', instanceId: '' });
      await getLogsHandler(undefined, mockSender);
      expect(mockServerMonitoringService.getInstanceLogs).toHaveBeenCalled();
    });
    it('connect-rcon: should handle undefined payload', async () => {
      mockServerOperationsService.connectRcon.mockResolvedValue({ success: true, connected: true, instanceId: '' });
      await connectRconHandler(undefined, mockSender);
      expect(mockServerOperationsService.connectRcon).toHaveBeenCalled();
    });
    it('disconnect-rcon: should handle undefined payload', async () => {
      mockServerOperationsService.disconnectRcon.mockResolvedValue({ success: true, connected: false, instanceId: '' });
      await disconnectRconHandler(undefined, mockSender);
      expect(mockServerOperationsService.disconnectRcon).toHaveBeenCalled();
    });
    it('get-rcon-status: should handle undefined payload', async () => {
      (mockServerOperationsService.getRconStatus as any).mockResolvedValue({ success: true, connected: true, instanceId: '' });
      await getRconStatusHandler(undefined, mockSender);
      expect(mockServerOperationsService.getRconStatus).toHaveBeenCalled();
    });
    it('rcon-command: should handle undefined payload', async () => {
      mockServerOperationsService.executeRconCommand.mockResolvedValue({ success: true, response: '', instanceId: '' });
      await rconCommandHandler(undefined, mockSender);
      expect(mockServerOperationsService.executeRconCommand).toHaveBeenCalled();
    });
    it('start-server-instance: should handle undefined payload', async () => {
      mockServerInstanceService.startServerInstance.mockResolvedValue({ started: true, instanceId: '' });
      await startInstanceHandler(undefined, mockSender);
      const call = (mockServerInstanceService.startServerInstance as any).mock.calls.slice(-1)[0];
      expect(call[0]).toBeUndefined();
      expect(typeof call[1]).toBe('function');
      expect(typeof call[2]).toBe('function');
    });
    it('get-server-instance-players: should handle undefined payload', async () => {
      mockServerMonitoringService.getPlayerCount.mockReturnValue({ instanceId: '', players: 0 });
      await getPlayersHandler(undefined, mockSender);
      const call = (mockServerMonitoringService.getPlayerCount as any).mock.calls.slice(-1)[0];
      expect(call[0]).toBeUndefined();
    });
    it('get-server-instances: should handle undefined payload', async () => {
      mockServerManagementService.getAllInstances.mockResolvedValue({ instances: [] });
      await getInstancesHandler(undefined, mockSender);
      expect(mockServerManagementService.getAllInstances).toHaveBeenCalled();
    });
    it('get-server-instance: should handle undefined payload', async () => {
      mockServerManagementService.getInstance.mockResolvedValue({ instance: null });
      await getInstanceHandler(undefined, mockSender);
      const call = (mockServerManagementService.getInstance as any).mock.calls.slice(-1)[0];
      expect(call[0]).toBeUndefined();
    });
    it('save-server-instance: should handle undefined payload', async () => {
      mockServerManagementService.saveInstance.mockResolvedValue({ success: true, instance: {} });
      await saveInstanceHandler(undefined, mockSender);
      expect(mockServerManagementService.saveInstance).toHaveBeenCalledWith(undefined);
    });
    it('delete-server-instance: should handle undefined payload', async () => {
      mockServerManagementService.deleteInstance.mockResolvedValue({ success: true, id: '' });
      await deleteInstanceHandler(undefined, mockSender);
      const call = (mockServerManagementService.deleteInstance as any).mock.calls.slice(-1)[0];
      expect(call[0]).toBeUndefined();
    });
    it('import-server-from-backup: should handle undefined payload', async () => {
      mockServerInstanceService.importServerFromBackup.mockResolvedValue({ success: true, instance: {} });
      await importBackupHandler(undefined, mockSender);
      const call = (mockServerInstanceService.importServerFromBackup as any).mock.calls.slice(-1)[0];
      expect(call[0]).toBeUndefined();
      expect(call[1]).toBeUndefined();
      expect(call[2]).toBeUndefined();
      expect(call[3]).toBeUndefined();
    });
  });

  describe('force-stop-server-instance handler', () => {
    it('should send fallback error message if an error is thrown', async () => {
      // Simulate error thrown (not an Error instance)
      mockServerInstanceService.forceStopInstance.mockImplementation(() => { throw 'fail'; });
      await forceStopHandler({}, mockSender);
      const call = (mockMessagingService.sendToOriginator as any).mock.calls.find((c: any[]) => c[0] === 'force-stop-server-instance');
      expect(call).toBeDefined();
      expect(call[1].success).toBe(false);
      expect(call[1].error).toBe('Failed to force stop server');
    });
    it('should send error message if an Error is thrown', async () => {
      mockServerInstanceService.forceStopInstance.mockImplementation(() => { throw new Error('custom error'); });
      await forceStopHandler({}, mockSender);
      const call = (mockMessagingService.sendToOriginator as any).mock.calls.find((c: any[]) => c[0] === 'force-stop-server-instance');
      expect(call).toBeDefined();
      expect(call[1].success).toBe(false);
      expect(call[1].error).toBe('custom error');
    });
  });
  describe('import-server-from-backup handler', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockServerProcessService.getNormalizedInstanceState.mockReset();
    });
    it('should not send error if result.success is false but no error is thrown', async () => {
      mockServerInstanceService.importServerFromBackup.mockResolvedValueOnce({ success: false, error: 'restore failed' });
      mockServerManagementService.getAllInstances.mockResolvedValueOnce({ instances: [] });
      await importBackupHandler({ backupPath: 'foo', requestId: 'req-4' }, mockSender);
      // Should not throw, should not call error fallback
      const call = (mockMessagingService.sendToOriginator as any).mock.calls.find((c: any[]) => c[0] === 'import-server-from-backup');
      expect(call).toBeDefined();
      expect(call[1].success).toBe(false);
      expect(call[1].error).toBe('restore failed');
    });

    it('should send error message if an Error is thrown', async () => {
      mockServerInstanceService.importServerFromBackup.mockImplementation(() => { throw new Error('custom import error'); });
      await importBackupHandler({ backupPath: 'foo', requestId: 'req-2' }, mockSender);
      const call = (mockMessagingService.sendToOriginator as any).mock.calls.find((c: any[]) => c[0] === 'import-server-from-backup');
      expect(call).toBeDefined();
      expect(call[1].success).toBe(false);
      expect(call[1].error).toBe('custom import error');
    });

    it('should send fallback error message if a non-Error is thrown', async () => {
      mockServerInstanceService.importServerFromBackup.mockImplementation(() => { throw 'fail'; });
      await importBackupHandler({ backupPath: 'foo', requestId: 'req-3' }, mockSender);
      const call = (mockMessagingService.sendToOriginator as any).mock.calls.find((c: any[]) => c[0] === 'import-server-from-backup');
      expect(call).toBeDefined();
      expect(call[1].success).toBe(false);
      expect(call[1].error).toBe('Failed to import server from backup');
    });
  });
  describe('force-stop-server-instance handler', () => {
    it('should not send notification if result.success is false', async () => {
      mockServerInstanceService.forceStopInstance.mockResolvedValueOnce({ success: false, error: 'fail' });
      await forceStopHandler({ id: 'test-id', requestId: 'req-1' }, mockSender);
      // Should not send notification
      const notifCall = (mockMessagingService.sendToAll as any).mock.calls.find((c: any[]) => c[0] === 'notification');
      expect(notifCall).toBeUndefined();
      // Should send result to originator
      const originCall = (mockMessagingService.sendToOriginator as any).mock.calls.find((c: any[]) => c[0] === 'force-stop-server-instance');
      expect(originCall).toBeDefined();
      expect(originCall[1].success).toBe(false);
      expect(originCall[1].error).toBe('fail');
    });
  });
