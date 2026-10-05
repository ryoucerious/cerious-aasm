import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BackupTabComponent } from './backup-tab.component';
import { BackupMetadata } from '../../../../core/interfaces/backup.interface';

describe('BackupTabComponent', () => {
  let component: BackupTabComponent;
  let fixture: ComponentFixture<BackupTabComponent>;

  const backup: BackupMetadata = {
    id: 'b1', instanceId: 'srv1', name: 'nightly', createdAt: new Date('2026-01-02T03:04:05Z'),
    size: 1048576, type: 'scheduled', filePath: 'C:/backups/b1.zip'
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BackupTabComponent]
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

  it('emits the chosen time', () => {
    spyOn(component.backupTimeChange, 'emit');
    component.backupScheduleEnabled = true;
    fixture.detectChanges();
    const input = (fixture.nativeElement as HTMLElement).querySelector('input[type=time]') as HTMLInputElement;
    input.value = '04:30';
    input.dispatchEvent(new Event('change'));
    expect(component.backupTimeChange.emit).toHaveBeenCalledWith('04:30');
  });

  it('should emit backupDaySelect', () => {
    spyOn(component.backupDaySelect, 'emit');
    component.onBackupDaySelect(2);
    expect(component.backupDaySelect.emit).toHaveBeenCalledWith(2);
  });

  describe('max backups to keep', () => {
    const commit = (value: string): HTMLInputElement => {
      component.backupScheduleEnabled = true;
      fixture.detectChanges();
      const input = (fixture.nativeElement as HTMLElement).querySelector('input[type=number]') as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('change'));
      return input;
    };

    it('keeps the value a whole number from 1 to 50', () => {
      const emitted: number[] = [];
      component.maxBackupsToKeepChange.subscribe(value => emitted.push(value));

      commit('0');
      commit('75');
      commit('7.6');
      commit('12');

      expect(emitted).toEqual([1, 50, 8, 12]);
    });

    it('shows the value that will be saved', () => {
      expect(commit('75').value).toBe('50');
    });

    it('ignores a cleared field and shows the saved value again', () => {
      component.maxBackupsToKeep = 10;
      spyOn(component.maxBackupsToKeepChange, 'emit');

      const input = commit('');

      expect(component.maxBackupsToKeepChange.emit).not.toHaveBeenCalled();
      expect(input.value).toBe('10');
    });
  });

  it('shows validation messages for its fields', () => {
    component.backupScheduleEnabled = true;
    component.fieldErrors = { maxBackupsToKeep: 'Max backups to keep must be between 1 and 1000' };
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.validation-error')?.textContent)
      .toContain('Max backups to keep must be between 1 and 1000');
  });

  it('lists each backup with its size and date', () => {
    component.backupList = [backup];
    fixture.detectChanges();
    const row = (fixture.nativeElement as HTMLElement).querySelector('.table-row') as HTMLElement;
    expect(row.querySelector('.backup-name')?.textContent).toContain('nightly');
    expect(row.querySelector('.backup-size')?.textContent).toContain('1 MB');
    expect(row.querySelector('.backup-date')?.textContent?.trim()).toBe(backup.createdAt.toLocaleString());
  });

  it('should emit restoreBackup', () => {
    spyOn(component.restoreBackup, 'emit');
    component.onRestoreBackup(backup);
    expect(component.restoreBackup.emit).toHaveBeenCalledWith(backup);
  });

  it('should emit downloadBackup', () => {
    spyOn(component.downloadBackup, 'emit');
    component.onDownloadBackup(backup);
    expect(component.downloadBackup.emit).toHaveBeenCalledWith(backup);
  });

  it('should emit deleteBackup', () => {
    spyOn(component.deleteBackup, 'emit');
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

  it('should track by backup id', () => {
    expect(component.trackByBackupId(0, backup)).toBe('b1');
  });
});
