import { jest } from '@jest/globals';

jest.mock('../services/messaging.service', () => ({
  messagingService: {
    on: jest.fn(),
    sendToOriginator: jest.fn(),
    sendToAll: jest.fn(),
  },
}));

jest.mock('../services/whitelist.service', () => ({
  whitelistService: {
    loadWhitelistFromInstance: jest.fn(),
    addToInstanceWhitelist: jest.fn(),
    removeFromInstanceWhitelist: jest.fn(),
    clearInstanceWhitelist: jest.fn(),
  },
}));

jest.mock('../services/server-instance/server-operations.service', () => ({
  serverOperationsService: {},
}));

jest.mock('../utils/ark/instance.utils', () => ({
  getInstancesBaseDir: jest.fn(() => '/base/instances'),
}));

import { messagingService } from '../services/messaging.service';
import { whitelistService } from '../services/whitelist.service';

const mockMessaging = messagingService as jest.Mocked<typeof messagingService>;
const mockWhitelist = whitelistService as jest.Mocked<typeof whitelistService>;

// Determine expected path separator for cross-platform tests
const pathSep = process.platform === 'win32' ? '\\' : '/';

describe('whitelist-handler', () => {
  let handlers: Record<string, (...args: any[]) => Promise<void>>;
  let mockSender: any;

  beforeAll(() => {
    require('./whitelist-handler');

    handlers = {};
    for (const call of (mockMessaging.on as jest.Mock).mock.calls) {
      handlers[call[0] as string] = call[1] as any;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    mockSender = { id: 'test-sender' };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should register all expected handlers', () => {
    expect(handlers['load-whitelist']).toBeDefined();
    expect(handlers['add-to-whitelist']).toBeDefined();
    expect(handlers['remove-from-whitelist']).toBeDefined();
    expect(handlers['clear-whitelist']).toBeDefined();
  });

  describe('load-whitelist', () => {
    it('should load whitelist successfully', async () => {
      (mockWhitelist.loadWhitelistFromInstance as jest.Mock).mockReturnValue({
        success: true,
        playerIds: ['player1', 'player2'],
        message: 'Loaded 2 players',
      });

      await handlers['load-whitelist']({ instanceId: 'inst1' }, mockSender);

      expect(mockWhitelist.loadWhitelistFromInstance).toHaveBeenCalledWith(
        expect.stringContaining('inst1')
      );
      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'load-whitelist',
        expect.objectContaining({
          success: true,
          playerIds: ['player1', 'player2'],
        }),
        mockSender
      );
    });

    it('should fail when no instanceId provided', async () => {
      await handlers['load-whitelist']({ instanceId: undefined }, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'load-whitelist',
        expect.objectContaining({ success: false, error: 'Instance ID is required' }),
        mockSender
      );
    });

    it('should handle service errors', async () => {
      (mockWhitelist.loadWhitelistFromInstance as jest.Mock).mockImplementation(() => {
        throw new Error('Disk read error');
      });

      await handlers['load-whitelist']({ instanceId: 'inst1' }, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'load-whitelist',
        expect.objectContaining({ success: false, error: 'Disk read error' }),
        mockSender
      );
    });
  });

  describe('add-to-whitelist', () => {
    it('should add player successfully', async () => {
      (mockWhitelist.addToInstanceWhitelist as jest.Mock).mockReturnValue({
        success: true,
        playerIds: ['player1', 'newplayer'],
        message: 'Added',
      });

      await handlers['add-to-whitelist']({ instanceId: 'inst1', playerId: '  newplayer  ' }, mockSender);

      // Should trim the playerId
      expect(mockWhitelist.addToInstanceWhitelist).toHaveBeenCalledWith(
        expect.stringContaining('inst1'),
        'newplayer'
      );
      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'add-to-whitelist',
        expect.objectContaining({ success: true }),
        mockSender
      );
    });

    it('should fail when instanceId or playerId missing', async () => {
      await handlers['add-to-whitelist']({ instanceId: 'inst1' }, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'add-to-whitelist',
        expect.objectContaining({
          success: false,
          error: 'Instance ID and Player ID are required',
        }),
        mockSender
      );
    });

    it('should fail when both are missing', async () => {
      await handlers['add-to-whitelist']({}, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'add-to-whitelist',
        expect.objectContaining({ success: false }),
        mockSender
      );
    });
  });

  describe('remove-from-whitelist', () => {
    it('should remove player successfully', async () => {
      (mockWhitelist.removeFromInstanceWhitelist as jest.Mock).mockReturnValue({
        success: true,
        playerIds: ['player2'],
        message: 'Removed',
      });

      await handlers['remove-from-whitelist'](
        { instanceId: 'inst1', playerId: ' player1 ' },
        mockSender
      );

      expect(mockWhitelist.removeFromInstanceWhitelist).toHaveBeenCalledWith(
        expect.stringContaining('inst1'),
        'player1'
      );
    });

    it('should fail when missing required fields', async () => {
      await handlers['remove-from-whitelist']({ instanceId: 'inst1' }, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'remove-from-whitelist',
        expect.objectContaining({ success: false }),
        mockSender
      );
    });
  });

  describe('clear-whitelist', () => {
    it('should clear whitelist successfully', async () => {
      (mockWhitelist.clearInstanceWhitelist as jest.Mock).mockReturnValue({
        success: true,
        playerIds: [],
        message: 'Cleared',
      });

      await handlers['clear-whitelist']({ instanceId: 'inst1' }, mockSender);

      expect(mockWhitelist.clearInstanceWhitelist).toHaveBeenCalledWith(
        expect.stringContaining('inst1')
      );
      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'clear-whitelist',
        expect.objectContaining({ success: true, playerIds: [] }),
        mockSender
      );
    });

    it('should fail when no instanceId', async () => {
      await handlers['clear-whitelist']({ instanceId: undefined }, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'clear-whitelist',
        expect.objectContaining({ success: false, error: 'Instance ID is required' }),
        mockSender
      );
    });

    it('should handle errors during clear', async () => {
      (mockWhitelist.clearInstanceWhitelist as jest.Mock).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      await handlers['clear-whitelist']({ instanceId: 'inst1' }, mockSender);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith(
        'clear-whitelist',
        expect.objectContaining({ success: false, error: 'Permission denied' }),
        mockSender
      );
    });
  });
});
