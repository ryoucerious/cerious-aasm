import { messagingService } from '../services/messaging.service';
import { automationService } from '../services/automation/automation.service';
import { schedulerService } from '../services/scheduler.service';
import * as instanceUtils from '../utils/ark/instance.utils';
import { setHostRouter } from '../services/host-routing';

jest.mock('../services/messaging.service', () => ({
  messagingService: { on: jest.fn(), sendToOriginator: jest.fn() }
}));
jest.mock('../services/automation/automation.service', () => ({
  automationService: {
    configureAutostart: jest.fn(),
    configureCrashDetection: jest.fn(),
    configureScheduledRestart: jest.fn(),
    getAutomationStatus: jest.fn(),
    handleAutoStartOnAppLaunch: jest.fn()
  }
}));
jest.mock('../services/scheduler.service', () => ({ schedulerService: { initSchedule: jest.fn() } }));
jest.mock('../utils/ark/instance.utils', () => ({ getInstance: jest.fn(), saveInstance: jest.fn() }));

const mockMessaging = jest.mocked(messagingService);
const mockAutomation = jest.mocked(automationService);
const mockInstanceUtils = jest.mocked(instanceUtils);

type Listener = (payload: unknown, sender: unknown) => Promise<void>;

describe('automation-handler', () => {
  const sender = { send: jest.fn() };
  let handlers: Record<string, Listener>;

  beforeAll(() => {
    require('./automation-handler');
    handlers = Object.fromEntries(mockMessaging.on.mock.calls.map(([channel, listener]) => [channel, listener as Listener]));
  });

  function replies(channel: string): unknown[] {
    return mockMessaging.sendToOriginator.mock.calls.filter(([replyChannel]) => replyChannel === channel).map(call => call[1]);
  }

  describe.each([
    ['configure-autostart', mockAutomation.configureAutostart,
      { autoStartOnAppLaunch: true, autoStartOnBoot: false }, [true, false]],
    ['configure-crash-detection', mockAutomation.configureCrashDetection,
      { enabled: true, checkInterval: 30000, maxRestartAttempts: 3 }, [true, 30000, 3]],
    ['configure-scheduled-restart', mockAutomation.configureScheduledRestart,
      { enabled: true, frequency: 'daily', time: '04:00', days: [1], warningMinutes: 5 }, [true, 'daily', '04:00', [1], 5]],
    ['configure-scheduled-restart', mockAutomation.configureScheduledRestart,
      { enabled: true, frequency: 'daily', time: '04:00', times: ['04:00', '16:00'], days: [1], warningMinutes: 5 }, [true, 'daily', ['04:00', '16:00'], [1], 5]],
    ['get-automation-status', mockAutomation.getAutomationStatus, {}, []]
  ] as const)('%s', (channel, serviceMethod, settings, args) => {
    const method = serviceMethod as jest.Mock;

    it('passes the settings on and replies with the result', async () => {
      method.mockResolvedValue({ success: true, status: { isMonitoring: true } });

      await handlers[channel]({ serverId: 'a1', ...settings, requestId: 'r1' }, sender);

      expect(method).toHaveBeenCalledWith('a1', ...args);
      expect(replies(channel)).toEqual([{ success: true, status: { isMonitoring: true }, requestId: 'r1' }]);
    });

    it('passes on a refusal from the service', async () => {
      method.mockResolvedValue({ success: false, error: 'Configuration failed' });

      await handlers[channel]({ serverId: 'a1', ...settings, requestId: 'r1' }, sender);

      expect(replies(channel)).toEqual([{ success: false, error: 'Configuration failed', requestId: 'r1' }]);
    });

    it.each([
      ['an Error', new Error('Service error'), 'Service error'],
      ['a string', 'String error', 'String error']
    ])('replies a failure when the service throws %s', async (_label, thrown, error) => {
      method.mockRejectedValue(thrown);

      await handlers[channel]({ serverId: 'a1', ...settings, requestId: 'r1' }, sender);

      expect(replies(channel)).toEqual([{ success: false, error, requestId: 'r1' }]);
    });

    it.each([[{ serverId: '../x', requestId: 'r1' }, 'r1'], [undefined, undefined]])(
      'refuses an invalid instance id without calling the service (payload %p)',
      async (payload, requestId) => {
        await handlers[channel](payload, sender);

        expect(method).not.toHaveBeenCalled();
        expect(replies(channel)).toEqual([{ success: false, error: 'Invalid instance ID', requestId }]);
      }
    );
  });

  describe('configure-discord-webhook', () => {
    const config = { enabled: true, webhookUrl: 'https://discord.com/api/webhooks/1/abc' };

    it('stores the webhook settings on the instance', async () => {
      mockInstanceUtils.getInstance.mockReturnValue({ id: 'a1', name: 'Alpha' });
      mockInstanceUtils.saveInstance.mockResolvedValue({ id: 'a1' });

      await handlers['configure-discord-webhook']({ serverId: 'a1', config, requestId: 'r1' }, sender);

      expect(mockInstanceUtils.saveInstance).toHaveBeenCalledWith({ id: 'a1', name: 'Alpha', discordConfig: config });
      expect(replies('configure-discord-webhook')).toEqual([{ success: true, requestId: 'r1' }]);
    });

    it('refuses a webhook URL that is not Discord\'s', async () => {
      mockInstanceUtils.getInstance.mockReturnValue({ id: 'a1', name: 'Alpha' });

      await handlers['configure-discord-webhook']({
        serverId: 'a1', config: { enabled: true, webhookUrl: 'http://169.254.169.254/latest/meta-data' }, requestId: 'r1'
      }, sender);

      expect(mockInstanceUtils.saveInstance).not.toHaveBeenCalled();
      expect(replies('configure-discord-webhook')).toEqual([
        { success: false, error: 'The Discord webhook URL must be a Discord webhook link, such as https://discord.com/api/webhooks/...', requestId: 'r1' }
      ]);
    });

    it('replies a failure for an instance that does not exist', async () => {
      mockInstanceUtils.getInstance.mockReturnValue(null);

      await handlers['configure-discord-webhook']({ serverId: 'a1', config, requestId: 'r1' }, sender);

      expect(mockInstanceUtils.saveInstance).not.toHaveBeenCalled();
      expect(replies('configure-discord-webhook')).toEqual([{ success: false, error: 'Instance not found', requestId: 'r1' }]);
    });

    it('passes on a save the instance store refused', async () => {
      mockInstanceUtils.getInstance.mockReturnValue({ id: 'a1', name: 'Alpha' });
      mockInstanceUtils.saveInstance.mockResolvedValue({ error: 'A server with this name already exists.' });

      await handlers['configure-discord-webhook']({ serverId: 'a1', config, requestId: 'r1' }, sender);

      expect(replies('configure-discord-webhook')).toEqual([
        { success: false, error: 'A server with this name already exists.', requestId: 'r1' }
      ]);
    });

    it.each([[{ serverId: '../x', config, requestId: 'r1' }, 'r1'], [undefined, undefined]])(
      'refuses an invalid instance id without touching any config (payload %p)',
      async (payload, requestId) => {
        await handlers['configure-discord-webhook'](payload, sender);

        expect(mockInstanceUtils.getInstance).not.toHaveBeenCalled();
        expect(replies('configure-discord-webhook')).toEqual([{ success: false, error: 'Invalid instance ID', requestId }]);
      }
    );
  });

  describe('configure-broadcasts', () => {
    beforeEach(() => {
      mockInstanceUtils.getInstance.mockReturnValue({ id: 'a1', name: 'Alpha' });
      mockInstanceUtils.saveInstance.mockResolvedValue({ id: 'a1' });
    });

    it('stores the broadcast config and reschedules the broadcasts', async () => {
      const broadcastConfig = { enabled: true, messages: [{ id: 'm1', message: 'Hi', interval: 30, enabled: true }] };

      await handlers['configure-broadcasts']({ serverId: 'a1', broadcastConfig, requestId: 'r1' }, sender);

      expect(mockInstanceUtils.saveInstance).toHaveBeenCalledWith({ id: 'a1', name: 'Alpha', broadcastConfig });
      expect(schedulerService.initSchedule).toHaveBeenCalledWith('a1');
      expect(replies('configure-broadcasts')).toEqual([{ success: true, requestId: 'r1' }]);
    });

    it('turns a flat broadcast list into a broadcast config', async () => {
      const broadcasts = [
        { id: 'm1', message: 'Hi', intervalMinutes: 15 },
        { id: 'm2', message: 'Bye', enabled: false }
      ];

      await handlers['configure-broadcasts']({ serverId: 'a1', broadcasts, requestId: 'r1' }, sender);

      expect(mockInstanceUtils.saveInstance).toHaveBeenCalledWith({
        id: 'a1',
        name: 'Alpha',
        broadcasts,
        broadcastConfig: {
          enabled: true,
          messages: [
            { id: 'm1', message: 'Hi', interval: 15, enabled: true },
            { id: 'm2', message: 'Bye', interval: 60, enabled: false }
          ]
        }
      });
    });

    it('does not reschedule when the save is refused', async () => {
      mockInstanceUtils.saveInstance.mockResolvedValue({ error: 'A server with this name already exists.' });

      await handlers['configure-broadcasts']({ serverId: 'a1', broadcastConfig: {}, requestId: 'r1' }, sender);

      expect(schedulerService.initSchedule).not.toHaveBeenCalled();
      expect(replies('configure-broadcasts')).toEqual([
        { success: false, error: 'A server with this name already exists.', requestId: 'r1' }
      ]);
    });

    it.each([[{ serverId: '../x', requestId: 'r1' }, 'r1'], [undefined, undefined]])(
      'refuses an invalid instance id without touching any config (payload %p)',
      async (payload, requestId) => {
        await handlers['configure-broadcasts'](payload, sender);

        expect(mockInstanceUtils.getInstance).not.toHaveBeenCalled();
        expect(replies('configure-broadcasts')).toEqual([{ success: false, error: 'Invalid instance ID', requestId }]);
      }
    );
  });

  describe('auto-start-on-app-launch', () => {
    it('starts the servers marked for it and replies', async () => {
      mockAutomation.handleAutoStartOnAppLaunch.mockResolvedValue(undefined);

      await handlers['auto-start-on-app-launch']({ requestId: 'r1' }, sender);

      expect(mockAutomation.handleAutoStartOnAppLaunch).toHaveBeenCalled();
      expect(replies('auto-start-on-app-launch')).toEqual([{ success: true, requestId: 'r1' }]);
    });

    it('replies a failure when starting throws', async () => {
      mockAutomation.handleAutoStartOnAppLaunch.mockRejectedValue(new Error('Auto-start failed'));

      await handlers['auto-start-on-app-launch']({ requestId: 'r1' }, sender);

      expect(replies('auto-start-on-app-launch')).toEqual([{ success: false, error: 'Auto-start failed', requestId: 'r1' }]);
    });

    it('answers a request without a payload', async () => {
      mockAutomation.handleAutoStartOnAppLaunch.mockResolvedValue(undefined);

      await handlers['auto-start-on-app-launch'](undefined, sender);

      expect(replies('auto-start-on-app-launch')).toEqual([{ success: true, requestId: undefined }]);
    });
  });

  // A server on another machine: its automation runs there.
  describe('a server hosted on another machine', () => {
    const router = jest.fn(async () => ({ success: true, there: true }));
    beforeEach(() => { router.mockClear(); setHostRouter(router); });
    afterEach(() => setHostRouter(null));

    it.each([
      ['get-automation-status', true], ['configure-autostart', false], ['configure-crash-detection', false],
      ['configure-discord-webhook', false], ['configure-broadcasts', false], ['configure-scheduled-restart', false]
    ])('runs %s on that machine', async (channel, read) => {
      await handlers[channel]({ serverId: 'far', requestId: 'r1' }, sender);

      expect(router).toHaveBeenCalledWith(channel, 'far', { serverId: 'far' }, read, sender);
      expect(replies(channel)).toContainEqual({ success: true, there: true, requestId: 'r1' });
    });
  });
});
