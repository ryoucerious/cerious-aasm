import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ServerInstance } from '../../../../core/models/server-instance.model';
import { FieldMessages, FieldMessagesComponent } from '../../../field-messages/field-messages.component';

@Component({
  selector: 'app-automation-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, FieldMessagesComponent],
  styleUrls: ['./automation-tab.component.scss'],
  templateUrl: './automation-tab.component.html'
})
export class AutomationTabComponent {
  @Input() serverInstance: Partial<ServerInstance> = {};
  @Input() restartFrequencyDropdownOpen = false;
  @Input() fieldErrors: FieldMessages = {};
  @Input() fieldWarnings: FieldMessages = {};

  @Output() saveAutoStartSettings = new EventEmitter<void>();
  @Output() saveCrashDetectionSettings = new EventEmitter<void>();
  @Output() saveScheduledRestartSettings = new EventEmitter<void>();
  @Output() validateField = new EventEmitter<{key: string, value: unknown}>();
  @Output() restartDayToggle = new EventEmitter<{dayIndex: number, checked: boolean}>();
  @Output() restartFrequencySelect = new EventEmitter<string>();
  @Output() toggleRestartFrequencyDropdown = new EventEmitter<void>();

  weekDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  getAutoStartStatus(): string {
    if (!this.serverInstance) return 'Disabled';

    const appLaunch = this.serverInstance.autoStartOnAppLaunch;
    const boot = this.serverInstance.autoStartOnBoot;

    if (appLaunch && boot) return 'App Launch + Boot';
    if (appLaunch) return 'App Launch';
    if (boot) return 'System Boot';
    return 'Disabled';
  }

  getScheduledRestartStatus(): string {
    if (!this.serverInstance?.scheduledRestartEnabled) return 'Disabled';

    const frequency = this.serverInstance.restartFrequency || 'daily';
    const time = this.serverInstance.restartTime || '02:00';

    if (frequency === 'daily') {
      return `Daily at ${time}`;
    } else if (frequency === 'weekly') {
      const days = this.getSelectedDaysText();
      return `Weekly ${days} at ${time}`;
    } else if (frequency === 'custom') {
      const days = this.getSelectedDaysText();
      return `${days} at ${time}`;
    }

    return `${frequency} at ${time}`;
  }

  private getSelectedDaysText(): string {
    if (!this.serverInstance?.restartDays?.length) return 'No days selected';

    return [...this.serverInstance.restartDays]
      .sort((a, b) => a - b)
      .map(dayIndex => this.weekDays[dayIndex])
      .join(', ');
  }

  isRestartDaySelected(dayIndex: number): boolean {
    if (!this.serverInstance?.restartDays) return false;
    return this.serverInstance.restartDays.includes(dayIndex);
  }

  getRestartFrequencyOptions(): Array<{value: string, display: string}> {
    return [
      { value: 'none', display: 'No Restart' },
      { value: 'daily', display: 'Daily' },
      { value: 'weekly', display: 'Weekly' }
    ];
  }

  getRestartFrequencyDisplayName(frequency: string | undefined): string {
    const frequencyMap: { [key: string]: string } = {
      'none': 'No Restart',
      'daily': 'Daily',
      'weekly': 'Weekly'
    };
    return (frequency && frequencyMap[frequency]) || frequency || '';
  }

  onSaveAutoStartSettings(): void {
    this.saveAutoStartSettings.emit();
  }

  onSaveCrashDetectionSettings(): void {
    this.saveCrashDetectionSettings.emit();
  }

  onSaveScheduledRestartSettings(): void {
    this.saveScheduledRestartSettings.emit();
  }

  /** Every time of day the server restarts at; older versions saved only one, as restartTime. */
  get restartTimes(): string[] {
    const times = this.serverInstance.restartTimes;
    return times?.length ? times : [this.serverInstance.restartTime || '02:00'];
  }

  onRestartTimeChange(index: number, value: string): void {
    const times = [...this.restartTimes];
    times[index] = value;
    this.setRestartTimes(times);
  }

  /** Another restart a day, twelve hours after the first to start with. */
  onAddRestartTime(): void {
    const [hours, minutes] = (this.restartTimes[0] || '02:00').split(':').map(Number);
    const next = `${String(((hours || 0) + 12) % 24).padStart(2, '0')}:${String(minutes || 0).padStart(2, '0')}`;
    this.setRestartTimes([...this.restartTimes, next]);
    this.onSaveScheduledRestartSettings();
  }

  onRemoveRestartTime(index: number): void {
    if (this.restartTimes.length < 2) return;
    this.setRestartTimes(this.restartTimes.filter((_time, i) => i !== index));
    this.onSaveScheduledRestartSettings();
  }

  trackByIndex(index: number): number {
    return index;
  }

  /** The first time is restartTime too, which older versions read. */
  private setRestartTimes(times: string[]): void {
    this.serverInstance.restartTimes = times;
    this.serverInstance.restartTime = times[0];
  }

  onValidateField(key: string, value: unknown): void {
    this.validateField.emit({key, value});
  }

  onRestartDayToggle(dayIndex: number, event: Event): void {
    this.restartDayToggle.emit({ dayIndex, checked: (event.target as HTMLInputElement).checked });
  }

  onRestartFrequencySelect(value: string): void {
    this.restartFrequencySelect.emit(value);
  }

  onToggleRestartFrequencyDropdown(): void {
    this.toggleRestartFrequencyDropdown.emit();
  }
}