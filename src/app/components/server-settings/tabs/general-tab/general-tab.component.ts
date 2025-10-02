import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface Field {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'dropdown' | 'combo' | 'multi-toggle';
  description: string;
  options?: any[];
  step?: number;
  min?: number;
  max?: number;
}

@Component({
  selector: 'app-general-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './general-tab.component.html'
})
export class GeneralTabComponent {
  @Input() serverInstance: any = {};
  @Input() isLocked = false;
  @Input() generalFields: Field[] = [];
  @Input() dropdownOpen = false;

  @Output() saveSettings = new EventEmitter<void>();
  @Output() validateField = new EventEmitter<{key: string, value: any}>();
  @Output() toggleMultiOption = new EventEmitter<{key: string, option: string, checked: boolean}>();
  @Output() mapSelect = new EventEmitter<{value: string, key?: string}>();
  @Output() mapInput = new EventEmitter<{event: any, key: string}>();
  @Output() dropdownToggle = new EventEmitter<boolean>();

  get mapDisplayValue(): string {
    return this.getMapDisplayName(this.serverInstance.mapName) || this.serverInstance.mapName || '';
  }

  getMapDisplayName(mapName: string): string {
    if (!mapName) return '';
    const field = this.generalFields.find(f => f.key === 'mapName');
    if (!field?.options) return mapName;
    const option = field.options.find((opt: any) => opt.value === mapName);
    return option?.display || mapName;
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

  onSaveSettings(): void {
    this.saveSettings.emit();
  }

  onValidateField(key: string, value: any): void {
    this.validateField.emit({key, value});
  }

  onToggleMultiOption(key: string, option: string, checked: boolean): void {
    this.toggleMultiOption.emit({key, option, checked});
  }

  onMapSelect(value: string, key?: string): void {
    this.mapSelect.emit({value, key});
  }

  onMapInput(event: any, key: string): void {
    this.mapInput.emit({event, key});
  }

  onDropdownToggle(): void {
    this.dropdownToggle.emit(!this.dropdownOpen);
  }
}