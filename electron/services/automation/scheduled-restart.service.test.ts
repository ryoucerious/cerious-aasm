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
    /** Host local time today (Monday 29 September 2025). */
    const at = (hours: number, minutes: number, seconds = 0) => new Date(2025, 8, 29, hours, minutes, seconds);
    const advanceTo = (time: Date) => jest.advanceTimersByTimeAsync(time.getTime() - Date.now());

    /** When each broadcast went out, as "HH:MM:SS message". */
    let sent: string[];
    let stoppedAt: Date | null;

    beforeEach(() => {
      sent = [];
      stoppedAt = null;
      rconService.executeRconCommand.mockImplementation(async (_id: string, command: string) => {
        sent.push(`${new Date(Date.now()).toTimeString().slice(0, 8)} ${command.replace(/^broadcast /, '')}`);
        return { success: true, response: '', instanceId: 'a1' };
      });
      serverLifecycleService.stopServerInstance.mockImplementation(async () => {
        stoppedAt = new Date(Date.now());
        return { success: true, instanceId: 'a1' };
      });
    });

    // A restart set for 04:20 with a 15-minute warning used to warn at 04:20 and restart at 04:35.
    it('restarts at the time entered, with the warnings counting down to it', async () => {
      const automation = schedule({ restartTime: '04:20', restartWarningMinutes: 15 });
      expect(automation.status.nextRestart).toEqual(at(4, 20));

      await advanceTo(at(4, 19, 59));
      expect(sent).toEqual([
        '04:05:00 Server will restart in 15 minutes!',
        '04:10:00 Server will restart in 10 minutes!',
        '04:15:00 Server will restart in 5 minutes!',
        '04:16:00 Server will restart in 4 minutes!',
        '04:17:00 Server will restart in 3 minutes!',
        '04:18:00 Server will restart in 2 minutes!',
        '04:19:00 Server will restart in 1 minute!'
      ]);
      expect(serverLifecycleService.stopServerInstance).not.toHaveBeenCalled();

      await advanceTo(at(4, 20));
      expect(sent.at(-1)).toBe('04:20:00 Server restarting now!');
      expect(stoppedAt).toEqual(at(4, 20));
      expect(messagingService.sendToAll).toHaveBeenCalledWith('server-instance-state', { state: 'stopping', instanceId: 'a1' });
      expect(serverInstanceService.startServerInstance).toHaveBeenCalledWith('a1', expect.any(Function), expect.any(Function));
      expect(serverProcessService.getServerProcess).not.toHaveBeenCalled();
    });

    it.each([
      [5, ['03:55:00 Server will restart in 5 minutes!', '03:56:00 Server will restart in 4 minutes!', '03:57:00 Server will restart in 3 minutes!',
        '03:58:00 Server will restart in 2 minutes!', '03:59:00 Server will restart in 1 minute!']],
      [7, ['03:53:00 Server will restart in 7 minutes!', '03:55:00 Server will restart in 5 minutes!', '03:56:00 Server will restart in 4 minutes!',
        '03:57:00 Server will restart in 3 minutes!', '03:58:00 Server will restart in 2 minutes!', '03:59:00 Server will restart in 1 minute!']],
      [30, ['03:30:00 Server will restart in 30 minutes!', '03:45:00 Server will restart in 15 minutes!', '03:50:00 Server will restart in 10 minutes!',
        '03:55:00 Server will restart in 5 minutes!', '03:56:00 Server will restart in 4 minutes!', '03:57:00 Server will restart in 3 minutes!',
        '03:58:00 Server will restart in 2 minutes!', '03:59:00 Server will restart in 1 minute!']]
    ])('starts a %i-minute warning at its own length, then counts down on the same marks', async (warningMinutes, warnings) => {
      schedule({ restartWarningMinutes: warningMinutes });

      await advanceTo(at(4, 0));

      expect(sent).toEqual([...warnings, '04:00:00 Server restarting now!']);
      expect(stoppedAt).toEqual(at(4, 0));
    });

    // Scheduled at 03:00 for 03:08: the 15- and 10-minute marks have gone by.
    it('counts down on the marks still ahead when set inside the warning period', async () => {
      schedule({ restartTime: '03:08', restartWarningMinutes: 15 });

      await advanceTo(at(3, 8));

      expect(sent).toEqual([
        '03:03:00 Server will restart in 5 minutes!',
        '03:04:00 Server will restart in 4 minutes!',
        '03:05:00 Server will restart in 3 minutes!',
        '03:06:00 Server will restart in 2 minutes!',
        '03:07:00 Server will restart in 1 minute!',
        '03:08:00 Server restarting now!'
      ]);
      expect(stoppedAt).toEqual(at(3, 8));
    });

    it('gives a mark that falls on the moment it is set', async () => {
      schedule({ restartTime: '03:10', restartWarningMinutes: 15 });

      await jest.advanceTimersByTimeAsync(0);

      expect(sent).toEqual(['03:00:00 Server will restart in 10 minutes!']);
    });

    it('restarts on the scheduled minute when the players cannot be warned', async () => {
      rconService.executeRconCommand.mockResolvedValue({ success: false, error: 'RCON not connected for this instance', notSent: true, instanceId: 'a1' });
      schedule();

      await advanceTo(at(3, 59, 59));
      expect(serverLifecycleService.stopServerInstance).not.toHaveBeenCalled();

      await advanceTo(at(4, 0));
      expect(stoppedAt).toEqual(at(4, 0));
    });

    it('restarts on the scheduled minute when a warning is slow to go out', async () => {
      rconService.executeRconCommand.mockImplementation((_id: string, command: string) =>
        command.includes('1 minute') ? new Promise(() => undefined) : Promise.resolve({ success: true, response: '', instanceId: 'a1' }));
      schedule();

      await advanceTo(at(4, 0));

      expect(stoppedAt).toEqual(at(4, 0));
    });

    it('restarts at the time entered when there is no warning time', async () => {
      schedule({ restartWarningMinutes: 0 });

      await advanceTo(at(4, 0));

      expect(sent).toEqual(['04:00:00 Server restarting now!']);
      expect(stoppedAt).toEqual(at(4, 0));
    });

    // The countdown timers were not tracked, so a restart still happened after the schedule was disabled.
    it('cancels a pending restart when the schedule is disabled during the warning', async () => {
      schedule();
      await advanceTo(at(3, 57));

      service.unscheduleRestart('a1');
      await jest.advanceTimersByTimeAsync(10 * MINUTE);

      expect(sent.at(-1)).toBe('03:57:00 Server will restart in 3 minutes!');
      expect(serverLifecycleService.stopServerInstance).not.toHaveBeenCalled();
      expect(serverInstanceService.startServerInstance).not.toHaveBeenCalled();
    });

    it('restarts once, on the new schedule, when rescheduled during the warning', async () => {
      const automation = schedule();
      await advanceTo(at(3, 57));

      automation.settings.restartTime = '06:00';
      service.scheduleRestart('a1');
      await advanceTo(at(4, 30));
      expect(serverLifecycleService.stopServerInstance).not.toHaveBeenCalled();

      await advanceTo(at(6, 0));
      expect(serverLifecycleService.stopServerInstance).toHaveBeenCalledTimes(1);
      expect(stoppedAt).toEqual(at(6, 0));
    });

    it('leaves a server that was stopped by hand during the warning alone', async () => {
      schedule();
      await advanceTo(at(3, 57));

      serverProcessService.getInstanceState.mockReturnValue('stopped');
      await advanceTo(at(4, 5));

      expect(sent.at(-1)).toBe('03:57:00 Server will restart in 3 minutes!');
      expect(serverLifecycleService.stopServerInstance).not.toHaveBeenCalled();
      expect(serverInstanceService.startServerInstance).not.toHaveBeenCalled();
    });

    it('skips a server that is not running, and keeps the schedule', async () => {
      serverProcessService.getInstanceState.mockReturnValue('stopped');
      const automation = schedule();

      await advanceTo(at(4, 0));

      expect(broadcasts()).toEqual([]);
      expect(serverLifecycleService.stopServerInstance).not.toHaveBeenCalled();
      expect(automation.status.nextRestart).toEqual(new Date(2025, 8, 30, 4, 0));
    });

    // 'stopping' was broadcast before the stop; left there, every client showed a server stuck stopping.
    it('does not start a server it could not stop, and tells the clients its real state', async () => {
      serverLifecycleService.stopServerInstance.mockResolvedValue({ success: false, error: 'Server process not found', instanceId: 'a1' });
      serverProcessService.getNormalizedInstanceState.mockReturnValue('crashed');
      schedule({ restartWarningMinutes: 0 });

      await advanceTo(at(4, 0));

      expect(serverInstanceService.startServerInstance).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalled();
      expect(messagingService.sendToAll).toHaveBeenLastCalledWith('server-instance-state', { state: 'crashed', instanceId: 'a1' });
    });

    // The server used to be killed and started again 5 s later, whether it had exited or not.
    it('starts the server again only once the stop has finished', async () => {
      let finishStop: (result: unknown) => void = () => undefined;
      serverLifecycleService.stopServerInstance.mockReturnValue(new Promise(resolve => { finishStop = resolve; }));
      schedule();

      await advanceTo(at(4, 15));
      expect(serverInstanceService.startServerInstance).not.toHaveBeenCalled();

      finishStop({ success: true, instanceId: 'a1' });
      await jest.advanceTimersByTimeAsync(0);
      expect(serverInstanceService.startServerInstance).toHaveBeenCalled();
    });

    it('schedules the next restart once one is done', async () => {
      const automation = schedule();

      await advanceTo(at(4, 0));

      expect(automation.status).toMatchObject({ isScheduled: true, nextRestart: new Date(2025, 8, 30, 4, 0) });
      await jest.advanceTimersByTimeAsync(24 * HOUR);
      expect(serverLifecycleService.stopServerInstance).toHaveBeenCalledTimes(2);
      expect(stoppedAt).toEqual(new Date(2025, 8, 30, 4, 0));
    });

    it('keeps the schedule when a restart throws', async () => {
      serverInstanceService.startServerInstance.mockRejectedValueOnce(new Error('boom'));
      const automation = schedule({ restartWarningMinutes: 0 });

      await advanceTo(at(4, 0));

      expect(console.error).toHaveBeenCalled();
      expect(automation.status).toMatchObject({ isScheduled: true, nextRestart: new Date(2025, 8, 30, 4, 0) });
    });
  });
});
