import { BackupUIService } from './backup-ui.service';
import { MessagingService } from './messaging/messaging.service';
import { BackupService } from './backup.service';
import { NotificationService } from './notification.service';
import { of, throwError } from 'rxjs';
describe('BackupUIService', () => {
  let service: BackupUIService;
  let messaging: jasmine.SpyObj<MessagingService>;
  let backup: jasmine.SpyObj<BackupService>;
  let notification: jasmine.SpyObj<NotificationService>;
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
  messaging.receiveMessage.and.returnValue(of());
    backup.getBackupList.and.returnValue(of({ success: true, backups: [] }));
    service = new BackupUIService(backup, notification, messaging);
  });
  it('should be created', () => {
    expect(service).toBeTruthy();
  });
  it('should show backup name modal and update state', () => {
    service.showBackupNameModal();
    service.state$.subscribe(state => {
      expect(state.showBackupNameModal).toBeTrue();
      expect(state.backupName).toContain('backup_');
    });
  });

  it('should update backup name', () => {
    service.updateBackupName('newName');
    service.state$.subscribe(state => {
      expect(state.backupName).toBe('newName');
    });
  });

  it('should hide backup name modal and clear name', () => {
    service.hideBackupNameModal();
    service.state$.subscribe(state => {
      expect(state.showBackupNameModal).toBeFalse();
      expect(state.backupName).toBe('');
    });
  });

  it('should handle backup-created event and call refreshBackupList', () => {
    backup.getBackupList.and.returnValue(of({ success: true, backups: [] }));
    messaging.receiveMessage.and.returnValue(of({ instanceId: 'id' }));
    const spy = spyOn(BackupUIService.prototype, 'refreshBackupList').and.callFake(() => {});
    service = new BackupUIService(backup, notification, messaging);
    expect(spy).toHaveBeenCalledWith('id');
  });

  afterAll(() => {
    // Clean up spies
    jasmine.getEnv().allowRespy(true);
  });

  it('should create manual backup and update state', (done) => {
    backup.createBackup.and.returnValue(of({ success: true }));
    backup.getBackupList.and.returnValue(of({ success: true, backups: [] }));
    const cdr = {
      detectChanges: jasmine.createSpy('detectChanges'),
      markForCheck: jasmine.createSpy('markForCheck')
    } as any;
    service.updateBackupName('manualName');
    service.createManualBackup('instanceId', cdr);
    service.state$.subscribe(state => {
      if (!state.isCreatingBackup) {
        expect(backup.createBackup).toHaveBeenCalledWith({ instanceId: 'instanceId', type: 'manual', name: 'manualName' });
        expect(state.isCreatingBackup).toBeFalse();
        done();
      }
    });
  });

    it('should handle error in createManualBackup', (done) => {
      backup.createBackup.and.returnValue(throwError(() => 'fail'));
      const cdr = { markForCheck: jasmine.createSpy('markForCheck') } as any;
      service.updateBackupName('manualName');
      spyOn(console, 'error');
      service.createManualBackup('instanceId', cdr);
      setTimeout(() => {
        expect(notification.error).toHaveBeenCalledWith('Failed to create backup', 'Backup Error');
        expect(cdr.markForCheck).toHaveBeenCalled();
        expect(console.error).toHaveBeenCalled();
        done();
      }, 10);
    });

    it('should handle failed response in createManualBackup', (done) => {
      backup.createBackup.and.returnValue(of({ success: false, error: 'fail' }));
      backup.getBackupList.and.returnValue(of({ success: true, backups: [] }));
      const cdr = { markForCheck: jasmine.createSpy('markForCheck') } as any;
      service.updateBackupName('manualName');
      service.createManualBackup('instanceId', cdr);
      setTimeout(() => {
        expect(notification.error).toHaveBeenCalledWith('fail', 'Backup Error');
        expect(cdr.markForCheck).toHaveBeenCalled();
        done();
      }, 10);
    });

    it('should refresh backup list and update state', () => {
      const backupMeta = {
        id: '1',
        instanceId: 'instanceId',
        name: 'backup1',
        createdAt: new Date(),
        size: 123,
        type: 'manual' as 'manual',
        status: 'complete',
        filePath: '/fake/path.zip'
      };
      backup.getBackupList.and.returnValue(of({ success: true, backups: [backupMeta] }));
      service.refreshBackupList('instanceId');
      service.state$.subscribe(state => {
        expect(state.backupList).toEqual([backupMeta]);
      });
    });

    it('should not update backup list if response is unsuccessful', () => {
      backup.getBackupList.and.returnValue(of({ success: false }));
      service.updateBackupList = jasmine.createSpy('updateBackupList');
      service.refreshBackupList('instanceId');
      expect(service.updateBackupList).not.toHaveBeenCalled();
    });

    it('should load backup settings and update state', () => {
      const settings = {
        instanceId: 'instanceId',
        enabled: true,
        frequency: 'weekly',
        time: '03:00',
        dayOfWeek: 2,
        maxBackupsToKeep: 5
      } as any; // Cast as any to allow union type for frequency
      backup.getBackupSettings.and.returnValue(of({ success: true, settings }));
      service.loadBackupSettings('instanceId');
      service.state$.subscribe(state => {
        expect(state.backupScheduleEnabled).toBeTrue();
        expect(state.backupFrequency).toBe('weekly');
        expect(state.backupTime).toBe('03:00');
        expect(state.backupDayOfWeek).toBe(2);
        expect(state.maxBackupsToKeep).toBe(5);
      });
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
      service.restoreBackup('instanceId', { id: 'bid', name: 'backup1' });
      expect(notification.success).toHaveBeenCalledWith('Backup restored successfully', 'Backup');
    });

    it('should show error if restoreBackup fails', () => {
      spyOn(window, 'confirm').and.returnValue(true);
      backup.restoreBackup.and.returnValue(of({ success: false, error: 'fail' }));
      service.restoreBackup('instanceId', { id: 'bid', name: 'backup1' });
      expect(notification.error).toHaveBeenCalledWith('fail', 'Backup Error');
    });

    it('should not restore backup if not confirmed', () => {
      spyOn(window, 'confirm').and.returnValue(false);
      backup.restoreBackup.and.returnValue(of({ success: true }));
      service.restoreBackup('instanceId', { id: 'bid', name: 'backup1' });
      expect(backup.restoreBackup).not.toHaveBeenCalled();
    });

    it('should not download backup if backup is null', () => {
      service.downloadBackup('instanceId', null);
      expect(backup.downloadBackup).not.toHaveBeenCalled();
    });

    it('should download backup and call downloadFileFromData for fileData', () => {
      backup.downloadBackup = jasmine.createSpy().and.returnValue(of({ success: true, fileData: 'ZmFrZQ==', fileName: 'file.zip', mimeType: 'application/zip' }));
      spyOn<any>(service, 'downloadFileFromData').and.callThrough();
      service.downloadBackup('instanceId', { id: 'bid' });
      expect(service['downloadFileFromData']).toHaveBeenCalledWith('ZmFrZQ==', 'file.zip', 'application/zip');
    });

    it('should show success if downloadBackup returns message', () => {
      backup.downloadBackup = jasmine.createSpy().and.returnValue(of({ success: true, message: 'opened' }));
      service.downloadBackup('instanceId', { id: 'bid' });
      expect(notification.success).toHaveBeenCalledWith('opened', 'Download');
    });

    it('should show large file warning if isLargeFile', () => {
      backup.downloadBackup = jasmine.createSpy().and.returnValue(of({ success: false, isLargeFile: true, filePath: '/path', fileSizeMB: 123 }));
      spyOn<any>(service, 'showLargeFileWarning').and.callThrough();
      service.downloadBackup('instanceId', { id: 'bid' });
      expect(service['showLargeFileWarning']).toHaveBeenCalledWith(jasmine.objectContaining({ isLargeFile: true }), { id: 'bid' });
    });

    it('should show error if downloadBackup fails', () => {
      backup.downloadBackup = jasmine.createSpy().and.returnValue(of({ success: false, error: 'fail' }));
      service.downloadBackup('instanceId', { id: 'bid' });
      expect(notification.error).toHaveBeenCalledWith('fail', 'Download Error');
    });

    it('should handle error in downloadBackup observable', () => {
      backup.downloadBackup = jasmine.createSpy().and.returnValue({ subscribe: ({ error }: any) => error('fail') });
      spyOn(console, 'error');
      service.downloadBackup('instanceId', { id: 'bid' });
      expect(notification.error).toHaveBeenCalledWith('Failed to download backup', 'Download Error');
      expect(console.error).toHaveBeenCalled();
    });

    it('should show and hide delete backup modal', () => {
      service.showDeleteBackupModal({ id: 'bid' });
      let state = (service as any).stateSubject.getValue();
      expect(state.showDeleteBackupModal).toBeTrue();
      expect(state.backupToDelete).toEqual({ id: 'bid' });

      service.hideDeleteBackupModal();
      state = (service as any).stateSubject.getValue();
      expect(state.showDeleteBackupModal).toBeFalse();
      expect(state.backupToDelete).toBeNull();
    });

    it('should not confirmDeleteBackup if backupToDelete is null', () => {
      service.updateBackupSettings({ backupToDelete: null });
      service.confirmDeleteBackup('instanceId');
      expect(backup.deleteBackup).not.toHaveBeenCalled();
    });

    it('should confirmDeleteBackup and show success', () => {
      backup.deleteBackup.and.returnValue(of({ success: true }));
      service.showDeleteBackupModal({ id: 'bid' });
      service.confirmDeleteBackup('instanceId');
      expect(notification.success).toHaveBeenCalledWith('Backup deleted successfully', 'Backup');
    });

    it('should show error if confirmDeleteBackup fails', () => {
      backup.deleteBackup.and.returnValue(of({ success: false, error: 'fail' }));
      service.showDeleteBackupModal({ id: 'bid' });
      service.confirmDeleteBackup('instanceId');
      expect(notification.error).toHaveBeenCalledWith('fail', 'Backup Error');
    });

    it('should handle error in confirmDeleteBackup observable', () => {
      backup.deleteBackup.and.returnValue(throwError(() => 'fail'));
      spyOn(console, 'error');
      service.showDeleteBackupModal({ id: 'bid' });
      service.confirmDeleteBackup('instanceId');
      expect(notification.error).toHaveBeenCalledWith('Failed to delete backup', 'Backup Error');
      expect(console.error).toHaveBeenCalled();
    });
});
