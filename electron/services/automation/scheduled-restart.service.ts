import { AutomationSettings, ServerAutomation } from '../../types/automation.types';
import { ScheduleSettings, computeNextRun } from '../../utils/schedule.utils';
import { messagingService } from '../messaging.service';
import { rconService } from '../rcon.service';
import { getStandardEventCallbacks } from '../server-instance/instance-events';
import { serverInstanceService } from '../server-instance/server-instance.service';
import { serverLifecycleService } from '../server-instance/server-lifecycle.service';
import { serverProcessService } from '../server-instance/server-process.service';

const MINUTE_MS = 60 * 1000;

/** The warning countdown of a restart in progress; finishing it early lets the restart see it was cancelled. */
interface Countdown {
  timer: NodeJS.Timeout;
  finish: () => void;
}

/** Restarts servers on their schedule: warns the players over RCON, stops gracefully, starts again. */
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

    const nextRestart = computeNextRun(restartSchedule(automation.settings), after);
    if (!nextRestart) {
      console.warn(`[scheduled-restart] Not scheduling restarts for ${serverId}: a "${automation.settings.restartFrequency}" schedule with these settings never runs`);
      return;
    }

    automation.status.isScheduled = true;
    automation.status.nextRestart = nextRestart;
    automation.scheduledRestartTimer = setTimeout(() => {
      void this.runScheduledRestart(serverId, generation, nextRestart);
    }, nextRestart.getTime() - Date.now());
  }

  private async runScheduledRestart(serverId: string, generation: number, due: Date): Promise<void> {
    try {
      await this.restart(serverId, generation);
    } catch (error) {
      console.error(`[scheduled-restart] Scheduled restart of ${serverId} failed:`, error);
    }
    if (this.generations.get(serverId) === generation) {
      this.arm(serverId, generation, new Date(Math.max(Date.now(), due.getTime())));
    }
  }

  private async restart(serverId: string, generation: number): Promise<void> {
    const automation = this.automations.get(serverId);
    if (!automation || serverProcessService.getInstanceState(serverId) !== 'running') {
      console.log(`[scheduled-restart] ${serverId} is not running; skipping its scheduled restart`);
      return;
    }

    const warningMinutes = automation.settings.restartWarningMinutes;
    if (warningMinutes > 0 && await this.broadcast(serverId, `Server will restart in ${warningMinutes} minutes!`)) {
      await this.waitForCountdown(serverId, warningMinutes * MINUTE_MS);
    }
    if (this.generations.get(serverId) !== generation) return;
    if (serverProcessService.getInstanceState(serverId) !== 'running') return;

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
    const result = await rconService.executeRconCommand(serverId, `broadcast ${message}`);
    return result.success;
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