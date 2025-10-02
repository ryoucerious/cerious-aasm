import { BackupService } from './backup.service';
import { MessagingService } from './messaging/messaging.service';
import { UtilityService } from './utility.service';
import { throwError } from 'rxjs';
describe('BackupService', () => {
  let service: BackupService;
  let messaging: jasmine.SpyObj<MessagingService>;
  let utility: jasmine.SpyObj<UtilityService>;
  beforeEach(() => {
    messaging = jasmine.createSpyObj('MessagingService', ['sendMessage', 'receiveMessage']);
    utility = jasmine.createSpyObj('UtilityService', ['getPlatform', 'isArray', 'formatFileSize', 'getFormattedDate', 'downloadFileFromData']);
    service = new BackupService(messaging, utility);
  });
  it('should be created', () => {
    expect(service).toBeTruthy();
  });
  it('should call messaging.sendMessage for createBackup and subscribe', () => {
    const obs = { subscribe: jasmine.createSpy('subscribe') } as any;
    messaging.sendMessage.and.returnValue(obs);
    const req = { instanceId: 'id', type: 'full' } as any;
    const result = service.createBackup(req);
    expect(messaging.sendMessage).toHaveBeenCalledWith('create-backup', req);
    expect(result).toBe(obs);
    result.subscribe();
    expect(obs.subscribe).toHaveBeenCalled();
  });

  it('should propagate errors from createBackup', (done) => {
    messaging.sendMessage.and.returnValue(throwError(() => 'fail'));
    service.createBackup({ instanceId: 'id', type: 'full' } as any).subscribe({
      error: (err: any) => {
        expect(err).toBe('fail');
        done();
      }
    });
  });

  it('should call messaging.sendMessage for getBackupList and subscribe', () => {
    const obs = { subscribe: jasmine.createSpy('subscribe') } as any;
    messaging.sendMessage.and.returnValue(obs);
    const result = service.getBackupList('id');
    expect(messaging.sendMessage).toHaveBeenCalledWith('get-backup-list', { instanceId: 'id' });
    expect(result).toBe(obs);
    result.subscribe();
    expect(obs.subscribe).toHaveBeenCalled();
  });

  it('should propagate errors from getBackupList', (done) => {
    messaging.sendMessage.and.returnValue(throwError(() => 'fail'));
    service.getBackupList('id').subscribe({
      error: (err: any) => {
        expect(err).toBe('fail');
        done();
      }
    });
  });

  it('should call messaging.sendMessage for restoreBackup and subscribe', () => {
    const obs = { subscribe: jasmine.createSpy('subscribe') } as any;
    messaging.sendMessage.and.returnValue(obs);
    const req = { instanceId: 'id', backupId: 'bid' } as any;
    const result = service.restoreBackup(req);
    expect(messaging.sendMessage).toHaveBeenCalledWith('restore-backup', req);
    expect(result).toBe(obs);
    result.subscribe();
    expect(obs.subscribe).toHaveBeenCalled();
  });

  it('should propagate errors from restoreBackup', (done) => {
    messaging.sendMessage.and.returnValue(throwError(() => 'fail'));
    service.restoreBackup({ instanceId: 'id', backupId: 'bid' } as any).subscribe({
      error: (err: any) => {
        expect(err).toBe('fail');
        done();
      }
    });
  });

  it('should call messaging.sendMessage for deleteBackup and subscribe', () => {
    const obs = { subscribe: jasmine.createSpy('subscribe') } as any;
    messaging.sendMessage.and.returnValue(obs);
    const req = { instanceId: 'id', backupId: 'bid' } as any;
    const result = service.deleteBackup(req);
    expect(messaging.sendMessage).toHaveBeenCalledWith('delete-backup', req);
    expect(result).toBe(obs);
    result.subscribe();
    expect(obs.subscribe).toHaveBeenCalled();
  });

  it('should propagate errors from deleteBackup', (done) => {
    messaging.sendMessage.and.returnValue(throwError(() => 'fail'));
    service.deleteBackup({ instanceId: 'id', backupId: 'bid' } as any).subscribe({
      error: (err: any) => {
        expect(err).toBe('fail');
        done();
      }
    });
  });

  it('should call messaging.sendMessage for getBackupSettings and subscribe', () => {
    const obs = { subscribe: jasmine.createSpy('subscribe') } as any;
    messaging.sendMessage.and.returnValue(obs);
    const result = service.getBackupSettings('id');
    expect(messaging.sendMessage).toHaveBeenCalledWith('get-backup-settings', { instanceId: 'id' });
    expect(result).toBe(obs);
    result.subscribe();
    expect(obs.subscribe).toHaveBeenCalled();
  });

  it('should propagate errors from getBackupSettings', (done) => {
    messaging.sendMessage.and.returnValue(throwError(() => 'fail'));
    service.getBackupSettings('id').subscribe({
      error: (err: any) => {
        expect(err).toBe('fail');
        done();
      }
    });
  });

  it('should call messaging.sendMessage for saveBackupSettings and subscribe', () => {
    const obs = { subscribe: jasmine.createSpy('subscribe') } as any;
    messaging.sendMessage.and.returnValue(obs);
    const settings = { instanceId: 'id', foo: 'bar' } as any;
    const result = service.saveBackupSettings(settings);
    expect(messaging.sendMessage).toHaveBeenCalledWith('save-backup-settings', { instanceId: 'id', settings });
    expect(result).toBe(obs);
    result.subscribe();
    expect(obs.subscribe).toHaveBeenCalled();
  });

  it('should propagate errors from saveBackupSettings', (done) => {
    messaging.sendMessage.and.returnValue(throwError(() => 'fail'));
    service.saveBackupSettings({ instanceId: 'id', foo: 'bar' } as any).subscribe({
      error: (err: any) => {
        expect(err).toBe('fail');
        done();
      }
    });
  });

  it('should call messaging.sendMessage for startBackupScheduler and subscribe', () => {
    const obs = { subscribe: jasmine.createSpy('subscribe') } as any;
    messaging.sendMessage.and.returnValue(obs);
    const result = service.startBackupScheduler('id');
    expect(messaging.sendMessage).toHaveBeenCalledWith('start-backup-scheduler', { instanceId: 'id' });
    expect(result).toBe(obs);
    result.subscribe();
    expect(obs.subscribe).toHaveBeenCalled();
  });

  it('should propagate errors from startBackupScheduler', (done) => {
    messaging.sendMessage.and.returnValue(throwError(() => 'fail'));
    service.startBackupScheduler('id').subscribe({
      error: (err: any) => {
        expect(err).toBe('fail');
        done();
      }
    });
  });

  it('should call messaging.sendMessage for stopBackupScheduler and subscribe', () => {
    const obs = { subscribe: jasmine.createSpy('subscribe') } as any;
    messaging.sendMessage.and.returnValue(obs);
    const result = service.stopBackupScheduler('id');
    expect(messaging.sendMessage).toHaveBeenCalledWith('stop-backup-scheduler', { instanceId: 'id' });
    expect(result).toBe(obs);
    result.subscribe();
    expect(obs.subscribe).toHaveBeenCalled();
  });

  it('should propagate errors from stopBackupScheduler', (done) => {
    messaging.sendMessage.and.returnValue(throwError(() => 'fail'));
    service.stopBackupScheduler('id').subscribe({
      error: (err: any) => {
        expect(err).toBe('fail');
        done();
      }
    });
  });

  it('should call messaging.sendMessage for getSchedulerStatus and subscribe', () => {
    const obs = { subscribe: jasmine.createSpy('subscribe') } as any;
    messaging.sendMessage.and.returnValue(obs);
    const result = service.getSchedulerStatus('id');
    expect(messaging.sendMessage).toHaveBeenCalledWith('get-scheduler-status', { instanceId: 'id' });
    expect(result).toBe(obs);
    result.subscribe();
    expect(obs.subscribe).toHaveBeenCalled();
  });

  it('should propagate errors from getSchedulerStatus', (done) => {
    messaging.sendMessage.and.returnValue(throwError(() => 'fail'));
    service.getSchedulerStatus('id').subscribe({
      error: (err: any) => {
        expect(err).toBe('fail');
        done();
      }
    });
  });

  it('should call messaging.sendMessage for downloadBackup with platform and subscribe', () => {
    const obs = { subscribe: jasmine.createSpy('subscribe') } as any;
    messaging.sendMessage.and.returnValue(obs);
    utility.getPlatform.and.returnValue('Electron');
    const req = { instanceId: 'id', backupId: 'bid' };
    const result = service.downloadBackup(req);
    expect(utility.getPlatform).toHaveBeenCalled();
    expect(messaging.sendMessage).toHaveBeenCalledWith('download-backup', { instanceId: 'id', backupId: 'bid', frontendEnvironment: 'electron' });
    expect(result).toBe(obs);
    result.subscribe();
    expect(obs.subscribe).toHaveBeenCalled();
  });

  it('should propagate errors from downloadBackup', (done) => {
    messaging.sendMessage.and.returnValue(throwError(() => 'fail'));
    utility.getPlatform.and.returnValue('Electron');
    service.downloadBackup({ instanceId: 'id', backupId: 'bid' }).subscribe({
      error: (err: any) => {
        expect(err).toBe('fail');
        done();
      }
    });
  });
    it('should call downloadBackup with Web platform', () => {
      const obs = { subscribe: jasmine.createSpy('subscribe') } as any;
      messaging.sendMessage.and.returnValue(obs);
      utility.getPlatform.and.returnValue('Web');
      const req = { instanceId: 'id', backupId: 'bid' };
      const result = service.downloadBackup(req);
      expect(utility.getPlatform).toHaveBeenCalled();
      expect(messaging.sendMessage).toHaveBeenCalledWith('download-backup', { instanceId: 'id', backupId: 'bid', frontendEnvironment: 'web' });
      expect(result).toBe(obs);
      result.subscribe();
      expect(obs.subscribe).toHaveBeenCalled();
    });

    it('should handle missing instanceId in downloadBackup', () => {
      const obs = { subscribe: jasmine.createSpy('subscribe') } as any;
      messaging.sendMessage.and.returnValue(obs);
      utility.getPlatform.and.returnValue('Electron');
      const req = { backupId: 'bid' } as any;
      const result = service.downloadBackup(req);
      expect(messaging.sendMessage).toHaveBeenCalledWith('download-backup', { backupId: 'bid', frontendEnvironment: 'electron' });
      result.subscribe();
      expect(obs.subscribe).toHaveBeenCalled();
    });

    it('should handle missing backupId in downloadBackup', () => {
      const obs = { subscribe: jasmine.createSpy('subscribe') } as any;
      messaging.sendMessage.and.returnValue(obs);
      utility.getPlatform.and.returnValue('Electron');
      const req = { instanceId: 'id' } as any;
      const result = service.downloadBackup(req);
      expect(messaging.sendMessage).toHaveBeenCalledWith('download-backup', { instanceId: 'id', frontendEnvironment: 'electron' });
      result.subscribe();
      expect(obs.subscribe).toHaveBeenCalled();
    });

    it('should handle completely empty request in downloadBackup', () => {
      const obs = { subscribe: jasmine.createSpy('subscribe') } as any;
      messaging.sendMessage.and.returnValue(obs);
      utility.getPlatform.and.returnValue('Electron');
      const req = {} as any;
      const result = service.downloadBackup(req);
      expect(messaging.sendMessage).toHaveBeenCalledWith('download-backup', { frontendEnvironment: 'electron' });
      result.subscribe();
      expect(obs.subscribe).toHaveBeenCalled();
    });
});
