import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../modal/modal.component';

@Component({
  selector: 'app-mods-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, ModalComponent],
  templateUrl: './mods-tab.component.html'
})
export class ModsTabComponent {
  @Input() isLocked = false;
  @Input() modList: any[] = [];

  @Output() addMod = new EventEmitter<{id: string, name: string}>();
  @Output() removeMod = new EventEmitter<any>();
  @Output() toggleMod = new EventEmitter<any>();
  @Output() updateModSettings = new EventEmitter<{mod: any, settings: any}>();

  // Modal state
  showAddModModal = false;
  showSettingsModal = false;
  newModId = '';
  newModName = '';
  selectedMod: any = null;
  modSettings: any = {};
  editingKey: string | null = null;
  tempKeyValue: string = '';

  onAddMod(): void {
    if (this.newModId && this.newModId.trim() && this.newModName && this.newModName.trim()) {
      this.addMod.emit({
        id: this.newModId.trim(),
        name: this.newModName.trim()
      });
      this.closeModal();
    }
  }

  openAddModModal(): void {
    this.newModId = '';
    this.newModName = '';
    this.showAddModModal = true;
  }

  openSettingsModal(mod: any): void {
    this.selectedMod = mod;
    this.modSettings = mod.settings ? { ...mod.settings } : {};
    this.showSettingsModal = true;
  }

  saveModSettings(): void {
    if (this.selectedMod) {
      this.updateModSettings.emit({
        mod: this.selectedMod,
        settings: { ...this.modSettings }
      });
      this.closeModal();
    }
  }

  closeModal(): void {
    this.showAddModModal = false;
    this.showSettingsModal = false;
    this.newModId = '';
    this.newModName = '';
    this.modSettings = {};
    this.selectedMod = null;
    this.editingKey = null;
    this.tempKeyValue = '';
  }

  onRemoveMod(mod: any): void {
    this.removeMod.emit(mod);
  }

  onToggleMod(mod: any): void {
    this.toggleMod.emit(mod);
  }

  onSettingKeyChange(oldKey: string, newKey: string) {
    if (oldKey !== newKey && newKey.trim()) {
      // Create new object with updated key
      const updatedSettings = { ...this.modSettings };
      updatedSettings[newKey.trim()] = updatedSettings[oldKey];
      delete updatedSettings[oldKey];
      this.modSettings = updatedSettings;
    }
  }

  startEditingKey(setting: string): void {
    this.editingKey = setting;
    this.tempKeyValue = setting;
  }

  finishEditingKey(oldKey: string): void {
    if (this.editingKey && this.tempKeyValue.trim() && this.tempKeyValue !== oldKey) {
      this.onSettingKeyChange(oldKey, this.tempKeyValue.trim());
    }
    this.editingKey = null;
    this.tempKeyValue = '';
  }

  cancelEditingKey(): void {
    this.editingKey = null;
    this.tempKeyValue = '';
  }

  addSetting(): void {
    const key = `Setting${Object.keys(this.modSettings).length + 1}`;
    this.modSettings = { ...this.modSettings, [key]: '' };
  }

  removeSetting(key: string): void {
    const updatedSettings = { ...this.modSettings };
    delete updatedSettings[key];
    this.modSettings = updatedSettings;
  }

  trackByModId(index: number, mod: any): any {
    return mod ? mod.id : index;
  }

  trackBySetting(index: number, setting: string): string {
    return setting;
  }

  objectKeys(obj: any): string[] {
    return obj ? Object.keys(obj) : [];
  }
}