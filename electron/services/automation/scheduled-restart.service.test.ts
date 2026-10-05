import { ScheduledRestartService } from './scheduled-restart.service';
import { AutomationSettings, ServerAutomation } from '../../types/automation.types';

jest.mock('../server-instance/server-instance.service', () => ({
  serverInstanceService: { startServerInstance: jest.fn() }
}));
jest.mock('../server-instance/instance-events', () => ({
  getStandardEventCallbacks: jest.fn(() => ({ onLog: jest.fn(), onState: jest.fn() }))
}));
jest.mock('../server-instance/server-lifecycle.service', () => ({
  serverLifecycleService: { stopServerInstance: jest.fn() }
}));
jest.mock('../server-instance/server-process.service', () => ({
  serverProcessService: { getInstanceState: jest.fn(), getNormalizedInstanceState: jest.fn(), getServerProcess: jest.fn() }
}));
jest.mock('../rcon.service', () => ({ rconService: { executeRconCommand: jest.fn() } }));
jest.mock('../messaging.service', () => ({ messagingService: { sendToAll: jest.fn() } }));

const { serverInstanceService } = jest.requireMock('../server-instance/server-instance.service');
const { serverLifecycleService } = jest.requireMock('../server-instance/server-lifecycle.service');
const { serverProcessService } = jest.requireMock('../server-instance/server-process.service');
const { rconService } = jest.requireMock('../rcon.service');
const { messagingService } = jest.requireMock('../messaging.service');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function makeAutomation(overrides: Partial<AutomationSettings> = {}): ServerAutomation {
  return {
    serverId: 'a1',
    settings: {
      autoStartOnAppLaunch: false,
      autoStartOnBoot: false,
      crashDetectionEnabled: false,
      crashDetectionInterval: 60,
      maxRestartAttempts: 3,
      scheduledRestartEnabled: true,
      restartFrequency: 'daily',
      restartTime: '04:00',
      restartDays: [1],
      restartWarningMinutes: 5,
      ...overrides
    },
    restartAttempts: 0,
    manuallyStopped: false,
    status: { isMonitoring: false, isScheduled: false }
  };
}

describe('ScheduledRestartService', () => {
  let automations: Map<string, ServerAutomation>;
  let service: ScheduledRestartService;

  beforeEach(() => {
    // Monday 29 September 2025, 03:00 host local time.
    jest.useFakeTimers({ now: new Date(2025, 8, 29, 3, 0, 0) });
    automations = new Map();
    service = new ScheduledRestartService(automations);
    serverProcessService.getInstanceState.mockReturnValue('running');
    rconService.executeRconCommand.mockResolvedValue({ success: true, response: '', instanceId: 'a1' });
    serverLifecycleService.stopServerInstance.mockResolvedValue({ success: true, instanceId: 'a1' });
    serverInstanceService.startServerInstance.mockResolvedValue({ started: true, instanceId: 'a1' });
  });

  afterEach(() => {
    service.unscheduleRestart('a1');
    jest.useRealTimers();
  });

  function schedule(overrides: Partial<AutomationSettings> = {}): ServerAutomation {
    const automation = makeAutomation(overrides);
    automations.set('a1', automation);
    service.scheduleRestart('a1');
    return automation;
  }

  function broadcasts(): string[] {
    return rconService.executeRconCommand.mock.calls.map(([, command]: [string, string]) => command);
  }

  describe('scheduling', () => {
    it('schedules a daily restart for the next time of day', () => {
      const automation = schedule();

      expect(automation.status).toEqual({ isMonitoring: false, isScheduled: true, nextRestart: new Date(2025, 8, 29, 4, 0) });
    });

    it('schedules a weekly restart on the nearest chosen day', () => {
      const automation = schedule({ restartFrequency: 'weekly', restartTime: '02:00', restartDays: [1, 3] });

      expect(automation.status.nextRestart).toEqual(new Date(2025, 9, 1, 2, 0));
    });

    it('treats custom as the chosen days at the chosen time, as the UI shows it', () => {
      const automation = schedule({ restartFrequency: 'custom', restartTime: '02:00', restartDays: [3] });

      expect(automation.status.nextRestart).toEqual(new Date(2025, 9, 1, 2, 0));
    });

    // Each of these used to schedule a delay of zero or less, and then restart the server in a loop.
    it.each([
      ['no restart, left enabled', { restartFrequency: 'none' as const }],
      ['weekly with no days chosen', { restartFrequency: 'weekly' as const, restartDays: [] }],
      ['an impossible time', { restartTime: '25:99' }],
      ['an hourly frequency the UI does not offer', { restartFrequency: 'hourly' as unknown as AutomationSettings['restartFrequency'] }]
    ])('does not schedule %s', async (_label, overrides) => {
      const automation = schedule(overrides);

      expect(automation.status.isScheduled).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
      await jest.advanceTimersByTimeAsync(48 * HOUR);
      expect(serverLifecycleService.stopServerInstance).not.toHaveBeenCalled();
    });

    it('ignores an instance without automation settings', () => {
      expect(() => service.scheduleRestart('missing')).not.toThrow();
      expect(() => service.unscheduleRestart('missing')).not.toThrow();
    });

    it('unschedules', () => {
      const automation = schedule();

      service.unscheduleRestart('a1');

      expect(automation.status).toEqual({ isMonitoring: false, isScheduled: false });
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('restarting', () => {
    it('warns the players, waits, then stops the server gracefully and starts it again', async () => {
      schedule();

      await jest.advanceTimersByTimeAsync(HOUR);
      expect(broadcasts()).toEqual(['broadcast Server will restart in 5 minutes!']);
      expect(serverLifecycleService.stopServerInstance).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(5 * MINUTE);
      expect(broadcasts()).toEqual(['broadcast Server will restart in 5 minutes!', 'broadcast Server restarting now!']);
      expect(messagingService.sendToAll).toHaveBeenCalledWith('server-instance-state', { state: 'stopping', instanceId: 'a1' });
      expect(serverLifecycleService.stopServerInstance).toHaveBeenCalledWith('a1');
      expect(serverInstanceService.startServerInstance).toHaveBeenCalledWith('a1', expect.any(Function), expect.any(Function));
      expect(serverProcessService.getServerProcess).not.toHaveBeenCalled();
    });

    // The server used to be killed and started again 5 s later, whether it had exited or not.
    it('starts the server again only once the stop has finished', async () => {
      let finishStop: (result: unknown) => void = () => undefined;
      serverLifecycleService.stopServerInstance.mockReturnValue(new Promise(resolve => { finishStop = resolve; }));
      schedule();

      await jest.advanceTimersByTimeAsync(HOUR + 5 * MINUTE + 10 * MINUTE);
      expect(serverInstanceService.startServerInstance).not.toHaveBeenCalled();

      finishStop({ success: true, instanceId: 'a1' });
      await jest.advanceTimersByTimeAsync(0);
      expect(serverInstanceService.startServerInstance).toHaveBeenCalled();
    });

    it('restarts at once when the players cannot be warned', async () => {
      rconService.executeRconCommand.mockResolvedValue({ success: false, error: 'RCON not connected for this instance', notSent: true, instanceId: 'a1' });
      schedule();

      await jest.advanceTimersByTimeAsync(HOUR);

      expect(serverLifecycleService.stopServerInstance).toHaveBeenCalledWith('a1');
    });

    it('restarts at once when there is no warning time', async () => {
      schedule({ restartWarningMinutes: 0 });

      await jest.advanceTimersByTimeAsync(HOUR);

      expect(broadcasts()).toEqual(['broadcast Server restarting now!']);
      expect(serverLifecycleService.stopServerInstance).toHaveBeenCalled();
    });

    // The countdown timers were not tracked, so a restart still happened after the schedule was disabled.
    it('cancels a pending restart when the schedule is disabled during the warning', async () => {
      schedule();
      await jest.advanceTimersByTimeAsync(HOUR);

      service.unscheduleRestart('a1');
      await jest.advanceTimersByTimeAsync(10 * MINUTE);

      expect(serverLifecycleService.stopServerInstance).not.toHaveBeenCalled();
      expect(serverInstanceService.startServerInstance).not.toHaveBeenCalled();
    });

    it('restarts once, on the new schedule, when rescheduled during the warning', async () => {
      const automation = schedule();
      await jest.advanceTimersByTimeAsync(HOUR);

      automation.settings.restartTime = '06:00';
      service.scheduleRestart('a1');
      await jest.advanceTimersByTimeAsync(10 * MINUTE);
      expect(serverLifecycleService.stopServerInstance).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(2 * HOUR);
      expect(serverLifecycleService.stopServerInstance).toHaveBeenCalledTimes(1);
    });

    it('leaves a server that was stopped by hand during the warning alone', async () => {
      schedule();
      await jest.advanceTimersByTimeAsync(HOUR);

      serverProcessService.getInstanceState.mockReturnValue('stopped');
      await jest.advanceTimersByTimeAsync(5 * MINUTE);

      expect(serverLifecycleService.stopServerInstance).not.toHaveBeenCalled();
      expect(serverInstanceService.startServerInstance).not.toHaveBeenCalled();
    });

    it('skips a server that is not running, and keeps the schedule', async () => {
      serverProcessService.getInstanceState.mockReturnValue('stopped');
      const automation = schedule();

      await jest.advanceTimersByTimeAsync(HOUR);

      expect(broadcasts()).toEqual([]);
      expect(serverLifecycleService.stopServerInstance).not.toHaveBeenCalled();
      expect(automation.status.nextRestart).toEqual(new Date(2025, 8, 30, 4, 0));
    });

    // 'stopping' was broadcast before the stop; left there, every client showed a server stuck stopping.
    it('does not start a server it could not stop, and tells the clients its real state', async () => {
      serverLifecycleService.stopServerInstance.mockResolvedValue({ success: false, error: 'Server process not found', instanceId: 'a1' });
      serverProcessService.getNormalizedInstanceState.mockReturnValue('crashed');
      schedule({ restartWarningMinutes: 0 });

      await jest.advanceTimersByTimeAsync(HOUR);

      expect(serverInstanceService.startServerInstance).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalled();
      expect(messagingService.sendToAll).toHaveBeenLastCalledWith('server-instance-state', { state: 'crashed', instanceId: 'a1' });
    });

    it('schedules the next restart once one is done', async () => {
      const automation = schedule();

      await jest.advanceTimersByTimeAsync(HOUR + 5 * MINUTE);

      expect(automation.status).toMatchObject({ isScheduled: true, nextRestart: new Date(2025, 8, 30, 4, 0) });
      await jest.advanceTimersByTimeAsync(24 * HOUR);
      expect(serverLifecycleService.stopServerInstance).toHaveBeenCalledTimes(2);
    });

    it('keeps the schedule when a restart throws', async () => {
      serverInstanceService.startServerInstance.mockRejectedValueOnce(new Error('boom'));
      const automation = schedule({ restartWarningMinutes: 0 });

      await jest.advanceTimersByTimeAsync(HOUR);

      expect(console.error).toHaveBeenCalled();
      expect(automation.status).toMatchObject({ isScheduled: true, nextRestart: new Date(2025, 8, 30, 4, 0) });
    });
  });
});
