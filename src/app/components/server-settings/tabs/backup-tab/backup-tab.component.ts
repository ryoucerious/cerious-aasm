import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BackupMetadata } from '../../../../core/interfaces/backup.interface';
import { formatBytes, formatLocalDateTime } from '../../../../core/utils/format.utils';
import { FieldMessages, FieldMessagesComponent } from '../../../field-messages/field-messages.component';
import { BackupCopiesService, BackupCopy } from '../../../../core/services/backup-copies.service';
import { NotificationService } from '../../../../core/services/notification.service';

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
export class BackupTabComponent implements OnChanges {
  /** The server, to ask where the copy of its latest backup is kept. */
  @Input() serverId: string | null = null;
  /** A backup was brought back from another machine: the list has to be read again. */
  @Output() backupsChanged = new EventEmitter<void>();
  /** Where another machine of the mesh keeps the latest backup; null outside a mesh, or before one is kept. */
  copy: BackupCopy | null = null;
  bringingBack = false;
  private readonly copies = inject(BackupCopiesService);
  private readonly notification = inject(NotificationService);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['serverId']) this.loadCopy();
  }

  /** The copy's backup is among this server's backups already. */
  get copyHere(): boolean {
    const name = this.copy?.fileName;
    return !!name && this.backupList.some(backup => (backup.filePath || '').replace(/\\/g, '/').split('/').pop() === name);
  }

  get copiedAt(): string {
    return this.copy ? formatLocalDateTime(new Date(this.copy.copiedAt)) : '';
  }

  onBringBack(): void {
    const id = this.serverId;
    const copy = this.copy;
    if (!id || !copy || this.bringingBack) return;
    this.bringingBack = true;
    this.copies.bringBack(id).subscribe({
      next: reply => {
        this.bringingBack = false;
        if (reply?.success) {
          this.notification.success(`${copy.fileName} is back among this server's backups.`, 'Backup');
          this.backupsChanged.emit();
        } else {
          this.notification.error(reply?.error || `Could not bring the copy back from ${copy.nodeName}.`, 'Backup');
        }
      },
      error: () => {
        this.bringingBack = false;
        this.notification.error(`Could not bring the copy back from ${copy.nodeName}.`, 'Backup');
      }
    });
  }

  private loadCopy(): void {
    this.copy = null;
    const id = this.serverId;
    if (!id) return;
    this.copies.copyOf(id).subscribe({
      next: reply => { if (this.serverId === id) this.copy = reply?.copy ?? null; },
      error: () => { /* outside a mesh, or the machine is out of reach: nothing to show */ }
    });
  }

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
