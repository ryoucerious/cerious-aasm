import { ArkUpdateService, ArkUpdateResult } from './ark-update.service';
import { MessagingService } from './messaging.service';
import * as arkServerUtils from '../utils/ark/ark-server.utils';
import * as steamcmdUtils from '../utils/steamcmd.utils';

jest.mock('../utils/ark/ark-server.utils', () => ({
  getCurrentInstalledVersion: jest.fn().mockResolvedValue('12345')
}));

describe('ArkUpdateService', () => {
  let messagingService: MessagingService;
  let service: ArkUpdateService;

  beforeEach(() => {
    messagingService = { sendToAll: jest.fn() } as any;
    service = new ArkUpdateService(messagingService);
    jest.spyOn(steamcmdUtils, 'isSteamCmdInstalled').mockReturnValue(true);
    jest.spyOn(steamcmdUtils, 'getSteamCmdDir').mockReturnValue('STEAMCMD_DIR');
    // getCurrentInstalledVersion is already mocked above
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('initialize sets lastKnownBuildId and starts polling', async () => {
    const pollSpy = jest.spyOn(service, 'pollAndNotify').mockResolvedValue('12346');
    jest.useFakeTimers();
    await service.initialize();
    expect(service['lastKnownBuildId']).toBe('12345');
    expect(pollSpy).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('checkForUpdate returns update result if new build', async () => {
    jest.spyOn(service, 'pollArkServerUpdates').mockResolvedValue('12346');
    const result: ArkUpdateResult = await service.checkForUpdate();
    expect(result.success).toBe(true);
    expect(result.hasUpdate).toBe(true);
    expect(result.buildId).toBe('12346');
  });

  it('checkForUpdate returns no update if null', async () => {
    jest.spyOn(service, 'pollArkServerUpdates').mockResolvedValue(null);
    const result: ArkUpdateResult = await service.checkForUpdate();
    expect(result.success).toBe(true);
    expect(result.hasUpdate).toBe(false);
  });

  it('checkForUpdate returns error on failure', async () => {
    jest.spyOn(service, 'pollArkServerUpdates').mockRejectedValue(new Error('fail'));
    const result: ArkUpdateResult = await service.checkForUpdate();
    expect(result.success).toBe(false);
    expect(result.hasUpdate).toBe(false);
    expect(result.error).toBe('fail');
  });

  it('pollArkServerUpdates returns new buildId if changed', async () => {
    // Simulate the effect by patching the method
    service['lastKnownBuildId'] = '12345';
    // Patch the method to simulate a new buildId
    (service as any).getLatestServerVersion = jest.fn().mockResolvedValue('12346');
    const result = await service.pollArkServerUpdates();
    expect(result).toBe('12346');
    expect(service['lastKnownBuildId']).toBe('12346');
  });

  it('pollArkServerUpdates returns null if no change', async () => {
    service['lastKnownBuildId'] = '12345';
    (service as any).getLatestServerVersion = jest.fn().mockResolvedValue('12345');
    const result = await service.pollArkServerUpdates();
    expect(result).toBeNull();
  });

  it('pollAndNotify sends update status', async () => {
    jest.spyOn(service, 'pollArkServerUpdates').mockResolvedValue('12346');
    await service.pollAndNotify();
    expect(messagingService.sendToAll).toHaveBeenCalledWith('ark-update-status', { hasUpdate: true, buildId: '12346' });
  });

  it('getLatestServerVersion returns null if SteamCMD not installed', async () => {
    (steamcmdUtils.isSteamCmdInstalled as jest.Mock).mockReturnValue(false);
    const result = await service['getLatestServerVersion']();
    expect(result).toBeNull();
  });
});
