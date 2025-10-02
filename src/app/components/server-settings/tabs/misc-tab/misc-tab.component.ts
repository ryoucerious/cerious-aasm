import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-misc-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './misc-tab.component.html'
})
export class MiscTabComponent {
  @Input() serverInstance: any = {};
  @Input() isLocked = false;
  @Input() miscFields: any[] = [];

  @Output() saveSettings = new EventEmitter<void>();
  @Output() validateField = new EventEmitter<{key: string, value: any}>();

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

  onSaveSettings(): void {
    this.saveSettings.emit();
  }

  onValidateField(key: string, value: any): void {
    this.validateField.emit({key, value});
  }
}