import { jest } from '@jest/globals';

// Mock the services
jest.mock('../services/messaging.service', () => ({
  messagingService: {
    on: jest.fn(),
    sendToOriginator: jest.fn(),
  },
}));

jest.mock('../services/platform.service', () => ({
  platformService: {
    getNodeVersion: jest.fn(),
    getElectronVersion: jest.fn(),
    getPlatform: jest.fn(),
    getConfigPath: jest.fn(),
  },
}));

import { messagingService } from '../services/messaging.service';
import { platformService } from '../services/platform.service';

const mockMessagingService = messagingService as jest.Mocked<typeof messagingService>;
const mockPlatformService = platformService as jest.Mocked<typeof platformService>;

describe('system-info-handler', () => {
  let getSystemInfoHandler: (...args: any[]) => void;
  let mockSender: any;

  beforeAll(() => {
    // Import the handler to register the event listeners
    require('./system-info-handler');

    // Store the handler for testing
    getSystemInfoHandler = (mockMessagingService.on as jest.Mock).mock.calls.find(
      call => call[0] === 'get-system-info'
    )?.[1] as (...args: any[]) => void;
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

  describe('get-system-info handler', () => {
    it('should handle get-system-info successfully', async () => {
      const payload = { requestId: 'test-request-123' };
      const mockSystemInfo = {
        nodeVersion: '18.17.0',
        electronVersion: '25.0.0',
        platform: 'Windows',
        configPath: 'C:\\Users\\user\\AppData\\Roaming\\Cerious AASM'
      };

      mockPlatformService.getNodeVersion.mockReturnValue(mockSystemInfo.nodeVersion);
      mockPlatformService.getElectronVersion.mockReturnValue(mockSystemInfo.electronVersion);
      mockPlatformService.getPlatform.mockReturnValue(mockSystemInfo.platform);
      mockPlatformService.getConfigPath.mockReturnValue(mockSystemInfo.configPath);

      expect(getSystemInfoHandler).toBeDefined();

      getSystemInfoHandler(payload, mockSender);

      expect(mockPlatformService.getNodeVersion).toHaveBeenCalled();
      expect(mockPlatformService.getElectronVersion).toHaveBeenCalled();
      expect(mockPlatformService.getPlatform).toHaveBeenCalled();
      expect(mockPlatformService.getConfigPath).toHaveBeenCalled();
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith(
        'get-system-info',
        {
          nodeVersion: mockSystemInfo.nodeVersion,
          electronVersion: mockSystemInfo.electronVersion,
          platform: mockSystemInfo.platform,
          configPath: mockSystemInfo.configPath,
          requestId: 'test-request-123'
        },
        mockSender
      );
    });

    it('should handle get-system-info with undefined payload', async () => {
      const mockSystemInfo = {
        nodeVersion: '18.17.0',
        electronVersion: '25.0.0',
        platform: 'Linux',
        configPath: '/home/user/.config/Cerious AASM'
      };

      mockPlatformService.getNodeVersion.mockReturnValue(mockSystemInfo.nodeVersion);
      mockPlatformService.getElectronVersion.mockReturnValue(mockSystemInfo.electronVersion);
      mockPlatformService.getPlatform.mockReturnValue(mockSystemInfo.platform);
      mockPlatformService.getConfigPath.mockReturnValue(mockSystemInfo.configPath);

      getSystemInfoHandler(undefined, mockSender);

      expect(mockPlatformService.getNodeVersion).toHaveBeenCalled();
      expect(mockPlatformService.getElectronVersion).toHaveBeenCalled();
      expect(mockPlatformService.getPlatform).toHaveBeenCalled();
      expect(mockPlatformService.getConfigPath).toHaveBeenCalled();
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith(
        'get-system-info',
        {
          nodeVersion: mockSystemInfo.nodeVersion,
          electronVersion: mockSystemInfo.electronVersion,
          platform: mockSystemInfo.platform,
          configPath: mockSystemInfo.configPath,
          requestId: undefined
        },
        mockSender
      );
    });

    it('should handle get-system-info with null versions', async () => {
      const payload = { requestId: 'test-request-456' };
      const mockSystemInfo = {
        nodeVersion: null,
        electronVersion: null,
        platform: 'macOS',
        configPath: '/Users/user/Library/Application Support/Cerious AASM'
      };

      mockPlatformService.getNodeVersion.mockReturnValue(mockSystemInfo.nodeVersion);
      mockPlatformService.getElectronVersion.mockReturnValue(mockSystemInfo.electronVersion);
      mockPlatformService.getPlatform.mockReturnValue(mockSystemInfo.platform);
      mockPlatformService.getConfigPath.mockReturnValue(mockSystemInfo.configPath);

      getSystemInfoHandler(payload, mockSender);

      expect(mockPlatformService.getNodeVersion).toHaveBeenCalled();
      expect(mockPlatformService.getElectronVersion).toHaveBeenCalled();
      expect(mockPlatformService.getPlatform).toHaveBeenCalled();
      expect(mockPlatformService.getConfigPath).toHaveBeenCalled();
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith(
        'get-system-info',
        {
          nodeVersion: null,
          electronVersion: null,
          platform: mockSystemInfo.platform,
          configPath: mockSystemInfo.configPath,
          requestId: 'test-request-456'
        },
        mockSender
      );
    });

    it('should handle get-system-info error', async () => {
      const payload = { requestId: 'test-request-789' };
      const errorMessage = 'Platform service unavailable';

      mockPlatformService.getNodeVersion.mockImplementation(() => {
        throw new Error(errorMessage);
      });

      getSystemInfoHandler(payload, mockSender);

      expect(mockPlatformService.getNodeVersion).toHaveBeenCalled();
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith(
        'get-system-info',
        { error: errorMessage, requestId: 'test-request-789' },
        mockSender
      );
    });

    it('should handle get-system-info with non-Error exception', async () => {
      const payload = { requestId: 'test-request-000' };

      mockPlatformService.getNodeVersion.mockImplementation(() => {
        throw 'String error';
      });

      getSystemInfoHandler(payload, mockSender);

      expect(mockPlatformService.getNodeVersion).toHaveBeenCalled();
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith(
        'get-system-info',
        { error: 'String error', requestId: 'test-request-000' },
        mockSender
      );
    });
  });
});