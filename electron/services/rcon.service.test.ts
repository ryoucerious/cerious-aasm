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
    jest.spyOn(instanceUtils, 'getInstance').mockResolvedValue(null);
    const result = await service.connectRcon('id');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Instance not found');
  });

  it('connectRcon returns error for missing rcon config', async () => {
    jest.spyOn(instanceUtils, 'getInstance').mockResolvedValue({});
    const result = await service.connectRcon('id');
    expect(result.success).toBe(false);
    expect(result.error).toBe('RCON not configured for this instance');
  });

  it('connectRcon resolves success if connected', async () => {
    jest.spyOn(instanceUtils, 'getInstance').mockResolvedValue({ rconPort: 123, rconPassword: 'pass' });
    (rconUtils.connectRcon as any) = (id: string, inst: any, cb: (connected: boolean) => void) => cb(true);
    const result = await service.connectRcon('id');
    expect(result.success).toBe(true);
    expect(result.connected).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('connectRcon resolves error if not connected', async () => {
    jest.spyOn(instanceUtils, 'getInstance').mockResolvedValue({ rconPort: 123, rconPassword: 'pass' });
    (rconUtils.connectRcon as any) = (id: string, inst: any, cb: (connected: boolean) => void) => cb(false);
    const result = await service.connectRcon('id');
    expect(result.success).toBe(true);
    expect(result.connected).toBe(false);
    expect(result.error).toBe('Failed to establish RCON connection');
  });

  it('disconnectRcon resolves success', async () => {
    (rconUtils.disconnectRcon as any) = async (id: string) => {};
    const result = await service.disconnectRcon('id');
    expect(result.success).toBe(true);
    expect(result.connected).toBe(false);
  });

  it('disconnectRcon handles error', async () => {
    (rconUtils.disconnectRcon as any) = async (id: string) => { throw new Error('fail'); };
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

  it('executeRconCommand handles error', async () => {
    jest.spyOn(rconUtils, 'isRconConnected').mockReturnValue(true);
    jest.spyOn(rconUtils, 'sendRconCommand').mockRejectedValue(new Error('fail'));
    const result = await service.executeRconCommand('id', 'cmd');
    expect(result.success).toBe(false);
    expect(result.error).toBe('fail');
  });

  it('autoConnectRcon calls connectRcon and onStatusChange', async () => {
    jest.spyOn(instanceUtils, 'getInstance').mockResolvedValue({ rconPort: 123, rconPassword: 'pass' });
  (rconUtils.connectRcon as any) = (id: string, inst: any, cb: (connected: boolean) => void) => cb(true);
    const cb = jest.fn();
    await service.autoConnectRcon('id', cb);
    expect(cb).toHaveBeenCalledWith(true);
  });

  it('autoConnectRcon handles error and calls onStatusChange(false)', async () => {
    jest.spyOn(instanceUtils, 'getInstance').mockRejectedValue(new Error('fail'));
    const cb = jest.fn();
    await service.autoConnectRcon('id', cb);
    expect(cb).toHaveBeenCalledWith(false);
  });

  it('forceDisconnectRcon calls disconnectRcon', async () => {
    const spy = jest.fn();
    (rconUtils.disconnectRcon as any) = spy;
    await service.forceDisconnectRcon('id');
    expect(spy).toHaveBeenCalledWith('id');
  });

  it('forceDisconnectRcon handles error', async () => {
    (rconUtils.disconnectRcon as any) = async (id: string) => { throw new Error('fail'); };
    await expect(service.forceDisconnectRcon('id')).resolves.toBeUndefined();
  });
});
