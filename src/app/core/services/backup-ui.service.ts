import { Injectable, ChangeDetectorRef } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { BackupService } from './backup.service';
import { NotificationService } from './notification.service';
import { MessagingService } from './messaging/messaging.service';

interface BackupUIState {
  showBackupNameModal: boolean;
  showDeleteBackupModal: boolean;
  backupName: string;
  backupToDelete: any | null;
  backupList: any[];
  backupScheduleEnabled: boolean;
  backupFrequency: 'hourly' | 'daily' | 'weekly';
  backupTime: string;
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

  constructor(
    private backupService: BackupService,
    private notificationService: NotificationService,
    private messagingService: MessagingService // <-- inject MessagingService
  ) {
    // Listen for scheduled/manual backup-created events
    this.messagingService.receiveMessage<any>('backup-created').subscribe(event => {
      if (event && event.instanceId) {
        this.refreshBackupList(event.instanceId);
      }
    });
  }

  get currentState(): BackupUIState {
    return this.stateSubject.value;
  }

  /**
   * Generate a backup name with timestamp
   */
  generateBackupName(): string {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `backup_${timestamp}`;
  }

  /**
   * Show backup name modal
   */
  showBackupNameModal(): void {
    const currentState = this.currentState;
    this.stateSubject.next({
      ...currentState,
      backupName: this.generateBackupName(),
      showBackupNameModal: true
    });
  }

  /**
   * Update backup name
   */
  updateBackupName(name: string): void {
    const currentState = this.currentState;
    this.stateSubject.next({
      ...currentState,
      backupName: name
    });
  }

  /**
   * Hide backup name modal
   */
  hideBackupNameModal(): void {
    const currentState = this.currentState;
    this.stateSubject.next({
      ...currentState,
      showBackupNameModal: false,
      backupName: ''
    });
  }

  /**
   * Create manual backup
   */
  createManualBackup(instanceId: string, cdr: ChangeDetectorRef): void {
    const currentState = this.currentState;
    const originalList = [...currentState.backupList];
    
    // Set loading state to true
    this.stateSubject.next({
      ...currentState,
      isCreatingBackup: true
    });
    
    this.backupService.createBackup({
      instanceId: instanceId,
      type: 'manual',
      name: currentState.backupName || this.generateBackupName()
    }).subscribe({
      next: (response) => {
        // Set loading state to false
        const updatedState = this.currentState;
        this.stateSubject.next({
          ...updatedState,
          isCreatingBackup: false
        });
        
        if (response.success) {
          this.notificationService.success('Backup created successfully', 'Backup');
          this.hideBackupNameModal();
          this.refreshBackupList(instanceId);
        } else {
          this.notificationService.error(response.error || 'Failed to create backup', 'Backup Error');
          // Restore original list on failure
          this.updateBackupList(originalList);
        }
        cdr.markForCheck();
      },
      error: (error) => {
        // Set loading state to false on error
        const updatedState = this.currentState;
        this.stateSubject.next({
          ...updatedState,
          isCreatingBackup: false
        });
        
        console.error('Failed to create backup:', error);
        this.notificationService.error('Failed to create backup', 'Backup Error');
        this.updateBackupList(originalList);
        cdr.markForCheck();
      }
    });
  }

  /**
   * Refresh backup list
   */
  refreshBackupList(instanceId: string): void {
    this.backupService.getBackupList(instanceId).subscribe(response => {
      if (response.success && Array.isArray(response.backups)) {
        this.updateBackupList(response.backups);
      }
    });
  }

  /**
   * Update backup list in state
   */
  updateBackupList(backupList: any[]): void {
    const currentState = this.currentState;
    this.stateSubject.next({
      ...currentState,
      backupList
    });
  }

  /**
   * Load backup settings
   */
  loadBackupSettings(instanceId: string): void {
    this.backupService.getBackupSettings(instanceId).subscribe(response => {
      if (response.success && response.settings) {
        const currentState = this.currentState;
        this.stateSubject.next({
          ...currentState,
          backupScheduleEnabled: response.settings.enabled || false,
          backupFrequency: response.settings.frequency || 'daily',
          backupTime: response.settings.time || '02:00',
          backupDayOfWeek: response.settings.dayOfWeek || 1,
          maxBackupsToKeep: response.settings.maxBackupsToKeep || 10
        });
      }
    });
  }

  /**
   * Save backup settings
   */
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

    this.backupService.saveBackupSettings(settings).subscribe(response => {
      if (response.success) {
        this.notificationService.success('Backup settings saved successfully', 'Settings');
        
        // Start or stop scheduler based on enabled state
        if (state.backupScheduleEnabled) {
          this.backupService.startBackupScheduler(instanceId).subscribe();
        } else {
          this.backupService.stopBackupScheduler(instanceId).subscribe();
        }
      } else {
        this.notificationService.error(response.error || 'Failed to save backup settings', 'Settings Error');
      }
    });
  }

  /**
   * Restore backup with confirmation
   */
  restoreBackup(instanceId: string, backup: any): void {
    if (!backup) return;
    
    const message = `Are you sure you want to restore the backup "${backup.name}"? This will replace all current server files.`;
    if (confirm(message)) {
      this.backupService.restoreBackup({
        instanceId: instanceId,
        backupId: backup.id
      }).subscribe(response => {
        if (response.success) {
          this.notificationService.success('Backup restored successfully', 'Backup');
        } else {
          this.notificationService.error(response.error || 'Failed to restore backup', 'Backup Error');
        }
      });
    }
  }

  /**
   * Download backup
   */
  downloadBackup(instanceId: string, backup: any): void {
    if (!backup) return;
    
    this.backupService.downloadBackup({
      instanceId: instanceId,
      backupId: backup.id
    }).subscribe({
      next: (response) => {
        if (response.success) {
          if (response.fileData && response.fileName) {
            this.downloadFileFromData(response.fileData, response.fileName, response.mimeType || 'application/zip');
          } else {
            this.notificationService.success(response.message || 'Backup file location opened', 'Download');
          }
        } else {
          // Handle large file warning
          if (response.isLargeFile && response.filePath) {
            this.showLargeFileWarning(response, backup);
          } else {
            this.notificationService.error(response.error || 'Failed to download backup', 'Download Error');
          }
        }
      },
      error: (error) => {
        console.error('Failed to download backup:', error);
        this.notificationService.error('Failed to download backup', 'Download Error');
      }
    });
  }

  /**
   * Show delete backup confirmation modal
   */
  showDeleteBackupModal(backup: any): void {
    const currentState = this.currentState;
    this.stateSubject.next({
      ...currentState,
      backupToDelete: backup,
      showDeleteBackupModal: true
    });
  }

  /**
   * Hide delete backup modal
   */
  hideDeleteBackupModal(): void {
    const currentState = this.currentState;
    this.stateSubject.next({
      ...currentState,
      backupToDelete: null,
      showDeleteBackupModal: false
    });
  }

  /**
   * Confirm backup deletion
   */
  confirmDeleteBackup(instanceId: string): void {
    const state = this.currentState;
    const backupToDelete = state.backupToDelete;
    
    if (!backupToDelete) return;

    this.backupService.deleteBackup({
      backupId: backupToDelete.id
    }).subscribe({
      next: (response) => {
        if (response.success) {
          this.notificationService.success('Backup deleted successfully', 'Backup');
          this.refreshBackupList(instanceId);
        } else {
          this.notificationService.error(response.error || 'Failed to delete backup', 'Backup Error');
        }
        this.hideDeleteBackupModal();
      },
      error: (error) => {
        console.error('Failed to delete backup:', error);
        this.notificationService.error('Failed to delete backup', 'Backup Error');
        this.hideDeleteBackupModal();
      }
    });
  }

  /**
   * Update backup settings values
   */
  updateBackupSettings(updates: Partial<BackupUIState>): void {
    const currentState = this.currentState;
    this.stateSubject.next({
      ...currentState,
      ...updates
    });
  }

  /**
   * Helper method to download file from data
   */
  private downloadFileFromData(fileData: string, fileName: string, mimeType: string): void {
    try {
      const byteCharacters = atob(fileData);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: mimeType });
      
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download file:', error);
      this.notificationService.error('Failed to download file', 'Download Error');
    }
  }

  /**
   * Show warning dialog for large backup files
   */
  private showLargeFileWarning(response: any, backup: any): void {
    const fileSizeMB = response.fileSizeMB || 'Unknown';
    const filePath = response.filePath || 'Unknown location';
    
    this.notificationService.warning(
      `This backup file (${fileSizeMB}MB) is too large for web download. ` +
      `For large backups, please use the desktop application or access the file directly at: ${filePath}`,
      'Large File Warning'
    );
  }
}