import { Component, Input, Output, EventEmitter, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../modal/modal.component';
import { MessagingService } from '../../../../core/services/messaging/messaging.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { IpcService } from '../../../../core/services/ipc.service';
import { ModEntry } from '../../../../core/models/server-instance.model';
import { environment } from '../../../../../environments/environment';

/** One search result, as the backend's curseforge-search-mods handler shapes it. */
export interface CurseForgeModSummary {
  id: number;
  name: string;
  summary?: string;
  downloadCount?: number;
  thumbUrl?: string;
  screenshotUrl?: string;
  websiteUrl?: string;
  authors?: string;
  categories?: string[];
}

interface CurseForgeSearchReply {
  success?: boolean;
  mods?: CurseForgeModSummary[];
  pagination?: { totalCount?: number };
  error?: string;
}

@Component({
  selector: 'app-mods-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, ModalComponent],
  templateUrl: './mods-tab.component.html'
})
export class ModsTabComponent {
  @Input() isLocked = false;
  @Input() modList: ModEntry[] = [];

  @Output() addMod = new EventEmitter<{id: string, name: string}>();
  @Output() removeMod = new EventEmitter<ModEntry>();
  @Output() toggleMod = new EventEmitter<ModEntry>();
  @Output() updateModSettings = new EventEmitter<{mod: ModEntry, settings: Record<string, string>}>();

  showAddModModal = false;
  showSettingsModal = false;
  newModId = '';
  newModName = '';
  selectedMod: ModEntry | null = null;
  modSettings: Record<string, string> = {};
  editingKey: string | null = null;
  tempKeyValue = '';

  showBrowseModal = false;
  cfSearchQuery = '';
  cfSearchResults: CurseForgeModSummary[] = [];
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
    private notification: NotificationService,
    private ipc: IpcService,
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
    setTimeout(() => this.searchCurseForge(), 0);
  }

  isModInstalled(modId: string | number): boolean {
    return (this.modList || []).some(m => String(m.id) === String(modId));
  }

  closeBrowseModal(): void {
    this.showBrowseModal = false;
    this.cdr.markForCheck();
  }

  openUrl(url: string): void {
    if (!url) return;
    if (this.ipc.isElectron) {
      this.messaging.sendMessage('curseforge-open-website', { url }).subscribe({
        error: () => this.notification.error('Could not open the CurseForge page.', 'Mod Browser')
      });
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
    this.messaging.sendMessage<CurseForgeSearchReply>('curseforge-search-mods', {
      query: this.cfSearchQuery,
      apiKey,
      pageSize: this.cfPageSize,
      index: this.cfPage * this.cfPageSize,
      sortField: this.cfSortField,
    }).subscribe({
      next: res => {
        if (res?.success) {
          if (reset) {
            this.cfSearchResults = res.mods || [];
          } else {
            this.cfSearchResults = [...this.cfSearchResults, ...(res.mods || [])];
          }
          this.cfHasMore = (res.pagination?.totalCount ?? 0) > (this.cfPage + 1) * this.cfPageSize;
        } else {
          this.showSearchError(res?.error || 'Search failed.');
        }
        this.cfSearching = false;
        this.cdr.markForCheck();
      },
      error: (err: unknown) => {
        this.cfSearching = false;
        this.showSearchError(err instanceof Error && err.message ? err.message : 'Failed to search CurseForge.');
        this.cdr.markForCheck();
      },
    });
  }

  cfLoadMore(): void {
    this.cfPage++;
    this.searchCurseForge(false);
  }

  /** The page that owns the mod list confirms the addition, so this only reports a duplicate. */
  addModFromCurseForge(mod: CurseForgeModSummary): void {
    if (this.isModInstalled(mod.id)) {
      this.notification.warning(`Mod "${mod.name}" is already in the list.`, 'Mod Browser');
      return;
    }
    this.addMod.emit({ id: String(mod.id), name: mod.name });
    this.cdr.markForCheck();
  }

  openSettingsModal(mod: ModEntry): void {
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

  onRemoveMod(mod: ModEntry): void {
    this.removeMod.emit(mod);
  }

  onToggleMod(mod: ModEntry): void {
    this.toggleMod.emit(mod);
  }

  onSettingKeyChange(oldKey: string, newKey: string) {
    if (oldKey !== newKey && newKey.trim()) {
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

  /** Adds an empty setting named "SettingN", with the first N that no setting uses yet. */
  addSetting(): void {
    let n = Object.keys(this.modSettings).length + 1;
    while (`Setting${n}` in this.modSettings) n++;
    this.modSettings = { ...this.modSettings, [`Setting${n}`]: '' };
  }

  removeSetting(key: string): void {
    const updatedSettings = { ...this.modSettings };
    delete updatedSettings[key];
    this.modSettings = updatedSettings;
  }

  trackByModId(_index: number, mod: ModEntry): string {
    return mod.id;
  }

  trackBySetting(_index: number, setting: string): string {
    return setting;
  }

  objectKeys(obj: Record<string, string> | null | undefined): string[] {
    return obj ? Object.keys(obj) : [];
  }

  private showSearchError(message: string): void {
    this.cfError = message;
    this.cfIsAccessError = message.includes('403') || message.toLowerCase().includes('restricted');
  }
}
