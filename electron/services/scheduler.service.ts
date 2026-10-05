import { rconService } from './rcon.service';
import * as instanceUtils from '../utils/ark/instance.utils';
import { BroadcastConfig, ScheduledBroadcast } from '../types/server-instance.types';

const CHECK_INTERVAL_MS = 60 * 1000;
// The first announcement should not wait a full check interval.
const FIRST_CHECK_DELAY_MS = 5 * 1000;

function getIntervalMinutes(job: ScheduledBroadcast): number {
  const minutes = Number(job.intervalMinutes ?? job.interval ?? 60);
  return Number.isFinite(minutes) && minutes >= 1 ? minutes : 60;
}

/** Scheduled RCON announcements: each message repeats every `interval` minutes while RCON is up. */
export class SchedulerService {
  private intervals: Record<string, NodeJS.Timeout> = {};
  private initialTimeouts: Record<string, NodeJS.Timeout> = {};
  private activeBroadcasts: Record<string, ScheduledBroadcast[]> = {};

  /** (Re)starts an instance's announcements from its saved broadcastConfig, or stops them when it has none. */
  async initSchedule(instanceId: string): Promise<void> {
    const instance = instanceUtils.getInstance(instanceId);
    const config: BroadcastConfig | undefined = instance?.broadcastConfig;

    let messages: ScheduledBroadcast[] | undefined;
    if (config?.enabled && Array.isArray(config.messages) && config.messages.length > 0) {
      messages = config.messages;
    } else if (Array.isArray(instance?.broadcasts) && instance.broadcasts.length > 0) {
      // The flat list older clients saved.
      messages = instance.broadcasts;
    }

    if (!messages?.length) {
      this.stopScheduler(instanceId);
      delete this.activeBroadcasts[instanceId];
      return;
    }

    this.updateBroadcasts(instanceId, messages);
    this.startScheduler(instanceId);
  }

  /** For app startup. */
  async initAllSchedules(): Promise<void> {
    try {
      const instances = await instanceUtils.getAllInstances();
      for (const instance of instances || []) {
        if (instance?.id) {
          await this.initSchedule(instance.id);
        }
      }
    } catch (error) {
      console.error('[scheduler-service] Failed to initialize broadcast schedules:', error);
    }
  }

  startScheduler(instanceId: string): void {
    this.stopScheduler(instanceId);

    this.intervals[instanceId] = setInterval(() => {
      void this.checkBroadcasts(instanceId);
    }, CHECK_INTERVAL_MS);
    this.initialTimeouts[instanceId] = setTimeout(() => {
      delete this.initialTimeouts[instanceId];
      void this.checkBroadcasts(instanceId);
    }, FIRST_CHECK_DELAY_MS);
  }

  stopScheduler(instanceId: string): void {
    clearInterval(this.intervals[instanceId]);
    delete this.intervals[instanceId];
    clearTimeout(this.initialTimeouts[instanceId]);
    delete this.initialTimeouts[instanceId];
  }

  private async checkBroadcasts(instanceId: string): Promise<void> {
    const broadcasts = this.activeBroadcasts[instanceId];
    if (!broadcasts) return;

    try {
      const now = Date.now();
      for (const job of broadcasts) {
        if (!job.enabled || typeof job.message !== 'string' || !job.message.trim()) continue;
        if (job.nextRun && now < job.nextRun) continue;

        const result = await rconService.executeRconCommand(instanceId, `Broadcast ${job.message}`);
        if (!result.success) {
          // Left due, so it goes out on the next check once RCON is up.
          console.warn(`[scheduler-service] Broadcast skipped for ${instanceId}: ${result.error || 'unknown error'}`);
          continue;
        }
        job.nextRun = now + getIntervalMinutes(job) * 60 * 1000;
      }
    } catch (error) {
      console.error(`[scheduler-service] Broadcast check failed for ${instanceId}:`, error);
    }
  }

  /** Replaces the instance's messages, keeping when each existing message is next due. */
  updateBroadcasts(instanceId: string, broadcasts: ScheduledBroadcast[]): void {
    const existingById = new Map((this.activeBroadcasts[instanceId] || []).map(job => [job.id, job]));
    this.activeBroadcasts[instanceId] = (broadcasts || []).map(job => ({
      ...job,
      nextRun: existingById.get(job.id)?.nextRun
    }));
  }
}

export const schedulerService = new SchedulerService();
