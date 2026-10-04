import { BackupResult, BackupSchedulerStatusResult, BackupSettings } from '../../types/backup.types';
import * as instanceUtils from '../../utils/ark/instance.utils';
import { ScheduleSettings, computeNextRun, parseTimeOfDay } from '../../utils/schedule.utils';
import { messagingService } from '../messaging.service';

type CreateBackup = (instanceId: string, type: 'scheduled') => Promise<BackupResult>;

interface ArmedSchedule {
  /** Which start armed it: a run that finds another generation here was stopped or replaced. */
  generation: number;
  timer: NodeJS.Timeout;
  nextRun: Date;
}

// The UI's own default time.
const DEFAULT_TIME = '02:00';

export class BackupSchedulerService {
  private readonly schedules = new Map<string, ArmedSchedule>();
  private lastGeneration = 0;

  /** Replaces any schedule the instance has. The next run is armed only once a run has finished. */
  startBackupSchedulerInternal(instanceId: string, settings: BackupSettings, createBackup: CreateBackup): void {
    this.stopBackupSchedulerInternal(instanceId);
    this.arm(instanceId, toSchedule(instanceId, settings), createBackup, ++this.lastGeneration, new Date());
  }

  stopBackupSchedulerInternal(instanceId: string): void {
    const schedule = this.schedules.get(instanceId);
    if (schedule) {
      clearTimeout(schedule.timer);
      this.schedules.delete(instanceId);
    }
  }

  async getSchedulerStatus(instanceId: string): Promise<BackupSchedulerStatusResult> {
    const schedule = this.schedules.get(instanceId);
    return { success: true, isRunning: !!schedule, nextBackup: schedule?.nextRun };
  }

  private arm(instanceId: string, schedule: ScheduleSettings, createBackup: CreateBackup, generation: number, after: Date): void {
    let nextRun = computeNextRun(schedule, after);
    // Slots a slow backup ran past are skipped, not run back to back.
    while (nextRun && nextRun.getTime() <= Date.now()) {
      nextRun = computeNextRun(schedule, nextRun);
    }
    if (!nextRun) {
      console.warn(`[backup-scheduler] Not scheduling backups for ${instanceId}: a "${String(schedule.frequency)}" schedule with these settings never runs`);
      return;
    }

    const timer = setTimeout(() => {
      void this.run(instanceId, schedule, createBackup, generation, nextRun);
    }, nextRun.getTime() - Date.now());
    this.schedules.set(instanceId, { generation, timer, nextRun });
  }

  private async run(instanceId: string, schedule: ScheduleSettings, createBackup: CreateBackup, generation: number, due: Date): Promise<void> {
    await this.createScheduledBackup(instanceId, createBackup);
    if (this.schedules.get(instanceId)?.generation !== generation) {
      return;
    }
    // From the slot it ran for, so an hourly schedule stays on its slots however long a backup takes.
    this.arm(instanceId, schedule, createBackup, generation, due);
  }

  private async createScheduledBackup(instanceId: string, createBackup: CreateBackup): Promise<void> {
    try {
      const result = await createBackup(instanceId, 'scheduled');
      if (result.success) {
        messagingService.sendToAll('backup-created', {
          instanceId,
          backupId: result.backupId,
          type: 'scheduled',
          message: result.message,
          success: true
        });
      } else {
        console.error(`[backup-scheduler] Scheduled backup failed for ${instanceId}: ${result.error}`);
        this.reportFailure(instanceId, result.error);
      }
    } catch (error) {
      console.error(`[backup-scheduler] Scheduled backup failed for ${instanceId}:`, error);
      this.reportFailure(instanceId, error instanceof Error ? error.message : undefined);
    }
  }

  // A toast and a line in the instance's log view: on the console alone, a schedule that failed
  // every run would look like one that never ran.
  private reportFailure(instanceId: string, error?: string): void {
    let instanceName = instanceId;
    try {
      instanceName = instanceUtils.getInstance(instanceId)?.name || instanceId;
    } catch {
      // The id is enough: a failed name lookup must not swallow the notification.
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
  }
}

// A missing or malformed time falls back to the UI's default: throwing would abort schedule
// restore at startup for every instance after this one.
function toSchedule(instanceId: string, settings: BackupSettings): ScheduleSettings {
  let time: unknown = settings.time;
  if (settings.frequency !== 'hourly' && !parseTimeOfDay(time)) {
    console.warn(`[backup-scheduler] Invalid backup time ${JSON.stringify(time)} for ${instanceId}; using ${DEFAULT_TIME}`);
    time = DEFAULT_TIME;
  }
  return { frequency: settings.frequency, time, days: [settings.dayOfWeek ?? 0] };
}