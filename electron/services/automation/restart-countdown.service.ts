import { messagingService } from '../messaging.service';
import { rconService } from '../rcon.service';
import { serverProcessService } from '../server-instance/server-process.service';
import { warningMarks } from '../../utils/warning-marks.utils';

const MINUTE_MS = 60 * 1000;

/** A server here that will restart when its countdown ends; `all` when it is part of a restart of every server. */
export interface PendingRestart {
  instanceId: string;
  dueAt: number;
  all: boolean;
}

export interface CountdownDeps {
  /** Tells the players on a server, over RCON. */
  broadcast(serverId: string, message: string): Promise<boolean>;
  isRunning(serverId: string): boolean;
  /** Tells the app's pages; dueAt null once it will no longer restart. */
  publish(change: { instanceId: string; dueAt: number | null; all: boolean }): void;
  now(): number;
}

interface Countdown {
  ids: Set<string>;
  dueAt: number;
  all: boolean;
  timer: NodeJS.Timeout | null;
  restart: (ids: string[]) => Promise<void>;
}

const defaultDeps: CountdownDeps = {
  broadcast: async (serverId, message) => {
    try {
      return (await rconService.executeRconCommand(serverId, `broadcast ${message}`)).success;
    } catch {
      return false;
    }
  },
  isRunning: serverId => serverProcessService.getInstanceState(serverId) === 'running',
  publish: change => messagingService.sendToAll('server-restart-pending', change),
  now: Date.now
};

function warningText(minutes: number): string {
  return `Server will restart in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}!`;
}

/**
 * Restarts asked for from the app, rather than on a schedule: the players hear the same countdown
 * a scheduled restart gives them (15, 10, 5, 4, 3, 2, 1 minutes), then the servers restart. A
 * countdown can be cancelled, for one server or for a restart of all of them.
 */
export class RestartCountdownService {
  private readonly countdowns = new Set<Countdown>();

  constructor(private deps: CountdownDeps = defaultDeps) {}

  /**
   * Counts down `minutes` on `serverIds`, warning their players at each mark, then runs `restart`
   * with those still running. A server already counting down moves onto this countdown.
   */
  begin(serverIds: string[], minutes: number, all: boolean, restart: (ids: string[]) => Promise<void>): number {
    for (const id of serverIds) this.leave(id);
    const marks = warningMarks(minutes);
    const start = this.deps.now();
    const countdown: Countdown = { ids: new Set(serverIds), dueAt: start + marks[0] * MINUTE_MS, all, timer: null, restart };
    this.countdowns.add(countdown);
    for (const id of serverIds) this.deps.publish({ instanceId: id, dueAt: countdown.dueAt, all });
    this.reach(countdown, marks, 0);
    return countdown.dueAt;
  }

  /** Cancels a server's restart, telling its players. False when it had none. */
  cancel(serverId: string): boolean {
    const countdown = this.leave(serverId);
    if (!countdown) return false;
    this.tell(serverId, 'The restart was cancelled.');
    return true;
  }

  /** Cancels every restart of all servers; a server's own restart stays. The servers it covered. */
  cancelAll(): string[] {
    const cancelled: string[] = [];
    for (const countdown of [...this.countdowns]) {
      if (!countdown.all) continue;
      for (const id of [...countdown.ids]) {
        if (this.cancel(id)) cancelled.push(id);
      }
    }
    return cancelled;
  }

  pending(): PendingRestart[] {
    return [...this.countdowns].flatMap(countdown =>
      [...countdown.ids].map(instanceId => ({ instanceId, dueAt: countdown.dueAt, all: countdown.all })));
  }

  /** Mark `index` is due: warn, then wait for the next one. The last mark, 0, is the restart. */
  private reach(countdown: Countdown, marks: number[], index: number): void {
    if (!this.countdowns.has(countdown)) return;
    const minutes = marks[index];
    if (minutes === 0) {
      void this.finish(countdown);
      return;
    }
    for (const id of countdown.ids) this.tell(id, warningText(minutes));
    const nextAt = countdown.dueAt - marks[index + 1] * MINUTE_MS;
    countdown.timer = setTimeout(() => this.reach(countdown, marks, index + 1), Math.max(0, nextAt - this.deps.now()));
  }

  private async finish(countdown: Countdown): Promise<void> {
    this.countdowns.delete(countdown);
    const ids = [...countdown.ids].filter(id => this.deps.isRunning(id));
    for (const id of countdown.ids) this.deps.publish({ instanceId: id, dueAt: null, all: countdown.all });
    for (const id of ids) this.tell(id, 'Server restarting now!');
    if (!ids.length) return;
    try {
      await countdown.restart(ids);
    } catch (error) {
      console.error(`[restart] Could not restart ${ids.join(', ')}:`, error);
    }
  }

  /** Takes a server out of its countdown, which ends with no servers left. The countdown it left. */
  private leave(serverId: string): Countdown | null {
    for (const countdown of this.countdowns) {
      if (!countdown.ids.delete(serverId)) continue;
      this.deps.publish({ instanceId: serverId, dueAt: null, all: countdown.all });
      if (!countdown.ids.size) {
        if (countdown.timer) clearTimeout(countdown.timer);
        this.countdowns.delete(countdown);
      }
      return countdown;
    }
    return null;
  }

  /** Not waited for: a warning that fails, or is slow to go out, does not move the restart. */
  private tell(serverId: string, message: string): void {
    if (!this.deps.isRunning(serverId)) return;
    void this.deps.broadcast(serverId, message).then(sent => {
      if (!sent) console.warn(`[restart] Could not tell the players on ${serverId}: ${message}`);
    });
  }
}

export const restartCountdowns = new RestartCountdownService();
