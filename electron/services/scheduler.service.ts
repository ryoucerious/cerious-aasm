import { rconService } from './rcon.service';
import * as instanceUtils from '../utils/ark/instance.utils';

export interface ScheduledBroadcast {
  id: string;
  message: string;
  intervalMinutes: number;
  enabled: boolean;
  nextRun?: number;
}

export class SchedulerService {
  private intervals: Record<string, NodeJS.Timeout> = {};
  private activeBroadcasts: Record<string, ScheduledBroadcast[]> = {};

  /**
   * Initialize schedule for an instance
   */
  async initSchedule(instanceId: string): Promise<void> {
    const instance = await instanceUtils.getInstance(instanceId);
    if (!instance || !instance.broadcasts) return;

    this.activeBroadcasts[instanceId] = instance.broadcasts;
    this.startScheduler(instanceId);
  }

  /**
   * Start the scheduler loop for a specific instance
   */
  startScheduler(instanceId: string): void {
    if (this.intervals[instanceId]) clearInterval(this.intervals[instanceId]);

    // Check every minute
    this.intervals[instanceId] = setInterval(() => {
      this.checkBroadcasts(instanceId);
    }, 60 * 1000);
  }

  /**
   * Stop scheduler for an instance
   */
  stopScheduler(instanceId: string): void {
    if (this.intervals[instanceId]) {
      clearInterval(this.intervals[instanceId]);
      delete this.intervals[instanceId];
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
      if (!job.enabled) continue;

      if (!job.nextRun || now >= job.nextRun) {
        // Run Broadcast
        await rconService.executeRconCommand(instanceId, `Broadcast ${job.message}`);
        
        // Schedule next run
        job.nextRun = now + (job.intervalMinutes * 60 * 1000);
      }
    }
  }

  /**
   * Update valid broadcasts list
   */
  updateBroadcasts(instanceId: string, broadcasts: ScheduledBroadcast[]): void {
    this.activeBroadcasts[instanceId] = broadcasts;
    // Reset nextRun for new jobs or keep existing logic
    // For simplicity, we just update the ref.
  }
}

export const schedulerService = new SchedulerService();
