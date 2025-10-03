import { Component, OnInit, OnDestroy, ChangeDetectorRef, ViewChild, ElementRef, AfterViewInit, HostListener } from '@angular/core';
import { NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MessagingService } from '../../core/services/messaging/messaging.service';
import { ServerInstanceService } from '../../core/services/server-instance.service';

import { StatMultiplierService } from '../../core/services/stat-multiplier.service';
import { RconManagementService } from '../../core/services/rcon-management.service';
import { ServerStateService } from '../../core/services/server-state.service';
import { AutomationService } from '../../core/services/automation.service';
import { NotificationService } from '../../core/services/notification.service';
import { ServerConfigurationService } from '../../core/services/server-configuration.service';
import { BackupUIService } from '../../core/services/backup-ui.service';
import { ServerLifecycleService } from '../../core/services/server-lifecycle.service';
import { EventSubscriptionService } from '../../core/services/event-subscription.service';
import { UtilityService } from '../../core/services/utility.service';
import { Subscription, take } from 'rxjs';
import { ModalComponent } from '../../components/modal/modal.component';
import { ServerStateComponent } from '../../components/server-state/server-state.component';
import { RconControlComponent } from '../../components/rcon-control/rcon-control.component';
import { ServerSettingsComponent } from '../../components/server-settings/server-settings.component';

@Component({
  selector: 'app-server',
  standalone: true,
  imports: [NgIf, FormsModule, ModalComponent, ServerStateComponent, RconControlComponent, ServerSettingsComponent],
  templateUrl: './server.component.html'
})
export class ServerComponent implements OnInit, OnDestroy, AfterViewInit {
  get generalFields() {
    return this.advancedSettingsMeta.filter(f => f.tab === 'general');
  }
  get ratesFields() {
    return this.advancedSettingsMeta.filter(f => f.tab === 'rates');
  }
  get structuresPvpFields() {
    return this.advancedSettingsMeta.filter(f => f.tab === 'structures');
  }
  get miscFields() {
    return this.advancedSettingsMeta.filter(f => f.tab === 'misc');
  }
  get modsFields() {
    return this.advancedSettingsMeta.filter(f => f.tab === 'mods');
  }
  advancedSettingsMeta: any[] = [];
  // For Bootstrap dropdown map selection
  setMap(map: string, event?: Event) {
    if (event) { event.preventDefault(); }
    if (this.activeServerInstance) {
      this.activeServerInstance.mapName = map;
      this.saveSettings();
    }
  }

  getMapDisplayName(mapName: string): string {
    return this.mapDisplayName(mapName);
  }
  // -------------------- Properties --------------------
  dropdownOpen = false;
  rconInputFocused = false;
  showRcon = true;
  rconConnected = false;
  rconMessage = '';
  rconLastResponse = '';
  get knownRconCommands() {
    return this.rconManagementService.getKnownCommands();
  }
  get crossplayPlatforms() {
    return this.serverConfigurationService.crossplayPlatforms;
  }
  activeTab: 'general' | 'rates' | 'structures' | 'misc' | 'mods' | 'stats' | 'automation' | 'backup' | 'cluster' | 'firewall' | 'whitelist' = 'general';
  modsInput: string = '';
  modList: any[] = [];
  installProgress: { percent: number, step: string, message: string, phase?: string } | null = null;
  installOutput: string[] = [];
  showServerState = true;
  showServerSettings = true;
  activeServerInstance: any = null;
  originalServerInstance: any = null; // Keep track of original values for change detection
  private activeServerSub?: Subscription;
  private subscriptions: Subscription[] = [];
  @ViewChild('logContainer') logContainer?: ElementRef<HTMLDivElement>;

  // Backup UI state (now managed by BackupUIService)
  get backupScheduleEnabled() { return this.backupUIService.currentState.backupScheduleEnabled; }
  get backupFrequency() { return this.backupUIService.currentState.backupFrequency; }
  get backupTime() { return this.backupUIService.currentState.backupTime; }
  get backupDayOfWeek() { return this.backupUIService.currentState.backupDayOfWeek; }
  get maxBackupsToKeep() { return this.backupUIService.currentState.maxBackupsToKeep; }
  get backupList() { return this.backupUIService.currentState.backupList; }
  get showBackupNameModal() { return this.backupUIService.currentState.showBackupNameModal; }
  get showDeleteBackupModal() { return this.backupUIService.currentState.showDeleteBackupModal; }
  get backupName() { return this.backupUIService.currentState.backupName; }
  set backupName(value: string) { this.backupUIService.updateBackupName(value); }
  get backupToDelete() { return this.backupUIService.currentState.backupToDelete; }
  get isCreatingBackup() { return this.backupUIService.currentState.isCreatingBackup; }

  // Stat multipliers tab UI
  statList: string[] = [
    'Health', 'Stamina', 'Torpidity', 'Oxygen', 'Food', 'Water', 'Temperature', 'Weight', 'MeleeDamage', 'MovementSpeed', 'Fortitude', 'CraftingSkill'
  ];
  selectedStatIndex: number = 0;

  // -------------------- Getters --------------------
  get filteredLogs() {
    if (!this.activeServerInstance?.id) return [];
    return this.serverStateService.getLogsForInstance(this.activeServerInstance.id);
  }

  get settingsLocked(): boolean {
    return this.serverStateService.areSettingsLocked(this.activeServerInstance?.state);
  }

  get backupSettingsLocked(): boolean {
    return this.serverStateService.areBackupSettingsLocked(this.activeServerInstance?.state);
  }

  // -------------------- Lifecycle Hooks --------------------
  constructor(
    private messaging: MessagingService,
    private serverInstanceService: ServerInstanceService,
    private statMultiplierService: StatMultiplierService,
    private rconManagementService: RconManagementService,
    private serverStateService: ServerStateService,
    private serverConfigurationService: ServerConfigurationService,
    private backupUIService: BackupUIService,
    private serverLifecycleService: ServerLifecycleService,
    private eventSubscriptionService: EventSubscriptionService,
    private utilityService: UtilityService,
    private automationService: AutomationService,
    private cdr: ChangeDetectorRef,
    private notificationService: NotificationService
  ) {}

  ngOnInit() {
    // Initialize all event subscriptions through the service
    this.activeServerSub = this.eventSubscriptionService.initializeSubscriptions(this, this.cdr);
  }

  ngAfterViewInit() {
    this.scrollLogsToBottom();
  }

  ngOnDestroy(): void {
    if (this.activeServerSub) {
      this.activeServerSub.unsubscribe();
    }
    this.eventSubscriptionService.destroySubscriptions();
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    const target = event.target as HTMLElement;
    
    // Check if the click is outside the dropdown
    if (this.dropdownOpen && target && !target.closest('.custom-dropdown')) {
      this.dropdownOpen = false;
      this.cdr.markForCheck();
    }
  }

  // -------------------- UI/Utility Methods --------------------
  // Utility to group fields by a property (e.g., 'group')
  groupFields(fields: any[], prop: string) {
    const groups: { [key: string]: any[] } = {};
    for (const field of fields) {
      const group = field[prop] || 'Other';
      if (!groups[group]) groups[group] = [];
      groups[group].push(field);
    }
    // Return as array of { key, value } for *ngFor
    return Object.entries(groups).map(([key, value]) => ({ key, value }));
  }
  mapDisplayName(mapName: string): string {
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

  onRconInputFocus() {
    this.rconInputFocused = true;
  }
  onRconInputBlur() {
    setTimeout(() => this.rconInputFocused = false, 150);
  }
  fillRconCommand(cmd: string) {
    this.rconMessage = cmd;
    this.rconInputFocused = false;
  }

  isArray(val: any): boolean {
    return this.utilityService.isArray(val);
  }

  scrollLogsToBottom() {
    setTimeout(() => {
      if (this.logContainer && this.logContainer.nativeElement) {
        const element = this.logContainer.nativeElement;
        const threshold = 50; // pixels from bottom
        const isNearBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - threshold;
        
        // Only auto-scroll if user is already at or near the bottom
        if (isNearBottom) {
          element.scrollTop = element.scrollHeight;
        }
      }
    });
  }

  onCrossplayChange(event: Event, platform: string) {
    const input = event.target as HTMLInputElement;
    this.serverConfigurationService.handleCrossplayChange(this.activeServerInstance, platform, input.checked);
    this.saveSettings();
  }

  saveSettings() {
    if (this.activeServerInstance && this.activeServerInstance.id) {
      // Validate the server configuration first
      const validation = this.serverConfigurationService.validateServerConfiguration(this.activeServerInstance);
      
      if (!validation.isValid) {
        // Show validation errors as toast (only to originator)
        const errorMessage = validation.errors.join('\n');
        this.notificationService.error('Configuration Validation Failed', errorMessage);
        return;
      }

      // Show warnings if any
      if (validation.warnings.length > 0) {
        const warningMessage = validation.warnings.join('\n');
        this.notificationService.warning('Configuration Warnings', warningMessage);
      }

      const saveObservable = this.serverConfigurationService.saveServerSettings(
        this.activeServerInstance, 
        this.originalServerInstance
      );
      
      if (saveObservable) {
        saveObservable.subscribe((result) => {
          if (result && result.success !== false) {
            // Update the original after successful save (no toast needed)
            this.originalServerInstance = this.serverConfigurationService.createDeepCopy(this.activeServerInstance);
          } else {
            this.notificationService.error('Save Failed', 'Failed to save server configuration.');
          }
        });
      }
    }
  }

  private hasServerChanged(): boolean {
    return this.serverConfigurationService.hasServerChanged(this.activeServerInstance, this.originalServerInstance);
  }

  onModsInputChange() {
    this.activeServerInstance.mods = this.serverConfigurationService.processModsInput(this.modsInput);
    this.saveSettings();
  }

  onAddMod(modData: {id: string, name: string}) {
    if (!modData.id || !modData.id.trim() || !modData.name || !modData.name.trim()) {
      this.notificationService.error('Please enter a valid mod ID and name');
      return;
    }

    // Check if mod already exists
    const existingMod = this.modList.find(mod => mod.id === modData.id);
    if (existingMod) {
      this.notificationService.warning('Mod is already in the list');
      return;
    }

    // Add mod to list
    const newMod = {
      id: modData.id,
      name: modData.name,
      enabled: true,
      settings: {}
    };
    this.modList.push(newMod);

    // Update server instance mods array
    if (!this.activeServerInstance.mods) {
      this.activeServerInstance.mods = [];
    }
    this.activeServerInstance.mods.push(modData.id);

    // Update server instance mod settings
    if (!this.activeServerInstance.modSettings) {
      this.activeServerInstance.modSettings = {};
    }
    this.activeServerInstance.modSettings[modData.id] = {
      _name: modData.name  // Store the mod name
    };

    // Add to enabled mods by default
    if (!this.activeServerInstance.enabledMods) {
      this.activeServerInstance.enabledMods = [];
    }
    this.activeServerInstance.enabledMods.push(modData.id);
    
    // Save settings
    this.saveSettings();
    this.notificationService.success('Mod added successfully');
  }

  onRemoveMod(mod: any) {
    const index = this.modList.findIndex(m => m.id === mod.id);
    if (index !== -1) {
      this.modList.splice(index, 1);
    }

    // Remove from server instance mods array
    if (this.activeServerInstance.mods) {
      const serverModIndex = this.activeServerInstance.mods.indexOf(mod.id);
      if (serverModIndex !== -1) {
        this.activeServerInstance.mods.splice(serverModIndex, 1);
      }
    }

    // Remove from enabled mods array
    if (this.activeServerInstance.enabledMods) {
      const enabledModIndex = this.activeServerInstance.enabledMods.indexOf(mod.id);
      if (enabledModIndex !== -1) {
        this.activeServerInstance.enabledMods.splice(enabledModIndex, 1);
      }
    }

    this.saveSettings();
    this.notificationService.success('Mod removed successfully');
  }

  onUpdateModSettings(data: {mod: any, settings: any}) {
    const mod = data.mod;
    const settings = data.settings;

    // Update mod settings
    mod.settings = settings;

    // Update server instance mod settings
    if (!this.activeServerInstance.modSettings) {
      this.activeServerInstance.modSettings = {};
    }
    // Preserve the _name when updating settings
    const existingSettings = this.activeServerInstance.modSettings[mod.id] || {};
    this.activeServerInstance.modSettings[mod.id] = {
      ...settings,
      _name: existingSettings._name  // Preserve the stored name
    };

    // Save settings
    this.saveSettings();
    this.notificationService.success('Mod settings updated successfully');
  }

  onToggleMod(mod: any) {
    // Update the server instance enabled mods array
    if (!this.activeServerInstance.enabledMods) {
      this.activeServerInstance.enabledMods = [];
    }

    if (mod.enabled) {
      // Add to enabled mods if not already there
      if (!this.activeServerInstance.enabledMods.includes(mod.id)) {
        this.activeServerInstance.enabledMods.push(mod.id);
      }
    } else {
      // Remove from enabled mods
      const index = this.activeServerInstance.enabledMods.indexOf(mod.id);
      if (index !== -1) {
        this.activeServerInstance.enabledMods.splice(index, 1);
      }
    }

    this.saveSettings();
    this.notificationService.success(`Mod ${mod.enabled ? 'enabled' : 'disabled'} successfully`);
  }

  loadModList() {
    // Initialize mod list from server instance
    this.modList = [];
    if (this.activeServerInstance?.mods) {
      // Initialize enabledMods array if it doesn't exist
      if (!this.activeServerInstance.enabledMods) {
        this.activeServerInstance.enabledMods = [...this.activeServerInstance.mods]; // Default all mods to enabled
      }

      // Initialize modSettings if it doesn't exist
      if (!this.activeServerInstance.modSettings) {
        this.activeServerInstance.modSettings = {};
      }

      for (const modId of this.activeServerInstance.mods) {
        const modSettings = this.activeServerInstance.modSettings[modId] || {};
        const mod = {
          id: modId,
          name: modSettings._name || `Mod ${modId}`,  // Use stored name or fallback
          enabled: this.activeServerInstance.enabledMods.includes(modId),
          settings: { ...modSettings }  // Copy settings but exclude _name from the settings object
        };
        // Remove _name from the settings object since it's not a real mod setting
        delete mod.settings._name;
        this.modList.push(mod);
      }
    }
  }

  openServerDirectory() {
    if (this.activeServerInstance && this.activeServerInstance.id) {
      this.messaging.sendMessage('open-directory', { id: this.activeServerInstance.id }).pipe(take(1)).subscribe();
    }
  }

  startServer() {
    this.serverLifecycleService.startServer(this.activeServerInstance, this.cdr);
  }

  stopServer() {
    this.serverLifecycleService.stopServer(this.activeServerInstance);
  }

  forceStopServer() {
    this.serverLifecycleService.forceStopServer(this.activeServerInstance);
  }

  sendRconMessage(message?: string) {
    const messageToSend = message || this.rconMessage;
    if (!messageToSend?.trim() || !this.activeServerInstance?.id) return;
    
    this.rconManagementService.sendRconCommand(this.activeServerInstance.id, messageToSend)
      .subscribe((response: any) => {
        if (response && response.response) {
          this.rconLastResponse = response.response;
          this.cdr.markForCheck();
        }
      });
    
    if (!message) {
      this.rconMessage = '';
    }
    this.cdr.markForCheck();
  }

  canStartInstance(): boolean {
    if (!this.activeServerInstance) return false;
    return this.serverLifecycleService.canStartInstance(this.activeServerInstance.state);
  }

  mapServerState(state: string | null | undefined): string {
    return this.serverLifecycleService.mapServerState(state);
  }
  onToggleMultiOption(fieldKey: string, option: string, checked: boolean) {
    this.serverConfigurationService.toggleMultiOption(this.activeServerInstance, fieldKey, option, checked);
    this.saveSettings();
  }

  // -------------------- Backup Methods --------------------
  createManualBackup() {
    if (!this.activeServerInstance?.id) return;
    this.backupUIService.showBackupNameModal();
    this.cdr.detectChanges();
  }

  onBackupNameConfirm() {
    if (!this.activeServerInstance?.id) return;
    this.backupUIService.createManualBackup(this.activeServerInstance.id, this.cdr);
  }

  onBackupNameCancel() {
    this.backupUIService.hideBackupNameModal();
    this.cdr.detectChanges();
  }

  private refreshBackupList() {
    if (!this.activeServerInstance?.id) return;
    this.backupUIService.refreshBackupList(this.activeServerInstance.id);
  }

  onBackupScheduleToggle() {
    this.backupUIService.updateBackupSettings({
      backupScheduleEnabled: !this.backupScheduleEnabled
    });
    this.saveBackupSettings();
  }

  onBackupFrequencyChange(frequency: string) {
    this.backupUIService.updateBackupSettings({
      backupFrequency: frequency as 'hourly' | 'daily' | 'weekly'
    });
    this.saveBackupSettings();
  }

  onBackupTimeChange(time: string) {
    this.backupUIService.updateBackupSettings({
      backupTime: time
    });
    this.saveBackupSettings();
  }

  onBackupDayOfWeekChange(dayOfWeek: number) {
    this.backupUIService.updateBackupSettings({
      backupDayOfWeek: dayOfWeek
    });
    this.saveBackupSettings();
  }

  onMaxBackupsToKeepChange(maxBackups: number) {
    this.backupUIService.updateBackupSettings({
      maxBackupsToKeep: maxBackups
    });
    this.saveBackupSettings();
  }

  onBackupScheduleChange() {
    this.saveBackupSettings();
  }

  saveBackupSettings() {
    if (!this.activeServerInstance?.id) return;
    
    const instanceId = this.activeServerInstance.id; // Store to prevent race conditions
    this.backupUIService.saveBackupSettings(instanceId);
  }

  loadBackupList() {
    this.refreshBackupList();
  }

  loadBackupSettings() {
    if (!this.activeServerInstance?.id) return;
    
    this.backupUIService.loadBackupSettings(this.activeServerInstance.id);
  }

  restoreBackup(backup: any) {
    if (!this.activeServerInstance?.id || !backup) return;
    
    if (confirm(`Are you sure you want to restore the backup "${backup.name}"? This will replace all current server files.`)) {
      this.backupUIService.restoreBackup(this.activeServerInstance.id, backup);
    }
  }

  downloadBackup(backup: any) {
    if (!this.activeServerInstance?.id || !backup) return;
    
    this.backupUIService.downloadBackup(this.activeServerInstance.id, backup);
  }

  deleteBackup(backup: any) {
    if (!backup) return;
    this.backupUIService.showDeleteBackupModal(backup);
  }

  onDeleteBackupConfirm() {
    if (!this.activeServerInstance?.id) return;
    this.backupUIService.confirmDeleteBackup(this.activeServerInstance.id);
  }

  onDeleteBackupCancel() {
    this.backupUIService.hideDeleteBackupModal();
  }

  formatFileSize(bytes: number): string {
    return this.utilityService.formatFileSize(bytes);
  }

  // Safe date formatting method - displays dates in UTC
  getFormattedDate(dateValue: any): string {
    return this.utilityService.getFormattedDate(dateValue);
  }

  // TrackBy function for better performance
  trackByBackupId(index: number, backup: any): any {
    return backup ? backup.id : index;
  }

  // Stat multiplier helper methods
  getStatMultiplier(type: string, statIndex: number): number {
    if (!this.activeServerInstance) return 1.0;
    return this.statMultiplierService.getStatMultiplier(this.activeServerInstance, type, statIndex);
  }

  setStatMultiplier(type: string, statIndex: number, value: number): void {
    if (!this.activeServerInstance) return;
    
    this.statMultiplierService.setStatMultiplier(this.activeServerInstance, type, statIndex, value);
    this.saveSettings();
  }

  resetStatToDefaults(statIndex: number): void {
    if (!this.activeServerInstance) return;
    
    this.statMultiplierService.resetStatToDefaults(this.activeServerInstance, statIndex);
    this.saveSettings();
  }

  copyStatToAll(statIndex: number): void {
    if (!this.activeServerInstance) return;
    
    this.statMultiplierService.copyStatToAll(this.activeServerInstance, statIndex);
    this.saveSettings();
  }

  saveAutomationSettings(): void {
    // Legacy method - save all automation settings
    this.saveAutoStartSettings();
    this.saveCrashDetectionSettings();
    this.saveScheduledRestartSettings();
  }

  saveAutoStartSettings(): void {
    if (!this.activeServerInstance?.id) return;

    // Save the settings
    this.saveSettings();

    const serverId = this.activeServerInstance.id;
    this.automationService.configureAutoStart(serverId, {
      autoStartOnAppLaunch: this.activeServerInstance.autoStartOnAppLaunch || false,
      autoStartOnBoot: this.activeServerInstance.autoStartOnBoot || false
    }).subscribe({
      next: (response) => {
        if (response.success) {
          this.notificationService.success('Auto-start settings saved', 'Automation');
        } else {
          this.notificationService.error('Failed to save auto-start settings: ' + response.error, 'Automation');
        }
      },
      error: (error) => {
        this.notificationService.error('Failed to configure auto-start', 'Automation');
        console.error('Auto-start configuration error:', error);
      }
    });
  }

  saveCrashDetectionSettings(): void {
    if (!this.activeServerInstance?.id) return;

    // Save the settings
    this.saveSettings();

    const serverId = this.activeServerInstance.id;
    this.automationService.configureCrashDetection(serverId, {
      enabled: this.activeServerInstance.crashDetectionEnabled || false,
      checkInterval: this.activeServerInstance.crashDetectionInterval || 60,
      maxRestartAttempts: this.activeServerInstance.maxRestartAttempts || 3
    }).subscribe({
      next: (response) => {
        if (response.success) {
          this.notificationService.success('Crash detection settings saved', 'Automation');
        } else {
          this.notificationService.error('Failed to save crash detection settings: ' + response.error, 'Automation');
        }
      },
      error: (error) => {
        this.notificationService.error('Failed to configure crash detection', 'Automation');
        console.error('Crash detection configuration error:', error);
      }
    });
  }

  saveScheduledRestartSettings(): void {
    if (!this.activeServerInstance?.id) return;

    // Save the settings
    this.saveSettings();

    const serverId = this.activeServerInstance.id;
    this.automationService.configureScheduledRestart(serverId, {
      enabled: this.activeServerInstance.scheduledRestartEnabled || false,
      frequency: this.activeServerInstance.restartFrequency || 'daily',
      time: this.activeServerInstance.restartTime || '02:00',
      days: this.activeServerInstance.restartDays || [1],
      warningMinutes: this.activeServerInstance.restartWarningMinutes || 5
    }).subscribe({
      next: (response) => {
        if (response.success) {
          this.notificationService.success('Scheduled restart settings saved', 'Automation');
        } else {
          this.notificationService.error('Failed to save scheduled restart settings: ' + response.error, 'Automation');
        }
      },
      error: (error) => {
        this.notificationService.error('Failed to configure scheduled restart', 'Automation');
        console.error('Scheduled restart configuration error:', error);
      }
    });
  }
}
