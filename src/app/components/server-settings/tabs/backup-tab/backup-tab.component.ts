import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-backup-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './backup-tab.component.html'
})
export class BackupTabComponent {
  @Input() backupScheduleEnabled = false;
  @Input() backupFrequency: 'hourly' | 'daily' | 'weekly' = 'daily';
  @Input() backupTime = '02:00';
  @Input() backupDayOfWeek = 0;
  @Input() maxBackupsToKeep = 10;
  @Input() backupList: any[] = [];
  @Input() isBackupLocked = false;
  @Input() backupFrequencyDropdownOpen = false;
  @Input() backupDayDropdownOpen = false;

  @Output() createManualBackup = new EventEmitter<void>();
  @Output() backupScheduleToggle = new EventEmitter<void>();
  @Output() backupFrequencySelect = new EventEmitter<string>();
  @Output() backupTimeChange = new EventEmitter<Event>();
  @Output() backupDaySelect = new EventEmitter<number>();
  @Output() maxBackupsToKeepChange = new EventEmitter<Event>();
  @Output() restoreBackup = new EventEmitter<any>();
  @Output() downloadBackup = new EventEmitter<any>();
  @Output() deleteBackup = new EventEmitter<any>();
  @Output() validateField = new EventEmitter<{key: string, value: any}>();
  @Output() toggleBackupFrequencyDropdown = new EventEmitter<void>();
  @Output() toggleBackupDayDropdown = new EventEmitter<void>();

  getBackupFrequencyDisplayName(frequency: string): string {
    const frequencyMap: { [key: string]: string } = {
      'hourly': 'Every Hour',
      'daily': 'Daily',
      'weekly': 'Weekly'
    };
    return frequencyMap[frequency] || frequency;
  }

  getBackupFrequencyOptions(): Array<{value: string, display: string}> {
    return [
      { value: 'hourly', display: 'Every Hour' },
      { value: 'daily', display: 'Daily' },
      { value: 'weekly', display: 'Weekly' }
    ];
  }

  getBackupDayDisplayName(day: number): string {
    const dayMap: { [key: number]: string } = {
      0: 'Sunday',
      1: 'Monday',
      2: 'Tuesday',
      3: 'Wednesday',
      4: 'Thursday',
      5: 'Friday',
      6: 'Saturday'
    };
    return dayMap[day] || `Day ${day}`;
  }

  getBackupDayOptions(): Array<{value: number, display: string}> {
    return [
      { value: 0, display: 'Sunday' },
      { value: 1, display: 'Monday' },
      { value: 2, display: 'Tuesday' },
      { value: 3, display: 'Wednesday' },
      { value: 4, display: 'Thursday' },
      { value: 5, display: 'Friday' },
      { value: 6, display: 'Saturday' }
    ];
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  getFormattedDate(dateValue: any): string {
    if (!dateValue) return 'Unknown';
    const date = new Date(dateValue);
    return date.toLocaleString();
  }

  trackByBackupId(index: number, backup: any): any {
    return backup ? backup.id : index;
  }

  hasFieldError(fieldName: string): boolean {
    // This would be implemented based on your validation logic
    return false;
  }

  getFieldError(fieldName: string): string {
    return '';
  }

  hasFieldWarning(fieldName: string): boolean {
    return false;
  }

  getFieldWarning(fieldName: string): string {
    return '';
  }

  onCreateManualBackup(): void {
    this.createManualBackup.emit();
  }

  onBackupScheduleToggle(): void {
    this.backupScheduleToggle.emit();
  }

  onBackupFrequencySelect(value: string): void {
    this.backupFrequencySelect.emit(value);
  }

  onBackupTimeChange(event: Event): void {
    this.backupTimeChange.emit(event);
  }

  onBackupDaySelect(value: number): void {
    this.backupDaySelect.emit(value);
  }

  onMaxBackupsToKeepChange(event: Event): void {
    this.maxBackupsToKeepChange.emit(event);
  }

  onRestoreBackup(backup: any): void {
    this.restoreBackup.emit(backup);
  }

  onDownloadBackup(backup: any): void {
    this.downloadBackup.emit(backup);
  }

  onDeleteBackup(backup: any): void {
    this.deleteBackup.emit(backup);
  }

  onValidateField(key: string, value: any): void {
    this.validateField.emit({key, value});
  }

  onToggleBackupFrequencyDropdown(): void {
    this.toggleBackupFrequencyDropdown.emit();
  }

  onToggleBackupDayDropdown(): void {
    this.toggleBackupDayDropdown.emit();
  }
}