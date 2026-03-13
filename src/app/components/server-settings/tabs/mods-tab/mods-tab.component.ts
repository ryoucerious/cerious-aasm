import { Component, Input, Output, EventEmitter, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../modal/modal.component';
import { MessagingService } from '../../../../core/services/messaging/messaging.service';
import { GlobalConfigService } from '../../../../core/services/global-config.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { UtilityService } from '../../../../core/services/utility.service';
import { environment } from '../../../../../environments/environment';

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

  // Manual add modal
  showAddModModal = false;
  showSettingsModal = false;
  newModId = '';
  newModName = '';
  selectedMod: any = null;
  modSettings: any = {};
  editingKey: string | null = null;
  tempKeyValue: string = '';

  // CurseForge browser
  showBrowseModal = false;
  cfSearchQuery = '';
  cfSearchResults: any[] = [];
  cfSearching = false;
  cfPage = 0;
  cfPageSize = 20;
  cfHasMore = false;
  cfSortField = 2; // 1=Featured, 2=Popularity, 3=LastUpdated, 4=Name, 6=TotalDownloads
  cfError: string | null = null;
  cfIsAccessError = false; // true when ARK:SA private-game 403 is hit
  cfSortDropdownOpen = false;

  readonly cfSortOptions = [
    { value: 2, label: 'Popular' },
    { value: 6, label: 'Most Downloaded' },
    { value: 3, label: 'Recently Updated' },
    { value: 4, label: 'A–Z Name' },
    { value: 1, label: 'Featured' },
  ];

  get cfSortLabel(): string {
    return this.cfSortOptions.find(o => o.value === this.cfSortField)?.label ?? 'Sort';
  }

  selectCfSort(value: number): void {
    this.cfSortField = value;
    this.cfSortDropdownOpen = false;
    this.searchCurseForge();
  }

  constructor(
    private messaging: MessagingService,
    private globalConfig: GlobalConfigService,
    private notification: NotificationService,
    private utility: UtilityService,
    private cdr: ChangeDetectorRef
  ) {}

  onAddMod(): void {
    const id = this.newModId?.trim();
    const name = this.newModName?.trim();
    if (!id || !name) return;
    if (!/^\d+$/.test(id)) {
      this.notification.error('Mod ID must be a numeric CurseForge ID (e.g. 731604991). Copy it from the CurseForge website.');
      return;
    }
    this.addMod.emit({ id, name });
    this.closeModal();
  }

  openAddModModal(): void {
    this.newModId = '';
    this.newModName = '';
    this.showAddModModal = true;
  }

  openBrowseModal(): void {
    this.showBrowseModal = true;
    this.cfSearchQuery = '';
    this.cfSearchResults = [];
    this.cfPage = 0;
    this.cfSortField = 2;
    this.cfError = null;
    this.cfIsAccessError = false;
    this.cfSortDropdownOpen = false;
    this.cdr.markForCheck();
    // Auto-load popular mods immediately
    setTimeout(() => this.searchCurseForge(), 0);
  }

  isModInstalled(modId: any): boolean {
    return (this.modList || []).some((m: any) => String(m.id) === String(modId));
  }

  closeBrowseModal(): void {
    this.showBrowseModal = false;
    this.cdr.markForCheck();
  }

  openUrl(url: string): void {
    if (!url) return;
    if (this.utility.getPlatform() === 'Electron') {
      this.messaging.sendMessage('curseforge-open-website', { url }).subscribe();
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  searchCurseForge(reset = true): void {
    const apiKey = environment.curseForgeApiKey || '';
    if (reset) {
      this.cfPage = 0;
      this.cfSearchResults = [];
      this.cfError = null;
      this.cfIsAccessError = false;
    }
    this.cfSearching = true;
    this.cdr.markForCheck();
    this.messaging.sendMessage('curseforge-search-mods', {
      query: this.cfSearchQuery,
      apiKey,
      pageSize: this.cfPageSize,
      index: this.cfPage * this.cfPageSize,
      sortField: this.cfSortField,
    }).subscribe({
      next: (res: any) => {
        if (res?.success) {
          if (reset) {
            this.cfSearchResults = res.mods || [];
          } else {
            this.cfSearchResults = [...this.cfSearchResults, ...(res.mods || [])];
          }
          this.cfHasMore = (res.pagination?.totalCount ?? 0) > (this.cfPage + 1) * this.cfPageSize;
        } else {
          const msg = res?.error || 'Search failed.';
          this.cfError = msg;
          this.cfIsAccessError = msg.includes('403') || msg.toLowerCase().includes('restricted');
        }
        this.cfSearching = false;
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.cfSearching = false;
        const msg = err?.message || 'Failed to search CurseForge.';
        this.cfError = msg;
        this.cfIsAccessError = msg.includes('403') || msg.toLowerCase().includes('restricted');
        this.cdr.markForCheck();
      },
    });
  }

  cfLoadMore(): void {
    this.cfPage++;
    this.searchCurseForge(false);
  }

  addModFromCurseForge(mod: any): void {
    const existing = (this.modList || []).find((m: any) => String(m.id) === String(mod.id));
    if (existing) {
      this.notification.warning(`Mod "${mod.name}" is already in the list.`, 'Mod Browser');
      return;
    }
    this.addMod.emit({ id: String(mod.id), name: mod.name });
    this.notification.success(`Added "${mod.name}" (${mod.id}).`, 'Mod Browser');
    this.cdr.markForCheck();
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