import { ArkUpdateService, ArkUpdateResult } from './ark-update.service';
import { MessagingService } from './messaging.service';
import * as arkServerUtils from '../utils/ark/ark-server.utils';
import * as steamcmdUtils from '../utils/steamcmd.utils';
import * as globalConfigUtils from '../utils/global-config.utils';

jest.mock('../utils/ark/ark-server.utils', () => ({
  getCurrentInstalledVersion: jest.fn().mockResolvedValue('12345')
}));

jest.mock('../utils/global-config.utils', () => ({
  loadGlobalConfig: jest.fn().mockReturnValue({})
}));

jest.mock('../utils/ark/ark-install.utils', () => ({
  installArkServer: jest.fn((cb: Function) => cb(null))
}));

jest.mock('./server-instance/server-lifecycle.service', () => ({
  serverLifecycleService: { stopServerInstance: jest.fn().mockResolvedValue({}) }
}));

jest.mock('./server-instance/server-management.service', () => ({
  serverManagementService: {
    getAllInstances: jest.fn().mockResolvedValue({ instances: [] }),
    prepareInstanceConfiguration: jest.fn()
  }
}));

jest.mock('./server-instance/server-process.service', () => ({
  serverProcessService: { getNormalizedInstanceState: jest.fn().mockReturnValue('stopped') }
}));

jest.mock('./server-instance/server-instance.service', () => ({
  serverInstanceService: { getStandardEventCallbacks: jest.fn() }
}));

jest.mock('./rcon.service', () => ({
  rconService: { sendRconToInstance: jest.fn().mockResolvedValue('') }
}));

describe('ArkUpdateService', () => {
  let messagingService: MessagingService;
  let service: ArkUpdateService;

  beforeEach(() => {
    messagingService = { sendToAll: jest.fn() } as any;
    service = new ArkUpdateService(messagingService);
    jest.spyOn(steamcmdUtils, 'isSteamCmdInstalled').mockReturnValue(true);
    jest.spyOn(steamcmdUtils, 'getSteamCmdDir').mockReturnValue('STEAMCMD_DIR');
    // Reset to default before each test
    (arkServerUtils.getCurrentInstalledVersion as jest.Mock).mockReset().mockResolvedValue('12345');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('initialize sets lastKnownBuildId and starts polling', async () => {
    (service as any).pollAndNotify = jest.fn().mockResolvedValue('12346');
    jest.useFakeTimers();
    await service.initialize();
    expect(service['lastKnownBuildId']).toBe('12345');
    expect((service as any).pollAndNotify).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('checkForUpdate returns update result if new build', async () => {
    service['installedBuildId'] = '12345';
    (service as any).getLatestServerVersion = jest.fn().mockResolvedValue('12346');
    const result: ArkUpdateResult = await service.checkForUpdate();
    expect(result.success).toBe(true);
    expect(result.hasUpdate).toBe(true);
    expect(result.buildId).toBe('12346');
  });

  it('checkForUpdate returns no update if same build', async () => {
    service['installedBuildId'] = '12345';
    (service as any).getLatestServerVersion = jest.fn().mockResolvedValue('12345');
    const result: ArkUpdateResult = await service.checkForUpdate();
    expect(result.success).toBe(true);
    expect(result.hasUpdate).toBe(false);
  });

  it('checkForUpdate returns error on failure', async () => {
    (service as any).getLatestServerVersion = jest.fn().mockRejectedValue(new Error('fail'));
    const result: ArkUpdateResult = await service.checkForUpdate();
    expect(result.success).toBe(false);
    expect(result.hasUpdate).toBe(false);
    expect(result.error).toBe('fail');
  });

  it('pollArkServerUpdates returns new buildId if changed', async () => {
    // Simulate the effect by patching the method
    service['installedBuildId'] = '12345';
    // Patch the method to simulate a new buildId
    (service as any).getLatestServerVersion = jest.fn().mockResolvedValue('12346');
    const result = await service.pollArkServerUpdates();
    expect(result).toBe('12346');
  });

  it('pollArkServerUpdates returns null if no change', async () => {
    service['lastKnownBuildId'] = '12345';
    (service as any).getLatestServerVersion = jest.fn().mockResolvedValue('12345');
    const result = await service.pollArkServerUpdates();
    expect(result).toBeNull();
  });

  it('pollAndNotify sends update status', async () => {
    jest.spyOn(service, 'pollArkServerUpdates').mockResolvedValue('12346');
    await (service as any).pollAndNotify();
    expect(messagingService.sendToAll).toHaveBeenCalledWith('ark-update-status', { hasUpdate: true, buildId: '12346' });
  });

  it('getLatestServerVersion returns null if SteamCMD not installed', async () => {
    (steamcmdUtils.isSteamCmdInstalled as jest.Mock).mockReturnValue(false);
    const result = await service['getLatestServerVersion']();
    expect(result).toBeNull();
  });

  describe('auto-update cycle prevention', () => {
    it('pollArkServerUpdates re-reads installedBuildId from disk on each poll', async () => {
      // Reset the mock and configure sequential return values
      (arkServerUtils.getCurrentInstalledVersion as jest.Mock)
        .mockReset()
        .mockResolvedValueOnce('old-build')   // first call in poll
        .mockResolvedValueOnce('new-build');   // second call in poll
      jest.spyOn(service as any, 'getLatestServerVersion').mockResolvedValue('new-build');

      // First poll: old-build vs new-build → update detected
      const result1 = await service.pollArkServerUpdates();
      expect(result1).toBe('new-build');

      // Second poll: new-build vs new-build → no update
      const result2 = await service.pollArkServerUpdates();
      expect(result2).toBeNull();
    });

    it('pollAndNotify respects cooldown and does not re-trigger auto-update', async () => {
      (globalConfigUtils.loadGlobalConfig as jest.Mock).mockReturnValue({ autoUpdateArkServer: true, updateWarningMinutes: 5 });

      service['installedBuildId'] = '12345';
      service['lastUpdateAttemptTime'] = Date.now(); // cooldown active now
      jest.spyOn(service, 'pollArkServerUpdates').mockResolvedValue('12346');

      // Mock scheduleClusterUpdate to track calls
      const scheduleSpy = jest.fn();
      (service as any).scheduleClusterUpdate = scheduleSpy;

      await (service as any).pollAndNotify();

      // Should NOT schedule cluster update because cooldown is active
      expect(scheduleSpy).not.toHaveBeenCalled();
      // Should still notify about the available update
      expect(messagingService.sendToAll).toHaveBeenCalledWith('ark-update-available', expect.objectContaining({ latest: '12346' }));
    });

    it('pollAndNotify allows auto-update after cooldown expires', async () => {
      (globalConfigUtils.loadGlobalConfig as jest.Mock).mockReturnValue({ autoUpdateArkServer: true, updateWarningMinutes: 5 });

      service['installedBuildId'] = '12345';
      service['lastUpdateAttemptTime'] = Date.now() - (2 * 60 * 60 * 1000); // 2 hours ago — expired
      jest.spyOn(service, 'pollArkServerUpdates').mockResolvedValue('12346');

      const scheduleSpy = jest.fn();
      (service as any).scheduleClusterUpdate = scheduleSpy;

      await (service as any).pollAndNotify();

      // Cooldown expired — should schedule update
      expect(scheduleSpy).toHaveBeenCalledWith(5);
    });

    it('performClusterUpdate syncs installedBuildId with latestBuildId on no-op update', async () => {
      service['installedBuildId'] = '12345';
      service['latestBuildId'] = '99999';

      // getCurrentInstalledVersion returns same value → version unchanged after SteamCMD
      (arkServerUtils.getCurrentInstalledVersion as jest.Mock).mockReset().mockResolvedValue('12345');

      await service.performClusterUpdate([]);

      // Should have synced installedBuildId with latestBuildId since version was unchanged
      expect(service['installedBuildId']).toBe('99999');
      expect(service['lastUpdateAttemptTime']).toBeGreaterThan(0);
    });
  });
});
