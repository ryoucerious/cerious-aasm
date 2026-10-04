import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, OnChanges, SimpleChanges, HostListener, ChangeDetectorRef, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription, take } from 'rxjs';
import { FirewallService, FirewallStatus } from '../../core/services/firewall.service';
import { NotificationService } from '../../core/services/notification.service';
import { UtilityService } from '../../core/services/utility.service';
import { StatMultiplierService } from '../../core/services/stat-multiplier.service';
import { ArkServerValidationService } from '../../core/services/ark-server-validation.service';
import { IpcService } from '../../core/services/ipc.service';
import { MessagingService } from '../../core/services/messaging/messaging.service';
import { ConfigImportExportService } from '../../core/services/config-import-export.service';
import { ServerInstanceService } from '../../core/services/server-instance.service';
import { ServerInstance } from '../../core/models/server-instance.model';
import { ServerNavService, ServerTabId } from '../../core/services/server-nav.service';
import { AuthService } from '../../core/services/auth.service';
import { PERMISSIONS } from '../../core/models/auth.model';
import { ModalComponent } from '../modal/modal.component';
import { GeneralTabComponent } from './tabs/general-tab/general-tab.component';
import { RatesTabComponent } from './tabs/rates-tab/rates-tab.component';
import { StructuresTabComponent } from './tabs/structures-tab/structures-tab.component';
import { StatMultipliersTabComponent } from './tabs/stat-mulitpliers-tab/stat-multipliers-tab.component';
import { MiscTabComponent } from './tabs/misc-tab/misc-tab.component';
import { ClusterTabComponent } from './tabs/cluster-tab/cluster-tab.component';
import { ModsTabComponent } from './tabs/mods-tab/mods-tab.component';
import { AutomationTabComponent } from './tabs/automation-tab/automation-tab.component';
import { BackupTabComponent } from './tabs/backup-tab/backup-tab.component';
import { FirewallTabComponent } from './tabs/firewall-tab/firewall-tab.component';
import { WhitelistTabComponent } from './tabs/whitelist-tab/whitelist-tab.component';
import { DiscordTabComponent } from './tabs/discord-tab/discord-tab.component';
import { BroadcastsTabComponent } from './tabs/broadcasts-tab/broadcasts-tab.component';
import { ArkApiTabComponent } from './tabs/ark-api-tab/ark-api-tab.component';

// The page ids are shared with the sidebar; console and players are hosted elsewhere but may
// arrive through the same input while the parent switches pages.
type TabType = ServerTabId;

@Component({
  selector: 'app-server-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, ModalComponent, GeneralTabComponent, RatesTabComponent, StructuresTabComponent, StatMultipliersTabComponent, MiscTabComponent, ClusterTabComponent, ModsTabComponent, AutomationTabComponent, BackupTabComponent, FirewallTabComponent, WhitelistTabComponent, DiscordTabComponent, BroadcastsTabComponent, ArkApiTabComponent],
  templateUrl: './server-settings.component.html'
})
export class ServerSettingsComponent implements OnInit, OnDestroy, OnChanges {
  @Input() serverInstance: any;
  @Input() isVisible = true;
  @Input() activeTab: TabType = 'general';
  @Input() isLocked = false;
  @Input() generalFields: any[] = [];
  @Input() ratesFields: any[] = [];
  @Input() structuresFields: any[] = [];
  @Input() miscFields: any[] = [];
  @Input() modsFields: any[] = [];
  @Input() statList: string[] = [];
  @Input() selectedStatIndex: number | null = null;
  @Input() modsInput = '';
  @Input() modList: any[] = [];
  
  // Platform detection
  isElectron = false;
  @Input() playerStatMultiplier = 1.0;
  @Input() dinoWildStatMultiplier = 1.0;
  @Input() dinoTamedStatMultiplier = 1.0;
  @Input() dinoTamedAddStatMultiplier = 1.0;
  @Input() dinoTamedAffinityStatMultiplier = 1.0;
  @Input() dinoTamedTorpidityStatMultiplier = 1.0;
  @Input() dinoTamedClampStatMultiplier = 1.0;
  @Input() backupScheduleEnabled = false;
  @Input() backupFrequency: 'hourly' | 'daily' | 'weekly' = 'daily';
  @Input() backupTime = '02:00';
  @Input() backupDayOfWeek = 0;
  @Input() maxBackupsToKeep = 10;
  @Input() backupList: any[] = [];

  @Output() toggleVisibility = new EventEmitter<void>();
  @Output() openDirectory = new EventEmitter<void>();
  @Output() tabChanged = new EventEmitter<TabType>();
  @Output() backupTabClicked = new EventEmitter<void>();
  @Output() settingsChanged = new EventEmitter<void>();
  @Output() toggleMultiOption = new EventEmitter<{fieldKey: string, option: string, checked: boolean}>();
  @Output() mapSelected = new EventEmitter<string>();
  @Output() statMultiplierChanged = new EventEmitter<{type: string, statIndex: number, value: number}>();
  @Output() resetStatToDefaults = new EventEmitter<number>();
  @Output() copyStatToAll = new EventEmitter<number>();
  @Output() modsInputChanged = new EventEmitter<void>();
  @Output() addMod = new EventEmitter<{id: string, name: string, settings?: any}>();
  @Output() removeMod = new EventEmitter<any>();
  @Output() toggleMod = new EventEmitter<any>();
  @Output() updateModSettings = new EventEmitter<{mod: any, settings: any}>();
  @Output() createManualBackup = new EventEmitter<void>();
  @Output() backupScheduleToggle = new EventEmitter<void>();
  @Output() backupFrequencyChange = new EventEmitter<string>();
  @Output() backupTimeChange = new EventEmitter<string>();
  @Output() backupDayOfWeekChange = new EventEmitter<number>();
  @Output() maxBackupsToKeepChange = new EventEmitter<number>();
  @Output() restoreBackup = new EventEmitter<any>();
  @Output() downloadBackup = new EventEmitter<any>();
  @Output() deleteBackup = new EventEmitter<any>();
  @Output() configImported = new EventEmitter<any>();

  @ViewChild('configFileInput') configFileInput!: ElementRef<HTMLInputElement>;
  dropdownOpen = false; // For map dropdown
  statDropdownOpen = false;
  backupFrequencyDropdownOpen = false;
  backupDayDropdownOpen = false;
  restartFrequencyDropdownOpen = false;
  statSelectorDropdownOpen = false;
  exportDropdownOpen = false;

  // Copy Config modal state
  showCopyConfigModal = false;
  copyConfigDropdownOpen = false;
  allServers: ServerInstance[] = [];
  selectedSourceServer: ServerInstance | null = null;
  copyCategories: { [key: string]: boolean } = {};
  readonly configCategoryGroups = [
    {
      label: 'Game Settings',
      categories: [
        { key: 'general', label: 'General', icon: 'tune' },
        { key: 'rates', label: 'Rates', icon: 'speed' },
        { key: 'structures', label: 'Structures', icon: 'home' },
        { key: 'stats', label: 'Stat Multipliers', icon: 'bar_chart' },
        { key: 'misc', label: 'Miscellaneous', icon: 'settings' },
      ]
    },
    {
      label: 'Server Configuration',
      categories: [
        { key: 'mods', label: 'Mods', icon: 'extension' },
        { key: 'cluster', label: 'Cluster', icon: 'group_work' },
        { key: 'customIni', label: 'Custom INI', icon: 'code' },
      ]
    },
    {
      label: 'Features & Integrations',
      categories: [
        { key: 'automation', label: 'Automation', icon: 'schedule' },
        { key: 'discord', label: 'Discord', icon: 'chat' },
        { key: 'broadcasts', label: 'Broadcasts', icon: 'campaign' },
        { key: 'whitelist', label: 'Whitelist', icon: 'people' },
      ]
    }
  ];

  readonly configCategories = this.configCategoryGroups.flatMap(g => g.categories);

  // Map display value for combo input
  mapDisplayValue = '';

  // Firewall-related properties (Linux-only)
  firewallStatus: FirewallStatus | null = null;
  private subscriptions: Subscription[] = [];

  // Expert Mode / INI Editor state. Expert mode lives in ServerNavService because the sidebar
  // renders the INI pages in place of the configuration pages while it is on.
  get expertMode(): boolean {
    return this.serverNav.expertMode;
  }
  set expertMode(value: boolean) {
    this.serverNav.setExpertMode(!!value);
  }
  iniFilename = 'GameUserSettings.ini';
  iniContent = '';
  iniLoading = false;
  iniSaving = false;
  readonly iniTabs: { id: TabType; label: string; filename: string }[] = [
    { id: 'ini-GameUserSettings', label: 'GameUserSettings', filename: 'GameUserSettings.ini' },
    { id: 'ini-Game',             label: 'Game',             filename: 'Game.ini'             },
    { id: 'ini-Engine',           label: 'Engine',           filename: 'Engine.ini'           },
  ];
  readonly iniFiles = ['GameUserSettings.ini', 'Game.ini', 'Engine.ini'];

  // Validation state
  fieldErrors: { [key: string]: string } = {};
  fieldWarnings: { [key: string]: string } = {};
  canAssignManagers = false;
  canSetOperator = false;
  serverManagers: Array<{ id: string; username: string; displayName: string; roleId?: string; roleName?: string; ownerUserId?: string | null }> = [];
  operators: Array<{ id: string; username: string; displayName: string }> = [];
  assigneeRoles: Array<{ id: string; label: string }> = [];
  managerBusy = false;
  managerError = '';

  constructor(
    private firewallService: FirewallService,
    private notificationService: NotificationService,
    private utilityService: UtilityService,
    private statMultiplierService: StatMultiplierService,
    private validationService: ArkServerValidationService,
    private ipcService: IpcService,
    private messagingService: MessagingService,
    private configImportExportService: ConfigImportExportService,
    private serverInstanceService: ServerInstanceService,
    private cdr: ChangeDetectorRef,
    private serverNav: ServerNavService,
    private auth: AuthService
  ) {
    this.isElectron = this.utilityService.getPlatform() !== 'Web';
  }

  ngOnInit() {
    this.checkFirewallStatus();
    this.subscriptions.push(this.auth.identity$.subscribe(identity => {
      this.canAssignManagers = !!(identity.isAdmin || identity.user?.roleId === 'operator');
      this.canSetOperator = identity.isAdmin;
      const roles: Array<{ id: string; label: string }> = [];
      if (identity.isAdmin || this.auth.can(PERMISSIONS.ACCOUNTS_MANAGERS_CREATE)) {
        roles.push({ id: 'server-manager', label: 'Server Manager' });
      }
      if (identity.isAdmin || this.auth.can(PERMISSIONS.ACCOUNTS_ATTENDANTS_CREATE)) {
        roles.push({ id: 'attendant', label: 'Attendant' });
      }
      this.assigneeRoles = roles;
      if (this.canAssignManagers) {
        void this.refreshServerManagers();
      }
      this.cdr.markForCheck();
    }));
  }

  async refreshServerManagers(): Promise<void> {
    const directory = await this.auth.listServerManagers();
    this.serverManagers = directory.managers;
    this.operators = directory.operators;
    this.cdr.markForCheck();
  }

  async onManagerSelected(managerUserId: string | null): Promise<void> {
    if (!this.serverInstance?.id) return;
    this.managerBusy = true;
    this.managerError = '';
    const result = await this.auth.assignServerManager(this.serverInstance.id, managerUserId);
    this.managerBusy = false;
    if (!result.success) {
      this.managerError = result.error || 'Could not assign that server manager.';
    } else {
      this.serverInstance.managerUserId = managerUserId;
      this.notificationService.success(managerUserId ? 'Server assigned.' : 'Assignment cleared.');
    }
    this.cdr.markForCheck();
  }

  async onOperatorSelected(operatorUserId: string | null): Promise<void> {
    if (!this.serverInstance?.id) return;
    this.managerBusy = true;
    this.managerError = '';
    const result = await this.auth.setServerOperator(this.serverInstance.id, operatorUserId);
    this.managerBusy = false;
    if (!result.success) {
      this.managerError = result.error || 'Could not move this server.';
    } else {
      const saved = result.data as { operatorUserId?: string | null; managerUserId?: string | null } | undefined;
      this.serverInstance.operatorUserId = saved?.operatorUserId ?? operatorUserId;
      if (saved && 'managerUserId' in saved) this.serverInstance.managerUserId = saved.managerUserId || null;
      this.notificationService.success(operatorUserId ? 'Server moved to that operator.' : 'Server moved to the admin pool.');
    }
    this.cdr.markForCheck();
  }

  async onCreateManager(input: { username: string; password: string; displayName: string; roleId: string }): Promise<void> {
    if (!this.serverInstance?.id) return;
    this.managerBusy = true;
    this.managerError = '';
    const created = await this.auth.createServerManager({
      ...input,
      ownerUserId: this.serverInstance?.operatorUserId || null
    });
    if (!created.success || !created.data) {
      this.managerBusy = false;
      this.managerError = created.error || 'Could not add that account.';
      this.cdr.markForCheck();
      return;
    }
    const assigned = await this.auth.assignServerManager(this.serverInstance.id, created.data.id);
    this.managerBusy = false;
    if (!assigned.success) {
      this.managerError = assigned.error || 'The account was created, but this server was not assigned.';
      await this.refreshServerManagers();
      this.cdr.markForCheck();
      return;
    }
    this.serverInstance.managerUserId = created.data.id;
    await this.refreshServerManagers();
    this.notificationService.success(`${created.data.displayName || created.data.username} now has this server.`);
    this.cdr.markForCheck();
  }

  ngOnChanges(changes: SimpleChanges) {
    // Update map display value when serverInstance changes
    if (this.serverInstance?.mapName) {
      this.mapDisplayValue = this.getMapDisplayName(this.serverInstance.mapName);
    } else {
      this.mapDisplayValue = '';
    }

    // The page is chosen by the route now, so an INI page arriving as an input must load its file.
    const tabChanged = !!changes['activeTab'] || !!changes['serverInstance'];
    const iniTab = this.iniTabs.find(t => t.id === this.activeTab);
    if (tabChanged && iniTab && this.serverInstance?.id) {
      if (!this.expertMode) this.expertMode = true;
      if (this.iniFilename !== iniTab.filename || changes['activeTab']?.firstChange || changes['serverInstance']) {
        this.iniFilename = iniTab.filename;
        this.loadIniFile();
      }
    }
  }

  /** Title shown in the toolbar above the page content. */
  get pageTitle(): string {
    const iniTab = this.iniTabs.find(t => t.id === this.activeTab);
    if (iniTab) return iniTab.label;
    const labels: Record<string, string> = {
      general: 'General', rates: 'Rates', structures: 'Structures', stats: 'Stat Multipliers',
      misc: 'Miscellaneous', cluster: 'Cluster', mods: 'Mods', arkapi: 'ArkApi', whitelist: 'Whitelist',
      automation: 'Automation', broadcasts: 'Broadcasts', discord: 'Discord', firewall: 'Firewall', backup: 'Backup'
    };
    return labels[this.activeTab] || 'Settings';
  }

  /** Expert mode only applies to the configuration pages; other pages hide the toggle. */
  get showExpertToggle(): boolean {
    const configTabs = ['general', 'rates', 'structures', 'stats', 'misc', 'cluster'];
    return configTabs.includes(this.activeTab) || this.isInIniTab;
  }

  ngOnDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  get isLinux(): boolean {
    return this.firewallStatus?.platform === 'linux';
  }

  get isAutomationLocked(): boolean {
    // Automation settings should always be editable regardless of server state
    return false;
  }

  get isBackupLocked(): boolean {
    // Backup settings should always be editable regardless of server state
    return false;
  }

  onTabChange(tab: TabType) {
    this.activeTab = tab as any;
    this.tabChanged.emit(tab);
    const iniTab = this.iniTabs.find(t => t.id === tab);
    if (iniTab && this.serverInstance?.id) {
      this.iniFilename = iniTab.filename;
      this.loadIniFile();
    }
  }

  /** Hosts pass 'players' etc. through the same input; anything outside this component's pages shows nothing. */
  get isKnownTab(): boolean {
    return this.activeTab !== ('console' as any) && this.activeTab !== 'players';
  }

  toggleExpertMode(event: Event) {
    this.expertMode = (event.target as HTMLInputElement).checked;
    if (this.expertMode) {
      this.onTabChange('ini-GameUserSettings');
    } else {
      this.onTabChange('general');
    }
    this.cdr.markForCheck();
  }

  get isInIniTab(): boolean {
    return this.iniTabs.some(t => t.id === this.activeTab);
  }

  loadIniFile() {
    if (!this.serverInstance?.id) return;
    this.iniLoading = true;
    this.iniContent = '';
    this.cdr.markForCheck();
    this.messagingService.sendMessage('get-ini-file', { instanceId: this.serverInstance.id, filename: this.iniFilename })
      .subscribe({
        next: (res: any) => {
          if (res?.success === false) {
            this.notificationService.error(res?.error || 'Failed to load INI file.', 'Expert Mode');
          } else {
            this.iniContent = res?.content ?? '';
          }
          this.iniLoading = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.notificationService.error('Failed to load INI file.', 'Expert Mode');
          this.iniLoading = false;
          this.cdr.markForCheck();
        }
      });
  }

  saveIniFile() {
    if (!this.serverInstance?.id) return;
    this.iniSaving = true;
    this.cdr.markForCheck();
    this.messagingService.sendMessage('save-ini-file', { instanceId: this.serverInstance.id, filename: this.iniFilename, content: this.iniContent })
      .subscribe({
        next: (res: any) => {
          if (res?.success) {
            this.notificationService.success(`Saved ${this.iniFilename}`, 'Expert Mode');
          } else {
            this.notificationService.error(res?.error || 'Save failed.', 'Expert Mode');
          }
          this.iniSaving = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.notificationService.error('Failed to save INI file.', 'Expert Mode');
          this.iniSaving = false;
          this.cdr.markForCheck();
        }
      });
  }

  onToggleVisibility() {
    this.toggleVisibility.emit();
  }

  onOpenDirectory(event: Event) {
    event.stopPropagation();
    this.openDirectory.emit();
  }

  toggleExportDropdown(event: Event) {
    event.stopPropagation();
    // Legacy – no longer used
  }

  onExportConfig(event: Event) {
    event.stopPropagation();
    if (!this.serverInstance?.id) return;

    this.configImportExportService.exportAsZip(this.serverInstance.id).subscribe({
      next: (result) => {
        if (result.success && result.base64) {
          const fileName = result.suggestedFileName || `${this.serverInstance.serverName || 'server'}-config.zip`;
          this.configImportExportService.downloadBase64AsFile(result.base64, fileName, 'application/zip');
          this.notificationService.success('Configuration exported as ZIP successfully');
        } else {
          this.notificationService.error(result.error || 'Failed to export configuration');
        }
      },
      error: (err) => {
        this.notificationService.error('Failed to export configuration: ' + (err.message || err));
      }
    });
  }

  onImportConfig(event: Event) {
    event.stopPropagation();
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
            // Merge imported config into the current server instance
            Object.keys(result.config).forEach(key => {
              if (key !== 'id' && key !== 'installDir') {
                (this.serverInstance as any)[key] = result.config[key];
              }
            });
            this.configImported.emit(result.config);
            this.settingsChanged.emit();
            this.cdr.detectChanges();

            const warnings = result.warnings?.length ? ` (${result.warnings.length} warning(s))` : '';
            this.notificationService.success(`Configuration imported successfully${warnings}`);
          } else {
            this.notificationService.error(result.error || 'Failed to import configuration');
          }
        },
        error: (err) => {
          this.notificationService.error('Failed to import configuration: ' + (err.message || err));
        }
      });
    };
    reader.onerror = () => {
      this.notificationService.error('Failed to read file');
    };
    reader.readAsText(file);
  }

  onBackupTabClick() {
    this.backupTabClicked.emit();
  }

  onSaveSettings() {
    this.settingsChanged.emit();
  }

  onWhitelistStatusUpdate(event: {message: string, type: 'success' | 'error' | 'warning'}) {
    // You can emit this to parent component or handle it locally
    // For now, we'll just log it - you can integrate with your notification system
    console.log(`Whitelist ${event.type}: ${event.message}`);
  }

  onToggleMultiOption(fieldKey: string, option: string, checked: boolean) {
    this.toggleMultiOption.emit({ fieldKey, option, checked });
  }

  onMapSelect(value: string, fieldKey?: string) {
    this.dropdownOpen = false;
    if (fieldKey) {
      this.serverInstance[fieldKey] = value;
      if (fieldKey === 'mapName') {
        this.mapDisplayValue = this.getMapDisplayName(value);
      }
    }
    this.mapSelected.emit(value);
  }

  onMapInput(event: Event, fieldKey?: string) {
    const input = event.target as HTMLInputElement;
    const displayValue = input.value;
    
    if (fieldKey) {
      if (fieldKey === 'mapName') {
        this.mapDisplayValue = displayValue;
        // For custom maps, use the display value directly
        // For known maps, we need to convert back to the actual value
        const mapField = this.generalFields?.find(field => field.key === 'mapName');
        if (mapField?.options) {
          const option = mapField.options.find((opt: any) => opt.display === displayValue);
          this.serverInstance.mapName = option ? option.value : displayValue;
        } else {
          this.serverInstance.mapName = displayValue;
        }
      } else {
        this.serverInstance[fieldKey] = displayValue;
      }
    }
    
    // Emit the actual value for validation
    this.mapSelected.emit(this.serverInstance[fieldKey || 'mapName']);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    const target = event.target as HTMLElement;
    
    // Check if the click is outside any dropdown
    if (!target.closest('.custom-dropdown')) {
      this.closeAllDropdowns();
    }
  }

  closeAllDropdowns(): void {
    this.dropdownOpen = false;
    this.statDropdownOpen = false;
    this.backupFrequencyDropdownOpen = false;
    this.backupDayDropdownOpen = false;
    this.restartFrequencyDropdownOpen = false;
    this.statSelectorDropdownOpen = false;
    this.exportDropdownOpen = false;
    this.cdr.markForCheck();
  }

  toggleStatDropdown(): void {
    this.closeAllDropdowns();
    this.statDropdownOpen = !this.statDropdownOpen;
  }

  toggleBackupFrequencyDropdown(): void {
    this.closeAllDropdowns();
    this.backupFrequencyDropdownOpen = !this.backupFrequencyDropdownOpen;
  }

  toggleBackupDayDropdown(): void {
    this.closeAllDropdowns();
    this.backupDayDropdownOpen = !this.backupDayDropdownOpen;
  }

  toggleRestartFrequencyDropdown(): void {
    this.closeAllDropdowns();
    this.restartFrequencyDropdownOpen = !this.restartFrequencyDropdownOpen;
  }

  onStatSelect(index: number): void {
    this.selectedStatIndex = index;
    this.statDropdownOpen = false;
    // Emit the change event if needed
  }

  onBackupFrequencySelect(frequency: string): void {
    this.backupFrequencyDropdownOpen = false;
    this.backupFrequencyChange.emit(frequency);
  }

  onBackupDaySelect(day: number): void {
    this.backupDayDropdownOpen = false;
    this.backupDayOfWeekChange.emit(day);
  }

  onRestartFrequencySelect(frequency: string): void {
    this.restartFrequencyDropdownOpen = false;
    // Update the server instance and save
    if (this.serverInstance) {
      this.serverInstance.restartFrequency = frequency;
      this.onSaveScheduledRestartSettings();
    }
  }

  getStatDisplayName(index: number): string {
    return this.statList[index] || `Stat ${index + 1}`;
  }

  getBackupFrequencyDisplayName(frequency: string): string {
    const frequencyMap: { [key: string]: string } = {
      'hourly': 'Every Hour',
      'daily': 'Daily', 
      'weekly': 'Weekly'
    };
    return frequencyMap[frequency] || frequency;
  }

  getBackupDayDisplayName(day: number): string {
    const dayMap: { [key: number]: string } = {
      0: 'Sunday',
      1: 'Monday',
      2: 'Tuesday',
      3: 'Wednesday', 
      4: 'Thursday',
      5: 'Friday',
      6: 'Saturday'
    };
    return dayMap[day] || `Day ${day}`;
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

  getBackupFrequencyOptions(): Array<{value: string, display: string}> {
    return [
      { value: 'hourly', display: 'Every Hour' },
      { value: 'daily', display: 'Daily' },
      { value: 'weekly', display: 'Weekly' }
    ];
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

  toggleStatSelectorDropdown(): void {
    this.closeAllDropdowns();
    this.statSelectorDropdownOpen = !this.statSelectorDropdownOpen;
  }

  onStatSelectorSelect(index: number): void {
    this.selectedStatIndex = index;
    this.statSelectorDropdownOpen = false;
  }

  getStatSelectorDisplayName(index: number | null): string {
    if (index === null || index === undefined) {
      return 'Select stat...';
    }
    return this.statList[index] || 'Select stat...';
  }

  getMapDisplayName(mapName: string): string {
    if (!mapName) return '';

    // Find the map field in generalFields
    const mapField = this.generalFields?.find(field => field.key === 'mapName');
    if (mapField?.options) {
      // Find the option with matching value and return its display name
      const option = mapField.options.find((opt: any) => opt.value === mapName);
      if (option) {
        return option.display;
      }
    }

    // For custom maps, return the map name as-is (without _WP suffix if present)
    return mapName.replace(/_WP$/, '');
  }

  getStatMultiplier(type: string, statIndex: number): number {
    // Use the service to get the actual stat-specific multiplier value
    return this.statMultiplierService.getStatMultiplier(this.serverInstance, type, statIndex);
  }

  onStatMultiplierChange(type: string, statIndex: number, value: number) {
    // Update the value using the service
    this.statMultiplierService.setStatMultiplier(this.serverInstance, type, statIndex, value);
    // Emit the change event for parent component
    this.statMultiplierChanged.emit({ type, statIndex, value });
  }

  onResetStatToDefaults(statIndex: number) {
    this.resetStatToDefaults.emit(statIndex);
  }

  onCopyStatToAll(statIndex: number) {
    this.copyStatToAll.emit(statIndex);
  }

  onModsInputChange() {
    this.modsInputChanged.emit();
  }

  onRemoveMod(mod: any) {
    this.removeMod.emit(mod);
  }

  onToggleMod(mod: any) {
    this.toggleMod.emit(mod);
  }

  trackByModId(index: number, mod: any): any {
    return mod ? mod.id : index;
  }

  // Backup methods
  onCreateManualBackup() {
    this.createManualBackup.emit();
  }

  onBackupScheduleToggle() {
    this.backupScheduleToggle.emit();
  }

  onBackupFrequencyChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    this.backupFrequencyChange.emit(target.value);
  }

  onBackupTimeChange(event: Event) {
    const target = event.target as HTMLInputElement;
    this.backupTimeChange.emit(target.value);
  }

  onBackupDayOfWeekChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    this.backupDayOfWeekChange.emit(parseInt(target.value));
  }

  onMaxBackupsToKeepChange(event: Event) {
    const target = event.target as HTMLInputElement;
    this.maxBackupsToKeepChange.emit(parseInt(target.value));
  }

  onRestoreBackup(backup: any) {
    this.restoreBackup.emit(backup);
  }

  onDownloadBackup(backup: any) {
    this.downloadBackup.emit(backup);
  }

  onDeleteBackup(backup: any) {
    this.deleteBackup.emit(backup);
  }

  trackByBackupId(index: number, backup: any): any {
    return backup ? backup.id : index;
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  getFormattedDate(dateValue: any): string {
    if (!dateValue) return 'Unknown';
    const date = new Date(dateValue);
    return date.toLocaleString();
  }

  getFieldsByCategory(category: string): any[] {
    const categories = {
      'experience': [
        'xpMultiplier',
        'overrideOfficialDifficulty',
        'difficultyOffset'
      ],
      'taming': [
        'tamingSpeedMultiplier',
        'eggHatchSpeedMultiplier',
        'babyMatureSpeedMultiplier',
        'matingIntervalMultiplier',
        'babyFoodConsumptionSpeedMultiplier',
        'babyCuddleIntervalMultiplier',
        'babyImprintingStatScaleMultiplier',
        'babyCuddleGracePeriodMultiplier',
        'babyCuddleLoseImprintQualitySpeedMultiplier',
        'babyImprintAmountMultiplier',
        'babyMaxIntervalMultiplier'
      ],
      'harvesting': [
        'harvestAmountMultiplier',
        'dinoHarvestingDamageMultiplier',
        'playerHarvestingDamageMultiplier',
        'resourcesRespawnPeriodMultiplier',
        'cropGrowthSpeedMultiplier',
        'cropDecaySpeedMultiplier'
      ],
      'stats': [
        'playerCharacterFoodDrainMultiplier',
        'playerCharacterStaminaDrainMultiplier',
        'playerCharacterHealthRecoveryMultiplier',
        'playerCharacterWaterDrainMultiplier',
        'playerCharacterDamageMultiplier',
        'playerCharacterResistanceMultiplier',
        'dinoCharacterFoodDrainMultiplier',
        'dinoCharacterStaminaDrainMultiplier',
        'dinoCharacterHealthRecoveryMultiplier',
        'dinoCharacterDamageMultiplier',
        'dinoCharacterResistanceMultiplier'
      ],
      'world': [
        'dayCycleSpeedScale',
        'dayTimeSpeedScale',
        'nightTimeSpeedScale',
        'fuelConsumptionIntervalMultiplier'
      ]
    };

    const categoryKeys = categories[category as keyof typeof categories] || [];
    return this.ratesFields.filter(field => categoryKeys.includes(field.key));
  }

  // Automation-related properties and methods
  weekDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  @Output() saveAutomationSettings = new EventEmitter<void>();
  @Output() saveAutoStartSettings = new EventEmitter<void>();
  @Output() saveCrashDetectionSettings = new EventEmitter<void>();
  @Output() saveScheduledRestartSettings = new EventEmitter<void>();

  onSaveAutomationSettings() {
    this.saveAutomationSettings.emit();
  }

  onSaveAutoStartSettings() {
    this.saveAutoStartSettings.emit();
  }

  onSaveCrashDetectionSettings() {
    this.saveCrashDetectionSettings.emit();
  }

  onSaveScheduledRestartSettings() {
    this.saveScheduledRestartSettings.emit();
  }

  isRestartDaySelected(dayIndex: number): boolean {
    if (!this.serverInstance?.restartDays) return false;
    return this.serverInstance.restartDays.includes(dayIndex);
  }

  onRestartDayToggle(dayIndex: number, event: any) {
    if (!this.serverInstance) return;
    
    if (!this.serverInstance.restartDays) {
      this.serverInstance.restartDays = [];
    }

    if (event.target.checked) {
      if (!this.serverInstance.restartDays.includes(dayIndex)) {
        this.serverInstance.restartDays.push(dayIndex);
      }
    } else {
      const index = this.serverInstance.restartDays.indexOf(dayIndex);
      if (index > -1) {
        this.serverInstance.restartDays.splice(index, 1);
      }
    }

    this.onSaveScheduledRestartSettings();
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

  // Validation methods
  validateField(fieldName: string, value: any) {
    if (!this.serverInstance) return;

    // Handle special test connectivity event
    if (fieldName === 'testConnectivity') {
      this.testClusterConnectivity();
      return;
    }

    // Find the field label from the field definitions
    const fieldLabel = this.getFieldLabel(fieldName);
    const validation = this.validationService.validateField(fieldName, value, this.serverInstance, fieldLabel);
    
    if (!validation.isValid && validation.error) {
      this.fieldErrors[fieldName] = validation.error;
    } else {
      delete this.fieldErrors[fieldName];
    }

    if (validation.warning) {
      this.fieldWarnings[fieldName] = validation.warning;
    } else {
      delete this.fieldWarnings[fieldName];
    }

    this.cdr.detectChanges();
  }

  hasFieldError(fieldName: string): boolean {
    return !!this.fieldErrors[fieldName];
  }

  getFieldError(fieldName: string): string {
    return this.fieldErrors[fieldName] || '';
  }

  hasFieldWarning(fieldName: string): boolean {
    return !!this.fieldWarnings[fieldName];
  }

  getFieldWarning(fieldName: string): string {
    return this.fieldWarnings[fieldName] || '';
  }

  // Helper method to get field label from field definitions
  private getFieldLabel(fieldName: string): string {
    // Search through all field arrays to find the matching field
    const allFields = [
      ...(this.generalFields || []),
      ...(this.ratesFields || []),
      ...(this.structuresFields || []),
      ...(this.miscFields || []),
      ...(this.modsFields || [])
    ];

    const field = allFields.find(f => f.key === fieldName);
    return field ? field.label : fieldName; // Fallback to fieldName if label not found
  }

  // Firewall management methods (Linux-only)
  checkFirewallStatus() {
    const sub = this.firewallService.checkFirewallStatus().subscribe({
      next: (status) => {
        this.firewallStatus = status;
      },
      error: (error) => {
        console.error('Failed to check firewall status:', error);
      }
    });
    this.subscriptions.push(sub);
  }

  // Cluster connectivity testing
  testClusterConnectivity() {
    if (!this.serverInstance?.clusterDirOverride) {
      this.notificationService.error('No cluster directory configured');
      return;
    }

    // Show loading notification
    this.notificationService.info('Testing cluster directory connection...', '', 2000);

    // Use MessagingService to test directory access
    this.messagingService.sendMessage('test-directory-access', {
      directoryPath: this.serverInstance.clusterDirOverride
    }).subscribe({
      next: (result: any) => {
        if (result.accessible) {
          this.notificationService.success('Cluster directory is accessible',
            `Successfully connected to: ${this.serverInstance.clusterDirOverride}`);
        } else {
          this.notificationService.error('Cluster directory not accessible',
            result.error || 'Unable to access the specified directory');
        }
      },
      error: (error: any) => {
        this.notificationService.error('Connection test failed',
          `Failed to test cluster directory: ${error.message || error}`);
      }
    });
  }

  // ==================== Copy Config Methods ====================

  private readonly categoryKeyMap: { [category: string]: string[] } = {
    general: ['sessionName', 'mapName', 'maxPlayers', 'serverPassword', 'serverAdminPassword', 'crossplay', 'launchParameters'],
    rates: [
      'xpMultiplier', 'tamingSpeedMultiplier', 'harvestAmountMultiplier',
      'dinoCharacterFoodDrainMultiplier', 'dinoCharacterStaminaDrainMultiplier', 'dinoCharacterHealthRecoveryMultiplier',
      'dinoCountMultiplier', 'playerCharacterFoodDrainMultiplier', 'playerCharacterStaminaDrainMultiplier',
      'playerCharacterHealthRecoveryMultiplier', 'playerCharacterWaterDrainMultiplier',
      'playerCharacterDamageMultiplier', 'playerCharacterResistanceMultiplier',
      'dinoCharacterDamageMultiplier', 'dinoCharacterResistanceMultiplier',
      'difficultyOffset', 'overrideOfficialDifficulty', 'maxDifficulty',
      'dayCycleSpeedScale', 'dayTimeSpeedScale', 'nightTimeSpeedScale',
      'dinoHarvestingDamageMultiplier', 'playerHarvestingDamageMultiplier',
      'resourcesRespawnPeriodMultiplier', 'globalSpoilingTimeMultiplier',
      'globalItemDecompositionTimeMultiplier', 'globalCorpseDecompositionTimeMultiplier',
      'cropGrowthSpeedMultiplier', 'cropDecaySpeedMultiplier',
      'matingIntervalMultiplier', 'matingSpeedMultiplier', 'eggHatchSpeedMultiplier',
      'babyMatureSpeedMultiplier', 'babyFoodConsumptionSpeedMultiplier', 'babyCuddleIntervalMultiplier',
      'babyImprintingStatScaleMultiplier', 'babyCuddleGracePeriodMultiplier',
      'babyCuddleLoseImprintQualitySpeedMultiplier', 'babyImprintAmountMultiplier', 'babyMaxIntervalMultiplier',
      'supplyCrateLootQualityMultiplier', 'fishingLootQualityMultiplier',
      'layEggIntervalMultiplier', 'fuelConsumptionIntervalMultiplier',
      'raidDinoCharacterFoodDrainMultiplier', 'passiveTameIntervalMultiplier',
      'tamedDinoCharacterFoodDrainMultiplier', 'tamedDinoTorporDrainMultiplier',
      'wildDinoCharacterFoodDrainMultiplier', 'wildDinoTorporDrainMultiplier',
      'oviraptorEggConsumptionMultiplier', 'useCorpseLifeSpanMultiplier',
      'overrideMaxExperiencePointsPlayer', 'overrideMaxExperiencePointsDino',
    ],
    structures: [
      'structureResistanceMultiplier', 'structureDamageMultiplier',
      'perPlatformMaxStructuresMultiplier', 'platformSaddleBuildAreaBoundsMultiplier',
      'maxPlatformSaddleStructureLimit', 'maxGateFrameOnSaddles',
      'structurePreventResourceRadiusMultiplier', 'structurePickupTimeAfterPlacement',
      'structurePickupHoldDuration', 'allowIntegratedSPlusStructures',
      'bAllowPlatformSaddleStacking', 'bAllowPlatformSaddleMultiFloors',
      'allowCaveBuildingPvE', 'autoDestroyOldStructuresMultiplier',
      'maxStructuresInRange', 'pvePlatformStructureDamageRatio',
      'enableExtraStructurePreventionVolumes', 'bEnableExtraStructurePreventionVolumes',
      'pvpStructureDecay', 'disableStructureDecayPvE', 'bDisableStructureDecayPvE',
      'bDisableStructurePlacementCollision', 'allowCrateSpawnsOnTopOfStructures',
      'overrideStructurePlatformPrevention', 'forceAllStructureLocking',
    ],
    stats: [
      'perLevelStatsMultiplier_Player', 'perLevelStatsMultiplier_DinoTamed',
      'perLevelStatsMultiplier_DinoWild', 'perLevelStatsMultiplier_DinoTamed_Add',
      'perLevelStatsMultiplier_DinoTamed_Affinity', 'perLevelStatsMultiplier_DinoTamed_Torpidity',
      'perLevelStatsMultiplier_DinoTamed_Clamp',
    ],
    misc: [
      'bPvE', 'serverPVE', 'allowThirdPersonPlayer', 'allowThirdPerson',
      'showMapPlayerLocation', 'serverCrosshair', 'serverForceNoHUD',
      'showFloatingDamageText', 'bAutoUnlockAllEngrams', 'bAllowUnlimitedRespecs',
      'serverHardcore', 'globalVoiceChat', 'proximityChat',
      'adminLogging', 'allowHitMarkers', 'enablePVPGamma', 'disablePvEGamma',
      'allowFlyerCarryPvE', 'forceAllowCaveFlyers',
      'bDisableDinoRiding', 'bAllowFlyerSpeedLeveling', 'bAllowSpeedLeveling',
      'alwaysNotifyPlayerLeft', 'alwaysNotifyPlayerJoined',
      'noTributeDownloads', 'preventDownloadDinos', 'preventDownloadItems', 'preventDownloadSurvivors',
      'preventUploadDinos', 'preventUploadItems', 'preventUploadSurvivors',
      'crossArkAllowForeignDinoDownloads',
      'allowAnyoneBabyImprintCuddle', 'disableImprintDinoBuff', 'disableImprinting',
      'allowRaidDinoFeeding', 'onlyAllowSpecifiedEngrams',
      'preventOfflinePvP', 'preventOfflinePvPInterval',
      'maxTamedDinos', 'maxPersonalTamedDinos', 'personalTamedDinosSaddleStructureCost',
      'useOptimizedHarvestingHealth', 'allowMultipleAttachedC4',
      'enableCryoSicknessPVE', 'itemStackSizeMultiplier',
      'disableCryopodFridgeRequirement', 'disableCryopodEnemyCheck', 'allowCryoFridgeOnSaddle',
      'maxNumberOfPlayersInTribe', 'kickIdlePlayersPeriod', 'autoSavePeriodMinutes',
      'allowCustomRecipes', 'customRecipeEffectivenessMultiplier', 'customRecipeSkillMultiplier',
      'dinoTurretDamageMultiplier', 'clampResourceHarvestDamage',
      'autoDestroyDecayedDinos', 'preventMateBoost',
      'passiveDefensesDamageRiderlessDinos', 'tribeNameChangeCooldown',
      'bDisableFriendlyFire', 'bDisableLootCrates', 'bDisableWeatherFog',
      'bIncreasePvPRespawnInterval', 'bPvEDisableFriendlyFire',
      'bPvEAllowTribeWar', 'bPvEAllowTribeWarCancel',
      'bServerGameLogEnabled', 'bShowCreativeMode', 'bUseCorpseLocator', 'bUseSingleplayerSettings',
    ],
    cluster: [
      'clusterId', 'clusterName', 'clusterOrder', 'clusterRole',
      'clusterDirOverride', 'noTransferFromFiltering',
    ],
    mods: ['mods'],
    automation: [
      'autoStartOnAppLaunch', 'crashDetectionEnabled', 'crashDetectionInterval',
      'maxRestartAttempts', 'scheduledRestartEnabled', 'restartFrequency',
      'restartTime', 'restartDays', 'restartWarningMinutes',
    ],
    whitelist: [
      'useExclusiveList', 'exclusiveJoinPlayerIds', 'exclusiveJoinPlayers', 'whitelistKickMessage',
    ],
    discord: ['discordConfig'],
    broadcasts: ['broadcastConfig'],
    customIni: ['customGameIni', 'customGameUserSettingsIni'],
  };

  onOpenCopyConfig(event: Event) {
    event.stopPropagation();
    // Reset state
    this.selectedSourceServer = null;
    this.copyConfigDropdownOpen = false;
    this.configCategories.forEach(cat => this.copyCategories[cat.key] = false);
    // Load servers (exclude current)
    this.serverInstanceService.getInstances().pipe(take(1)).subscribe(servers => {
      this.allServers = (servers || []).filter((s: ServerInstance) => s.id !== this.serverInstance?.id);
      this.showCopyConfigModal = true;
      this.cdr.markForCheck();
    });
  }

  onCloseCopyConfig() {
    this.showCopyConfigModal = false;
    this.copyConfigDropdownOpen = false;
    this.cdr.markForCheck();
  }

  toggleCopyConfigDropdown() {
    this.copyConfigDropdownOpen = !this.copyConfigDropdownOpen;
  }

  onSelectSourceServer(server: ServerInstance) {
    this.selectedSourceServer = server;
    this.copyConfigDropdownOpen = false;
    this.cdr.markForCheck();
  }

  getSourceServerDisplayName(): string {
    if (!this.selectedSourceServer) return '';
    const name = this.selectedSourceServer.sessionName || this.selectedSourceServer.name || 'Unnamed';
    const map = this.selectedSourceServer.mapName || 'Unknown Map';
    return `${name} (${map})`;
  }

  get hasAnyCategorySelected(): boolean {
    return Object.values(this.copyCategories).some(v => v);
  }

  toggleAllCategories(checked: boolean) {
    this.configCategories.forEach(cat => this.copyCategories[cat.key] = checked);
  }

  onApplyCopyConfig() {
    if (!this.selectedSourceServer || !this.serverInstance) return;
    const selectedKeys: string[] = [];
    for (const cat of this.configCategories) {
      if (this.copyCategories[cat.key]) {
        selectedKeys.push(...(this.categoryKeyMap[cat.key] || []));
      }
    }
    if (selectedKeys.length === 0) {
      this.notificationService.warning('No Categories Selected', 'Please select at least one category to copy.');
      return;
    }
    const source = this.selectedSourceServer as any;
    const target = this.serverInstance as any;
    let copiedCount = 0;
    for (const key of selectedKeys) {
      if (source[key] !== undefined) {
        // Deep copy arrays and objects
        if (Array.isArray(source[key])) {
          target[key] = JSON.parse(JSON.stringify(source[key]));
        } else if (typeof source[key] === 'object' && source[key] !== null) {
          target[key] = JSON.parse(JSON.stringify(source[key]));
        } else {
          target[key] = source[key];
        }
        copiedCount++;
      }
    }
    this.showCopyConfigModal = false;
    this.settingsChanged.emit();
    this.cdr.markForCheck();
    const categoryNames = this.configCategories
      .filter(cat => this.copyCategories[cat.key])
      .map(cat => cat.label)
      .join(', ');
    this.notificationService.success(
      'Config Copied',
      `Copied ${copiedCount} settings from "${this.selectedSourceServer.sessionName || this.selectedSourceServer.name}" (${categoryNames})`
    );
  }
}
