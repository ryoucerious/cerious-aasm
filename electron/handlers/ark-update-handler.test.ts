// Mock the services
jest.mock('../services/messaging.service');
jest.mock('../services/ark-update.service');

import { messagingService } from '../services/messaging.service';
import { ArkUpdateService } from '../services/ark-update.service';

const mockMessagingService = messagingService as jest.Mocked<typeof messagingService>;
const mockArkUpdateService = ArkUpdateService as jest.MockedClass<typeof ArkUpdateService>;

// Create a mock instance that will be returned by the constructor
const mockServiceInstance = {
  checkForUpdate: jest.fn()
};

// Store handler function for testing
let checkArkUpdateHandler: Function;

describe('ARK Update Handler', () => {
  let mockSender: any;

  beforeAll(() => {
    // Mock the ArkUpdateService constructor to return our mock instance
    mockArkUpdateService.mockImplementation(() => mockServiceInstance as any);

    // Import handler to register events
    require('./ark-update-handler');

    // Capture the registered event handler
    const mockOn = mockMessagingService.on as jest.Mock;
    mockOn.mock.calls.forEach(([event, handler]) => {
      if (event === 'check-ark-update') {
        checkArkUpdateHandler = handler;
      }
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSender = {};
  });

  describe('check-ark-update event', () => {
    it('should handle successful update check with no update available', async () => {
      const mockResult = {
        success: true,
        hasUpdate: false,
        message: 'No update available'
      };

      mockServiceInstance.checkForUpdate.mockResolvedValue(mockResult);

      await checkArkUpdateHandler({}, mockSender);

      expect(mockServiceInstance.checkForUpdate).toHaveBeenCalled();
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('check-ark-update', {
        success: true,
        hasUpdate: false,
        buildId: undefined,
        message: 'No update available',
        error: undefined,
        requestId: undefined
      }, mockSender);
    });

    it('should handle successful update check with update available', async () => {
      const mockResult = {
        success: true,
        hasUpdate: true,
        buildId: '123456',
        message: 'New ARK server build available: 123456'
      };

      mockServiceInstance.checkForUpdate.mockResolvedValue(mockResult);

      await checkArkUpdateHandler({}, mockSender);

      expect(mockServiceInstance.checkForUpdate).toHaveBeenCalled();
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('check-ark-update', {
        success: true,
        hasUpdate: true,
        buildId: '123456',
        message: 'New ARK server build available: 123456',
        error: undefined,
        requestId: undefined
      }, mockSender);
    });

    it('should handle update check with requestId', async () => {
      const payload = { requestId: 'test-123' };
      const mockResult = {
        success: true,
        hasUpdate: false,
        message: 'No update available'
      };

      mockServiceInstance.checkForUpdate.mockResolvedValue(mockResult);

      await checkArkUpdateHandler(payload, mockSender);

      expect(mockServiceInstance.checkForUpdate).toHaveBeenCalled();
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('check-ark-update', {
        success: true,
        hasUpdate: false,
        buildId: undefined,
        message: 'No update available',
        error: undefined,
        requestId: 'test-123'
      }, mockSender);
    });

    it('should handle update check failure', async () => {
      const mockResult = {
        success: false,
        hasUpdate: false,
        error: 'SteamCMD not available',
        message: 'Failed to check for ARK server updates'
      };

      mockServiceInstance.checkForUpdate.mockResolvedValue(mockResult);

      await checkArkUpdateHandler({}, mockSender);

      expect(mockServiceInstance.checkForUpdate).toHaveBeenCalled();
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('check-ark-update', {
        success: false,
        hasUpdate: false,
        buildId: undefined,
        message: 'Failed to check for ARK server updates',
        error: 'SteamCMD not available',
        requestId: undefined
      }, mockSender);
    });

    it('should handle update check exception', async () => {
      const error = new Error('Network error');
      mockServiceInstance.checkForUpdate.mockRejectedValue(error);

      // Mock console.error to avoid test output pollution
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await checkArkUpdateHandler({}, mockSender);

      expect(mockServiceInstance.checkForUpdate).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('[ark-update-handler] Unexpected error:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('check-ark-update', {
        success: false,
        error: 'Network error',
        requestId: undefined
      }, mockSender);

      consoleSpy.mockRestore();
    });

    it('should handle non-Error exception', async () => {
      const error = 'String error';
      mockServiceInstance.checkForUpdate.mockRejectedValue(error);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await checkArkUpdateHandler({}, mockSender);

      expect(mockServiceInstance.checkForUpdate).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('[ark-update-handler] Unexpected error:', error);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('check-ark-update', {
        success: false,
        error: 'String error',
        requestId: undefined
      }, mockSender);

      consoleSpy.mockRestore();
    });

    it('should handle undefined payload || {})', async () => {
      const mockResult = {
        success: true,
        hasUpdate: false,
        message: 'No update available'
      };

      mockServiceInstance.checkForUpdate.mockResolvedValue(mockResult);

      await checkArkUpdateHandler(undefined, mockSender);

      expect(mockServiceInstance.checkForUpdate).toHaveBeenCalled();
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('check-ark-update', {
        success: true,
        hasUpdate: false,
        buildId: undefined,
        message: 'No update available',
        error: undefined,
        requestId: undefined
      }, mockSender);
    });
  });
});