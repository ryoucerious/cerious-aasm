import { AutomationSettings, ServerAutomation } from '../../types/automation.types';
import { ScheduleSettings, computeNextRun } from '../../utils/schedule.utils';
import { messagingService } from '../messaging.service';
import { rconService } from '../rcon.service';
import { getStandardEventCallbacks } from '../server-instance/instance-events';
import { serverInstanceService } from '../server-instance/server-instance.service';
import { serverLifecycleService } from '../server-instance/server-lifecycle.service';
import { serverProcessService } from '../server-instance/server-process.service';
import { warningMarks } from '../../utils/warning-marks.utils';

const MINUTE_MS = 60 * 1000;
/**
 * A mark reached later than this (a host busy, or waking from sleep, as the timer was due) is passed
 * over: announcing it then would give the players the wrong time.
 */
const LATE_MARK_MS = 30 * 1000;

/** The warning countdown of a restart in progress; finishing it early lets the restart see it was cancelled. */
interface Countdown {
  timer: NodeJS.Timeout;
  finish: () => void;
}

function warningText(minutes: number): string {
  return `Server will restart in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}!`;
}

/**
 * Restarts servers on their schedule, at the time entered: warns the players over RCON, counting down
 * to that time, then stops gracefully and starts again.
 */
export class ScheduledRestartService {
  private automations: Map<string, ServerAutomation>;
  // Every (un)schedule starts a new generation. A restart in progress checks it after the warning,
  // so disabling or changing the schedule cancels a restart that has not begun stopping.
  private readonly generations = new Map<string, number>();
  private readonly countdowns = new Map<string, Countdown>();

  constructor(automations: Map<string, ServerAutomation>) {
    this.automations = automations;
  }

  scheduleRestart(serverId: string): void {
    if (!this.automations.has(serverId)) return;
    this.unscheduleRestart(serverId);
    this.arm(serverId, this.generations.get(serverId) ?? 0, new Date());
  }

  unscheduleRestart(serverId: string): void {
    const automation = this.automations.get(serverId);
    if (!automation) return;

    this.generations.set(serverId, (this.generations.get(serverId) ?? 0) + 1);
    clearTimeout(automation.scheduledRestartTimer);
    automation.scheduledRestartTimer = undefined;
    this.countdowns.get(serverId)?.finish();
    automation.status.isScheduled = false;
    delete automation.status.nextRestart;
  }

  private arm(serverId: string, generation: number, after: Date): void {
    const automation = this.automations.get(serverId);
    if (!automation) return;

    const nextRestart = nextRestartAt(automation.settings, after);
    if (!nextRestart) {
      console.warn(`[scheduled-restart] Not scheduling restarts for ${serverId}: a "${automation.settings.restartFrequency}" schedule with these settings never runs`);
      return;
    }

    automation.status.isScheduled = true;
    automation.status.nextRestart = nextRestart;
    // The countdown starts the warning period before the restart, or now when that has begun.
    const marks = warningMarks(automation.settings.restartWarningMinutes);
    const countdownStart = nextRestart.getTime() - marks[0] * MINUTE_MS;
    automation.scheduledRestartTimer = setTimeout(() => {
      void this.runScheduledRestart(serverId, generation, nextRestart, marks);
    }, Math.max(0, countdownStart - Date.now()));
  }

  private async runScheduledRestart(serverId: string, generation: number, due: Date, marks: number[]): Promise<void> {
    try {
      if (await this.countDown(serverId, generation, due.getTime(), marks)) await this.restart(serverId);
    } catch (error) {
      console.error(`[scheduled-restart] Scheduled restart of ${serverId} failed:`, error);
    }
    if (this.generations.get(serverId) === generation) {
      this.arm(serverId, generation, new Date(Math.max(Date.now(), due.getTime())));
    }
  }

  /**
   * Warns the players of a running server at each mark still ahead, and waits until the restart is
   * due. False when the schedule was changed or turned off meanwhile.
   */
  private async countDown(serverId: string, generation: number, due: number, marks: number[]): Promise<boolean> {
    for (const minutes of marks) {
      const markAt = due - minutes * MINUTE_MS;
      if (markAt > Date.now()) await this.waitForCountdown(serverId, markAt - Date.now());
      if (this.generations.get(serverId) !== generation) return false;
      if (minutes === 0) return true;
      if (Date.now() - markAt > LATE_MARK_MS) continue;
      if (serverProcessService.getInstanceState(serverId) !== 'running') continue;
      // Not waited for: a warning that fails, or is slow to go out, does not move the restart.
      void this.broadcast(serverId, warningText(minutes)).then(sent => {
        if (!sent) console.warn(`[scheduled-restart] Could not warn the players on ${serverId} of its restart in ${minutes} min`);
      });
    }
    return true;
  }

  private async restart(serverId: string): Promise<void> {
    if (!this.automations.has(serverId) || serverProcessService.getInstanceState(serverId) !== 'running') {
      console.log(`[scheduled-restart] ${serverId} is not running; skipping its scheduled restart`);
      return;
    }

    await this.broadcast(serverId, 'Server restarting now!');
    // Through the graceful stop, which marks the server stopping first: its exit is then a stop,
    // not a crash (no crash notice, no crash-detection restart).
    messagingService.sendToAll('server-instance-state', { state: 'stopping', instanceId: serverId });
    const stopped = await serverLifecycleService.stopServerInstance(serverId);
    if (!stopped.success) {
      console.error(`[scheduled-restart] Could not stop ${serverId} for its scheduled restart: ${stopped.error}`);
      // Clients were told 'stopping' above.
      messagingService.sendToAll('server-instance-state', {
        state: serverProcessService.getNormalizedInstanceState(serverId),
        instanceId: serverId
      });
      return;
    }

    const { onLog, onState } = getStandardEventCallbacks(serverId);
    const started = await serverInstanceService.startServerInstance(serverId, onLog, onState);
    if (!started.started) {
      console.error(`[scheduled-restart] Could not start ${serverId} after its scheduled restart: ${started.portError}`);
    }
  }

  private async broadcast(serverId: string, message: string): Promise<boolean> {
    try {
      const result = await rconService.executeRconCommand(serverId, `broadcast ${message}`);
      return result.success;
    } catch (error) {
      console.warn(`[scheduled-restart] Broadcast to ${serverId} failed:`, error);
      return false;
    }
  }

  private waitForCountdown(serverId: string, ms: number): Promise<void> {
    return new Promise(resolve => {
      const finish = () => {
        clearTimeout(timer);
        this.countdowns.delete(serverId);
        resolve();
      };
      const timer = setTimeout(finish, ms);
      this.countdowns.set(serverId, { timer, finish });
    });
  }
}

/** The restart times; older versions saved only one, as restartTime. */
export function restartTimesOf(settings: Pick<AutomationSettings, 'restartTime' | 'restartTimes'>): string[] {
  const times = (settings.restartTimes || []).filter(time => typeof time === 'string' && time);
  return times.length ? times : [settings.restartTime];
}

/** The soonest of the restart times after `after`, or null when the schedule never runs. */
function nextRestartAt(settings: AutomationSettings, after: Date): Date | null {
  const schedule = restartSchedule(settings);
  const next = restartTimesOf(settings)
    .map(time => computeNextRun({ ...schedule, time }, after))
    .filter((date): date is Date => date !== null);
  return next.length ? new Date(Math.min(...next.map(date => date.getTime()))) : null;
}

// Only daily and weekly are offered; the UI shows 'custom' as the chosen days at the chosen time.
function restartSchedule(settings: AutomationSettings): ScheduleSettings {
  const { restartFrequency, restartTime, restartDays } = settings;
  const frequency = restartFrequency === 'custom' ? 'weekly' : restartFrequency;
  return {
    frequency: frequency === 'daily' || frequency === 'weekly' ? frequency : undefined,
    time: restartTime,
    days: restartDays
  };
}