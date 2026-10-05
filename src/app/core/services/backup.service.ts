import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { BACKUP_TIMEOUT_MS, MessagingService } from './messaging/messaging.service';
import { IpcService } from './ipc.service';
import {
  BackupSettings,
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
    private ipc: IpcService
  ) {}

  /** Replies once the archive is written, which can take many minutes for a large save. */
  createBackup(request: BackupCreateRequest): Observable<BackupOperationResponse> {
    return this.messaging.sendMessage('create-backup', request, { timeoutMs: BACKUP_TIMEOUT_MS });
  }

  getBackupList(instanceId: string): Observable<BackupListResponse> {
    return this.messaging.sendMessage('get-backup-list', { instanceId });
  }

  /** Replies once the archive is unpacked over the server's files. */
  restoreBackup(request: BackupRestoreRequest): Observable<BackupOperationResponse> {
    return this.messaging.sendMessage('restore-backup', request, { timeoutMs: BACKUP_TIMEOUT_MS });
  }

  deleteBackup(request: BackupDeleteRequest): Observable<BackupOperationResponse> {
    return this.messaging.sendMessage('delete-backup', request);
  }

  getBackupSettings(instanceId: string): Observable<{ success: boolean; settings?: BackupSettings; error?: string }> {
    return this.messaging.sendMessage('get-backup-settings', { instanceId });
  }

  saveBackupSettings(settings: BackupSettings): Observable<BackupOperationResponse> {
    return this.messaging.sendMessage('save-backup-settings', {
      instanceId: settings.instanceId,
      settings
    });
  }

  startBackupScheduler(instanceId: string): Observable<BackupOperationResponse> {
    return this.messaging.sendMessage('start-backup-scheduler', { instanceId });
  }

  stopBackupScheduler(instanceId: string): Observable<BackupOperationResponse> {
    return this.messaging.sendMessage('stop-backup-scheduler', { instanceId });
  }

  downloadBackup(request: { instanceId: string; backupId: string }): Observable<BackupOperationResponse> {
    return this.messaging.sendMessage('download-backup', {
      ...request,
      frontendEnvironment: this.ipc.isElectron ? 'electron' : 'web'
    }, { timeoutMs: BACKUP_TIMEOUT_MS });
  }
}
