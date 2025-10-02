import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-automation-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './automation-tab.component.html'
})
export class AutomationTabComponent {
  @Input() serverInstance: any = {};
  @Input() isLocked = false;
  @Input() restartFrequencyDropdownOpen = false;

  @Output() saveAutoStartSettings = new EventEmitter<void>();
  @Output() saveCrashDetectionSettings = new EventEmitter<void>();
  @Output() saveScheduledRestartSettings = new EventEmitter<void>();
  @Output() validateField = new EventEmitter<{key: string, value: any}>();
  @Output() restartDayToggle = new EventEmitter<{dayIndex: number, event: any}>();
  @Output() restartFrequencySelect = new EventEmitter<string>();
  @Output() toggleRestartFrequencyDropdown = new EventEmitter<void>();

  // Automation-related properties
  weekDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  get isAutomationLocked(): boolean {
    // Automation settings should always be editable regardless of server state
    return false;
  }

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

    const selectedDays = this.serverInstance.restartDays
      .sort((a: number, b: number) => a - b)
      .map((dayIndex: number) => this.weekDays[dayIndex])
      .join(', ');

    return selectedDays;
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

  getRestartFrequencyDisplayName(frequency: string): string {
    const frequencyMap: { [key: string]: string } = {
      'none': 'No Restart',
      'daily': 'Daily',
      'weekly': 'Weekly'
    };
    return frequencyMap[frequency] || frequency;
  }

  hasFieldError(key: string): boolean {
    // This would be implemented based on your validation logic
    return false;
  }

  getFieldError(key: string): string {
    return '';
  }

  hasFieldWarning(key: string): boolean {
    return false;
  }

  getFieldWarning(key: string): string {
    return '';
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

  onValidateField(key: string, value: any): void {
    this.validateField.emit({key, value});
  }

  onRestartDayToggle(dayIndex: number, event: any): void {
    this.restartDayToggle.emit({dayIndex, event});
  }

  onRestartFrequencySelect(value: string): void {
    this.restartFrequencySelect.emit(value);
  }

  onToggleRestartFrequencyDropdown(): void {
    this.toggleRestartFrequencyDropdown.emit();
  }
}