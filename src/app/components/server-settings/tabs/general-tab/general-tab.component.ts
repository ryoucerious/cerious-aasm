import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
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
export class GeneralTabComponent implements OnChanges {
  showCreateManager = false;
  newManager = { username: '', password: '', displayName: '', roleId: 'server-manager' };

  @Input() serverInstance: any = {};
  @Input() isLocked = false;
  @Input() generalFields: Field[] = [];
  @Input() dropdownOpen = false;
  @Input() fieldErrors: { [key: string]: string } = {};
  @Input() fieldWarnings: { [key: string]: string } = {};
  @Input() canAssignManagers = false;
  @Input() canSetOperator = false;
  @Input() operators: Array<{ id: string; username: string; displayName: string }> = [];
  @Input() assigneeRoles: Array<{ id: string; label: string }> = [];
  @Input() serverManagers: Array<{ id: string; username: string; displayName: string; roleId?: string; roleName?: string; ownerUserId?: string | null }> = [];
  @Input() managerBusy = false;
  @Input() managerError = '';

  @Output() saveSettings = new EventEmitter<void>();
  @Output() operatorSelected = new EventEmitter<string | null>();
  @Output() managerSelected = new EventEmitter<string | null>();
  @Output() createManager = new EventEmitter<{ username: string; password: string; displayName: string; roleId: string }>();
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
    return !!this.fieldErrors[key];
  }

  getFieldError(key: string): string {
    return this.fieldErrors[key] || '';
  }

  hasFieldWarning(key: string): boolean {
    return !!this.fieldWarnings[key];
  }

  getFieldWarning(key: string): string {
    return this.fieldWarnings[key] || '';
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

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['assigneeRoles'] && this.assigneeRoles.length && !this.assigneeRoles.some(role => role.id === this.newManager.roleId)) {
      this.newManager.roleId = this.assigneeRoles[0].id;
    }
    const busy = changes['managerBusy'];
    if (busy && busy.previousValue === true && this.managerBusy === false && !this.managerError) {
      this.clearCreateManager();
    }
  }

  get visibleManagers(): Array<{ id: string; username: string; displayName: string; roleId?: string; roleName?: string; ownerUserId?: string | null }> {
    const pool = this.serverInstance?.operatorUserId || '';
    return (this.serverManagers || []).filter(manager => (manager.ownerUserId || '') === pool);
  }

  onOperatorSelected(value: string): void {
    this.operatorSelected.emit(value || null);
  }

  managerLabel(manager: { username: string; displayName: string; roleName?: string }): string {
    const name = manager.displayName && manager.displayName !== manager.username
      ? `${manager.displayName} (${manager.username})`
      : (manager.displayName || manager.username);
    return manager.roleName ? `${name} - ${manager.roleName}` : name;
  }

  onManagerSelected(value: string): void {
    this.managerSelected.emit(value || null);
  }

  onCreateManager(): void {
    this.createManager.emit({
      username: this.newManager.username.trim(),
      password: this.newManager.password,
      displayName: this.newManager.displayName.trim(),
      roleId: this.newManager.roleId
    });
  }

  clearCreateManager(): void {
    this.showCreateManager = false;
    this.newManager = { username: '', password: '', displayName: '', roleId: 'server-manager' };
  }
}