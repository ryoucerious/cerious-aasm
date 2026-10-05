import { Injectable, ChangeDetectorRef } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { BackupService } from './backup.service';
import { NotificationService } from './notification.service';
import { MessagingService } from './messaging/messaging.service';
import { BackupMetadata, BackupOperationResponse } from '../interfaces/backup.interface';
import { downloadBase64File } from '../utils/download.utils';

interface BackupUIState {
  showBackupNameModal: boolean;
  showDeleteBackupModal: boolean;
  backupName: string;
  backupToDelete: BackupMetadata | null;
  backupList: BackupMetadata[];
  backupScheduleEnabled: boolean;
  backupFrequency: 'hourly' | 'daily' | 'weekly';
  backupTime: string;
  /** 0 is Sunday. */
  backupDayOfWeek: number;
  maxBackupsToKeep: number;
  isCreatingBackup: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class BackupUIService {

  private initialState: BackupUIState = {
    showBackupNameModal: false,
    showDeleteBackupModal: false,
    backupName: '',
    backupToDelete: null,
    backupList: [],
    backupScheduleEnabled: false,
    backupFrequency: 'daily',
    backupTime: '02:00',
    backupDayOfWeek: 1,
    maxBackupsToKeep: 10,
    isCreatingBackup: false
  };

  private stateSubject = new BehaviorSubject<BackupUIState>(this.initialState);
  public state$ = this.stateSubject.asObservable();

  /**
   * The server whose backups the state holds. This service outlives the page's choice of server,
   * so a late reply for the previous one is dropped rather than shown, or saved, as this one's.
   */
  private shownInstanceId: string | null = null;

  constructor(
    private backupService: BackupService,
    private notificationService: NotificationService,
    private messagingService: MessagingService
  ) {
    // Scheduled backups finish with nobody asking, so the list follows the broadcast.
    this.messagingService.receiveMessage<{ instanceId?: string }>('backup-created').subscribe(event => {
      if (event?.instanceId && event.instanceId === this.shownInstanceId) {
        this.fetchBackupList(event.instanceId);
      }
    });
  }

  get currentState(): BackupUIState {
    return this.stateSubject.value;
  }

  generateBackupName(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `backup_${timestamp}`;
  }

  showBackupNameModal(): void {
    this.patchState({ backupName: this.generateBackupName(), showBackupNameModal: true });
  }

  updateBackupName(name: string): void {
    this.patchState({ backupName: name });
  }

  hideBackupNameModal(): void {
    this.patchState({ showBackupNameModal: false, backupName: '' });
  }

  createManualBackup(instanceId: string, cdr: ChangeDetectorRef): void {
    const currentState = this.currentState;

    this.patchState({ isCreatingBackup: true });

    this.backupService.createBackup({
      instanceId: instanceId,
      type: 'manual',
      name: currentState.backupName || this.generateBackupName()
    }).subscribe({
      // The user started the backup, so its outcome is always reported; only the shown server's state follows it.
      next: (response) => {
        const shown = instanceId === this.shownInstanceId;
        if (shown) this.patchState({ isCreatingBackup: false });

        if (response.success) {
          this.notificationService.success('Backup created successfully', 'Backup');
          if (shown) {
            this.hideBackupNameModal();
            this.fetchBackupList(instanceId);
          }
        } else {
          this.notificationService.error(response.error || 'Failed to create backup', 'Backup Error');
        }
        cdr.markForCheck();
      },
      error: (error) => {
        if (instanceId === this.shownInstanceId) this.patchState({ isCreatingBackup: false });
        console.error('[backup-ui] Failed to create backup:', error);
        this.notificationService.error('Failed to create backup', 'Backup Error');
        cdr.markForCheck();
      }
    });
  }

  /** Loads `instanceId`'s backups; from now on the state belongs to that server. */
  refreshBackupList(instanceId: string): void {
    this.show(instanceId);
    this.fetchBackupList(instanceId);
  }

  updateBackupList(backupList: BackupMetadata[]): void {
    this.patchState({ backupList });
  }

  /** Loads `instanceId`'s backup schedule; from now on the state belongs to that server. */
  loadBackupSettings(instanceId: string): void {
    this.show(instanceId);
    this.backupService.getBackupSettings(instanceId).subscribe({
      next: response => {
        if (instanceId !== this.shownInstanceId || !response.success || !response.settings) return;
        this.patchState({
          backupScheduleEnabled: response.settings.enabled || false,
          backupFrequency: response.settings.frequency || 'daily',
          backupTime: response.settings.time || '02:00',
          backupDayOfWeek: response.settings.dayOfWeek ?? 1,
          maxBackupsToKeep: response.settings.maxBackupsToKeep || 10
        });
      },
      error: error => {
        if (instanceId !== this.shownInstanceId) return;
        console.error('[backup-ui] Failed to load backup settings:', error);
        this.notificationService.error('Failed to load backup settings', 'Settings Error');
      }
    });
  }

  saveBackupSettings(instanceId: string): void {
    const state = this.currentState;
    const settings = {
      instanceId: instanceId,
      enabled: state.backupScheduleEnabled,
      frequency: state.backupFrequency,
      time: state.backupTime,
      dayOfWeek: state.backupDayOfWeek,
      maxBackupsToKeep: state.maxBackupsToKeep
    };

    this.backupService.saveBackupSettings(settings).subscribe({
      next: response => {
        if (response.success) {
          this.notificationService.success('Backup settings saved successfully', 'Settings');
          this.applySchedule(instanceId, state.backupScheduleEnabled);
        } else {
          this.notificationService.error(response.error || 'Failed to save backup settings', 'Settings Error');
        }
      },
      error: error => {
        console.error('[backup-ui] Failed to save backup settings:', error);
        this.notificationService.error('Failed to save backup settings', 'Settings Error');
      }
    });
  }

  restoreBackup(instanceId: string, backup: BackupMetadata | null): void {
    if (!backup) return;

    const message = `Are you sure you want to restore the backup "${backup.name}"? This will replace all current server files.`;
    if (confirm(message)) {
      this.backupService.restoreBackup({
        instanceId: instanceId,
        backupId: backup.id
      }).subscribe({
        next: response => {
          if (response.success) {
            this.notificationService.success('Backup restored successfully', 'Backup');
          } else {
            this.notificationService.error(response.error || 'Failed to restore backup', 'Backup Error');
          }
        },
        error: (error) => {
          console.error('[backup-ui] Failed to restore backup:', error);
          this.notificationService.error('Failed to restore backup', 'Backup Error');
        }
      });
    }
  }

  downloadBackup(instanceId: string, backup: BackupMetadata | null): void {
    if (!backup) return;

    this.backupService.downloadBackup({
      instanceId: instanceId,
      backupId: backup.id
    }).subscribe({
      next: (response) => {
        if (response.success) {
          if (response.fileData && response.fileName) {
            this.saveDownloadedFile(response.fileData, response.fileName, response.mimeType || 'application/zip');
          } else {
            this.notificationService.success(response.message || 'Backup file location opened', 'Download');
          }
        } else if (response.isLargeFile && response.filePath) {
          this.showLargeFileWarning(response);
        } else {
          this.notificationService.error(response.error || 'Failed to download backup', 'Download Error');
        }
      },
      error: (error) => {
        console.error('[backup-ui] Failed to download backup:', error);
        this.notificationService.error('Failed to download backup', 'Download Error');
      }
    });
  }

  showDeleteBackupModal(backup: BackupMetadata): void {
    this.patchState({ backupToDelete: backup, showDeleteBackupModal: true });
  }

  hideDeleteBackupModal(): void {
    this.patchState({ backupToDelete: null, showDeleteBackupModal: false });
  }

  confirmDeleteBackup(instanceId: string): void {
    const backupToDelete = this.currentState.backupToDelete;
    if (!backupToDelete) return;

    this.backupService.deleteBackup({
      instanceId,
      backupId: backupToDelete.id
    }).subscribe({
      next: (response) => {
        const shown = instanceId === this.shownInstanceId;
        if (response.success) {
          this.notificationService.success('Backup deleted successfully', 'Backup');
          if (shown) this.fetchBackupList(instanceId);
        } else {
          this.notificationService.error(response.error || 'Failed to delete backup', 'Backup Error');
        }
        if (shown) this.hideDeleteBackupModal();
      },
      error: (error) => {
        console.error('[backup-ui] Failed to delete backup:', error);
        this.notificationService.error('Failed to delete backup', 'Backup Error');
        if (instanceId === this.shownInstanceId) this.hideDeleteBackupModal();
      }
    });
  }

  updateBackupSettings(updates: Partial<BackupUIState>): void {
    this.patchState(updates);
  }

  private patchState(updates: Partial<BackupUIState>): void {
    this.stateSubject.next({ ...this.currentState, ...updates });
  }

  /** Until the new server's replies arrive, shows nothing of the previous one's. */
  private show(instanceId: string): void {
    if (instanceId === this.shownInstanceId) return;
    this.shownInstanceId = instanceId;
    const {
      backupList, backupScheduleEnabled, backupFrequency, backupTime, backupDayOfWeek, maxBackupsToKeep,
      showDeleteBackupModal, backupToDelete, showBackupNameModal, backupName, isCreatingBackup
    } = this.initialState;
    this.patchState({
      backupList, backupScheduleEnabled, backupFrequency, backupTime, backupDayOfWeek, maxBackupsToKeep,
      showDeleteBackupModal, backupToDelete, showBackupNameModal, backupName, isCreatingBackup
    });
  }

  private fetchBackupList(instanceId: string): void {
    this.backupService.getBackupList(instanceId).subscribe({
      next: response => {
        if (instanceId === this.shownInstanceId && response.success && Array.isArray(response.backups)) {
          this.updateBackupList(response.backups);
        }
      },
      error: error => {
        if (instanceId !== this.shownInstanceId) return;
        console.error('[backup-ui] Failed to load the backup list:', error);
        this.notificationService.error('Failed to load backups', 'Backup Error');
      }
    });
  }

  private applySchedule(instanceId: string, enabled: boolean): void {
    const request = enabled
      ? this.backupService.startBackupScheduler(instanceId)
      : this.backupService.stopBackupScheduler(instanceId);
    const failed = enabled ? 'Failed to start the backup schedule' : 'Failed to stop the backup schedule';
    request.subscribe({
      next: response => {
        if (!response.success) this.notificationService.error(response.error || failed, 'Settings Error');
      },
      error: error => {
        console.error(`[backup-ui] ${failed}:`, error);
        this.notificationService.error(failed, 'Settings Error');
      }
    });
  }

  private saveDownloadedFile(fileData: string, fileName: string, mimeType: string): void {
    try {
      downloadBase64File(fileData, fileName, mimeType);
    } catch (error) {
      console.error('[backup-ui] Failed to save downloaded file:', error);
      this.notificationService.error('Failed to download file', 'Download Error');
    }
  }

  private showLargeFileWarning(response: BackupOperationResponse): void {
    const fileSizeMB = response.fileSizeMB || 'Unknown';
    const filePath = response.filePath || 'Unknown location';

    this.notificationService.warning(
      `This backup file (${fileSizeMB}MB) is too large for web download. ` +
      `For large backups, please use the desktop application or access the file directly at: ${filePath}`,
      'Large File Warning'
    );
  }
}
