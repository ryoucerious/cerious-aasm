import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import { BackupSettings, BackupMetadata } from '../../types/backup.types';
import { BackupFilenameUtils, BackupPathUtils } from '../../utils/backup.utils';
import * as instanceUtils from '../../utils/ark/instance.utils';

// Import refactored services
import { BackupOperationsService } from './backup-operations.service';
import { BackupCleanupService } from './backup-cleanup.service';
import { BackupSettingsService } from './backup-settings.service';
import { BackupSchedulerService } from './backup-scheduler.service';
import { BackupImportService } from './backup-import.service';
import {
  BackupResult,
  BackupListResult,
  BackupSettingsResult,
  BackupRestoreResult,
  BackupSchedulerResult,
  BackupSchedulerStatusResult,
  BackupDownloadResult
} from '../../types/backup.types';

// File system operations
const mkdir = promisify(fs.mkdir);
const stat = promisify(fs.stat);
const readdir = promisify(fs.readdir);
const unlink = promisify(fs.unlink);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

// Note: Using require() due to lack of proper TypeScript definitions for adm-zip
const AdmZip = require('adm-zip') as any;

/**
 * Backup Service - Handles all business logic for server backup operations
 */
export class BackupService {
  private operationsService: BackupOperationsService;
  private cleanupService: BackupCleanupService;
  private settingsService: BackupSettingsService;
  private schedulerService: BackupSchedulerService;
  private importService: BackupImportService;

  constructor() {
    this.operationsService = new BackupOperationsService();
    this.cleanupService = new BackupCleanupService();
    this.settingsService = new BackupSettingsService();
    this.schedulerService = new BackupSchedulerService();
    this.importService = new BackupImportService();

    // Initialize will be called from the handler
  }

  /**
   * Get the server instance directory path
   */
  private getInstanceServerPath(instanceId: string): string {
    const baseDir = instanceUtils.getInstancesBaseDir();
    return path.join(baseDir, instanceId);
  }

  /**
   * Validate instance and get server path
   */
  private async validateInstanceAndGetPath(instanceId: string): Promise<{ instance: any; serverPath: string } | null> {
    if (!instanceId) {
      return null;
    }

    const instance = await instanceUtils.getInstance(instanceId);
    if (!instance) {
      return null;
    }

    const serverPath = this.getInstanceServerPath(instanceId);
    return { instance, serverPath };
  }

  /**
   * Initialize backup system and restore schedules
   */
  async initializeBackupSystem(): Promise<void> {
    try {
      await this.restoreActiveSchedules();
    } catch (error) {
      console.error('[backup-service] Failed to initialize backup system:', error);
    }
  }

  /**
   * Restore active backup schedules on startup
   */
  private async restoreActiveSchedules(): Promise<void> {
    try {
      const instances = await instanceUtils.getAllInstances();

      for (const instance of instances) {
        const serverPath = this.getInstanceServerPath(instance.id);
        const settings = await this.settingsService.getBackupSettingsInternal(instance.id, serverPath);
        if (settings?.enabled) {
          await this.schedulerService.startBackupSchedulerInternal(instance.id, settings, this.createBackup.bind(this));
        }
      }
    } catch (error) {
      console.error('[backup-service] Failed to restore active schedules:', error);
    }
  }

  /**
   * Create a new backup for a server instance, compressing all save data and configuration
   * @param instanceId - The unique identifier of the server instance to backup
   * @param type - The type of backup ('manual' for user-initiated, 'scheduled' for automated)
   * @param name - Optional custom name for the backup file
   * @returns Promise resolving to a BackupResult with success status and backup ID
   */
  async createBackup(instanceId: string, type?: 'manual' | 'scheduled', name?: string): Promise<BackupResult> {
    try {
      const validation = await this.validateInstanceAndGetPath(instanceId);
      if (!validation) {
        return {
          success: false,
          error: !instanceId ? 'Instance ID is required' : 'Instance not found'
        };
      }

      const { serverPath } = validation;

      // Create the backup
      const metadata = await this.operationsService.createBackupInternal(instanceId, serverPath, type || 'manual', name);

      // Clean up old backups if settings exist
      const settings = await this.settingsService.getBackupSettingsInternal(instanceId, serverPath);
      if (settings) {
        await this.cleanupService.cleanupOldBackups(serverPath, settings.maxBackupsToKeep, this.operationsService.getInstanceBackupsInternal.bind(this.operationsService));

        // Also clean up ARK save files for scheduled backups
        if (type === 'scheduled') {
          await this.cleanupService.cleanupArkSaveFiles(serverPath, settings.maxBackupsToKeep);
        }
      }

      return {
        success: true,
        backupId: metadata.id,
        message: 'Backup created successfully'
      };

    } catch (error) {
      console.error('[backup-service] Failed to create backup:', error);
      return {
        success: false,
        error: (error as Error)?.message || 'Failed to create backup'
      };
    }
  }

  /**
   * Retrieve the list of all backups for a specific server instance
   * @param instanceId - The unique identifier of the server instance
   * @returns Promise resolving to a BackupListResult containing an array of backup metadata
   */
  async getBackupList(instanceId: string): Promise<BackupListResult> {
    try {
      const validation = await this.validateInstanceAndGetPath(instanceId);
      if (!validation) {
        return {
          success: false,
          error: !instanceId ? 'Instance ID is required' : 'Instance not found'
        };
      }

      const { serverPath } = validation;
      const backups = await this.operationsService.getInstanceBackupsInternal(serverPath);

      return {
        success: true,
        backups
      };

    } catch (error) {
      console.error('[backup-service] Failed to get backup list:', error);
      return {
        success: false,
        error: (error as Error)?.message || 'Failed to get backup list'
      };
    }
  }

  /**
   * Restore a server instance from a specific backup, replacing current save data and configuration
   * @param instanceId - The unique identifier of the server instance to restore to
   * @param backupId - The unique identifier of the backup to restore from
   * @returns Promise resolving to a BackupRestoreResult with success status and operation details
   */
  async restoreBackup(instanceId: string, backupId: string): Promise<BackupRestoreResult> {
    try {
      if (!instanceId || !backupId) {
        return {
          success: false,
          error: 'Instance ID and Backup ID are required'
        };
      }

      const validation = await this.validateInstanceAndGetPath(instanceId);
      if (!validation) {
        return {
          success: false,
          error: 'Instance not found'
        };
      }

      const { serverPath } = validation;

      // Check if backup exists
      const backups = await this.operationsService.getInstanceBackupsInternal(serverPath);
      const backup = backups.find((b: BackupMetadata) => b.id === backupId);
      if (!backup) {
        return {
          success: false,
          error: 'Backup not found'
        };
      }

      // Restore the backup
      await this.operationsService.restoreBackupInternal(backupId, serverPath);

      return {
        success: true,
        message: 'Backup restored successfully'
      };

    } catch (error) {
      console.error('[backup-service] Failed to restore backup:', error);
      return {
        success: false,
        error: (error as Error)?.message || 'Failed to restore backup'
      };
    }
  }

  /**
   * Permanently delete a backup file from storage
   * @param backupId - The unique identifier of the backup to delete
   * @returns Promise resolving to a BackupResult confirming successful deletion
   */
  async deleteBackup(backupId: string): Promise<BackupResult> {
    try {
      if (!backupId) {
        return {
          success: false,
          error: 'Backup ID is required'
        };
      }

      // Search for the backup across all instances
      const allInstances = await instanceUtils.getAllInstances();
      let foundBackup = false;
      let backupServerPath = '';

      for (const instance of allInstances) {
        try {
          const serverPath = this.getInstanceServerPath(instance.id);
          const backups = await this.operationsService.getInstanceBackupsInternal(serverPath);
          const backup = backups.find((b: BackupMetadata) => b.id === backupId);

          if (backup) {
            foundBackup = true;
            backupServerPath = serverPath;
            break;
          }
        } catch (error) {
          // Continue searching other instances if this one fails
          console.warn(`[backup-service] Failed to check backups for instance ${instance.id}:`, error);
        }
      }

      if (!foundBackup) {
        return {
          success: false,
          error: 'Backup not found'
        };
      }

      // Delete the backup
      await this.operationsService.deleteBackupInternal(backupId, backupServerPath);

      return {
        success: true,
        message: 'Backup deleted successfully'
      };

    } catch (error) {
      console.error('[backup-service] Failed to delete backup:', error);
      return {
        success: false,
        error: (error as Error)?.message || 'Failed to delete backup'
      };
    }
  }

  /**
   * Get backup settings for an instance
   */  
  async getBackupSettings(instanceId: string): Promise<BackupSettingsResult> {
    try {
      const validation = await this.validateInstanceAndGetPath(instanceId);
      if (!validation) {
        return {
          success: false,
          error: !instanceId ? 'Instance ID is required' : 'Instance not found'
        };
      }

      const { serverPath } = validation;
      const settings = await this.settingsService.getBackupSettingsInternal(instanceId, serverPath);

      return {
        success: true,
        settings: settings || {
          instanceId,
          enabled: false,
          frequency: 'daily',
          time: '02:00',
          maxBackupsToKeep: 5
        }
      };

    } catch (error) {
      console.error('[backup-service] Failed to get backup settings:', error);
      return {
        success: false,
        error: (error as Error)?.message || 'Failed to get backup settings'
      };
    }
  }

  /**
   * Save backup settings for an instance
   */
  async saveBackupSettings(instanceId: string, settings: BackupSettings): Promise<BackupResult> {
    try {
      if (!instanceId || !settings) {
        return {
          success: false,
          error: 'Instance ID and settings are required'
        };
      }

      const validation = await this.validateInstanceAndGetPath(instanceId);
      if (!validation) {
        return {
          success: false,
          error: 'Instance not found'
        };
      }

      const { serverPath } = validation;
      await this.settingsService.saveBackupSettingsInternal(settings, serverPath);

      // Update scheduler if settings changed
      if (settings.enabled) {
        await this.schedulerService.startBackupSchedulerInternal(instanceId, settings, this.createBackup.bind(this));
      } else {
        this.schedulerService.stopBackupSchedulerInternal(instanceId);
      }

      return {
        success: true,
        message: 'Backup settings saved successfully'
      };

    } catch (error) {
      console.error('[backup-service] Failed to save backup settings:', error);
      return {
        success: false,
        error: (error as Error)?.message || 'Failed to save backup settings'
      };
    }
  }

  /**
   * Start backup scheduler for an instance
   */
  async startBackupScheduler(instanceId: string): Promise<BackupSchedulerResult> {
    try {
      const validation = await this.validateInstanceAndGetPath(instanceId);
      if (!validation) {
        return {
          success: false,
          error: !instanceId ? 'Instance ID is required' : 'Instance not found'
        };
      }

      const { serverPath } = validation;
      const settings = await this.settingsService.getBackupSettingsInternal(instanceId, serverPath);

      if (!settings || !settings.enabled) {
        return {
          success: false,
          error: 'Backup settings not found or disabled'
        };
      }

      await this.schedulerService.startBackupSchedulerInternal(instanceId, settings, this.createBackup.bind(this));

      return {
        success: true,
        message: 'Backup scheduler started successfully'
      };

    } catch (error) {
      console.error('[backup-service] Failed to start backup scheduler:', error);
      return {
        success: false,
        error: (error as Error)?.message || 'Failed to start backup scheduler'
      };
    }
  }

  /**
   * Stop backup scheduler for an instance
   */
  async stopBackupScheduler(instanceId: string): Promise<BackupSchedulerResult> {
    try {
      if (!instanceId) {
        return {
          success: false,
          error: 'Instance ID is required'
        };
      }

      this.schedulerService.stopBackupSchedulerInternal(instanceId);

      return {
        success: true,
        message: 'Backup scheduler stopped successfully'
      };

    } catch (error) {
      console.error('[backup-service] Failed to stop backup scheduler:', error);
      return {
        success: false,
        error: (error as Error)?.message || 'Failed to stop backup scheduler'
      };
    }
  }

  /**
   * Get backup scheduler status for an instance
   */
  async getSchedulerStatus(instanceId: string): Promise<BackupSchedulerStatusResult> {
    try {
      if (!instanceId) {
        return {
          success: false,
          error: 'Instance ID is required'
        };
      }

      const serverPath = this.getInstanceServerPath(instanceId);
      const settings = await this.settingsService.getBackupSettingsInternal(instanceId, serverPath);

      return await this.schedulerService.getSchedulerStatus(instanceId, settings);

    } catch (error) {
      console.error('[backup-service] Failed to get scheduler status:', error);
      return {
        success: false,
        error: (error as Error)?.message || 'Failed to get scheduler status'
      };
    }
  }

  /**
   * Prepare a backup file for download by the client
   * @param instanceId - The unique identifier of the server instance the backup belongs to
   * @param backupId - The unique identifier of the backup to download
   * @returns Promise resolving to a BackupDownloadResult with file path and metadata for download
   */
  async downloadBackup(instanceId: string, backupId: string): Promise<BackupDownloadResult> {
    try {
      if (!instanceId || !backupId) {
        return {
          success: false,
          error: 'Instance ID and Backup ID are required'
        };
      }

      const validation = await this.validateInstanceAndGetPath(instanceId);
      if (!validation) {
        return {
          success: false,
          error: 'Instance not found'
        };
      }

      const { serverPath } = validation;

      // Check if backup exists
      const backups = await this.operationsService.getInstanceBackupsInternal(serverPath);
      const backup = backups.find((b: BackupMetadata) => b.id === backupId);
      if (!backup) {
        return {
          success: false,
          error: 'Backup not found'
        };
      }

      // Return the backup file path from metadata
      const fileName = path.basename(backup.filePath);

      return {
        success: true,
        filePath: backup.filePath,
        fileName
      };

    } catch (error) {
      console.error('[backup-service] Failed to prepare backup download:', error);
      return {
        success: false,
        error: (error as Error)?.message || 'Failed to prepare backup download'
      };
    }
  }

  /**
   * Import a backup file as a new server instance
   */
  async importBackupAsNewServer(serverName: string, backupFilePath: string): Promise<any> {
    return await this.importService.importBackupAsNewServer(serverName, backupFilePath);
  }

}

// Export singleton instance
export const backupService = new BackupService();