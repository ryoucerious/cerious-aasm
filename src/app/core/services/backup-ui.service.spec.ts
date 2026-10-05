import { ChangeDetectorRef } from '@angular/core';
import { EMPTY, NEVER, Subject, of, throwError } from 'rxjs';
import { BackupUIService } from './backup-ui.service';
import { MessagingService } from './messaging/messaging.service';
import { BackupService } from './backup.service';
import { NotificationService } from './notification.service';
import { BackupCreateRequest, BackupListResponse, BackupMetadata, BackupOperationResponse, BackupSettings } from '../interfaces/backup.interface';

function backupMeta(overrides: Partial<BackupMetadata> = {}): BackupMetadata {
  return {
    id: 'bid',
    instanceId: 'instanceId',
    name: 'backup1',
    createdAt: new Date(),
    size: 123,
    type: 'manual',
    filePath: '/fake/path.zip',
    ...overrides
  };
}

describe('BackupUIService', () => {
  let service: BackupUIService;
  let messaging: jasmine.SpyObj<MessagingService>;
  let backup: jasmine.SpyObj<BackupService>;
  let notification: jasmine.SpyObj<NotificationService>;
  let cdr: jasmine.SpyObj<ChangeDetectorRef>;

  beforeEach(() => {
    messaging = jasmine.createSpyObj('MessagingService', ['sendMessage', 'receiveMessage']);
    backup = jasmine.createSpyObj('BackupService', [
      'createBackup',
      'getBackupList',
      'restoreBackup',
      'deleteBackup',
      'downloadBackup',
      'saveBackupSettings',
      'startBackupScheduler',
      'stopBackupScheduler',
      'getBackupSettings'
    ]);
    notification = jasmine.createSpyObj('NotificationService', ['success', 'error', 'info', 'warning']);
    cdr = jasmine.createSpyObj('ChangeDetectorRef', ['markForCheck']);
    messaging.receiveMessage.and.returnValue(EMPTY);
    backup.getBackupList.and.returnValue(of({ success: true, backups: [] }));
    service = new BackupUIService(backup, notification, messaging);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should show backup name modal and update state', () => {
    service.showBackupNameModal();
    expect(service.currentState.showBackupNameModal).toBeTrue();
    expect(service.currentState.backupName).toContain('backup_');
  });

  it('should update backup name', () => {
    service.updateBackupName('newName');
    expect(service.currentState.backupName).toBe('newName');
  });

  it('should hide backup name modal and clear name', () => {
    service.hideBackupNameModal();
    expect(service.currentState.showBackupNameModal).toBeFalse();
    expect(service.currentState.backupName).toBe('');
  });

  describe('across servers', () => {
    let created: Subject<{ instanceId?: string }>;
    const weekly = (instanceId: string) =>
      ({ instanceId, enabled: true, frequency: 'weekly', time: '03:00', dayOfWeek: 2, maxBackupsToKeep: 5 } as const);

    beforeEach(() => {
      created = new Subject();
      messaging.receiveMessage.and.returnValue(created);
      service = new BackupUIService(backup, notification, messaging);
    });

    it('reloads the list when a backup of the shown server is created elsewhere', () => {
      service.refreshBackupList('A');
      backup.getBackupList.calls.reset();
      created.next({ instanceId: 'A' });
      expect(backup.getBackupList).toHaveBeenCalledOnceWith('A');
    });

    it('ignores backups created for another server', () => {
      service.refreshBackupList('A');
      backup.getBackupList.calls.reset();
      created.next({ instanceId: 'B' });
      expect(backup.getBackupList).not.toHaveBeenCalled();
    });

    it('drops a backup list that arrives after the page moved to another server', () => {
      const lateA = new Subject<BackupListResponse>();
      const listB = [backupMeta({ id: 'b1', instanceId: 'B' })];
      backup.getBackupList.and.callFake((id: string) => id === 'A' ? lateA : of({ success: true, backups: listB }));

      service.refreshBackupList('A');
      service.refreshBackupList('B');
      lateA.next({ success: true, backups: [backupMeta({ id: 'a1', instanceId: 'A' })] });

      expect(service.currentState.backupList).toEqual(listB);
    });

    it('drops backup settings that arrive after the page moved on, so a save cannot copy them over', () => {
      const lateA = new Subject<{ success: boolean; settings?: BackupSettings }>();
      backup.getBackupSettings.and.callFake((id: string) => id === 'A' ? lateA : NEVER);
      backup.saveBackupSettings.and.returnValue(of({ success: true }));
      backup.stopBackupScheduler.and.returnValue(of({ success: true }));

      service.loadBackupSettings('A');
      service.loadBackupSettings('B');
      lateA.next({ success: true, settings: weekly('A') });
      service.saveBackupSettings('B');

      expect(backup.saveBackupSettings).toHaveBeenCalledOnceWith(jasmine.objectContaining({
        instanceId: 'B', enabled: false, frequency: 'daily'
      }));
    });

    it('forgets the previous server\'s list, schedule and pending delete when another is shown', () => {
      backup.getBackupSettings.and.returnValue(of({ success: true, settings: weekly('A') }));
      backup.getBackupList.and.returnValue(of({ success: true, backups: [backupMeta({ instanceId: 'A' })] }));
      service.loadBackupSettings('A');
      service.refreshBackupList('A');
      service.showDeleteBackupModal(backupMeta({ instanceId: 'A' }));

      backup.getBackupSettings.and.returnValue(NEVER);
      backup.getBackupList.and.returnValue(NEVER);
      service.loadBackupSettings('B');

      expect(service.currentState.backupList).toEqual([]);
      expect(service.currentState.backupScheduleEnabled).toBeFalse();
      expect(service.currentState.backupFrequency).toBe('daily');
      expect(service.currentState.showDeleteBackupModal).toBeFalse();
      expect(service.currentState.backupToDelete).toBeNull();
    });

    it('keeps the state when the same server is loaded again', () => {
      backup.getBackupList.and.returnValue(of({ success: true, backups: [backupMeta({ instanceId: 'A' })] }));
      service.refreshBackupList('A');
      backup.getBackupSettings.and.returnValue(NEVER);
      service.loadBackupSettings('A');
      expect(service.currentState.backupList.length).toBe(1);
    });

    it('closes the backup name dialog and stops waiting for a backup when another server is shown', () => {
      backup.createBackup.and.returnValue(NEVER);
      service.refreshBackupList('A');
      service.showBackupNameModal();
      service.createManualBackup('A', cdr);
      expect(service.currentState.isCreatingBackup).toBeTrue();

      service.refreshBackupList('B');

      expect(service.currentState.isCreatingBackup).toBeFalse();
      expect(service.currentState.showBackupNameModal).toBeFalse();
      expect(service.currentState.backupName).toBe('');
    });

    it('leaves a backup name dialog opened for the shown server alone when it is loaded again', () => {
      service.refreshBackupList('A');
      service.showBackupNameModal();
      service.refreshBackupList('A');
      expect(service.currentState.showBackupNameModal).toBeTrue();
    });

    describe('a backup started for the previous server', () => {
      let lateA: Subject<BackupOperationResponse>;

      beforeEach(() => {
        spyOn(console, 'error');
        lateA = new Subject<BackupOperationResponse>();
        backup.createBackup.and.returnValue(lateA);
        service.refreshBackupList('A');
        service.createManualBackup('A', cdr);
        service.refreshBackupList('B');
        service.showBackupNameModal();
        backup.getBackupList.calls.reset();
      });

      it('still reports that it finished, without touching the dialog or list of the shown server', () => {
        lateA.next({ success: true });

        expect(notification.success).toHaveBeenCalledWith('Backup created successfully', 'Backup');
        expect(service.currentState.showBackupNameModal).toBeTrue();
        expect(backup.getBackupList).not.toHaveBeenCalled();
      });

      it('still reports that the backend refused it', () => {
        lateA.next({ success: false, error: 'Disk full' });

        expect(notification.error).toHaveBeenCalledWith('Disk full', 'Backup Error');
        expect(service.currentState.showBackupNameModal).toBeTrue();
      });

      it('still reports that it never answered', () => {
        lateA.error(new Error('Timeout has occurred'));

        expect(notification.error).toHaveBeenCalledWith('Failed to create backup', 'Backup Error');
        expect(service.currentState.showBackupNameModal).toBeTrue();
      });
    });

    it('does not let a backup for the previous server end the wait for the shown server\'s', () => {
      const lateA = new Subject<BackupOperationResponse>();
      const replyB = new Subject<BackupOperationResponse>();
      backup.createBackup.and.callFake((request: BackupCreateRequest) => request.instanceId === 'A' ? lateA : replyB);
      service.refreshBackupList('A');
      service.createManualBackup('A', cdr);
      service.refreshBackupList('B');
      service.createManualBackup('B', cdr);

      lateA.next({ success: true });

      expect(service.currentState.isCreatingBackup).toBeTrue();
    });

    describe('a delete requested for the previous server', () => {
      let lateA: Subject<BackupOperationResponse>;
      const forB = backupMeta({ id: 'b1', instanceId: 'B' });

      beforeEach(() => {
        spyOn(console, 'error');
        lateA = new Subject<BackupOperationResponse>();
        backup.deleteBackup.and.returnValue(lateA);
        service.refreshBackupList('A');
        service.showDeleteBackupModal(backupMeta({ instanceId: 'A' }));
        service.confirmDeleteBackup('A');
        service.refreshBackupList('B');
        service.showDeleteBackupModal(forB);
        backup.getBackupList.calls.reset();
      });

      it('still reports that it finished, without touching the dialog or list of the shown server', () => {
        lateA.next({ success: true });

        expect(notification.success).toHaveBeenCalledWith('Backup deleted successfully', 'Backup');
        expect(service.currentState.showDeleteBackupModal).toBeTrue();
        expect(service.currentState.backupToDelete).toEqual(forB);
        expect(backup.getBackupList).not.toHaveBeenCalled();
      });

      it('still reports that the backend refused it', () => {
        lateA.next({ success: false, error: 'File in use' });

        expect(notification.error).toHaveBeenCalledWith('File in use', 'Backup Error');
        expect(service.currentState.showDeleteBackupModal).toBeTrue();
        expect(service.currentState.backupToDelete).toEqual(forB);
      });

      it('still reports that it never answered', () => {
        lateA.error(new Error('Timeout has occurred'));

        expect(notification.error).toHaveBeenCalledWith('Failed to delete backup', 'Backup Error');
        expect(service.currentState.showDeleteBackupModal).toBeTrue();
        expect(service.currentState.backupToDelete).toEqual(forB);
      });
    });
  });

  describe('failed requests', () => {
    beforeEach(() => spyOn(console, 'error'));

    it('reports a backup list that could not be loaded', () => {
      backup.getBackupList.and.returnValue(throwError(() => new Error('Timeout has occurred')));
      service.refreshBackupList('instanceId');
      expect(notification.error).toHaveBeenCalledWith('Failed to load backups', 'Backup Error');
    });

    it('reports backup settings that could not be loaded', () => {
      backup.getBackupSettings.and.returnValue(throwError(() => new Error('Timeout has occurred')));
      service.loadBackupSettings('instanceId');
      expect(notification.error).toHaveBeenCalledWith('Failed to load backup settings', 'Settings Error');
    });

    it('reports backup settings that could not be saved', () => {
      backup.saveBackupSettings.and.returnValue(throwError(() => new Error('Timeout has occurred')));
      service.saveBackupSettings('instanceId');
      expect(notification.error).toHaveBeenCalledWith('Failed to save backup settings', 'Settings Error');
    });

    it('reports a backup schedule that could not be started', () => {
      backup.saveBackupSettings.and.returnValue(of({ success: true }));
      backup.startBackupScheduler.and.returnValue(of({ success: false, error: 'Invalid schedule' }));
      service.updateBackupSettings({ backupScheduleEnabled: true });
      service.saveBackupSettings('instanceId');
      expect(notification.error).toHaveBeenCalledWith('Invalid schedule', 'Settings Error');
    });

    it('reports a backup schedule start request that failed', () => {
      backup.saveBackupSettings.and.returnValue(of({ success: true }));
      backup.startBackupScheduler.and.returnValue(throwError(() => new Error('Timeout has occurred')));
      service.updateBackupSettings({ backupScheduleEnabled: true });
      service.saveBackupSettings('instanceId');
      expect(notification.error).toHaveBeenCalledWith('Failed to start the backup schedule', 'Settings Error');
    });

    it('reports a backup schedule that could not be stopped', () => {
      backup.saveBackupSettings.and.returnValue(of({ success: true }));
      backup.stopBackupScheduler.and.returnValue(throwError(() => new Error('Timeout has occurred')));
      service.updateBackupSettings({ backupScheduleEnabled: false });
      service.saveBackupSettings('instanceId');
      expect(notification.error).toHaveBeenCalledWith('Failed to stop the backup schedule', 'Settings Error');
    });
  });

  it('should create manual backup and update state', () => {
    backup.createBackup.and.returnValue(of({ success: true }));
    service.refreshBackupList('instanceId');
    service.updateBackupName('manualName');
    service.createManualBackup('instanceId', cdr);
    expect(backup.createBackup).toHaveBeenCalledWith({ instanceId: 'instanceId', type: 'manual', name: 'manualName' });
    expect(service.currentState.isCreatingBackup).toBeFalse();
    expect(notification.success).toHaveBeenCalledWith('Backup created successfully', 'Backup');
  });

  it('should handle error in createManualBackup', () => {
    backup.createBackup.and.returnValue(throwError(() => 'fail'));
    spyOn(console, 'error');
    service.refreshBackupList('instanceId');
    service.createManualBackup('instanceId', cdr);
    expect(notification.error).toHaveBeenCalledWith('Failed to create backup', 'Backup Error');
    expect(cdr.markForCheck).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
    expect(service.currentState.isCreatingBackup).toBeFalse();
  });

  it('should handle failed response in createManualBackup', () => {
    backup.createBackup.and.returnValue(of({ success: false, error: 'fail' }));
    service.refreshBackupList('instanceId');
    service.createManualBackup('instanceId', cdr);
    expect(notification.error).toHaveBeenCalledWith('fail', 'Backup Error');
    expect(cdr.markForCheck).toHaveBeenCalled();
  });

  it('should refresh backup list and update state', () => {
    const meta = backupMeta();
    backup.getBackupList.and.returnValue(of({ success: true, backups: [meta] }));
    service.refreshBackupList('instanceId');
    expect(service.currentState.backupList).toEqual([meta]);
  });

  it('should not update backup list if response is unsuccessful', () => {
    backup.getBackupList.and.returnValue(of({ success: false }));
    spyOn(service, 'updateBackupList');
    service.refreshBackupList('instanceId');
    expect(service.updateBackupList).not.toHaveBeenCalled();
  });

  it('should load backup settings and update state', () => {
    const settings = { instanceId: 'instanceId', enabled: true, frequency: 'weekly', time: '03:00', dayOfWeek: 2, maxBackupsToKeep: 5 } as const;
    backup.getBackupSettings.and.returnValue(of({ success: true, settings }));
    service.loadBackupSettings('instanceId');
    expect(service.currentState.backupScheduleEnabled).toBeTrue();
    expect(service.currentState.backupFrequency).toBe('weekly');
    expect(service.currentState.backupTime).toBe('03:00');
    expect(service.currentState.backupDayOfWeek).toBe(2);
    expect(service.currentState.maxBackupsToKeep).toBe(5);
  });

  it('keeps Sunday as the backup day', () => {
    const settings = { instanceId: 'instanceId', enabled: true, frequency: 'weekly', time: '03:00', dayOfWeek: 0, maxBackupsToKeep: 5 } as const;
    backup.getBackupSettings.and.returnValue(of({ success: true, settings }));
    service.loadBackupSettings('instanceId');
    expect(service.currentState.backupDayOfWeek).toBe(0);
  });

  it('should save backup settings and start scheduler if enabled', () => {
    backup.saveBackupSettings.and.returnValue(of({ success: true }));
    backup.startBackupScheduler.and.returnValue(of({ success: true }));
    service.updateBackupSettings({ backupScheduleEnabled: true });
    service.saveBackupSettings('instanceId');
    expect(notification.success).toHaveBeenCalledWith('Backup settings saved successfully', 'Settings');
    expect(backup.startBackupScheduler).toHaveBeenCalledWith('instanceId');
  });

  it('should save backup settings and stop scheduler if disabled', () => {
    backup.saveBackupSettings.and.returnValue(of({ success: true }));
    backup.stopBackupScheduler.and.returnValue(of({ success: true }));
    service.updateBackupSettings({ backupScheduleEnabled: false });
    service.saveBackupSettings('instanceId');
    expect(notification.success).toHaveBeenCalledWith('Backup settings saved successfully', 'Settings');
    expect(backup.stopBackupScheduler).toHaveBeenCalledWith('instanceId');
  });

  it('should show error if saveBackupSettings fails', () => {
    backup.saveBackupSettings.and.returnValue(of({ success: false, error: 'fail' }));
    service.saveBackupSettings('instanceId');
    expect(notification.error).toHaveBeenCalledWith('fail', 'Settings Error');
  });

  it('should not restore backup if backup is null', () => {
    spyOn(window, 'confirm');
    service.restoreBackup('instanceId', null);
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('should restore backup if confirmed and show success', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    backup.restoreBackup.and.returnValue(of({ success: true }));
    service.restoreBackup('instanceId', backupMeta());
    expect(backup.restoreBackup).toHaveBeenCalledWith({ instanceId: 'instanceId', backupId: 'bid' });
    expect(notification.success).toHaveBeenCalledWith('Backup restored successfully', 'Backup');
  });

  it('should show error if restoreBackup fails', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    backup.restoreBackup.and.returnValue(of({ success: false, error: 'fail' }));
    service.restoreBackup('instanceId', backupMeta());
    expect(notification.error).toHaveBeenCalledWith('fail', 'Backup Error');
  });

  it('reports a restore that never answered', () => {
    spyOn(window, 'confirm').and.returnValue(true);
    spyOn(console, 'error');
    backup.restoreBackup.and.returnValue(throwError(() => new Error('Timeout has occurred')));
    service.restoreBackup('instanceId', backupMeta());
    expect(notification.error).toHaveBeenCalledWith('Failed to restore backup', 'Backup Error');
  });

  it('should not restore backup if not confirmed', () => {
    spyOn(window, 'confirm').and.returnValue(false);
    backup.restoreBackup.and.returnValue(of({ success: true }));
    service.restoreBackup('instanceId', backupMeta());
    expect(backup.restoreBackup).not.toHaveBeenCalled();
  });

  it('should not download backup if backup is null', () => {
    service.downloadBackup('instanceId', null);
    expect(backup.downloadBackup).not.toHaveBeenCalled();
  });

  it('saves the returned file data as a download', () => {
    const anchor = jasmine.createSpyObj<HTMLAnchorElement>('HTMLAnchorElement', ['click']);
    spyOn(document, 'createElement').and.returnValue(anchor);
    spyOn(document.body, 'appendChild');
    spyOn(document.body, 'removeChild');
    spyOn(URL, 'createObjectURL').and.returnValue('blob:url');
    spyOn(URL, 'revokeObjectURL');
    backup.downloadBackup.and.returnValue(of({ success: true, fileData: 'ZmFrZQ==', fileName: 'file.zip', mimeType: 'application/zip' }));

    service.downloadBackup('instanceId', backupMeta());

    expect(anchor.download).toBe('file.zip');
    expect(anchor.click).toHaveBeenCalled();
  });

  it('reports file data that cannot be decoded', () => {
    spyOn(console, 'error');
    backup.downloadBackup.and.returnValue(of({ success: true, fileData: '!!!notbase64', fileName: 'file.zip' }));
    service.downloadBackup('instanceId', backupMeta());
    expect(notification.error).toHaveBeenCalledWith('Failed to download file', 'Download Error');
  });

  it('should show success if downloadBackup returns message', () => {
    backup.downloadBackup.and.returnValue(of({ success: true, message: 'opened' }));
    service.downloadBackup('instanceId', backupMeta());
    expect(notification.success).toHaveBeenCalledWith('opened', 'Download');
  });

  it('should show large file warning if isLargeFile', () => {
    backup.downloadBackup.and.returnValue(of({ success: false, isLargeFile: true, filePath: '/path', fileSizeMB: 123 }));
    service.downloadBackup('instanceId', backupMeta());
    expect(notification.warning).toHaveBeenCalledWith(jasmine.stringContaining('(123MB) is too large'), 'Large File Warning');
  });

  it('should show error if downloadBackup fails', () => {
    backup.downloadBackup.and.returnValue(of({ success: false, error: 'fail' }));
    service.downloadBackup('instanceId', backupMeta());
    expect(notification.error).toHaveBeenCalledWith('fail', 'Download Error');
  });

  it('should handle error in downloadBackup observable', () => {
    backup.downloadBackup.and.returnValue(throwError(() => 'fail'));
    spyOn(console, 'error');
    service.downloadBackup('instanceId', backupMeta());
    expect(notification.error).toHaveBeenCalledWith('Failed to download backup', 'Download Error');
    expect(console.error).toHaveBeenCalled();
  });

  it('should show and hide delete backup modal', () => {
    const meta = backupMeta();
    service.showDeleteBackupModal(meta);
    expect(service.currentState.showDeleteBackupModal).toBeTrue();
    expect(service.currentState.backupToDelete).toEqual(meta);

    service.hideDeleteBackupModal();
    expect(service.currentState.showDeleteBackupModal).toBeFalse();
    expect(service.currentState.backupToDelete).toBeNull();
  });

  it('should not confirmDeleteBackup if backupToDelete is null', () => {
    service.updateBackupSettings({ backupToDelete: null });
    service.confirmDeleteBackup('instanceId');
    expect(backup.deleteBackup).not.toHaveBeenCalled();
  });

  it('should confirmDeleteBackup and show success', () => {
    backup.deleteBackup.and.returnValue(of({ success: true }));
    service.refreshBackupList('instanceId');
    service.showDeleteBackupModal(backupMeta());
    service.confirmDeleteBackup('instanceId');
    expect(backup.deleteBackup).toHaveBeenCalledWith({ instanceId: 'instanceId', backupId: 'bid' });
    expect(notification.success).toHaveBeenCalledWith('Backup deleted successfully', 'Backup');
  });

  it('should show error if confirmDeleteBackup fails', () => {
    backup.deleteBackup.and.returnValue(of({ success: false, error: 'fail' }));
    service.refreshBackupList('instanceId');
    service.showDeleteBackupModal(backupMeta());
    service.confirmDeleteBackup('instanceId');
    expect(notification.error).toHaveBeenCalledWith('fail', 'Backup Error');
  });

  it('should handle error in confirmDeleteBackup observable', () => {
    backup.deleteBackup.and.returnValue(throwError(() => 'fail'));
    spyOn(console, 'error');
    service.refreshBackupList('instanceId');
    service.showDeleteBackupModal(backupMeta());
    service.confirmDeleteBackup('instanceId');
    expect(notification.error).toHaveBeenCalledWith('Failed to delete backup', 'Backup Error');
    expect(console.error).toHaveBeenCalled();
  });
});
