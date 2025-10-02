import { jest } from '@jest/globals';

// Mock the services
jest.mock('../services/messaging.service', () => ({
  messagingService: {
    on: jest.fn(),
    sendToOriginator: jest.fn(),
    sendToAll: jest.fn(),
  },
}));

jest.mock('../services/settings.service', () => ({
  settingsService: {
    getGlobalConfig: jest.fn(),
    updateGlobalConfig: jest.fn(),
    updateWebServerAuth: jest.fn(),
  },
}));

import { messagingService } from '../services/messaging.service';
import { settingsService } from '../services/settings.service';

const mockMessagingService = messagingService as jest.Mocked<typeof messagingService>;
const mockSettingsService = settingsService as jest.Mocked<typeof settingsService>;

describe('settings-handler', () => {
  let mockSender: any;
  let getConfigHandler: (...args: any[]) => Promise<void>;
  let setConfigHandler: (...args: any[]) => Promise<void>;

  beforeAll(() => {
    // Import the handler to register the event listeners
    require('./settings-handler');

    // Store the handlers for testing
    getConfigHandler = (mockMessagingService.on as jest.Mock).mock.calls.find(
      call => call[0] === 'get-global-config'
    )?.[1] as (...args: any[]) => Promise<void>;

    setConfigHandler = (mockMessagingService.on as jest.Mock).mock.calls.find(
      call => call[0] === 'set-global-config'
    )?.[1] as (...args: any[]) => Promise<void>;
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock console.error to suppress expected errors from error handling tests
    jest.spyOn(console, 'error').mockImplementation(() => {});

    mockSender = { id: 'test-sender' };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('get-global-config handler', () => {
    it('should handle get-global-config successfully', async () => {
      const payload = { requestId: 'test-request-123' };
      const mockConfig = { webServerPort: 3000, authenticationEnabled: true };

      mockSettingsService.getGlobalConfig.mockReturnValue(mockConfig);

      expect(getConfigHandler).toBeDefined();

      await getConfigHandler(payload, mockSender);

      expect(mockSettingsService.getGlobalConfig).toHaveBeenCalled();
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith(
        'get-global-config',
        { ...mockConfig, requestId: 'test-request-123' },
        mockSender
      );
      expect(mockMessagingService.sendToAll).toHaveBeenCalledWith('global-config', mockConfig);
    });

    it('should handle get-global-config with undefined payload', async () => {
      const mockConfig = { webServerPort: 3000, authenticationEnabled: true };

      mockSettingsService.getGlobalConfig.mockReturnValue(mockConfig);

      await getConfigHandler(undefined, mockSender);

      expect(mockSettingsService.getGlobalConfig).toHaveBeenCalled();
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith(
        'get-global-config',
        { ...mockConfig, requestId: undefined },
        mockSender
      );
      expect(mockMessagingService.sendToAll).toHaveBeenCalledWith('global-config', mockConfig);
    });

    it('should handle get-global-config error', async () => {
      const payload = { requestId: 'test-request-123' };
      const errorMessage = 'Failed to load config';

      mockSettingsService.getGlobalConfig.mockImplementation(() => {
        throw new Error(errorMessage);
      });

      await getConfigHandler(payload, mockSender);

      expect(mockSettingsService.getGlobalConfig).toHaveBeenCalled();
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith(
        'get-global-config',
        { error: errorMessage, requestId: 'test-request-123' },
        mockSender
      );
      expect(mockMessagingService.sendToAll).not.toHaveBeenCalled();
    });

    it('should handle get-global-config with non-Error exception', async () => {
      const payload = { requestId: 'test-request-123' };

      mockSettingsService.getGlobalConfig.mockImplementation(() => {
        throw 'String error';
      });

      await getConfigHandler(payload, mockSender);

      expect(mockSettingsService.getGlobalConfig).toHaveBeenCalled();
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith(
        'get-global-config',
        { error: 'String error', requestId: 'test-request-123' },
        mockSender
      );
      expect(mockMessagingService.sendToAll).not.toHaveBeenCalled();
    });
  });

  describe('set-global-config handler', () => {
    it('should handle set-global-config successfully', async () => {
      const payload = { config: { webServerPort: 3001 }, requestId: 'test-request-456' };
      const mockResult = { success: true, updatedConfig: { webServerPort: 3001, authenticationEnabled: false } };

      mockSettingsService.updateGlobalConfig.mockResolvedValue(mockResult);

      expect(setConfigHandler).toBeDefined();

      await setConfigHandler(payload, mockSender);

      expect(mockSettingsService.updateGlobalConfig).toHaveBeenCalledWith({ webServerPort: 3001 });
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith(
        'set-global-config',
        { success: true, error: undefined, requestId: 'test-request-456' },
        mockSender
      );
      expect(mockSettingsService.updateWebServerAuth).toHaveBeenCalledWith(mockResult.updatedConfig, undefined);
      expect(mockMessagingService.sendToAll).toHaveBeenCalledWith('global-config', mockResult.updatedConfig);
    });

    it('should handle set-global-config with undefined payload', async () => {
      const mockResult = { success: true, updatedConfig: { webServerPort: 3000 } };

      mockSettingsService.updateGlobalConfig.mockResolvedValue(mockResult);

      await setConfigHandler(undefined, mockSender);

      expect(mockSettingsService.updateGlobalConfig).toHaveBeenCalledWith(undefined);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith(
        'set-global-config',
        { success: true, error: undefined, requestId: undefined },
        mockSender
      );
      expect(mockSettingsService.updateWebServerAuth).toHaveBeenCalledWith(mockResult.updatedConfig, undefined);
      expect(mockMessagingService.sendToAll).toHaveBeenCalledWith('global-config', mockResult.updatedConfig);
    });

    it('should handle set-global-config failure', async () => {
      const payload = { config: { invalidPort: 99999 }, requestId: 'test-request-789' };
      const mockResult = { success: false, error: 'Invalid web server port' };

      mockSettingsService.updateGlobalConfig.mockResolvedValue(mockResult);

      await setConfigHandler(payload, mockSender);

      expect(mockSettingsService.updateGlobalConfig).toHaveBeenCalledWith({ invalidPort: 99999 });
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith(
        'set-global-config',
        { success: false, error: 'Invalid web server port', requestId: 'test-request-789' },
        mockSender
      );
      expect(mockSettingsService.updateWebServerAuth).not.toHaveBeenCalled();
      expect(mockMessagingService.sendToAll).not.toHaveBeenCalled();
    });

    it('should handle set-global-config error', async () => {
      const payload = { config: { webServerPort: 3001 }, requestId: 'test-request-999' };
      const errorMessage = 'Database connection failed';

      mockSettingsService.updateGlobalConfig.mockRejectedValue(new Error(errorMessage));

      await setConfigHandler(payload, mockSender);

      expect(mockSettingsService.updateGlobalConfig).toHaveBeenCalledWith({ webServerPort: 3001 });
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith(
        'set-global-config',
        { success: false, error: errorMessage, requestId: 'test-request-999' },
        mockSender
      );
      expect(mockSettingsService.updateWebServerAuth).not.toHaveBeenCalled();
      expect(mockMessagingService.sendToAll).not.toHaveBeenCalled();
    });

    it('should handle set-global-config with non-Error exception', async () => {
      const payload = { config: { webServerPort: 3001 }, requestId: 'test-request-000' };

      mockSettingsService.updateGlobalConfig.mockRejectedValue('String error');

      await setConfigHandler(payload, mockSender);

      expect(mockSettingsService.updateGlobalConfig).toHaveBeenCalledWith({ webServerPort: 3001 });
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith(
        'set-global-config',
        { success: false, error: 'String error', requestId: 'test-request-000' },
        mockSender
      );
      expect(mockSettingsService.updateWebServerAuth).not.toHaveBeenCalled();
      expect(mockMessagingService.sendToAll).not.toHaveBeenCalled();
    });
  });
});