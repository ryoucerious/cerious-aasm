import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { MessagingService } from './messaging/messaging.service';
import { UtilityService } from './utility.service';
import { 
  BackupSettings, 
  BackupMetadata, 
  BackupCreateRequest, 
  BackupRestoreRequest, 
  BackupDeleteRequest,
  BackupListResponse,
  BackupOperationResponse 
} from '../interfaces/backup.interface';

@Injectable({
  providedIn: 'root'
})
export class BackupService {

  constructor(
    private messaging: MessagingService,
    private utilityService: UtilityService
  ) {}

  /**
   * Create a backup for the specified server instance
   */
  createBackup(request: BackupCreateRequest): Observable<BackupOperationResponse> {
    return this.messaging.sendMessage('create-backup', request);
  }

  /**
   * Get list of backups for a server instance
   */
  getBackupList(instanceId: string): Observable<BackupListResponse> {
    return this.messaging.sendMessage('get-backup-list', { instanceId });
  }

  /**
   * Restore a backup
   */
  restoreBackup(request: BackupRestoreRequest): Observable<BackupOperationResponse> {
    return this.messaging.sendMessage('restore-backup', request);
  }

  /**
   * Delete a backup
   */
  deleteBackup(request: BackupDeleteRequest): Observable<BackupOperationResponse> {
    return this.messaging.sendMessage('delete-backup', request);
  }

  /**
   * Get backup settings for a server instance
   */
  getBackupSettings(instanceId: string): Observable<{ success: boolean; settings?: BackupSettings; error?: string }> {
    return this.messaging.sendMessage('get-backup-settings', { instanceId });
  }

  /**
   * Save backup settings for a server instance
   */
  saveBackupSettings(settings: BackupSettings): Observable<BackupOperationResponse> {
    return this.messaging.sendMessage('save-backup-settings', { 
      instanceId: settings.instanceId, 
      settings 
    });
  }

  /**
   * Start backup scheduler for a server instance
   */
  startBackupScheduler(instanceId: string): Observable<BackupOperationResponse> {
    return this.messaging.sendMessage('start-backup-scheduler', { instanceId });
  }

  /**
   * Stop backup scheduler for a server instance
   */
  stopBackupScheduler(instanceId: string): Observable<BackupOperationResponse> {
    return this.messaging.sendMessage('stop-backup-scheduler', { instanceId });
  }

  /**
   * Get backup scheduler status
   */
  getSchedulerStatus(instanceId: string): Observable<{ success: boolean; running?: boolean; nextRun?: Date; error?: string }> {
    return this.messaging.sendMessage('get-scheduler-status', { instanceId });
  }

  /**
   * Download/show backup file in file manager
   */
  downloadBackup(request: { instanceId: string; backupId: string }): Observable<BackupOperationResponse> {
    // Use utility service to detect platform
    const platform = this.utilityService.getPlatform();
    
    return this.messaging.sendMessage('download-backup', {
      ...request,
      frontendEnvironment: platform.toLowerCase() // 'electron' or 'web'
    });
  }
}