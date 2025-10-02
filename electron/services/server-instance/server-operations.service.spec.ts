import { serverOperationsService } from './server-operations.service';

// Mock all dependencies
jest.mock('../../utils/validation.utils');
jest.mock('../../utils/ark/instance.utils');
jest.mock('../rcon.service');

describe('ServerOperationsService', () => {
  let validateInstanceIdMock: any;
  let instanceUtilsMock: any;
  let rconServiceMock: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mocks
    validateInstanceIdMock = jest.fn();
    jest.mocked(require('../../utils/validation.utils')).validateInstanceId = validateInstanceIdMock;

    instanceUtilsMock = {
      getInstance: jest.fn()
    };
    jest.mocked(require('../../utils/ark/instance.utils')).getInstance = instanceUtilsMock.getInstance;

    rconServiceMock = {
      connectRcon: jest.fn(),
      disconnectRcon: jest.fn(),
      getRconStatus: jest.fn(),
      executeRconCommand: jest.fn()
    };
    jest.mocked(require('../rcon.service')).rconService = rconServiceMock;
  });

  describe('connectRcon', () => {
    it('should connect RCON successfully', async () => {
      const instanceId = 'instance1';
      const instance = { id: instanceId, name: 'Server 1' };

      validateInstanceIdMock.mockReturnValue(true);
      instanceUtilsMock.getInstance.mockResolvedValue(instance);
      rconServiceMock.connectRcon.mockResolvedValue({ connected: true });

      const result = await serverOperationsService.connectRcon(instanceId);

      expect(result).toEqual({
        success: true,
        connected: true,
        instanceId
      });
    });

    it('should handle invalid instance ID', async () => {
      validateInstanceIdMock.mockReturnValue(false);

      const result = await serverOperationsService.connectRcon('invalid');

      expect(result).toEqual({
        success: false,
        error: 'Invalid instance ID',
        instanceId: 'invalid',
        connected: false
      });
    });

    it('should handle instance not found', async () => {
      validateInstanceIdMock.mockReturnValue(true);
      instanceUtilsMock.getInstance.mockResolvedValue(null);

      const result = await serverOperationsService.connectRcon('instance1');

      expect(result).toEqual({
        success: false,
        error: 'Instance not found',
        instanceId: 'instance1',
        connected: false
      });
    });

    it('should handle connection failure', async () => {
      const instanceId = 'instance1';
      const instance = { id: instanceId, name: 'Server 1' };

      validateInstanceIdMock.mockReturnValue(true);
      instanceUtilsMock.getInstance.mockResolvedValue(instance);
      rconServiceMock.connectRcon.mockResolvedValue({ connected: false });

      const result = await serverOperationsService.connectRcon(instanceId);

      expect(result).toEqual({
        success: true,
        connected: false,
        instanceId
      });
    });

    it('should handle exception', async () => {
      validateInstanceIdMock.mockReturnValue(true);
      instanceUtilsMock.getInstance.mockRejectedValue(new Error('DB error'));

      const result = await serverOperationsService.connectRcon('instance1');

      expect(result).toEqual({
        success: false,
        error: 'DB error',
        instanceId: 'instance1',
        connected: false
      });
    });
  });

  describe('disconnectRcon', () => {
    it('should disconnect RCON successfully', async () => {
      rconServiceMock.disconnectRcon.mockResolvedValue({});

      const result = await serverOperationsService.disconnectRcon('instance1');

      expect(result).toEqual({
        success: true,
        connected: false,
        instanceId: 'instance1'
      });
    });

    it('should handle exception', async () => {
      rconServiceMock.disconnectRcon.mockRejectedValue(new Error('Disconnect error'));

      const result = await serverOperationsService.disconnectRcon('instance1');

      expect(result).toEqual({
        success: false,
        error: 'Disconnect error',
        instanceId: 'instance1',
        connected: false
      });
    });
  });

  describe('getRconStatus', () => {
    it('should get RCON status successfully', () => {
      rconServiceMock.getRconStatus.mockReturnValue({
        success: true,
        connected: true,
        instanceId: 'instance1'
      });

      const result = serverOperationsService.getRconStatus('instance1');

      expect(result).toEqual({
        success: true,
        connected: true,
        instanceId: 'instance1'
      });
    });

    it('should handle disconnected status', () => {
      rconServiceMock.getRconStatus.mockReturnValue({
        success: false,
        connected: false,
        instanceId: 'instance1'
      });

      const result = serverOperationsService.getRconStatus('instance1');

      expect(result).toEqual({
        success: false,
        connected: false,
        instanceId: 'instance1'
      });
    });
  });

  describe('executeRconCommand', () => {
    it('should execute RCON command successfully', async () => {
      const instanceId = 'instance1';
      const command = 'ListPlayers';

      validateInstanceIdMock.mockReturnValue(true);
      rconServiceMock.executeRconCommand.mockResolvedValue({
        success: true,
        response: 'Player1, Player2'
      });

      const result = await serverOperationsService.executeRconCommand(instanceId, command);

      expect(result).toEqual({
        success: true,
        response: 'Player1, Player2',
        instanceId
      });
    });

    it('should handle invalid instance ID', async () => {
      validateInstanceIdMock.mockReturnValue(false);

      const result = await serverOperationsService.executeRconCommand('invalid', 'command');

      expect(result).toEqual({
        success: false,
        error: 'Invalid instance ID',
        instanceId: 'invalid'
      });
    });

    it('should handle invalid command', async () => {
      validateInstanceIdMock.mockReturnValue(true);

      const result = await serverOperationsService.executeRconCommand('instance1', '');

      expect(result).toEqual({
        success: false,
        error: 'Invalid command',
        instanceId: 'instance1'
      });
    });

    it('should handle null command', async () => {
      validateInstanceIdMock.mockReturnValue(true);

      const result = await serverOperationsService.executeRconCommand('instance1', null as any);

      expect(result).toEqual({
        success: false,
        error: 'Invalid command',
        instanceId: 'instance1'
      });
    });

    it('should handle command execution failure', async () => {
      validateInstanceIdMock.mockReturnValue(true);
      rconServiceMock.executeRconCommand.mockResolvedValue({
        success: false,
        error: 'Command failed'
      });

      const result = await serverOperationsService.executeRconCommand('instance1', 'InvalidCommand');

      expect(result).toEqual({
        success: false,
        error: 'Command failed',
        instanceId: 'instance1'
      });
    });

    it('should handle exception', async () => {
      validateInstanceIdMock.mockReturnValue(true);
      rconServiceMock.executeRconCommand.mockRejectedValue(new Error('RCON error'));

      const result = await serverOperationsService.executeRconCommand('instance1', 'command');

      expect(result).toEqual({
        success: false,
        error: 'RCON error',
        instanceId: 'instance1'
      });
    });
  });

  describe('sendChatMessage', () => {
    it('should send chat message', async () => {
      validateInstanceIdMock.mockReturnValue(true);
      rconServiceMock.executeRconCommand.mockResolvedValue({ success: true });

      const result = await serverOperationsService.sendChatMessage('instance1', 'Hello world');

      expect(rconServiceMock.executeRconCommand).toHaveBeenCalledWith('instance1', 'ServerChat Hello world');
      expect(result.success).toBe(true);
    });
  });

  describe('kickPlayer', () => {
    it('should kick player', async () => {
      validateInstanceIdMock.mockReturnValue(true);
      rconServiceMock.executeRconCommand.mockResolvedValue({ success: true });

      const result = await serverOperationsService.kickPlayer('instance1', 'BadPlayer');

      expect(rconServiceMock.executeRconCommand).toHaveBeenCalledWith('instance1', 'KickPlayer BadPlayer');
      expect(result.success).toBe(true);
    });
  });

  describe('banPlayer', () => {
    it('should ban player', async () => {
      validateInstanceIdMock.mockReturnValue(true);
      rconServiceMock.executeRconCommand.mockResolvedValue({ success: true });

      const result = await serverOperationsService.banPlayer('instance1', 'BadPlayer');

      expect(rconServiceMock.executeRconCommand).toHaveBeenCalledWith('instance1', 'BanPlayer BadPlayer');
      expect(result.success).toBe(true);
    });
  });

  describe('unbanPlayer', () => {
    it('should unban player', async () => {
      validateInstanceIdMock.mockReturnValue(true);
      rconServiceMock.executeRconCommand.mockResolvedValue({ success: true });

      const result = await serverOperationsService.unbanPlayer('instance1', 'GoodPlayer');

      expect(rconServiceMock.executeRconCommand).toHaveBeenCalledWith('instance1', 'UnbanPlayer GoodPlayer');
      expect(result.success).toBe(true);
    });
  });

  describe('saveWorld', () => {
    it('should save world', async () => {
      validateInstanceIdMock.mockReturnValue(true);
      rconServiceMock.executeRconCommand.mockResolvedValue({ success: true });

      const result = await serverOperationsService.saveWorld('instance1');

      expect(rconServiceMock.executeRconCommand).toHaveBeenCalledWith('instance1', 'SaveWorld');
      expect(result.success).toBe(true);
    });
  });

  describe('getServerInfo', () => {
    it('should get server info', async () => {
      validateInstanceIdMock.mockReturnValue(true);
      rconServiceMock.executeRconCommand.mockResolvedValue({
        success: true,
        response: 'Server info here'
      });

      const result = await serverOperationsService.getServerInfo('instance1');

      expect(rconServiceMock.executeRconCommand).toHaveBeenCalledWith('instance1', 'GetServerInfo');
      expect(result).toEqual({
        success: true,
        response: 'Server info here',
        instanceId: 'instance1'
      });
    });
  });

  describe('listPlayers', () => {
    it('should list players', async () => {
      validateInstanceIdMock.mockReturnValue(true);
      rconServiceMock.executeRconCommand.mockResolvedValue({
        success: true,
        response: 'Player1, Player2'
      });

      const result = await serverOperationsService.listPlayers('instance1');

      expect(rconServiceMock.executeRconCommand).toHaveBeenCalledWith('instance1', 'ListPlayers');
      expect(result).toEqual({
        success: true,
        response: 'Player1, Player2',
        instanceId: 'instance1'
      });
    });
  });

  describe('broadcast', () => {
    it('should broadcast message', async () => {
      validateInstanceIdMock.mockReturnValue(true);
      rconServiceMock.executeRconCommand.mockResolvedValue({ success: true });

      const result = await serverOperationsService.broadcast('instance1', 'Server maintenance in 5 minutes');

      expect(rconServiceMock.executeRconCommand).toHaveBeenCalledWith('instance1', 'Broadcast Server maintenance in 5 minutes');
      expect(result.success).toBe(true);
    });
  });

  describe('setMessageOfTheDay', () => {
    it('should set message of the day', async () => {
      validateInstanceIdMock.mockReturnValue(true);
      rconServiceMock.executeRconCommand.mockResolvedValue({ success: true });

      const result = await serverOperationsService.setMessageOfTheDay('instance1', 'Welcome to our server!');

      expect(rconServiceMock.executeRconCommand).toHaveBeenCalledWith('instance1', 'SetMessageOfTheDay Welcome to our server!');
      expect(result.success).toBe(true);
    });
  });

  describe('destroyTribe', () => {
    it('should destroy tribe', async () => {
      validateInstanceIdMock.mockReturnValue(true);
      rconServiceMock.executeRconCommand.mockResolvedValue({ success: true });

      const result = await serverOperationsService.destroyTribe('instance1', '12345');

      expect(rconServiceMock.executeRconCommand).toHaveBeenCalledWith('instance1', 'DestroyTribe 12345');
      expect(result.success).toBe(true);
    });
  });

  describe('destroyPlayer', () => {
    it('should destroy player', async () => {
      validateInstanceIdMock.mockReturnValue(true);
      rconServiceMock.executeRconCommand.mockResolvedValue({ success: true });

      const result = await serverOperationsService.destroyPlayer('instance1', '67890');

      expect(rconServiceMock.executeRconCommand).toHaveBeenCalledWith('instance1', 'DestroyPlayer 67890');
      expect(result.success).toBe(true);
    });
  });
});