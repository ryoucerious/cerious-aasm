import { jest } from '@jest/globals';

// Mock the services
const mockMessagingService = {
  on: jest.fn() as any,
  sendToOriginator: jest.fn() as any,
};

const mockDirectoryService = {
  openConfigDirectory: jest.fn() as any,
  openInstanceDirectory: jest.fn() as any,
  testDirectoryAccess: jest.fn() as any,
};

jest.mock('../services/messaging.service', () => ({
  messagingService: mockMessagingService,
}));

jest.mock('../services/directory.service', () => ({
  directoryService: mockDirectoryService,
}));

import { messagingService } from '../services/messaging.service';
import { directoryService } from '../services/directory.service';

describe('directory-handler', () => {
  let openConfigHandler: (...args: any[]) => Promise<void>;
  let openDirectoryHandler: (...args: any[]) => Promise<void>;
  let testDirectoryAccessHandler: (...args: any[]) => Promise<void>;
  let mockSender: any;

  beforeAll(() => {
    // Import the handler to register the event listeners
    require('./directory-handler');

    // Store the handlers for testing
    openConfigHandler = (mockMessagingService.on as jest.Mock).mock.calls.find(
      call => call[0] === 'open-config-directory'
    )?.[1] as (...args: any[]) => Promise<void>;

    openDirectoryHandler = (mockMessagingService.on as jest.Mock).mock.calls.find(
      call => call[0] === 'open-directory'
    )?.[1] as (...args: any[]) => Promise<void>;

    testDirectoryAccessHandler = (mockMessagingService.on as jest.Mock).mock.calls.find(
      call => call[0] === 'test-directory-access'
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

  describe('open-config-directory handler', () => {
    it('should handle open-config-directory successfully', async () => {
      const payload = { requestId: 'test-request-123' };
      const mockResult = { success: true, configDir: '/path/to/config' };

      mockDirectoryService.openConfigDirectory.mockResolvedValue(mockResult);

      expect(openConfigHandler).toBeDefined();

      await openConfigHandler(payload, mockSender);

      expect(mockDirectoryService.openConfigDirectory).toHaveBeenCalled();
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith(
        'open-config-directory',
        { configDir: '/path/to/config', requestId: 'test-request-123' },
        mockSender
      );
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledTimes(1);
    });

    it('should handle open-config-directory with undefined payload', async () => {
      const mockResult = { success: true, configDir: '/path/to/config' };

      mockDirectoryService.openConfigDirectory.mockResolvedValue(mockResult);

      await openConfigHandler(undefined, mockSender);

      expect(mockDirectoryService.openConfigDirectory).toHaveBeenCalled();
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith(
        'open-config-directory',
        { configDir: '/path/to/config', requestId: undefined },
        mockSender
      );
    });

    it('should handle open-config-directory failure', async () => {
      const payload = { requestId: 'test-request-456' };
      const mockResult = { success: false, configDir: '', error: 'Permission denied' };

      mockDirectoryService.openConfigDirectory.mockResolvedValue(mockResult);

      await openConfigHandler(payload, mockSender);

      expect(mockDirectoryService.openConfigDirectory).toHaveBeenCalled();
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith(
        'open-config-directory-error',
        { error: 'Permission denied', requestId: 'test-request-456' },
        mockSender
      );
    });

    it('should handle open-config-directory error', async () => {
      const payload = { requestId: 'test-request-789' };
      const errorMessage = 'Shell operation failed';

      mockDirectoryService.openConfigDirectory.mockRejectedValue(new Error(errorMessage));

      await openConfigHandler(payload, mockSender);

      expect(mockDirectoryService.openConfigDirectory).toHaveBeenCalled();
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith(
        'open-config-directory-error',
        { error: errorMessage, requestId: 'test-request-789' },
        mockSender
      );
    });

    it('should handle open-config-directory with non-Error exception', async () => {
      const payload = { requestId: 'test-request-000' };

      mockDirectoryService.openConfigDirectory.mockRejectedValue('String error');

      await openConfigHandler(payload, mockSender);

      expect(mockDirectoryService.openConfigDirectory).toHaveBeenCalled();
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith(
        'open-config-directory-error',
        { error: 'String error', requestId: 'test-request-000' },
        mockSender
      );
    });
  });

  describe('open-directory handler', () => {
    it('should handle open-directory successfully', async () => {
      const payload = { id: 'instance-123', requestId: 'test-request-456' };
      const mockResult = { success: true, instanceId: 'instance-123' };

      mockDirectoryService.openInstanceDirectory.mockResolvedValue(mockResult);

      expect(openDirectoryHandler).toBeDefined();

      await openDirectoryHandler(payload, mockSender);

      expect(mockDirectoryService.openInstanceDirectory).toHaveBeenCalledWith('instance-123');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith(
        'open-directory',
        { id: 'instance-123', requestId: 'test-request-456' },
        mockSender
      );
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledTimes(1);
    });

    it('should handle open-directory with undefined payload', async () => {
      const mockResult = { success: true, instanceId: 'default-instance' };

      mockDirectoryService.openInstanceDirectory.mockResolvedValue(mockResult);

      await openDirectoryHandler(undefined, mockSender);

      expect(mockDirectoryService.openInstanceDirectory).toHaveBeenCalledWith(undefined as any);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith(
        'open-directory',
        { id: 'default-instance', requestId: undefined },
        mockSender
      );
    });

    it('should handle open-directory failure', async () => {
      const payload = { id: 'invalid-instance', requestId: 'test-request-789' };
      const mockResult = { success: false, error: 'Instance not found' };

      mockDirectoryService.openInstanceDirectory.mockResolvedValue(mockResult);

      await openDirectoryHandler(payload, mockSender);

      expect(mockDirectoryService.openInstanceDirectory).toHaveBeenCalledWith('invalid-instance');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith(
        'open-directory-error',
        { error: 'Instance not found', requestId: 'test-request-789' },
        mockSender
      );
    });

    it('should handle open-directory error', async () => {
      const payload = { id: 'instance-123', requestId: 'test-request-999' };
      const errorMessage = 'File system error';

      mockDirectoryService.openInstanceDirectory.mockRejectedValue(new Error(errorMessage));

      await openDirectoryHandler(payload, mockSender);

      expect(mockDirectoryService.openInstanceDirectory).toHaveBeenCalledWith('instance-123');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith(
        'open-directory-error',
        { error: errorMessage, requestId: 'test-request-999' },
        mockSender
      );
    });

    it('should handle open-directory with non-Error exception', async () => {
      const payload = { id: 'instance-123', requestId: 'test-request-111' };

      mockDirectoryService.openInstanceDirectory.mockRejectedValue('String error');

      await openDirectoryHandler(payload, mockSender);

      expect(mockDirectoryService.openInstanceDirectory).toHaveBeenCalledWith('instance-123');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith(
        'open-directory-error',
        { error: 'String error', requestId: 'test-request-111' },
        mockSender
      );
    });
  });

  describe('test-directory-access handler', () => {
    it('should handle test-directory-access successfully', async () => {
      const payload = { directoryPath: '/path/to/cluster', requestId: 'test-request-123' };
      const mockResult = { accessible: true };

      mockDirectoryService.testDirectoryAccess.mockResolvedValue(mockResult);

      expect(testDirectoryAccessHandler).toBeDefined();

      await testDirectoryAccessHandler(payload, mockSender);

      expect(mockDirectoryService.testDirectoryAccess).toHaveBeenCalledWith('/path/to/cluster');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith(
        'test-directory-access',
        { accessible: true, requestId: 'test-request-123' },
        mockSender
      );
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledTimes(1);
    });

    it('should handle test-directory-access failure', async () => {
      const payload = { directoryPath: '/invalid/path', requestId: 'test-request-456' };
      const mockResult = { accessible: false, error: 'Directory not found' };

      mockDirectoryService.testDirectoryAccess.mockResolvedValue(mockResult);

      await testDirectoryAccessHandler(payload, mockSender);

      expect(mockDirectoryService.testDirectoryAccess).toHaveBeenCalledWith('/invalid/path');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith(
        'test-directory-access',
        { accessible: false, error: 'Directory not found', requestId: 'test-request-456' },
        mockSender
      );
    });

    it('should handle test-directory-access error', async () => {
      const payload = { directoryPath: '/path/to/cluster', requestId: 'test-request-789' };
      const errorMessage = 'Permission denied';

      mockDirectoryService.testDirectoryAccess.mockRejectedValue(new Error(errorMessage));

      await testDirectoryAccessHandler(payload, mockSender);

      expect(mockDirectoryService.testDirectoryAccess).toHaveBeenCalledWith('/path/to/cluster');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith(
        'test-directory-access',
        { accessible: false, error: errorMessage, requestId: 'test-request-789' },
        mockSender
      );
    });

    it('should handle test-directory-access with undefined payload (cover || {} branch)', async () => {
      const mockResult = { accessible: true };
      mockDirectoryService.testDirectoryAccess.mockResolvedValue(mockResult);
      await testDirectoryAccessHandler(undefined, mockSender);
      expect(mockDirectoryService.testDirectoryAccess).toHaveBeenCalledWith(undefined);
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith(
        'test-directory-access',
        { accessible: true, requestId: undefined },
        mockSender
      );
    });

    it('should handle test-directory-access with non-Error exception (cover String(error) branch)', async () => {
      const payload = { directoryPath: '/path/to/cluster', requestId: 'test-request-999' };
      mockDirectoryService.testDirectoryAccess.mockRejectedValue('String error');
      await testDirectoryAccessHandler(payload, mockSender);
      expect(mockDirectoryService.testDirectoryAccess).toHaveBeenCalledWith('/path/to/cluster');
      expect(mockMessagingService.sendToOriginator).toHaveBeenCalledWith(
        'test-directory-access',
        { accessible: false, error: 'String error', requestId: 'test-request-999' },
        mockSender
      );
    });
  });
});