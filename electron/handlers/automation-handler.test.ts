// Mock the services
jest.mock('../services/messaging.service');
jest.mock('../services/automation/automation.service', () => ({
  automationService: {
    configureAutostart: jest.fn(),
    configureCrashDetection: jest.fn(),
    configureScheduledRestart: jest.fn(),
    getAutomationStatus: jest.fn(),
    handleAutoStartOnAppLaunch: jest.fn()
  }
}));

import { messagingService } from '../services/messaging.service';
import { automationService } from '../services/automation/automation.service';

const mockMessagingService = messagingService as jest.Mocked<typeof messagingService>;
const mockAutomationService = automationService as jest.Mocked<typeof automationService>;

// Store handler functions for testing
let configureAutostartHandler: Function;
let configureCrashDetectionHandler: Function;
let configureScheduledRestartHandler: Function;
let getAutomationStatusHandler: Function;
let autoStartOnAppLaunchHandler: Function;

describe('Automation Handler', () => {
  let mockSender: any;

  beforeAll(() => {
    // Import handler to register events
    require('./automation-handler');

    // Capture the registered event handlers
    const mockOn = mockMessagingService.on as jest.Mock;
    mockOn.mock.calls.forEach(([event, handler]) => {
      switch (event) {
        case 'configure-autostart':
          configureAutostartHandler = handler;
          break;
        case 'configure-crash-detection':
          configureCrashDetectionHandler = handler;
          break;
        case 'configure-scheduled-restart':
          configureScheduledRestartHandler = handler;
          break;
        case 'get-automation-status':
          getAutomationStatusHandler = handler;
          break;
        case 'auto-start-on-app-launch':
          autoStartOnAppLaunchHandler = handler;
          break;
      }
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSender = {};
  });

  describe('configure-autostart event', () => {
    it('should configure autostart successfully', async () => {
      const payload = {
        serverId: 'test-server',
        autoStartOnAppLaunch: true,
        autoStartOnBoot: false,
        requestId: 'test-123'
      };
      const expectedResult = { success: true };

      mockAutomationService.configureAutostart.mockResolvedValue(expectedResult);

      await configureAutostartHandler(payload, mockSender);

      expect(mockAutomationService.configureAutostart).toHaveBeenCalledWith('test-server', true, false);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('configure-autostart', {
        success: true,
        requestId: 'test-123'
      }, mockSender);
    });

    it('should handle configure autostart failure', async () => {
      const payload = {
        serverId: 'test-server',
        autoStartOnAppLaunch: false,
        autoStartOnBoot: true
      };
      const expectedResult = { success: false, error: 'Configuration failed' };

      mockAutomationService.configureAutostart.mockResolvedValue(expectedResult);

      await configureAutostartHandler(payload, mockSender);

      expect(mockAutomationService.configureAutostart).toHaveBeenCalledWith('test-server', false, true);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('configure-autostart', {
        success: false,
        error: 'Configuration failed',
        requestId: undefined
      }, mockSender);
    });

    it('should handle configure autostart exception', async () => {
      const payload = { serverId: 'test-server', autoStartOnAppLaunch: true, autoStartOnBoot: false };
      const error = new Error('Service error');

      mockAutomationService.configureAutostart.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await configureAutostartHandler(payload, mockSender);

      expect(mockAutomationService.configureAutostart).toHaveBeenCalledWith('test-server', true, false);
      expect(consoleSpy).toHaveBeenCalledWith('[automation-handler] Error configuring autostart:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('configure-autostart', {
        success: false,
        error: 'Service error',
        requestId: undefined
      }, mockSender);

      consoleSpy.mockRestore();
    });

    it('should handle undefined payload', async () => {
      const expectedResult = { success: true };

      mockAutomationService.configureAutostart.mockResolvedValue(expectedResult);

      await configureAutostartHandler(undefined, mockSender);

      expect(mockAutomationService.configureAutostart).toHaveBeenCalledWith(undefined as any, undefined as any, undefined as any);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('configure-autostart', {
        success: true,
        requestId: undefined
      }, mockSender);
    });

    it('should handle non-Error exception (cover String(error) branch)', async () => {
      const error = 'String error';
      mockAutomationService.configureAutostart.mockRejectedValue(error);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await configureAutostartHandler({}, mockSender);
      expect(mockAutomationService.configureAutostart).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('[automation-handler] Error configuring autostart:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('configure-autostart', {
        success: false,
        error: 'String error',
        requestId: undefined
      }, mockSender);
      consoleSpy.mockRestore();
    });
  });

  describe('configure-crash-detection event', () => {
    it('should configure crash detection successfully', async () => {
      const payload = {
        serverId: 'test-server',
        enabled: true,
        checkInterval: 30000,
        maxRestartAttempts: 3,
        requestId: 'test-123'
      };
      const expectedResult = { success: true };

      mockAutomationService.configureCrashDetection.mockResolvedValue(expectedResult);

      await configureCrashDetectionHandler(payload, mockSender);

      expect(mockAutomationService.configureCrashDetection).toHaveBeenCalledWith('test-server', true, 30000, 3);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('configure-crash-detection', {
        success: true,
        requestId: 'test-123'
      }, mockSender);
    });

    it('should handle configure crash detection failure', async () => {
      const payload = {
        serverId: 'test-server',
        enabled: false,
        checkInterval: 60000,
        maxRestartAttempts: 5
      };
      const expectedResult = { success: false, error: 'Invalid configuration' };

      mockAutomationService.configureCrashDetection.mockResolvedValue(expectedResult);

      await configureCrashDetectionHandler(payload, mockSender);

      expect(mockAutomationService.configureCrashDetection).toHaveBeenCalledWith('test-server', false, 60000, 5);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('configure-crash-detection', {
        success: false,
        error: 'Invalid configuration',
        requestId: undefined
      }, mockSender);
    });

    it('should handle configure crash detection exception', async () => {
      const payload = { serverId: 'test-server', enabled: true, checkInterval: 30000, maxRestartAttempts: 3 };
      const error = new Error('Configuration error');

      mockAutomationService.configureCrashDetection.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await configureCrashDetectionHandler(payload, mockSender);

      expect(mockAutomationService.configureCrashDetection).toHaveBeenCalledWith('test-server', true, 30000, 3);
      expect(consoleSpy).toHaveBeenCalledWith('[automation-handler] Error configuring crash detection:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('configure-crash-detection', {
        success: false,
        error: 'Configuration error',
        requestId: undefined
      }, mockSender);

      consoleSpy.mockRestore();
    });

    it('should handle undefined payload (cover || {} branch)', async () => {
      const expectedResult = { success: true };
      mockAutomationService.configureCrashDetection.mockResolvedValue(expectedResult);
      await configureCrashDetectionHandler(undefined, mockSender);
  expect(mockAutomationService.configureCrashDetection).toHaveBeenCalledWith(undefined as any, undefined as any, undefined as any, undefined as any);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('configure-crash-detection', {
        success: true,
        requestId: undefined
      }, mockSender);
    });

    it('should handle non-Error exception (cover String(error) branch)', async () => {
      const error = 'String error';
      mockAutomationService.configureCrashDetection.mockRejectedValue(error);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await configureCrashDetectionHandler({}, mockSender);
      expect(mockAutomationService.configureCrashDetection).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('[automation-handler] Error configuring crash detection:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('configure-crash-detection', {
        success: false,
        error: 'String error',
        requestId: undefined
      }, mockSender);
      consoleSpy.mockRestore();
    });
  });

  describe('configure-scheduled-restart event', () => {
    it('should configure scheduled restart successfully', async () => {
      const payload = {
        serverId: 'test-server',
        enabled: true,
        frequency: 'daily' as const,
        time: '02:00',
        days: [1, 2, 3, 4, 5],
        warningMinutes: 30,
        requestId: 'test-123'
      };
      const expectedResult = { success: true };

      mockAutomationService.configureScheduledRestart.mockResolvedValue(expectedResult);

      await configureScheduledRestartHandler(payload, mockSender);

      expect(mockAutomationService.configureScheduledRestart).toHaveBeenCalledWith('test-server', true, 'daily', '02:00', [1, 2, 3, 4, 5], 30);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('configure-scheduled-restart', {
        success: true,
        requestId: 'test-123'
      }, mockSender);
    });

    it('should handle configure scheduled restart failure', async () => {
      const payload = {
        serverId: 'test-server',
        enabled: false,
        frequency: 'weekly' as const,
        time: '03:00',
        days: [0, 6],
        warningMinutes: 15
      };
      const expectedResult = { success: false, error: 'Invalid schedule' };

      mockAutomationService.configureScheduledRestart.mockResolvedValue(expectedResult);

      await configureScheduledRestartHandler(payload, mockSender);

      expect(mockAutomationService.configureScheduledRestart).toHaveBeenCalledWith('test-server', false, 'weekly', '03:00', [0, 6], 15);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('configure-scheduled-restart', {
        success: false,
        error: 'Invalid schedule',
        requestId: undefined
      }, mockSender);
    });

    it('should handle configure scheduled restart exception', async () => {
      const payload = { serverId: 'test-server', enabled: true, frequency: 'daily' as const, time: '02:00', days: [1, 2, 3], warningMinutes: 30 };
      const error = new Error('Schedule error');

      mockAutomationService.configureScheduledRestart.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await configureScheduledRestartHandler(payload, mockSender);

      expect(mockAutomationService.configureScheduledRestart).toHaveBeenCalledWith('test-server', true, 'daily', '02:00', [1, 2, 3], 30);
      expect(consoleSpy).toHaveBeenCalledWith('[automation-handler] Error configuring scheduled restart:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('configure-scheduled-restart', {
        success: false,
        error: 'Schedule error',
        requestId: undefined
      }, mockSender);

      consoleSpy.mockRestore();
    });

    it('should handle undefined payload (cover || {} branch)', async () => {
      const expectedResult = { success: true };
      mockAutomationService.configureScheduledRestart.mockResolvedValue(expectedResult);
      await configureScheduledRestartHandler(undefined, mockSender);
  expect(mockAutomationService.configureScheduledRestart).toHaveBeenCalledWith(undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('configure-scheduled-restart', {
        success: true,
        requestId: undefined
      }, mockSender);
    });

    it('should handle non-Error exception (cover String(error) branch)', async () => {
      const error = 'String error';
      mockAutomationService.configureScheduledRestart.mockRejectedValue(error);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await configureScheduledRestartHandler({}, mockSender);
      expect(mockAutomationService.configureScheduledRestart).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('[automation-handler] Error configuring scheduled restart:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('configure-scheduled-restart', {
        success: false,
        error: 'String error',
        requestId: undefined
      }, mockSender);
      consoleSpy.mockRestore();
    });
  });

  describe('get-automation-status event', () => {
    it('should get automation status successfully', async () => {
      const payload = { serverId: 'test-server', requestId: 'test-123' };
      const expectedResult = {
        success: true,
        status: {
          settings: { autoStartOnAppLaunch: true },
          status: { isMonitoring: true },
          restartAttempts: 0
        }
      };

      mockAutomationService.getAutomationStatus.mockResolvedValue(expectedResult);

      await getAutomationStatusHandler(payload, mockSender);

      expect(mockAutomationService.getAutomationStatus).toHaveBeenCalledWith('test-server');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-automation-status', {
        success: true,
        status: {
          settings: { autoStartOnAppLaunch: true },
          status: { isMonitoring: true },
          restartAttempts: 0
        },
        requestId: 'test-123'
      }, mockSender);
    });

    it('should handle get automation status failure', async () => {
      const payload = { serverId: 'test-server' };
      const expectedResult = { success: false, error: 'Server not found' };

      mockAutomationService.getAutomationStatus.mockResolvedValue(expectedResult);

      await getAutomationStatusHandler(payload, mockSender);

      expect(mockAutomationService.getAutomationStatus).toHaveBeenCalledWith('test-server');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-automation-status', {
        success: false,
        error: 'Server not found',
        requestId: undefined
      }, mockSender);
    });

    it('should handle get automation status exception', async () => {
      const payload = { serverId: 'test-server' };
      const error = new Error('Status error');

      mockAutomationService.getAutomationStatus.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await getAutomationStatusHandler(payload, mockSender);

      expect(mockAutomationService.getAutomationStatus).toHaveBeenCalledWith('test-server');
      expect(consoleSpy).toHaveBeenCalledWith('[automation-handler] Error getting automation status:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-automation-status', {
        success: false,
        error: 'Status error',
        requestId: undefined
      }, mockSender);

      consoleSpy.mockRestore();
    });

    it('should handle undefined payload (cover || {} branch)', async () => {
      const expectedResult = { success: true, status: { foo: 'bar' } };
      mockAutomationService.getAutomationStatus.mockResolvedValue(expectedResult);
      await getAutomationStatusHandler(undefined, mockSender);
  expect(mockAutomationService.getAutomationStatus).toHaveBeenCalledWith(undefined as any);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-automation-status', {
        success: true,
        status: { foo: 'bar' },
        requestId: undefined
      }, mockSender);
    });

    it('should handle non-Error exception (cover String(error) branch)', async () => {
      const error = 'String error';
      mockAutomationService.getAutomationStatus.mockRejectedValue(error);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await getAutomationStatusHandler({}, mockSender);
      expect(mockAutomationService.getAutomationStatus).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('[automation-handler] Error getting automation status:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-automation-status', {
        success: false,
        error: 'String error',
        requestId: undefined
      }, mockSender);
      consoleSpy.mockRestore();
    });
  });

  describe('auto-start-on-app-launch event', () => {
    it('should handle auto-start on app launch successfully', async () => {
      const payload = { requestId: 'test-123' };

      mockAutomationService.handleAutoStartOnAppLaunch.mockResolvedValue(undefined);

      await autoStartOnAppLaunchHandler(payload, mockSender);

      expect(mockAutomationService.handleAutoStartOnAppLaunch).toHaveBeenCalled();
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('auto-start-on-app-launch', {
        success: true,
        requestId: 'test-123'
      }, mockSender);
    });

    it('should handle auto-start on app launch exception', async () => {
      const payload = {};
      const error = new Error('Auto-start failed');

      mockAutomationService.handleAutoStartOnAppLaunch.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await autoStartOnAppLaunchHandler(payload, mockSender);

      expect(mockAutomationService.handleAutoStartOnAppLaunch).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('[automation-handler] Error during auto-start on app launch:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('auto-start-on-app-launch', {
        success: false,
        error: 'Auto-start failed',
        requestId: undefined
      }, mockSender);

      consoleSpy.mockRestore();
    });

    it('should handle undefined payload (cover || {} branch)', async () => {
      mockAutomationService.handleAutoStartOnAppLaunch.mockResolvedValue(undefined);
      await autoStartOnAppLaunchHandler(undefined, mockSender);
      expect(mockAutomationService.handleAutoStartOnAppLaunch).toHaveBeenCalled();
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('auto-start-on-app-launch', {
        success: true,
        requestId: undefined
      }, mockSender);
    });

    it('should handle non-Error exception (cover String(error) branch)', async () => {
      const error = 'String error';
      mockAutomationService.handleAutoStartOnAppLaunch.mockRejectedValue(error);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await autoStartOnAppLaunchHandler({}, mockSender);
      expect(mockAutomationService.handleAutoStartOnAppLaunch).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('[automation-handler] Error during auto-start on app launch:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('auto-start-on-app-launch', {
        success: false,
        error: 'String error',
        requestId: undefined
      }, mockSender);
      consoleSpy.mockRestore();
    });
  });
});