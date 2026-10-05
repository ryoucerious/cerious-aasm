import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BackupMetadata } from '../../../../core/interfaces/backup.interface';
import { formatBytes, formatLocalDateTime } from '../../../../core/utils/format.utils';
import { FieldMessages, FieldMessagesComponent } from '../../../field-messages/field-messages.component';

export type BackupFrequency = 'hourly' | 'daily' | 'weekly';

/** The field's range, enforced on save: a retention of 0 would have the cleanup delete every backup. */
const MIN_BACKUPS_TO_KEEP = 1;
const MAX_BACKUPS_TO_KEEP = 50;

@Component({
  selector: 'app-backup-tab',
  standalone: true,
  imports: [CommonModule, FieldMessagesComponent],
  templateUrl: './backup-tab.component.html'
})
export class BackupTabComponent {
  @Input() backupScheduleEnabled = false;
  @Input() backupFrequency: BackupFrequency = 'daily';
  @Input() backupTime = '02:00';
  @Input() backupDayOfWeek = 0;
  @Input() maxBackupsToKeep = 10;
  @Input() backupList: BackupMetadata[] = [];
  @Input() backupFrequencyDropdownOpen = false;
  @Input() backupDayDropdownOpen = false;
  @Input() fieldErrors: FieldMessages = {};
  @Input() fieldWarnings: FieldMessages = {};

  @Output() createManualBackup = new EventEmitter<void>();
  @Output() backupScheduleToggle = new EventEmitter<void>();
  @Output() backupFrequencySelect = new EventEmitter<BackupFrequency>();
  @Output() backupTimeChange = new EventEmitter<string>();
  @Output() backupDaySelect = new EventEmitter<number>();
  @Output() maxBackupsToKeepChange = new EventEmitter<number>();
  @Output() restoreBackup = new EventEmitter<BackupMetadata>();
  @Output() downloadBackup = new EventEmitter<BackupMetadata>();
  @Output() deleteBackup = new EventEmitter<BackupMetadata>();
  @Output() validateField = new EventEmitter<{key: string, value: unknown}>();
  @Output() toggleBackupFrequencyDropdown = new EventEmitter<void>();
  @Output() toggleBackupDayDropdown = new EventEmitter<void>();

  readonly formatSize = formatBytes;
  readonly formatDate = formatLocalDateTime;

  getBackupFrequencyDisplayName(frequency: string): string {
    return this.getBackupFrequencyOptions().find(option => option.value === frequency)?.display ?? frequency;
  }

  getBackupFrequencyOptions(): Array<{value: BackupFrequency, display: string}> {
    return [
      { value: 'hourly', display: 'Every Hour' },
      { value: 'daily', display: 'Daily' },
      { value: 'weekly', display: 'Weekly' }
    ];
  }

  getBackupDayDisplayName(day: number): string {
    return this.getBackupDayOptions().find(option => option.value === day)?.display ?? `Day ${day}`;
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

  trackByBackupId(_index: number, backup: BackupMetadata): string {
    return backup.id;
  }

  onCreateManualBackup(): void {
    this.createManualBackup.emit();
  }

  onBackupScheduleToggle(): void {
    this.backupScheduleToggle.emit();
  }

  onBackupFrequencySelect(value: BackupFrequency): void {
    this.backupFrequencySelect.emit(value);
  }

  onBackupTimeChange(event: Event): void {
    this.backupTimeChange.emit((event.target as HTMLInputElement).value);
  }

  onBackupDaySelect(value: number): void {
    this.backupDaySelect.emit(value);
  }

  /** Sends a whole number in range; an empty field puts the saved value back instead. */
  onMaxBackupsToKeepChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const typed = input.value.trim() === '' ? NaN : Number(input.value);
    if (!Number.isFinite(typed)) {
      input.value = String(this.maxBackupsToKeep);
      return;
    }
    const value = Math.min(MAX_BACKUPS_TO_KEEP, Math.max(MIN_BACKUPS_TO_KEEP, Math.round(typed)));
    input.value = String(value);
    this.maxBackupsToKeepChange.emit(value);
  }

  onRestoreBackup(backup: BackupMetadata): void {
    this.restoreBackup.emit(backup);
  }

  onDownloadBackup(backup: BackupMetadata): void {
    this.downloadBackup.emit(backup);
  }

  onDeleteBackup(backup: BackupMetadata): void {
    this.deleteBackup.emit(backup);
  }

  onValidateField(key: string, value: unknown): void {
    this.validateField.emit({key, value});
  }

  onToggleBackupFrequencyDropdown(): void {
    this.toggleBackupFrequencyDropdown.emit();
  }

  onToggleBackupDayDropdown(): void {
    this.toggleBackupDayDropdown.emit();
  }
}
