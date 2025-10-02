import { messagingService } from '../services/messaging.service';
import { installService } from '../services/install.service';

// Mock the services
jest.mock('../services/messaging.service');
jest.mock('../services/install.service');

const mockMessagingService = messagingService as jest.Mocked<typeof messagingService>;
const mockInstallService = installService as jest.Mocked<typeof installService>;

// Import the handler to register the event listeners
import '../handlers/install-handler';

// Get the registered event handlers
const checkInstallRequirementsHandler = mockMessagingService.on.mock.calls.find(call => call[0] === 'check-install-requirements')?.[1] as (payload: any, sender: any) => Promise<void>;
const installHandler = mockMessagingService.on.mock.calls.find(call => call[0] === 'install')?.[1] as (payload: any, sender: any) => Promise<void>;
const cancelInstallHandler = mockMessagingService.on.mock.calls.find(call => call[0] === 'cancel-install')?.[1] as (payload: any, sender: any) => void;

const mockSender = {} as Electron.WebContents;

describe('Install Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('check-install-requirements event', () => {
    it('should check install requirements successfully', async () => {
      const payload = {
        target: 'server',
        requestId: 'test-123'
      };
      const expectedResult = {
        success: true,
        requiresSudo: true,
        missingDependencies: [],
        canProceed: true,
        message: 'All requirements met'
      };

      mockInstallService.checkInstallRequirements.mockResolvedValue(expectedResult);

      await checkInstallRequirementsHandler(payload, mockSender);

      expect(mockInstallService.checkInstallRequirements).toHaveBeenCalledWith('server');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('check-install-requirements', {
        success: true,
        requiresSudo: true,
        missingDependencies: [],
        canProceed: true,
        message: 'All requirements met',
        requestId: 'test-123'
      }, mockSender);
    });

    it('should handle check install requirements failure', async () => {
      const payload = {
        target: 'server',
        requestId: 'test-123'
      };
      const expectedResult = {
        success: false,
        requiresSudo: false,
        missingDependencies: ['steamcmd'],
        canProceed: false,
        message: 'Missing dependencies',
        error: 'SteamCMD not found'
      };

      mockInstallService.checkInstallRequirements.mockResolvedValue(expectedResult);

      await checkInstallRequirementsHandler(payload, mockSender);

      expect(mockInstallService.checkInstallRequirements).toHaveBeenCalledWith('server');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('check-install-requirements', {
        success: false,
        requiresSudo: false,
        missingDependencies: ['steamcmd'],
        canProceed: false,
        message: 'Missing dependencies',
        error: 'SteamCMD not found',
        requestId: 'test-123'
      }, mockSender);
    });

    it('should handle check install requirements exception', async () => {
      const payload = {
        target: 'server',
        requestId: 'test-123'
      };
      const error = new Error('System check failed');

      mockInstallService.checkInstallRequirements.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await checkInstallRequirementsHandler(payload, mockSender);

      expect(mockInstallService.checkInstallRequirements).toHaveBeenCalledWith('server');
      expect(consoleSpy).toHaveBeenCalledWith('[install-handler] Error checking install requirements:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('check-install-requirements', {
        success: false,
        error: 'System check failed',
        requestId: 'test-123'
      }, mockSender);

      consoleSpy.mockRestore();
    });

    it('should handle check install requirements with undefined payload (cover || {} branch)', async () => {
      const expectedResult = { success: true, requiresSudo: false, missingDependencies: [], canProceed: true, message: 'OK' };
      mockInstallService.checkInstallRequirements.mockResolvedValue(expectedResult);
      await checkInstallRequirementsHandler(undefined, mockSender);
  expect(mockInstallService.checkInstallRequirements).toHaveBeenCalledWith(undefined as any);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('check-install-requirements', {
        ...expectedResult,
        requestId: undefined
      }, mockSender);
    });

    it('should handle check install requirements with non-Error exception (cover String(error) branch)', async () => {
      mockInstallService.checkInstallRequirements.mockRejectedValue('String error');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await checkInstallRequirementsHandler({}, mockSender);
      expect(mockInstallService.checkInstallRequirements).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('[install-handler] Error checking install requirements:', 'String error');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('check-install-requirements', {
        success: false,
        error: 'String error',
        requestId: undefined
      }, mockSender);
      consoleSpy.mockRestore();
    });
  });

  describe('install event', () => {
    it('should send progress data as-is when requestId is missing (cover fallback branch)', async () => {
      const payload = { target: 'steamcmd' };
      mockInstallService.installComponent.mockImplementation(async (_target, emitOutput) => {
        emitOutput('No ID');
        return { status: 'success', target: 'steamcmd', message: 'done' };
      });
      await installHandler(payload, mockSender);
      // Find the call with the fallback data
      const calls = mockMessagingService.sendToOriginator.mock.calls.filter(call =>
        call[0] === 'install' && call[1]?.data === 'No ID'
      );
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0]).toEqual([
        'install',
        {
          target: 'steamcmd',
          data: 'No ID',
          requestId: undefined
        },
        mockSender
      ]);
    });
    it('should append requestId in catch branch when progress data is null (cover catch else branch)', async () => {
      const payload = { target: 'steamcmd', requestId: 'null-id' };
      mockInstallService.installComponent.mockImplementation(async (_target, emitOutput) => {
        emitOutput(null);
        return { status: 'success', target: 'steamcmd', message: 'done' };
      });
      await installHandler(payload, mockSender);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('install', {
        target: 'steamcmd',
        data: 'null|requestId:null-id',
        requestId: 'null-id'
      }, mockSender);
    });
    it('should use fallback error message if result.error is undefined (cover || "Installation failed")', async () => {
      const payload = { target: 'server', requestId: 'fallback-err' };
      const expectedResult = {
        status: 'error' as const,
        target: 'server',
        // error is intentionally undefined
        message: undefined
      };
      mockInstallService.installComponent.mockResolvedValue(expectedResult as any);
      await installHandler(payload, mockSender);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('install', {
        target: 'server',
        data: {
          error: 'Installation failed',
          message: 'Installation failed',
          step: 'error',
          target: 'server',
          requestId: 'fallback-err'
        },
        requestId: 'fallback-err'
      }, mockSender);
    });
    it('should use fallback target "unknown" if both result.target and payload.target are undefined', async () => {
      // Simulate installComponent returning error status with no target
      const expectedResult = {
        status: 'error',
        // no target property
        error: 'Something went wrong',
        message: 'Something went wrong'
      };
      mockInstallService.installComponent.mockResolvedValue(expectedResult as any);
      // Call with payload that also has no target
      await installHandler({}, mockSender);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('install', {
        target: 'unknown',
        data: {
          error: 'Something went wrong',
          message: 'Something went wrong',
          step: 'error',
          target: undefined,
          requestId: undefined
        },
        requestId: undefined
      }, mockSender);
    });
    it('should handle valid progress data (cover parsed.step && parsed.percent !== undefined branch)', async () => {
      const payload = { target: 'steamcmd', requestId: 'test-progress' };
      // Simulate installComponent calling emitOutput with valid progress data
      mockInstallService.installComponent.mockImplementation(async (_target, emitOutput) => {
        emitOutput(JSON.stringify({ step: 'downloading', percent: 42 }));
        return { status: 'success', target: 'steamcmd', message: 'done' };
      });
      await installHandler(payload, mockSender);
      // No error should be logged, but sendToOriginator should be called with progress
      // Find a call to sendToOriginator with the correct event, target, and requestId
      const calls = mockMessagingService.sendToOriginator.mock.calls;
      const found = calls.some(call =>
        call[0] === 'install' &&
        call[1] && call[1].target === 'steamcmd' && call[1].requestId === 'test-progress' &&
        call[2] === mockSender
      );
      expect(found).toBe(true);
    });
    it('should install component successfully', async () => {
      const payload = {
        target: 'steamcmd',
        requestId: 'test-123',
        sudoPassword: 'password123'
      };
      const expectedResult = {
        status: 'success' as const,
        target: 'steamcmd',
        message: 'Installation completed successfully'
      };

      mockInstallService.installComponent.mockResolvedValue(expectedResult);

      await installHandler(payload, mockSender);

      expect(mockInstallService.installComponent).toHaveBeenCalled();
      // Should emit final success message
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('install', {
        target: 'steamcmd',
        data: '[install-handler] Install complete: [object Object]|requestId:test-123',
        requestId: 'test-123'
      }, mockSender);
    });

    it('should handle install component error status', async () => {
      const payload = {
        target: 'server',
        requestId: 'test-123'
      };
      const expectedResult = {
        status: 'error' as const,
        target: 'server',
        error: 'Installation failed',
        message: 'SteamCMD installation failed'
      };

      mockInstallService.installComponent.mockResolvedValue(expectedResult);

      await installHandler(payload, mockSender);

            expect(mockInstallService.installComponent).toHaveBeenCalled();
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('install', {
        target: 'server',
        data: {
          error: 'Installation failed',
          message: 'Installation failed',
          step: 'error',
          target: 'server',
          requestId: 'test-123'
        },
        requestId: 'test-123'
      }, mockSender);
    });

    it('should handle install component exception', async () => {
      const payload = {
        target: 'proton',
        requestId: 'test-123'
      };
      const error = new Error('Network timeout');

      mockInstallService.installComponent.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await installHandler(payload, mockSender);

            expect(mockInstallService.installComponent).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('[install-handler] Unexpected error during installation:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('install', {
        target: 'proton',
        data: { error: 'Network timeout', requestId: 'test-123' },
        requestId: 'test-123'
      }, mockSender);

      consoleSpy.mockRestore();
    });

    it('should handle install with undefined payload (cover || {} branch)', async () => {
      const expectedResult = { status: 'success', target: 'default', message: 'OK' };
      mockInstallService.installComponent.mockResolvedValue(expectedResult as any);
      await installHandler(undefined, mockSender);
      const callArgs = (mockInstallService.installComponent as jest.Mock).mock.calls[0];
      expect(callArgs[0]).toBeUndefined();
      expect(typeof callArgs[1]).toBe('function');
      expect(callArgs[2]).toBeUndefined();
      // The handler emits a final output, so we check for at least one sendToOriginator call
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalled();
    });

    it('should handle install with non-Error exception (cover String(error) branch)', async () => {
      mockInstallService.installComponent.mockRejectedValue('String error');
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await installHandler({}, mockSender);
      expect(mockInstallService.installComponent).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('[install-handler] Unexpected error during installation:', 'String error');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('install', {
        target: 'unknown',
        data: { error: 'String error', requestId: undefined },
        requestId: undefined
      }, mockSender);
      consoleSpy.mockRestore();
    });

    it('should log error if progress data starts with "Error:" (cover emitOutput error branch)', async () => {
      const payload = { target: 'steamcmd', requestId: 'test-err' };
      // Pass a string that starts with 'Error:' to trigger the branch
      mockInstallService.installComponent.mockImplementation(async (_target, emitOutput) => {
        emitOutput('Error: Something went wrong');
        return { status: 'success', target: 'steamcmd', message: 'done' };
      });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await installHandler(payload, mockSender);
    expect(consoleSpy).toHaveBeenCalledWith('[install-handler] [steamcmd] Error: Something went wrong');
      consoleSpy.mockRestore();
    });

    it('should handle progress data that is a non-JSON, non-error string (cover emitOutput else branch)', async () => {
      const payload = { target: 'steamcmd', requestId: 'test-plain' };
      mockInstallService.installComponent.mockImplementation(async (_target, emitOutput) => {
        emitOutput('Just a message');
        return { status: 'success', target: 'steamcmd', message: 'done' };
      });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await installHandler(payload, mockSender);
      // Should NOT log an error
      expect(consoleSpy).not.toHaveBeenCalled();
      // Should call sendToOriginator with the string and requestId appended
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('install', {
        target: 'steamcmd',
        data: 'Just a message|requestId:test-plain',
        requestId: 'test-plain'
      }, mockSender);
      consoleSpy.mockRestore();
    });

    it('should append requestId to non-JSON string progress data (cover catch else branch)', async () => {
      const payload = { target: 'steamcmd', requestId: 'append-id' };
      mockInstallService.installComponent.mockImplementation(async (_target, emitOutput) => {
        emitOutput('Not JSON');
        return { status: 'success', target: 'steamcmd', message: 'done' };
      });
      await installHandler(payload, mockSender);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('install', {
        target: 'steamcmd',
        data: 'Not JSON|requestId:append-id',
        requestId: 'append-id'
      }, mockSender);
    });
  });

  describe('cancel-install event', () => {
    it('should cancel installation successfully', () => {
      const payload = {
        target: 'server',
        requestId: 'test-123'
      };
      const expectedResult = {
        success: true,
        target: 'server'
      };

      mockInstallService.cancelInstallation.mockReturnValue(expectedResult);

      cancelInstallHandler(payload, mockSender);

      expect(mockInstallService.cancelInstallation).toHaveBeenCalledWith('server');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('cancel-install', {
        target: 'server',
        data: { cancelled: true, requestId: 'test-123' },
        requestId: 'test-123'
      }, mockSender);
    });

    it('should handle cancel installation failure', () => {
      const payload = {
        target: 'steamcmd',
        requestId: 'test-123'
      };
      const expectedResult = {
        success: false,
        target: 'steamcmd'
      };

      mockInstallService.cancelInstallation.mockReturnValue(expectedResult);

      cancelInstallHandler(payload, mockSender);

      expect(mockInstallService.cancelInstallation).toHaveBeenCalledWith('steamcmd');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('cancel-install', {
        target: 'steamcmd',
        data: { error: 'Cancellation not supported for this target', requestId: 'test-123' },
        requestId: 'test-123'
      }, mockSender);
    });

    it('should handle cancel installation exception', () => {
      const payload = {
        target: 'proton',
        requestId: 'test-123'
      };
      const error = new Error('Process not found');

      mockInstallService.cancelInstallation.mockImplementation(() => {
        throw error;
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      cancelInstallHandler(payload, mockSender);

      expect(mockInstallService.cancelInstallation).toHaveBeenCalledWith('proton');
      expect(consoleSpy).toHaveBeenCalledWith('[install-handler] Error cancelling installation:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('cancel-install', {
        target: 'proton',
        data: { error: 'Process not found', requestId: 'test-123' },
        requestId: 'test-123'
      }, mockSender);

      consoleSpy.mockRestore();
    });

    it('should handle cancel-install with undefined payload (cover || {} branch)', () => {
      const expectedResult = { success: true, target: 'default' };
      mockInstallService.cancelInstallation.mockReturnValue(expectedResult as any);
      cancelInstallHandler(undefined, mockSender);
  expect(mockInstallService.cancelInstallation).toHaveBeenCalledWith(undefined as any);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('cancel-install', {
        target: 'default',
        data: { cancelled: true, requestId: undefined },
        requestId: undefined
      }, mockSender);
    });

    it('should handle cancel-install with non-Error exception (cover String(error) branch)', () => {
      mockInstallService.cancelInstallation.mockImplementation(() => { throw 'String error'; });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      cancelInstallHandler({}, mockSender);
      expect(mockInstallService.cancelInstallation).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('[install-handler] Error cancelling installation:', 'String error');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('cancel-install', {
        target: 'unknown',
        data: { error: 'String error', requestId: undefined },
        requestId: undefined
      }, mockSender);
      consoleSpy.mockRestore();
    });
  });
});