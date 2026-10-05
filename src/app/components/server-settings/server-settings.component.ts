import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, OnChanges, SimpleChanges, HostListener, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { FirewallService, FirewallStatus } from '../../core/services/firewall.service';
import { NotificationService } from '../../core/services/notification.service';
import { IpcService } from '../../core/services/ipc.service';
import { ArkServerValidationService } from '../../core/services/ark-server-validation.service';
import { MessagingService } from '../../core/services/messaging/messaging.service';
import { ConfigImportExportService } from '../../core/services/config-import-export.service';
import { downloadBase64File } from '../../core/utils/download.utils';
import { FieldDefinition } from '../../core/services/field-definitions.service';
import { ServerNavService, ServerTabId } from '../../core/services/server-nav.service';
import { ModEntry } from '../../core/models/server-instance.model';
import { BackupMetadata } from '../../core/interfaces/backup.interface';
import { FieldMessages } from '../field-messages/field-messages.component';
import { IniEditorComponent } from './ini-editor/ini-editor.component';
import { CopyConfigDialogComponent } from './copy-config-dialog/copy-config-dialog.component';
import { GeneralTabComponent } from './tabs/general-tab/general-tab.component';
import { RatesTabComponent } from './tabs/rates-tab/rates-tab.component';
import { StructuresTabComponent } from './tabs/structures-tab/structures-tab.component';
import { StatMultiplierChange, StatMultipliersTabComponent } from './tabs/stat-multipliers-tab/stat-multipliers-tab.component';
import { MiscTabComponent } from './tabs/misc-tab/misc-tab.component';
import { ClusterTabComponent } from './tabs/cluster-tab/cluster-tab.component';
import { ModsTabComponent } from './tabs/mods-tab/mods-tab.component';
import { AutomationTabComponent } from './tabs/automation-tab/automation-tab.component';
import { BackupFrequency, BackupTabComponent } from './tabs/backup-tab/backup-tab.component';
import { FirewallTabComponent } from './tabs/firewall-tab/firewall-tab.component';
import { WhitelistTabComponent } from './tabs/whitelist-tab/whitelist-tab.component';
import { DiscordTabComponent } from './tabs/discord-tab/discord-tab.component';
import { BroadcastsTabComponent } from './tabs/broadcasts-tab/broadcasts-tab.component';
import { ArkApiTabComponent } from './tabs/ark-api-tab/ark-api-tab.component';

// The page ids are shared with the sidebar; console and players are hosted elsewhere but may
// arrive through the same input while the parent switches pages.
type TabType = ServerTabId;

const INI_TABS: { id: TabType; label: string; filename: string }[] = [
  { id: 'ini-GameUserSettings', label: 'GameUserSettings', filename: 'GameUserSettings.ini' },
  { id: 'ini-Game',             label: 'Game',             filename: 'Game.ini'             },
  { id: 'ini-Engine',           label: 'Engine',           filename: 'Engine.ini'           },
];

const PAGE_TITLES: Record<string, string> = {
  general: 'General', rates: 'Rates', structures: 'Structures', stats: 'Stat Multipliers',
  misc: 'Miscellaneous', cluster: 'Cluster', mods: 'Mods', arkapi: 'ArkApi', whitelist: 'Whitelist',
  automation: 'Automation', broadcasts: 'Broadcasts', discord: 'Discord', firewall: 'Firewall', backup: 'Backup'
};

/** The configuration pages, which expert mode swaps for the INI files. */
const EXPERT_MODE_TABS: string[] = ['general', 'rates', 'structures', 'stats', 'misc', 'cluster'];

function without(messages: FieldMessages, key: string): FieldMessages {
  const { [key]: _removed, ...rest } = messages;
  return rest;
}

@Component({
  selector: 'app-server-settings',
  standalone: true,
  imports: [CommonModule, IniEditorComponent, CopyConfigDialogComponent, GeneralTabComponent, RatesTabComponent, StructuresTabComponent, StatMultipliersTabComponent, MiscTabComponent, ClusterTabComponent, ModsTabComponent, AutomationTabComponent, BackupTabComponent, FirewallTabComponent, WhitelistTabComponent, DiscordTabComponent, BroadcastsTabComponent, ArkApiTabComponent],
  templateUrl: './server-settings.component.html'
})
export class ServerSettingsComponent implements OnInit, OnDestroy, OnChanges {
  // Fields are addressed by key from the settings metadata, so this stays loosely typed.
  @Input() serverInstance: any;
  @Input() activeTab: TabType = 'general';
  @Input() isLocked = false;
  @Input() generalFields: FieldDefinition[] = [];
  @Input() ratesFields: FieldDefinition[] = [];
  @Input() structuresFields: FieldDefinition[] = [];
  @Input() miscFields: FieldDefinition[] = [];
  @Input() statList: string[] = [];
  @Input() selectedStatIndex: number | null = null;
  @Input() modList: ModEntry[] = [];
  @Input() backupScheduleEnabled = false;
  @Input() backupFrequency: BackupFrequency = 'daily';
  @Input() backupTime = '02:00';
  @Input() backupDayOfWeek = 0;
  @Input() maxBackupsToKeep = 10;
  @Input() backupList: BackupMetadata[] = [];

  @Output() openDirectory = new EventEmitter<void>();
  @Output() tabChanged = new EventEmitter<TabType>();
  @Output() settingsChanged = new EventEmitter<void>();
  /** Settings were replaced in bulk (import or copy): the host rebuilds what it derives from them, then saves. */
  @Output() configApplied = new EventEmitter<void>();
  @Output() toggleMultiOption = new EventEmitter<{fieldKey: string, option: string, checked: boolean}>();
  @Output() statMultiplierChanged = new EventEmitter<StatMultiplierChange>();
  @Output() resetStatToDefaults = new EventEmitter<number>();
  @Output() copyStatToAll = new EventEmitter<number>();
  @Output() addMod = new EventEmitter<{id: string, name: string}>();
  @Output() removeMod = new EventEmitter<ModEntry>();
  @Output() toggleMod = new EventEmitter<ModEntry>();
  @Output() updateModSettings = new EventEmitter<{mod: ModEntry, settings: Record<string, string>}>();
  @Output() createManualBackup = new EventEmitter<void>();
  @Output() backupScheduleToggle = new EventEmitter<void>();
  @Output() backupFrequencyChange = new EventEmitter<BackupFrequency>();
  @Output() backupTimeChange = new EventEmitter<string>();
  @Output() backupDayOfWeekChange = new EventEmitter<number>();
  @Output() maxBackupsToKeepChange = new EventEmitter<number>();
  @Output() restoreBackup = new EventEmitter<BackupMetadata>();
  @Output() downloadBackup = new EventEmitter<BackupMetadata>();
  @Output() deleteBackup = new EventEmitter<BackupMetadata>();
  @Output() saveAutoStartSettings = new EventEmitter<void>();
  @Output() saveCrashDetectionSettings = new EventEmitter<void>();
  @Output() saveScheduledRestartSettings = new EventEmitter<void>();

  @ViewChild('configFileInput') configFileInput!: ElementRef<HTMLInputElement>;

  readonly isElectron: boolean;
  readonly iniTabs = INI_TABS;

  dropdownOpen = false;
  backupFrequencyDropdownOpen = false;
  backupDayDropdownOpen = false;
  restartFrequencyDropdownOpen = false;
  statSelectorDropdownOpen = false;
  showCopyConfig = false;

  firewallStatus: FirewallStatus | null = null;
  fieldErrors: FieldMessages = {};
  fieldWarnings: FieldMessages = {};

  private readonly subscriptions = new Subscription();

  constructor(
    private firewallService: FirewallService,
    private notificationService: NotificationService,
    ipc: IpcService,
    private validationService: ArkServerValidationService,
    private messagingService: MessagingService,
    private configImportExportService: ConfigImportExportService,
    private serverNav: ServerNavService
  ) {
    this.isElectron = ipc.isElectron;
  }

  ngOnInit() {
    this.checkFirewallStatus();
  }

  ngOnChanges(changes: SimpleChanges) {
    const server = changes['serverInstance'];
    if (server && server.previousValue?.id !== server.currentValue?.id) {
      this.fieldErrors = {};
      this.fieldWarnings = {};
    }
    // The page is chosen by the route, so an INI page can arrive without the toggle being used.
    if (this.isInIniTab && !this.expertMode) this.expertMode = true;
  }

  ngOnDestroy() {
    this.subscriptions.unsubscribe();
  }

  // Expert mode lives in ServerNavService because the sidebar renders the INI pages in place of
  // the configuration pages while it is on.
  get expertMode(): boolean {
    return this.serverNav.expertMode;
  }
  set expertMode(value: boolean) {
    this.serverNav.setExpertMode(!!value);
  }

  get pageTitle(): string {
    return this.iniTabs.find(t => t.id === this.activeTab)?.label ?? PAGE_TITLES[this.activeTab] ?? 'Settings';
  }

  /** Expert mode only applies to the configuration pages; other pages hide the toggle. */
  get showExpertToggle(): boolean {
    return EXPERT_MODE_TABS.includes(this.activeTab) || this.isInIniTab;
  }

  /** Hosts pass 'players' etc. through the same input; anything outside this component's pages shows nothing. */
  get isKnownTab(): boolean {
    return this.activeTab !== 'console' && this.activeTab !== 'players';
  }

  get isInIniTab(): boolean {
    return this.iniTabs.some(t => t.id === this.activeTab);
  }

  get iniFilename(): string {
    return this.iniTabs.find(t => t.id === this.activeTab)?.filename ?? '';
  }

  onTabChange(tab: TabType) {
    this.activeTab = tab;
    this.tabChanged.emit(tab);
  }

  toggleExpertMode(event: Event) {
    this.expertMode = (event.target as HTMLInputElement).checked;
    this.onTabChange(this.expertMode ? 'ini-GameUserSettings' : 'general');
  }

  onOpenDirectory(event: Event) {
    event.stopPropagation();
    this.openDirectory.emit();
  }

  onExportConfig(event: Event) {
    event.stopPropagation();
    if (!this.serverInstance?.id) return;

    this.configImportExportService.exportAsZip(this.serverInstance.id).subscribe({
      next: (result) => {
        if (result.success && result.base64) {
          const fileName = result.suggestedFileName || `${this.serverInstance.name || 'server'}-config.zip`;
          downloadBase64File(result.base64, fileName, 'application/zip');
          this.notificationService.success('Configuration exported as ZIP successfully');
        } else {
          this.notificationService.error(result.error || 'Failed to export configuration');
        }
      },
      error: (err: unknown) => {
        this.notificationService.error('Failed to export configuration: ' + (err instanceof Error ? err.message : String(err)));
      }
    });
  }

  onImportConfig(event: Event) {
    event.stopPropagation();
    if (this.isLocked) return;
    this.configFileInput.nativeElement.value = '';
    this.configFileInput.nativeElement.click();
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      this.configImportExportService.importFromIniContent(content, file.name, this.serverInstance?.id).subscribe({
        next: (result) => {
          if (result.success && result.config) {
            Object.keys(result.config).forEach(key => {
              if (key !== 'id' && key !== 'installDir') {
                this.serverInstance[key] = result.config[key];
              }
            });
            this.configApplied.emit();

            const warnings = result.warnings?.length ? ` (${result.warnings.length} warning(s))` : '';
            this.notificationService.success(`Configuration imported successfully${warnings}`);
          } else {
            this.notificationService.error(result.error || 'Failed to import configuration');
          }
        },
        error: (err: unknown) => {
          this.notificationService.error('Failed to import configuration: ' + (err instanceof Error ? err.message : String(err)));
        }
      });
    };
    reader.onerror = () => {
      this.notificationService.error('Failed to read file');
    };
    reader.readAsText(file);
  }

  onOpenCopyConfig(event: Event) {
    event.stopPropagation();
    if (!this.isLocked) this.showCopyConfig = true;
  }

  onConfigCopied() {
    this.showCopyConfig = false;
    this.configApplied.emit();
  }

  /** Saves a field the user finished with, unless it is invalid: then its message says why. */
  commitField(key: string, value: unknown) {
    this.dropdownOpen = false;
    if (this.validateField(key, value)) {
      this.settingsChanged.emit();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.custom-dropdown')) {
      this.closeAllDropdowns();
    }
  }

  closeAllDropdowns(): void {
    this.dropdownOpen = false;
    this.backupFrequencyDropdownOpen = false;
    this.backupDayDropdownOpen = false;
    this.restartFrequencyDropdownOpen = false;
    this.statSelectorDropdownOpen = false;
  }

  toggleBackupFrequencyDropdown(): void {
    const open = !this.backupFrequencyDropdownOpen;
    this.closeAllDropdowns();
    this.backupFrequencyDropdownOpen = open;
  }

  toggleBackupDayDropdown(): void {
    const open = !this.backupDayDropdownOpen;
    this.closeAllDropdowns();
    this.backupDayDropdownOpen = open;
  }

  toggleRestartFrequencyDropdown(): void {
    const open = !this.restartFrequencyDropdownOpen;
    this.closeAllDropdowns();
    this.restartFrequencyDropdownOpen = open;
  }

  toggleStatSelectorDropdown(): void {
    const open = !this.statSelectorDropdownOpen;
    this.closeAllDropdowns();
    this.statSelectorDropdownOpen = open;
  }

  onStatSelectorSelect(index: number): void {
    this.selectedStatIndex = index;
    this.statSelectorDropdownOpen = false;
  }

  onBackupFrequencySelect(frequency: BackupFrequency): void {
    this.backupFrequencyDropdownOpen = false;
    this.backupFrequencyChange.emit(frequency);
  }

  onBackupDaySelect(day: number): void {
    this.backupDayDropdownOpen = false;
    this.backupDayOfWeekChange.emit(day);
  }

  onRestartFrequencySelect(frequency: string): void {
    this.restartFrequencyDropdownOpen = false;
    if (this.serverInstance) {
      this.serverInstance.restartFrequency = frequency;
      this.saveScheduledRestartSettings.emit();
    }
  }

  onRestartDayToggle(dayIndex: number, checked: boolean) {
    if (!this.serverInstance) return;
    const days: number[] = this.serverInstance.restartDays ?? [];
    this.serverInstance.restartDays = checked
      ? (days.includes(dayIndex) ? days : [...days, dayIndex])
      : days.filter(day => day !== dayIndex);
    this.saveScheduledRestartSettings.emit();
  }

  /** Shows the field's error or warning, if any; true when the value may be saved. */
  validateField(fieldName: string, value: unknown): boolean {
    if (!this.serverInstance) return true;

    const validation = this.validationService.validateField(fieldName, value, this.serverInstance, this.getFieldLabel(fieldName));
    this.fieldErrors = !validation.isValid && validation.error
      ? { ...this.fieldErrors, [fieldName]: validation.error }
      : without(this.fieldErrors, fieldName);
    this.fieldWarnings = validation.warning
      ? { ...this.fieldWarnings, [fieldName]: validation.warning }
      : without(this.fieldWarnings, fieldName);
    return validation.isValid;
  }

  checkFirewallStatus() {
    this.subscriptions.add(this.firewallService.checkFirewallStatus().subscribe({
      next: (status) => {
        this.firewallStatus = status;
      },
      error: (error) => {
        console.error('[server-settings] Failed to check firewall status:', error);
      }
    }));
  }

  testClusterConnectivity() {
    const directoryPath = this.serverInstance?.clusterDirOverride;
    if (!directoryPath) {
      this.notificationService.error('No cluster directory configured');
      return;
    }

    this.notificationService.info('Testing cluster directory connection...', '', 2000);

    this.messagingService.sendMessage<{ accessible?: boolean; error?: string }>('test-directory-access', { directoryPath }).subscribe({
      next: (result) => {
        if (result?.accessible) {
          this.notificationService.success(`Successfully connected to: ${directoryPath}`, 'Cluster directory is accessible');
        } else {
          this.notificationService.error(result?.error || 'Unable to access the specified directory', 'Cluster directory not accessible');
        }
      },
      error: (error: unknown) => {
        this.notificationService.error(
          `Failed to test cluster directory: ${error instanceof Error ? error.message : String(error)}`,
          'Connection test failed'
        );
      }
    });
  }

  private getFieldLabel(fieldName: string): string {
    const field = [...this.generalFields, ...this.ratesFields, ...this.structuresFields, ...this.miscFields]
      .find(f => f.key === fieldName);
    return field ? field.label : fieldName;
  }
}
