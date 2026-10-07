import { RconService } from './rcon.service';
import * as instanceUtils from '../utils/ark/instance.utils';
import * as rconUtils from '../utils/rcon.utils';

describe('RconService', () => {
  let service: RconService;

  beforeEach(() => {
    service = new RconService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('connectRcon returns error for invalid instanceId', async () => {
    const result = await service.connectRcon('');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid instance ID');
  });

  it('connectRcon returns error for missing instance', async () => {
    jest.spyOn(instanceUtils, 'getInstance').mockReturnValue(null);
    const result = await service.connectRcon('id');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Instance not found');
  });

  it('connectRcon returns error for missing rcon config', async () => {
    jest.spyOn(instanceUtils, 'getInstance').mockReturnValue({ id: 'id' });
    const result = await service.connectRcon('id');
    expect(result.success).toBe(false);
    expect(result.error).toBe('RCON not configured for this instance');
  });

  // ARK authenticates RCON with ServerAdminPassword, which is all an instance may have.
  it('connectRcon accepts an instance with only an admin password', async () => {
    jest.spyOn(instanceUtils, 'getInstance').mockReturnValue({ id: 'id', rconPort: 123, serverAdminPassword: 'admin' });
    const connect = jest.spyOn(rconUtils, 'connectRcon').mockImplementation((_id, _config, onStatus) => onStatus?.(true));
    const result = await service.connectRcon('id');
    expect(result).toEqual({ success: true, connected: true, instanceId: 'id', error: undefined });
    expect(connect).toHaveBeenCalledWith('id', expect.objectContaining({ serverAdminPassword: 'admin' }), expect.any(Function));
  });

  it('connectRcon resolves success if connected', async () => {
    jest.spyOn(instanceUtils, 'getInstance').mockReturnValue({ id: 'id', rconPort: 123, rconPassword: 'pass' });
    (rconUtils.connectRcon as any) = (id: string, inst: any, cb: (connected: boolean) => void) => cb(true);
    const result = await service.connectRcon('id');
    expect(result.success).toBe(true);
    expect(result.connected).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('connectRcon resolves error if not connected', async () => {
    jest.spyOn(instanceUtils, 'getInstance').mockReturnValue({ id: 'id', rconPort: 123, rconPassword: 'pass' });
    (rconUtils.connectRcon as any) = (id: string, inst: any, cb: (connected: boolean) => void) => cb(false);
    const result = await service.connectRcon('id');
    expect(result.success).toBe(true);
    expect(result.connected).toBe(false);
    expect(result.error).toBe('Failed to establish RCON connection');
  });

  it('disconnectRcon resolves success', async () => {
    (rconUtils.disconnectRcon as any) = (id: string) => {};
    const result = await service.disconnectRcon('id');
    expect(result.success).toBe(true);
    expect(result.connected).toBe(false);
  });

  it('disconnectRcon handles error', async () => {
    (rconUtils.disconnectRcon as any) = (id: string) => { throw new Error('fail'); };
    const result = await service.disconnectRcon('id');
    expect(result.success).toBe(false);
    expect(result.error).toBe('fail');
  });

  it('getRconStatus returns status', () => {
    jest.spyOn(rconUtils, 'isRconConnected').mockReturnValue(true);
    const result = service.getRconStatus('id');
    expect(result.success).toBe(true);
    expect(result.connected).toBe(true);
  });

  it('executeRconCommand returns error for invalid params', async () => {
    const result = await service.executeRconCommand('', '');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid instance ID or command');
  });

  it('executeRconCommand returns error if not connected', async () => {
    jest.spyOn(rconUtils, 'isRconConnected').mockReturnValue(false);
    const result = await service.executeRconCommand('id', 'cmd');
    expect(result.success).toBe(false);
    expect(result.error).toBe('RCON not connected for this instance');
  });

  it('executeRconCommand resolves success', async () => {
    jest.spyOn(rconUtils, 'isRconConnected').mockReturnValue(true);
    jest.spyOn(rconUtils, 'sendRconCommand').mockResolvedValue('resp');
    const result = await service.executeRconCommand('id', 'cmd');
    expect(result.success).toBe(true);
    expect(result.response).toBe('resp');
  });

  it('executeRconCommand forwards timeoutMs to sendRconCommand', async () => {
    jest.spyOn(rconUtils, 'isRconConnected').mockReturnValue(true);
    const sendSpy = jest.spyOn(rconUtils, 'sendRconCommand').mockResolvedValue('ok');
    await service.executeRconCommand('id', 'SaveWorld', 30000);
    expect(sendSpy).toHaveBeenCalledWith('id', 'SaveWorld', 30000);
  });

  it('executeRconCommand handles error', async () => {
    jest.spyOn(rconUtils, 'isRconConnected').mockReturnValue(true);
    jest.spyOn(rconUtils, 'sendRconCommand').mockRejectedValue(new Error('fail'));
    const result = await service.executeRconCommand('id', 'cmd');
    expect(result.success).toBe(false);
    expect(result.error).toBe('fail');
    expect(result.notSent).toBeUndefined();
  });

  describe('executeRconCommand says when a command provably never reached the server', () => {
    it('with no connection', async () => {
      jest.spyOn(rconUtils, 'isRconConnected').mockReturnValue(false);

      await expect(service.executeRconCommand('id', 'DoExit')).resolves.toEqual({
        success: false, instanceId: 'id', error: 'RCON not connected for this instance', notSent: true
      });
    });

    it('when it timed out still queued', async () => {
      jest.spyOn(rconUtils, 'isRconConnected').mockReturnValue(true);
      jest.spyOn(rconUtils, 'sendRconCommand').mockRejectedValue(new rconUtils.RconCommandNotSentError('RCON command timed out after 30000ms'));

      await expect(service.executeRconCommand('id', 'DoExit')).resolves.toEqual({
        success: false, instanceId: 'id', error: 'RCON command timed out after 30000ms', notSent: true
      });
    });
  });

  describe('reconnectRcon', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.spyOn(instanceUtils, 'getInstance').mockReturnValue({ id: 'id', rconPort: 123, rconPassword: 'pass' });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('makes a single attempt', async () => {
      const connect = jest.spyOn(rconUtils, 'connectRcon').mockImplementation((_id, _config, onStatus) => onStatus?.(true));

      await expect(service.reconnectRcon('id', 5000)).resolves.toBe(true);
      expect(connect).toHaveBeenCalledWith('id', expect.objectContaining({ rconPort: 123 }), expect.any(Function), 1);
    });

    it('gives up after the timeout', async () => {
      let answer: ((connected: boolean) => void) | undefined;
      jest.spyOn(rconUtils, 'connectRcon').mockImplementation((_id, _config, onStatus) => { answer = onStatus; });
      const disconnect = jest.spyOn(rconUtils, 'disconnectRcon').mockImplementation(() => answer?.(false));

      const reconnecting = service.reconnectRcon('id', 5000);
      jest.advanceTimersByTime(5000);

      await expect(reconnecting).resolves.toBe(false);
      expect(disconnect).toHaveBeenCalledWith('id');
    });

    it('does not try without an RCON port', async () => {
      jest.spyOn(instanceUtils, 'getInstance').mockReturnValue({ id: 'id' });
      const connect = jest.spyOn(rconUtils, 'connectRcon');

      await expect(service.reconnectRcon('id', 5000)).resolves.toBe(false);
      expect(connect).not.toHaveBeenCalled();
    });
  });

  describe('online players', () => {
    function answers(response: string): void {
      jest.spyOn(service, 'executeRconCommand').mockResolvedValue({ success: true, response, instanceId: 'id' });
    }

    // ASA lists each player with their EOS ID: 32 hex characters, not a number.
    it('reads each player\'s whole EOS ID from ASA\'s list', async () => {
      answers('0. Jared, 0002a1b2c3d4e5f60718293a4b5c6d7e\n1. Ada, 00029f8e7d6c5b4a39281706f5e4d3c2\n ');

      expect(await service.getOnlinePlayers('id')).toEqual([
        { name: 'Jared', playerId: '0002a1b2c3d4e5f60718293a4b5c6d7e', steamId: '0002a1b2c3d4e5f60718293a4b5c6d7e' },
        { name: 'Ada', playerId: '00029f8e7d6c5b4a39281706f5e4d3c2', steamId: '00029f8e7d6c5b4a39281706f5e4d3c2' }
      ]);
    });

    it('keeps a name with a comma in it whole', async () => {
      answers('0. Doe, Jane, 0002a1b2c3d4e5f60718293a4b5c6d7e\r\n');

      expect(await service.getOnlinePlayers('id')).toEqual([
        { name: 'Doe, Jane', playerId: '0002a1b2c3d4e5f60718293a4b5c6d7e', steamId: '0002a1b2c3d4e5f60718293a4b5c6d7e' }
      ]);
    });

    it('still reads a numeric ID', async () => {
      answers('0. Old, 76561198000000000');

      expect(await service.getOnlinePlayers('id')).toEqual([{ name: 'Old', playerId: '76561198000000000', steamId: '76561198000000000' }]);
    });

    it('lists nobody when nobody is connected', async () => {
      answers('No Players Connected');

      expect(await service.getOnlinePlayers('id')).toEqual([]);
    });
  });

  it('forceDisconnectRcon calls disconnectRcon', async () => {
    const spy = jest.fn();
    (rconUtils.disconnectRcon as any) = spy;
    await service.forceDisconnectRcon('id');
    expect(spy).toHaveBeenCalledWith('id');
  });

  it('forceDisconnectRcon handles error', async () => {
    (rconUtils.disconnectRcon as any) = (id: string) => { throw new Error('fail'); };
    await expect(service.forceDisconnectRcon('id')).resolves.toBeUndefined();
  });
});
