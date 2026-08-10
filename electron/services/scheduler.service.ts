import { rconService } from './rcon.service';
import * as instanceUtils from '../utils/ark/instance.utils';

export interface ScheduledBroadcast {
  id: string;
  message: string;
  /** Minutes between broadcasts (UI / broadcastConfig field) */
  interval?: number;
  /** Legacy field name used by older configs */
  intervalMinutes?: number;
  enabled: boolean;
  nextRun?: number;
}

export interface BroadcastConfig {
  enabled?: boolean;
  messages?: ScheduledBroadcast[];
}

function getIntervalMinutes(job: ScheduledBroadcast): number {
  const raw = job.intervalMinutes ?? job.interval ?? 60;
  const minutes = Number(raw);
  return Number.isFinite(minutes) && minutes >= 1 ? minutes : 60;
}

export class SchedulerService {
  private intervals: Record<string, NodeJS.Timeout> = {};
  private initialTimeouts: Record<string, NodeJS.Timeout> = {};
  private activeBroadcasts: Record<string, ScheduledBroadcast[]> = {};

  /**
   * Initialize schedule for an instance from its saved broadcastConfig
   * (falls back to legacy instance.broadcasts if present).
   */
  async initSchedule(instanceId: string): Promise<void> {
    const instance = await instanceUtils.getInstance(instanceId);
    if (!instance) {
      this.stopScheduler(instanceId);
      delete this.activeBroadcasts[instanceId];
      return;
    }

    const config: BroadcastConfig | undefined = instance.broadcastConfig;
    let messages: ScheduledBroadcast[] | undefined;

    if (config?.enabled && Array.isArray(config.messages) && config.messages.length > 0) {
      messages = config.messages;
    } else if (Array.isArray(instance.broadcasts) && instance.broadcasts.length > 0) {
      // Legacy shape from configure-broadcasts
      messages = instance.broadcasts;
    }

    if (!messages || messages.length === 0) {
      this.stopScheduler(instanceId);
      delete this.activeBroadcasts[instanceId];
      return;
    }

    this.updateBroadcasts(instanceId, messages);
    this.startScheduler(instanceId);
  }

  /**
   * Load schedules for every saved instance (call on app startup).
   */
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

  /**
   * Start the scheduler loop for a specific instance
   */
  startScheduler(instanceId: string): void {
    this.stopScheduler(instanceId);

    // Check every minute
    this.intervals[instanceId] = setInterval(() => {
      this.checkBroadcasts(instanceId);
    }, 60 * 1000);

    // Run once soon after start so the first announcement is not delayed a full minute
    this.initialTimeouts[instanceId] = setTimeout(() => {
      delete this.initialTimeouts[instanceId];
      this.checkBroadcasts(instanceId);
    }, 5 * 1000);
  }

  /**
   * Stop scheduler for an instance
   */
  stopScheduler(instanceId: string): void {
    if (this.intervals[instanceId]) {
      clearInterval(this.intervals[instanceId]);
      delete this.intervals[instanceId];
    }
    if (this.initialTimeouts[instanceId]) {
      clearTimeout(this.initialTimeouts[instanceId]);
      delete this.initialTimeouts[instanceId];
    }
  }

  /**
   * Check and run pending broadcasts
   */
  private async checkBroadcasts(instanceId: string): Promise<void> {
    const broadcasts = this.activeBroadcasts[instanceId];
    if (!broadcasts) return;

    const now = Date.now();

    for (const job of broadcasts) {
      if (!job.enabled || !job.message?.trim()) continue;

      if (!job.nextRun || now >= job.nextRun) {
        const result = await rconService.executeRconCommand(instanceId, `Broadcast ${job.message}`);
        if (!result.success) {
          // Keep nextRun unset / due so we retry next tick once RCON is up
          console.warn(
            `[scheduler-service] Broadcast skipped for ${instanceId}: ${result.error || 'unknown error'}`
          );
          continue;
        }

        job.nextRun = now + getIntervalMinutes(job) * 60 * 1000;
      }
    }
  }

  /**
   * Update valid broadcasts list, preserving nextRun for existing message IDs
   */
  updateBroadcasts(instanceId: string, broadcasts: ScheduledBroadcast[]): void {
    const existing = this.activeBroadcasts[instanceId] || [];
    const existingById = new Map(existing.map((b) => [b.id, b]));

    this.activeBroadcasts[instanceId] = (broadcasts || []).map((b) => ({
      ...b,
      nextRun: existingById.get(b.id)?.nextRun
    }));
  }
}

export const schedulerService = new SchedulerService();
