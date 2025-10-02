import {
  rconClients,
  connectRcon,
  disconnectRcon,
  sendRconCommand,
  isRconConnected,
  cleanupAllRconConnections
} from '../utils/rcon.utils';

// Mock the rcon module
jest.mock('rcon', () => {
  return jest.fn().mockImplementation(() => {
    const EventEmitter = require('events');
    const rcon = new EventEmitter();
    rcon.connect = jest.fn();
    rcon.disconnect = jest.fn();
    rcon.send = jest.fn();
    rcon.removeAllListeners = jest.fn();
    return rcon;
  });
});

const mockRcon = require('rcon');

describe('rcon.utils', () => {
  let mockRconInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.spyOn(global, 'setTimeout');
    
    // Mock console.error to suppress expected errors from disconnect error handling tests
    jest.spyOn(console, 'error').mockImplementation(() => {});

    // Clear rconClients between tests
    Object.keys(rconClients).forEach(key => {
      delete rconClients[key];
    });

    // Setup mock RCON instance
    mockRconInstance = {
      connect: jest.fn(),
      disconnect: jest.fn(),
      send: jest.fn(),
      removeAllListeners: jest.fn(),
      on: jest.fn(),
      once: jest.fn(),
      emit: jest.fn()
    };
    mockRcon.mockReturnValue(mockRconInstance);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('rconClients', () => {
    it('should export rconClients as an empty object initially', () => {
      expect(rconClients).toEqual({});
    });
  });

  describe('connectRcon', () => {
    const mockConfig = {
      rconPort: 27020,
      rconPassword: 'testpass'
    };

    it('should return early if already connected', () => {
      rconClients['instance1'] = mockRconInstance;
      const onStatus = jest.fn();
      connectRcon('instance1', mockConfig, onStatus);
      expect(onStatus).toHaveBeenCalledWith(true);
      expect(mockRcon).not.toHaveBeenCalled();
    });

    it('should connect successfully on first attempt', () => {
      const onStatus = jest.fn();
      connectRcon('instance1', mockConfig, onStatus);

      // Simulate successful auth
      const authCall = mockRconInstance.on.mock.calls.find((call: any[]) => call[0] === 'auth');
      authCall[1]();

      expect(rconClients['instance1']).toBe(mockRconInstance);
      expect(onStatus).toHaveBeenCalledWith(true);
    });

    it('should retry on connection end before auth', () => {
      const onStatus = jest.fn();
      connectRcon('instance1', mockConfig, onStatus);

      // Simulate connection end without auth (first attempt)
      const endCall = mockRconInstance.on.mock.calls.find((call: any[]) => call[0] === 'end');
      endCall[1]();

      // Should retry after 2 seconds
      expect((global as any).setTimeout).toHaveBeenCalled();
    });

    it('should give up after max attempts and call onStatus with false', () => {
      const onStatus = jest.fn();
      connectRcon('instance1', mockConfig, onStatus);

      // Simulate 15 failed attempts
      for (let i = 0; i < 15; i++) {
        const endCall = mockRconInstance.on.mock.calls.find((call: any[]) => call[0] === 'end');
        endCall[1]();
        if (i < 14) {
          jest.runOnlyPendingTimers(); // Advance to next retry
        }
      }

      expect(onStatus).toHaveBeenCalledWith(false);
      expect(rconClients['instance1']).toBeUndefined();
    });

    it('should handle errors and retry', () => {
      const onStatus = jest.fn();
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      connectRcon('instance1', mockConfig, onStatus);

      // Simulate error without auth
      const errorCall = mockRconInstance.on.mock.calls.find((call: any[]) => call[0] === 'error');
      errorCall[1](new Error('Connection failed'));

      // Should retry after 2 seconds
      expect((global as any).setTimeout).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle errors without retry after max attempts', () => {
      const onStatus = jest.fn();
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      connectRcon('instance1', mockConfig, onStatus);

      // Simulate 15 errors
      for (let i = 0; i < 15; i++) {
        const errorCall = mockRconInstance.on.mock.calls.find((call: any[]) => call[0] === 'error');
        errorCall[1](new Error('Connection failed'));
        if (i < 14) {
          jest.runOnlyPendingTimers();
        }
      }

      expect(onStatus).toHaveBeenCalledWith(false);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should use default port if not specified', () => {
      const configWithoutPort = { rconPassword: 'testpass' };
      connectRcon('instance1', configWithoutPort);

      expect(mockRcon).toHaveBeenCalledWith('localhost', 27020, 'testpass');
    });

    it('should use default password if not specified', () => {
      const configWithoutPassword = { rconPort: 27021 };
      connectRcon('instance1', configWithoutPassword);

      expect(mockRcon).toHaveBeenCalledWith('localhost', 27021, '');
    });
  });

  describe('disconnectRcon', () => {
    it('should disconnect and remove client if connected', () => {
      rconClients['instance1'] = mockRconInstance;
      disconnectRcon('instance1');

      expect(mockRconInstance.disconnect).toHaveBeenCalled();
      expect(rconClients['instance1']).toBeUndefined();
    });

    it('should do nothing if not connected', () => {
      disconnectRcon('instance1');

      expect(mockRconInstance.disconnect).not.toHaveBeenCalled();
    });

    it('should handle disconnect errors gracefully', () => {
      const mockClient = { ...mockRconInstance };
      mockClient.disconnect.mockImplementation(() => {
        throw new Error('Disconnect failed');
      });

      rconClients['instance1'] = mockClient;

      // Should not throw despite the disconnect error
      expect(() => disconnectRcon('instance1')).not.toThrow();
      expect(rconClients['instance1']).toBeUndefined();
    });
  });

  describe('sendRconCommand', () => {
    it('should send command and resolve with response', async () => {
      rconClients['instance1'] = mockRconInstance;
      const command = 'listplayers';
      const expectedResponse = 'Player1, Player2';

      const promise = sendRconCommand('instance1', command);

      // Simulate response
      const responseCall = mockRconInstance.once.mock.calls.find((call: any[]) => call[0] === 'response');
      responseCall[1](expectedResponse);

      const result = await promise;
      expect(mockRconInstance.send).toHaveBeenCalledWith(command);
      expect(result).toBe(expectedResponse);
    });

    it('should reject if RCON not connected', async () => {
      try {
        await sendRconCommand('instance1', 'test');
        fail('Expected promise to reject');
      } catch (error: any) {
        expect(error.message).toBe('RCON not connected');
      }
    });

    it('should reject on error', async () => {
      rconClients['instance1'] = mockRconInstance;
      const expectedError = new Error('Send failed');

      const promise = sendRconCommand('instance1', 'test');

      // Simulate error
      const errorCall = mockRconInstance.once.mock.calls.find((call: any[]) => call[0] === 'error');
      errorCall[1](expectedError);

      try {
        await promise;
        fail('Expected promise to reject');
      } catch (error) {
        expect(error).toBe(expectedError);
      }
    });
  });

  describe('isRconConnected', () => {
    it('should return true if connected', () => {
      rconClients['instance1'] = mockRconInstance;
      expect(isRconConnected('instance1')).toBe(true);
    });

    it('should return false if not connected', () => {
      expect(isRconConnected('instance1')).toBe(false);
    });
  });

  describe('cleanupAllRconConnections', () => {
    it('should disconnect all clients', () => {
      const mockClient1 = { ...mockRconInstance };
      const mockClient2 = { ...mockRconInstance };

      rconClients['instance1'] = mockClient1;
      rconClients['instance2'] = mockClient2;

      cleanupAllRconConnections();

      expect(mockClient1.disconnect).toHaveBeenCalled();
      expect(mockClient2.disconnect).toHaveBeenCalled();
      expect(rconClients).toEqual({});
    });

    it('should handle disconnect errors gracefully', () => {
      const mockClient = { ...mockRconInstance };
      mockClient.disconnect.mockImplementation(() => {
        throw new Error('Disconnect failed');
      });

      rconClients['instance1'] = mockClient;

      // Should not throw despite the disconnect error
      expect(() => cleanupAllRconConnections()).not.toThrow();
      expect(rconClients).toEqual({});
    });

    it('should do nothing if no clients', () => {
      cleanupAllRconConnections();
      expect(rconClients).toEqual({});
    });
  });
});