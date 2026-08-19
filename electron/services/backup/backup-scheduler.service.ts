import { BackupSettings } from '../../types/backup.types';
import { BackupSchedulerResult, BackupSchedulerStatusResult } from '../../types/backup.types';

export class BackupSchedulerService {
  private activeSchedules: Record<string, NodeJS.Timeout> = {};

  /**
   * Start backup scheduler for an instance
   */
  async startBackupSchedulerInternal(instanceId: string, settings: BackupSettings, createBackupCallback?: (instanceId: string, type: 'scheduled') => Promise<any>): Promise<void> {
    // Stop existing scheduler if running
    this.stopBackupSchedulerInternal(instanceId);

    const schedulerFunction = async () => {
      try {
        if (createBackupCallback) {
          const result = await createBackupCallback(instanceId, 'scheduled');
          if (result.success) {
            // Emit event to update UI
            const { messagingService } = require('../../services/messaging.service');
            messagingService.sendToAll('backup-created', {
              instanceId,
              backupId: result.backupId,
              type: 'scheduled',
              message: result.message,
              success: true
            });
          } else {
            console.error(`[backup-scheduler] Scheduled backup failed for instance: ${instanceId}`, result.error);
            this.reportFailure(instanceId, result.error);
          }
        }
      } catch (error) {
        console.error(`[backup-scheduler] Error during scheduled backup for instance: ${instanceId}`, error);
        this.reportFailure(instanceId, (error as Error)?.message);
      }
    };

    // Calculate next run time based on frequency.
    // Parse defensively: a missing or malformed `time` used to throw here, which
    // aborted schedule restore on startup. Fall back to the UI's own default instead
    // of leaving the instance — and everything after it — unscheduled.
    let nextRunMs: number;
    const { hours, minutes } = this.parseScheduleTime(settings.time, instanceId);
    const now = new Date();
    const scheduledTime = new Date();
    scheduledTime.setHours(hours, minutes, 0, 0);

    if (settings.frequency === 'daily') {
      if (scheduledTime <= now) {
        scheduledTime.setDate(scheduledTime.getDate() + 1);
      }
      nextRunMs = scheduledTime.getTime() - now.getTime();
    } else if (settings.frequency === 'weekly') {
      const targetDay = settings.dayOfWeek || 0; // Default to Sunday
      const currentDay = scheduledTime.getDay();
      let daysUntilTarget = targetDay - currentDay;

      if (daysUntilTarget < 0 || (daysUntilTarget === 0 && scheduledTime <= now)) {
        daysUntilTarget += 7;
      }

      scheduledTime.setDate(scheduledTime.getDate() + daysUntilTarget);
      nextRunMs = scheduledTime.getTime() - now.getTime();
    } else { // hourly
      nextRunMs = 60 * 60 * 1000; // 1 hour
    }

    // Schedule first backup, then set up recurring
    this.activeSchedules[instanceId] = setTimeout(async () => {
      await schedulerFunction();

      // Set up recurring schedule
      let intervalMs: number;
      if (settings.frequency === 'daily') {
        intervalMs = 24 * 60 * 60 * 1000;
      } else if (settings.frequency === 'weekly') {
        intervalMs = 7 * 24 * 60 * 60 * 1000;
      } else {
        intervalMs = 60 * 60 * 1000;
      }

      this.activeSchedules[instanceId] = setInterval(schedulerFunction, intervalMs);
    }, nextRunMs);
  }

  /**
   * Parse an "HH:MM" schedule time, falling back to 02:00 when it is absent or invalid.
   */
  private parseScheduleTime(time: unknown, instanceId: string): { hours: number; minutes: number } {
    const DEFAULT = { hours: 2, minutes: 0 };
    if (typeof time !== 'string') {
      console.warn(`[backup-scheduler] Missing backup time for ${instanceId} — defaulting to 02:00`);
      return DEFAULT;
    }

    const [rawHours, rawMinutes] = time.split(':');
    const hours = Number(rawHours);
    const minutes = Number(rawMinutes);

    if (!Number.isInteger(hours) || !Number.isInteger(minutes) ||
        hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      console.warn(`[backup-scheduler] Invalid backup time "${time}" for ${instanceId} — defaulting to 02:00`);
      return DEFAULT;
    }

    return { hours, minutes };
  }

  /**
   * Surface a failed scheduled backup to the UI.
   *
   * A scheduled backup that fails used to be logged to the console only, so from the
   * user's side an enabled schedule and a schedule that silently failed every run were
   * indistinguishable — reported as "automatic backups are not running". Failures now
   * raise a toast and a line in the instance's log view.
   */
  private reportFailure(instanceId: string, error?: string): void {
    try {
      const { messagingService } = require('../../services/messaging.service');
      let instanceName = instanceId;
      try {
        const instance = require('../../utils/ark/instance.utils').getInstance(instanceId);
        if (instance?.name) instanceName = instance.name;
      } catch {
        // Fall back to the id — never let name lookup swallow the notification
      }
      const detail = error || 'Unknown error';
      messagingService.sendToAll('notification', {
        type: 'error',
        message: `Scheduled backup failed for "${instanceName}": ${detail}`
      });
      messagingService.sendToAll('server-instance-log', {
        log: `[BACKUP] Scheduled backup failed: ${detail}`,
        instanceId
      });
    } catch (e) {
      console.error(`[backup-scheduler] Failed to report backup failure for ${instanceId}:`, e);
    }
  }

  /**
   * Stop backup scheduler for an instance
   */
  stopBackupSchedulerInternal(instanceId: string): void {
    if (this.activeSchedules[instanceId]) {
      clearTimeout(this.activeSchedules[instanceId]);
      clearInterval(this.activeSchedules[instanceId]);
      delete this.activeSchedules[instanceId];
    }
  }

  /**
   * Get backup scheduler status for an instance
   */
  async getSchedulerStatus(instanceId: string, settings: BackupSettings | null): Promise<BackupSchedulerStatusResult> {
    try {
      const isRunning = !!this.activeSchedules[instanceId];
      let nextBackup: Date | undefined;

      if (isRunning && settings) {
        const [hours, minutes] = settings.time.split(':').map(Number);
        const now = new Date();
        nextBackup = new Date();
        nextBackup.setHours(hours, minutes, 0, 0);

        // If time has passed today, schedule for next occurrence
        if (nextBackup <= now) {
          if (settings.frequency === 'daily') {
            nextBackup.setDate(nextBackup.getDate() + 1);
          } else if (settings.frequency === 'weekly') {
            nextBackup.setDate(nextBackup.getDate() + 7);
          }
        }
      }

      return {
        success: true,
        isRunning,
        nextBackup
      };
    } catch (error) {
      console.error('[backup-scheduler] Failed to get scheduler status:', error);
      return {
        success: false,
        error: (error as Error)?.message || 'Failed to get scheduler status'
      };
    }
  }

  /**
   * Cleanup all schedulers (called on app shutdown)
   */
  cleanup(): void {
    for (const instanceId in this.activeSchedules) {
      this.stopBackupSchedulerInternal(instanceId);
    }
  }

  /**
   * Check if scheduler is running for instance
   */
  isSchedulerRunning(instanceId: string): boolean {
    return !!this.activeSchedules[instanceId];
  }
}

export const backupSchedulerService = new BackupSchedulerService();