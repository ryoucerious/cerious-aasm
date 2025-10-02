import { setupIPCHandlers } from '../web-server/ipc-handlers';

// Mock dependencies
jest.mock('../services/messaging.service');
jest.mock('../web-server/auth-config');


const mockMessagingService = require('../services/messaging.service');
const mockAuthConfig = require('../web-server/auth-config');

// Setup the mock messaging service
mockMessagingService.messagingService = {
  sendToAllWebSockets: jest.fn()
};

// Mock process globally
let originalProcess: any;
beforeAll(() => {
  originalProcess = global.process;
});

afterAll(() => {
  global.process = originalProcess;
});

describe('ipc-handlers', () => {
  let mockProcess: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock process
    mockProcess = {
      on: jest.fn()
    };
    global.process = mockProcess;

  // Setup default mocks
  mockMessagingService.messagingService.sendToAllWebSockets = jest.fn();
    mockAuthConfig.updateAuthConfig = jest.fn();
    mockAuthConfig.hashPassword = jest.fn().mockResolvedValue('hashedpassword');
  });

  afterEach(() => {
    // Restore original process
    global.process = originalProcess;
  });

  describe('setupIPCHandlers', () => {
    it('should setup process message listener', () => {
      setupIPCHandlers();

      expect(mockProcess.on).toHaveBeenCalled();
      expect(mockProcess.on.mock.calls[0][0]).toBe('message');
      expect(typeof mockProcess.on.mock.calls[0][1]).toBe('function');
    });
  });

  describe('message handling', () => {
    let messageHandler: any;

    beforeEach(() => {
      setupIPCHandlers();
      messageHandler = mockProcess.on.mock.calls[0][1];
    });

    it('should handle messaging-response messages', () => {
      const message = {
        type: 'messaging-response',
        channel: 'test-channel',
        data: { test: 'data' }
      };

      messageHandler(message);

  expect(mockMessagingService.messagingService.sendToAllWebSockets).toHaveBeenCalledWith('test-channel', { test: 'data' });
    });

    it('should handle broadcast-web messages', () => {
      const message = {
        type: 'broadcast-web',
        channel: 'test-channel',
        data: { test: 'data' },
        excludeCid: 'exclude-123'
      };

      messageHandler(message);

  expect(mockMessagingService.messagingService.sendToAllWebSockets).toHaveBeenCalledWith('test-channel', { test: 'data' }, 'exclude-123');
    });

    it('should handle update-auth-config messages with plain password', async () => {
      const message = {
        type: 'update-auth-config',
        authConfig: {
          enabled: true,
          password: 'plainpassword'
        }
      };

      await messageHandler(message);

      expect(mockAuthConfig.hashPassword).toHaveBeenCalledWith('plainpassword');
      expect(mockAuthConfig.updateAuthConfig).toHaveBeenCalledWith({
        enabled: true,
        passwordHash: 'hashedpassword'
      });
    });

    it('should handle update-auth-config messages with hashed password', async () => {
      const message = {
        type: 'update-auth-config',
        authConfig: {
          enabled: true,
          passwordHash: 'alreadyhashed'
        }
      };

      await messageHandler(message);

      expect(mockAuthConfig.hashPassword).not.toHaveBeenCalled();
      expect(mockAuthConfig.updateAuthConfig).toHaveBeenCalledWith({
        enabled: true,
        passwordHash: 'alreadyhashed'
      });
    });

    it('should handle update-auth-config messages with no valid password', async () => {
      const message = {
        type: 'update-auth-config',
        authConfig: {
          enabled: true
          // No password or passwordHash
        }
      };

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await messageHandler(message);

      expect(consoleSpy).toHaveBeenCalledWith('[Auth] No valid password or passwordHash provided');
      expect(mockAuthConfig.updateAuthConfig).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle auth config update errors', async () => {
      const message = {
        type: 'update-auth-config',
        authConfig: {
          enabled: true,
          password: 'plainpassword'
        }
      };

      mockAuthConfig.hashPassword.mockRejectedValue(new Error('Hash error'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await messageHandler(message);

      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy.mock.calls[0][0]).toBe('[Auth] Failed to update auth config:');
      expect(typeof consoleSpy.mock.calls[0][1]).toBe('object');

      consoleSpy.mockRestore();
    });

    it('should ignore unknown message types', () => {
      const message = {
        type: 'unknown-type',
        data: 'test'
      };

      messageHandler(message);

  expect(mockMessagingService.messagingService.sendToAllWebSockets).not.toHaveBeenCalled();
      expect(mockAuthConfig.updateAuthConfig).not.toHaveBeenCalled();
    });
  });
});