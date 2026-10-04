import * as path from 'path';
import {
  BackupDownloadResult,
  BackupListResult,
  BackupMetadata,
  BackupRestoreResult,
  BackupResult,
  BackupSchedulerResult,
  BackupSchedulerStatusResult,
  BackupSettings,
  BackupSettingsResult
} from '../../types/backup.types';
import type { InstanceConfig } from '../../types/server-instance.types';
import * as instanceUtils from '../../utils/ark/instance.utils';
import { getNormalizedInstanceState, setInstanceState } from '../../utils/ark/ark-server/ark-server-state.utils';
import { messagingService } from '../messaging.service';
import { serverLifecycleService } from '../server-instance/server-lifecycle.service';
import { serverProcessService } from '../server-instance/server-process.service';
import { BackupCleanupService } from './backup-cleanup.service';
import { BackupImportService } from './backup-import.service';
import { BackupOperationsService } from './backup-operations.service';
import { BackupSchedulerService } from './backup-scheduler.service';
import { BackupSettingsService } from './backup-settings.service';

// What the UI lets the user choose.
const MIN_BACKUPS_TO_KEEP = 1;
const MAX_BACKUPS_TO_KEEP = 50;
const DEFAULT_BACKUPS_TO_KEEP = 5;

// States with no server process: a crash or failed start untracks the process before it is set.
const RESTORABLE_STATES = new Set(['stopped', 'crashed', 'error']);

function errorResult(error: unknown, fallback: string): { success: false; error: string } {
  return { success: false, error: (error instanceof Error && error.message) || fallback };
}

function clampBackupsToKeep(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_BACKUPS_TO_KEEP;
  }
  return Math.min(MAX_BACKUPS_TO_KEEP, Math.max(MIN_BACKUPS_TO_KEEP, Math.round(value)));
}

export class BackupService {
  private operationsService = new BackupOperationsService();
  private cleanupService = new BackupCleanupService();
  private settingsService = new BackupSettingsService();
  private schedulerService = new BackupSchedulerService();
  private importService = new BackupImportService();
  private readonly instanceQueues = new Map<string, Promise<void>>();

  /**
   * For app start: moves backups out of instance directories (older versions kept them there),
   * clears what an interrupted backup or restore left, and re-arms the saved schedules.
   */
  async initializeBackupSystem(): Promise<void> {
    let instances: InstanceConfig[];
    try {
      instances = await instanceUtils.getAllInstances();
    } catch (error) {
      console.error('[backup-service] Failed to list instances for the backup system:', error);
      return;
    }

    for (const instance of instances) {
      const serverPath = instanceUtils.getInstanceDir(instance.id);
      await this.operationsService.migrateLegacyBackups(serverPath);
      // Queued like a backup, so a backup started meanwhile never loses its temporary archive.
      await this.exclusive(instance.id, () => this.operationsService.removeStaleTempFiles(serverPath));
    }

    // Each instance on its own: one unreadable backup-settings.json must not leave every instance
    // after it unscheduled.
    for (const instance of instances) {
      try {
        const settings = await this.settingsService.getBackupSettingsInternal(instanceUtils.getInstanceDir(instance.id));
        if (settings?.enabled) {
          this.schedulerService.startBackupSchedulerInternal(instance.id, settings, this.createBackup.bind(this));
        }
      } catch (error) {
        console.error(`[backup-service] Failed to restore the backup schedule of ${instance.id}:`, error);
      }
    }
  }

  /** Clients only ever create manual backups; a type or name that is not what it should be is ignored. */
  async createBackup(instanceId: string, type?: 'manual' | 'scheduled', name?: string): Promise<BackupResult> {
    try {
      const serverPath = this.existingInstanceDir(instanceId);
      if (!serverPath) {
        return { success: false, error: !instanceId ? 'Instance ID is required' : 'Instance not found' };
      }
      const backupType = type === 'scheduled' ? 'scheduled' : 'manual';
      const customName = typeof name === 'string' ? name : undefined;

      const metadata = await this.exclusive(instanceId, async () => {
        const created = await this.operationsService.createBackupInternal(instanceId, serverPath, backupType, customName);
        const settings = await this.settingsService.getBackupSettingsInternal(serverPath);
        if (settings) {
          await this.cleanupService.cleanupOldBackups(serverPath, settings.maxBackupsToKeep, dir => this.operationsService.getInstanceBackupsInternal(dir));
          if (backupType === 'scheduled') {
            await this.cleanupService.cleanupArkSaveFiles(serverPath, settings.maxBackupsToKeep);
          }
        }
        return created;
      });

      return { success: true, backupId: metadata.id, message: 'Backup created successfully' };
    } catch (error) {
      console.error('[backup-service] Failed to create backup:', error);
      return errorResult(error, 'Failed to create backup');
    }
  }

  async getBackupList(instanceId: string): Promise<BackupListResult> {
    try {
      const serverPath = this.existingInstanceDir(instanceId);
      if (!serverPath) {
        return { success: false, error: !instanceId ? 'Instance ID is required' : 'Instance not found' };
      }
      return { success: true, backups: await this.operationsService.getInstanceBackupsInternal(serverPath) };
    } catch (error) {
      console.error('[backup-service] Failed to get backup list:', error);
      return errorResult(error, 'Failed to get backup list');
    }
  }

  async restoreBackup(instanceId: string, backupId: string): Promise<BackupRestoreResult> {
    try {
      if (!instanceId || !backupId) {
        return { success: false, error: 'Instance ID and Backup ID are required' };
      }
      const serverPath = this.existingInstanceDir(instanceId);
      if (!serverPath) {
        return { success: false, error: 'Instance not found' };
      }

      // Restoring clears and rewrites the instance directory. On Windows a running server holds
      // locks on its files, so a failure midway could leave the instance without a config.json and
      // drop it from the server list. A start in progress (a crash-detection restart too) has no
      // process and leaves the state as it was until it spawns one.
      const state = getNormalizedInstanceState(instanceId).toLowerCase();
      if (!RESTORABLE_STATES.has(state) || serverProcessService.hasActiveProcess(instanceId)
        || serverLifecycleService.isStartInProgress(instanceId)) {
        return { success: false, error: 'The server must be stopped before restoring a backup.' };
      }

      // Before the first await: crash detection restarts a 'crashed' server, which would then run
      // on half-restored files.
      if (state !== 'stopped') {
        setInstanceState(instanceId, 'stopped');
        messagingService.sendToAll('server-instance-state', { state: 'stopped', instanceId });
      }

      const backups = await this.operationsService.getInstanceBackupsInternal(serverPath);
      if (!backups.some((backup: BackupMetadata) => backup.id === backupId)) {
        return { success: false, error: 'Backup not found' };
      }

      await this.exclusive(instanceId, () => this.operationsService.restoreBackupInternal(backupId, serverPath));
      return { success: true, message: 'Backup restored successfully' };
    } catch (error) {
      console.error('[backup-service] Failed to restore backup:', error);
      return errorResult(error, 'Failed to restore backup');
    }
  }

  /**
   * Backup ids are file names, so two instances can have the same one. `instanceId` picks the
   * instance; without it the first instance holding the id is used.
   */
  async deleteBackup(backupId: string, instanceId?: string): Promise<BackupResult> {
    try {
      if (!backupId || typeof backupId !== 'string') {
        return { success: false, error: 'Backup ID is required' };
      }

      const candidates = instanceId ? [instanceId] : (await instanceUtils.getAllInstances()).map((instance: InstanceConfig) => instance.id);
      for (const candidate of candidates) {
        const serverPath = instanceUtils.getInstanceDir(candidate);
        let backups: BackupMetadata[];
        try {
          backups = await this.operationsService.getInstanceBackupsInternal(serverPath);
        } catch (error) {
          console.warn(`[backup-service] Failed to check the backups of ${candidate}:`, error);
          continue;
        }
        if (backups.some(backup => backup.id === backupId)) {
          await this.operationsService.deleteBackupInternal(backupId, serverPath);
          return { success: true, message: 'Backup deleted successfully' };
        }
      }
      return { success: false, error: 'Backup not found' };
    } catch (error) {
      console.error('[backup-service] Failed to delete backup:', error);
      return errorResult(error, 'Failed to delete backup');
    }
  }

  async getBackupSettings(instanceId: string): Promise<BackupSettingsResult> {
    try {
      const serverPath = this.existingInstanceDir(instanceId);
      if (!serverPath) {
        return { success: false, error: !instanceId ? 'Instance ID is required' : 'Instance not found' };
      }
      const settings = await this.settingsService.getBackupSettingsInternal(serverPath);
      return {
        success: true,
        settings: settings || { instanceId, enabled: false, frequency: 'daily', time: '02:00', maxBackupsToKeep: DEFAULT_BACKUPS_TO_KEEP }
      };
    } catch (error) {
      console.error('[backup-service] Failed to get backup settings:', error);
      return errorResult(error, 'Failed to get backup settings');
    }
  }

  /** Stores the settings, with the number of backups to keep held to 1-50, and arms or stops the schedule. */
  async saveBackupSettings(instanceId: string, settings: BackupSettings): Promise<BackupResult> {
    try {
      if (!instanceId || !settings || typeof settings !== 'object' || Array.isArray(settings)) {
        return { success: false, error: 'Instance ID and settings are required' };
      }
      const serverPath = this.existingInstanceDir(instanceId);
      if (!serverPath) {
        return { success: false, error: 'Instance not found' };
      }

      const stored: BackupSettings = { ...settings, instanceId, maxBackupsToKeep: clampBackupsToKeep(settings.maxBackupsToKeep) };
      await this.settingsService.saveBackupSettingsInternal(stored, serverPath);
      if (stored.enabled) {
        this.schedulerService.startBackupSchedulerInternal(instanceId, stored, this.createBackup.bind(this));
      } else {
        this.schedulerService.stopBackupSchedulerInternal(instanceId);
      }
      return { success: true, message: 'Backup settings saved successfully' };
    } catch (error) {
      console.error('[backup-service] Failed to save backup settings:', error);
      return errorResult(error, 'Failed to save backup settings');
    }
  }

  async startBackupScheduler(instanceId: string): Promise<BackupSchedulerResult> {
    try {
      const serverPath = this.existingInstanceDir(instanceId);
      if (!serverPath) {
        return { success: false, error: !instanceId ? 'Instance ID is required' : 'Instance not found' };
      }
      const settings = await this.settingsService.getBackupSettingsInternal(serverPath);
      if (!settings?.enabled) {
        return { success: false, error: 'Backup settings not found or disabled' };
      }
      this.schedulerService.startBackupSchedulerInternal(instanceId, settings, this.createBackup.bind(this));
      return { success: true, message: 'Backup scheduler started successfully' };
    } catch (error) {
      console.error('[backup-service] Failed to start backup scheduler:', error);
      return errorResult(error, 'Failed to start backup scheduler');
    }
  }

  async stopBackupScheduler(instanceId: string): Promise<BackupSchedulerResult> {
    if (!instanceId) {
      return { success: false, error: 'Instance ID is required' };
    }
    this.schedulerService.stopBackupSchedulerInternal(instanceId);
    return { success: true, message: 'Backup scheduler stopped successfully' };
  }

  async getSchedulerStatus(instanceId: string): Promise<BackupSchedulerStatusResult> {
    if (!instanceId) {
      return { success: false, error: 'Instance ID is required' };
    }
    return this.schedulerService.getSchedulerStatus(instanceId);
  }

  async downloadBackup(instanceId: string, backupId: string): Promise<BackupDownloadResult> {
    try {
      if (!instanceId || !backupId) {
        return { success: false, error: 'Instance ID and Backup ID are required' };
      }
      const serverPath = this.existingInstanceDir(instanceId);
      if (!serverPath) {
        return { success: false, error: 'Instance not found' };
      }

      const backups = await this.operationsService.getInstanceBackupsInternal(serverPath);
      const backup = backups.find((candidate: BackupMetadata) => candidate.id === backupId);
      if (!backup) {
        return { success: false, error: 'Backup not found' };
      }
      return { success: true, filePath: backup.filePath, fileName: path.basename(backup.filePath) };
    } catch (error) {
      console.error('[backup-service] Failed to prepare backup download:', error);
      return errorResult(error, 'Failed to prepare backup download');
    }
  }

  /** Resolves once the instance's backups and restores queued before the call have finished; never rejects. */
  async waitForBackupOperations(instanceId: string): Promise<void> {
    await this.instanceQueues.get(instanceId);
  }

  importBackupAsNewServer(serverName: string, backupFilePath: string): Promise<InstanceConfig> {
    return this.importService.importBackupAsNewServer(serverName, backupFilePath);
  }

  /** The instance directory, or null when there is no such instance. Throws for an invalid id. */
  private existingInstanceDir(instanceId: string): string | null {
    if (!instanceId || !instanceUtils.getInstance(instanceId)) {
      return null;
    }
    return instanceUtils.getInstanceDir(instanceId);
  }

  // One backup or restore per instance at a time: a scheduled backup must not overlap a manual one,
  // nor archive a restore that is half done.
  private exclusive<T>(instanceId: string, task: () => Promise<T>): Promise<T> {
    const result = (this.instanceQueues.get(instanceId) ?? Promise.resolve()).then(task);
    const settled = result.then(() => undefined, () => undefined);
    this.instanceQueues.set(instanceId, settled);
    void settled.then(() => {
      if (this.instanceQueues.get(instanceId) === settled) this.instanceQueues.delete(instanceId);
    });
    return result;
  }
}

export const backupService = new BackupService();