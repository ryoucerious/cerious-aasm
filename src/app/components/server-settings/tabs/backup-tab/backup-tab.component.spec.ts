import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BackupTabComponent } from './backup-tab.component';
import { MessagingService } from '../../../../core/services/messaging/messaging.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { ServerInstanceService } from '../../../../core/services/server-instance.service';
import { GlobalConfigService } from '../../../../core/services/global-config.service';
import { MockMessagingService } from '../../../../../../test/mocks/mock-messaging.service';
import { MockNotificationService } from '../../../../../../test/mocks/mock-notification.service';
import { MockServerInstanceService } from '../../../../../../test/mocks/mock-server-instance.service';
import { MockGlobalConfigService } from '../../../../../../test/mocks/mock-global-config.service';

describe('BackupTabComponent', () => {
  let component: BackupTabComponent;
  let fixture: ComponentFixture<BackupTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BackupTabComponent],
      providers: [
        { provide: MessagingService, useClass: MockMessagingService },
        { provide: NotificationService, useClass: MockNotificationService },
        { provide: ServerInstanceService, useClass: MockServerInstanceService },
        { provide: GlobalConfigService, useClass: MockGlobalConfigService }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(BackupTabComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should emit createManualBackup', () => {
    spyOn(component.createManualBackup, 'emit');
    component.onCreateManualBackup();
    expect(component.createManualBackup.emit).toHaveBeenCalled();
  });

  it('should emit backupScheduleToggle', () => {
    spyOn(component.backupScheduleToggle, 'emit');
    component.onBackupScheduleToggle();
    expect(component.backupScheduleToggle.emit).toHaveBeenCalled();
  });

  it('should emit backupFrequencySelect', () => {
    spyOn(component.backupFrequencySelect, 'emit');
    component.onBackupFrequencySelect('daily');
    expect(component.backupFrequencySelect.emit).toHaveBeenCalledWith('daily');
  });

  it('should emit backupTimeChange', () => {
    spyOn(component.backupTimeChange, 'emit');
    const event = new Event('change');
    component.onBackupTimeChange(event);
    expect(component.backupTimeChange.emit).toHaveBeenCalledWith(event);
  });

  it('should emit backupDaySelect', () => {
    spyOn(component.backupDaySelect, 'emit');
    component.onBackupDaySelect(2);
    expect(component.backupDaySelect.emit).toHaveBeenCalledWith(2);
  });

  it('should emit maxBackupsToKeepChange', () => {
    spyOn(component.maxBackupsToKeepChange, 'emit');
    const event = new Event('change');
    component.onMaxBackupsToKeepChange(event);
    expect(component.maxBackupsToKeepChange.emit).toHaveBeenCalledWith(event);
  });

  it('should emit restoreBackup', () => {
    spyOn(component.restoreBackup, 'emit');
    const backup = { id: 1 };
    component.onRestoreBackup(backup);
    expect(component.restoreBackup.emit).toHaveBeenCalledWith(backup);
  });

  it('should emit downloadBackup', () => {
    spyOn(component.downloadBackup, 'emit');
    const backup = { id: 2 };
    component.onDownloadBackup(backup);
    expect(component.downloadBackup.emit).toHaveBeenCalledWith(backup);
  });

  it('should emit deleteBackup', () => {
    spyOn(component.deleteBackup, 'emit');
    const backup = { id: 3 };
    component.onDeleteBackup(backup);
    expect(component.deleteBackup.emit).toHaveBeenCalledWith(backup);
  });

  it('should emit validateField', () => {
    spyOn(component.validateField, 'emit');
    component.onValidateField('backupSetting', true);
    expect(component.validateField.emit).toHaveBeenCalledWith({key: 'backupSetting', value: true});
  });

  it('should emit toggleBackupFrequencyDropdown', () => {
    spyOn(component.toggleBackupFrequencyDropdown, 'emit');
    component.onToggleBackupFrequencyDropdown();
    expect(component.toggleBackupFrequencyDropdown.emit).toHaveBeenCalled();
  });

  it('should emit toggleBackupDayDropdown', () => {
    spyOn(component.toggleBackupDayDropdown, 'emit');
    component.onToggleBackupDayDropdown();
    expect(component.toggleBackupDayDropdown.emit).toHaveBeenCalled();
  });

  it('should get backup frequency display name', () => {
    expect(component.getBackupFrequencyDisplayName('hourly')).toBe('Every Hour');
    expect(component.getBackupFrequencyDisplayName('daily')).toBe('Daily');
    expect(component.getBackupFrequencyDisplayName('weekly')).toBe('Weekly');
    expect(component.getBackupFrequencyDisplayName('other')).toBe('other');
  });

  it('should get backup frequency options', () => {
    const options = component.getBackupFrequencyOptions();
    expect(options.length).toBe(3);
  });

  it('should get backup day display name', () => {
    expect(component.getBackupDayDisplayName(0)).toBe('Sunday');
    expect(component.getBackupDayDisplayName(6)).toBe('Saturday');
    expect(component.getBackupDayDisplayName(99)).toContain('Day');
  });

  it('should get backup day options', () => {
    const options = component.getBackupDayOptions();
    expect(options.length).toBe(7);
  });

  it('should format file size', () => {
    expect(component.formatFileSize(0)).toBe('0 Bytes');
    expect(component.formatFileSize(1024)).toBe('1 KB');
    expect(component.formatFileSize(1048576)).toBe('1 MB');
  });

  it('should format date', () => {
    expect(component.getFormattedDate(null)).toBe('Unknown');
    expect(typeof component.getFormattedDate(Date.now())).toBe('string');
  });

  it('should track by backup id', () => {
    const backup = { id: 42 };
    expect(component.trackByBackupId(0, backup)).toBe(42);
    expect(component.trackByBackupId(1, null)).toBe(1);
  });

  it('should return false for hasFieldError and hasFieldWarning', () => {
    expect(component.hasFieldError('backupSetting')).toBeFalse();
    expect(component.hasFieldWarning('backupSetting')).toBeFalse();
  });

  it('should return empty string for getFieldError and getFieldWarning', () => {
    expect(component.getFieldError('backupSetting')).toBe('');
    expect(component.getFieldWarning('backupSetting')).toBe('');
  });
});
