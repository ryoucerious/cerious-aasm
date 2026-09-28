// Mock the services
jest.mock('../services/messaging.service');
jest.mock('../services/ark-update.service');
jest.mock('../utils/ark/ark-install.utils', () => ({
  isArkServerInstalled: jest.fn().mockReturnValue(true),
  getArkServerDir: jest.fn().mockReturnValue('/ark'),
  getCurrentInstalledVersion: jest.fn().mockResolvedValue('999')
}));

import { messagingService } from '../services/messaging.service';
import { ArkUpdateService } from '../services/ark-update.service';
import { setArkUpdateService } from './ark-update-handler';

const mockMessagingService = messagingService as jest.Mocked<typeof messagingService>;
const mockArkUpdateService = ArkUpdateService as jest.MockedClass<typeof ArkUpdateService>;

// Create a mock instance that will be returned by the constructor
const mockServiceInstance = {
  checkForUpdate: jest.fn(),
  refreshInstalledBuild: jest.fn()
};

// Store handler functions for testing
let checkArkUpdateHandler: Function;
let getArkInstallationHandler: Function;

describe('ARK Update Handler', () => {
  let mockSender: any;

  beforeAll(() => {
    // Mock the ArkUpdateService constructor to return our mock instance
    mockArkUpdateService.mockImplementation(() => mockServiceInstance as any);

    // Import handler to register events
    require('./ark-update-handler');

    // Set the mock service instance so the handler doesn't bail on null check
    setArkUpdateService(mockServiceInstance as any);

    // Capture the registered event handler
    const mockOn = mockMessagingService.on as jest.Mock;
    mockOn.mock.calls.forEach(([event, handler]) => {
      if (event === 'check-ark-update') {
        checkArkUpdateHandler = handler;
      }
      if (event === 'get-ark-installation') {
        getArkInstallationHandler = handler;
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

  describe('get-ark-installation event', () => {
    // The page must show one consistent picture: the installed build and the update flag
    // have to come from the same comparison, or a finished update still reads "Update available".
    it('reports the refreshed build and update flag together', async () => {
      mockServiceInstance.refreshInstalledBuild.mockResolvedValue({
        installedBuildId: '25535041',
        latestBuildId: '25535041',
        updateAvailable: false,
        lastCheckedAt: 1790562909000
      });

      await getArkInstallationHandler({ requestId: 'r1' }, mockSender);

      expect(mockServiceInstance.refreshInstalledBuild).toHaveBeenCalled();
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith('get-ark-installation', {
        success: true,
        installed: true,
        installedBuildId: '25535041',
        latestBuildId: '25535041',
        updateAvailable: false,
        lastCheckedAt: 1790562909000,
        installPath: '/ark',
        requestId: 'r1'
      }, mockSender);
    });
  });
});
