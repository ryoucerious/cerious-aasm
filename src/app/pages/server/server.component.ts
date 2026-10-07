import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription, interval } from 'rxjs';
import { ServerNavService, ServerTabId, DEFAULT_SERVER_TAB } from '../../core/services/server-nav.service';
import { LiveServersService } from '../../core/services/live-servers.service';
import { ModEntry, ModSettings, ServerInstance, ServerInstanceDraft } from '../../core/models/server-instance.model';
import { BackupMetadata } from '../../core/interfaces/backup.interface';
import { FieldDefinition } from '../../core/services/field-definitions.service';
import { MessagingService } from '../../core/services/messaging/messaging.service';
import { StatMultiplierService } from '../../core/services/stat-multiplier.service';
import { RconManagementService } from '../../core/services/rcon-management.service';
import { ServerStateService } from '../../core/services/server-state.service';
import { AutomationService } from '../../core/services/automation.service';
import { NotificationService } from '../../core/services/notification.service';
import { ServerConfigurationService } from '../../core/services/server-configuration.service';
import { BackupUIService } from '../../core/services/backup-ui.service';
import { ServerLifecycleService } from '../../core/services/server-lifecycle.service';
import { EventSubscriptionService, ServerPageState } from '../../core/services/event-subscription.service';
import { AuthService } from '../../core/services/auth.service';
import { MeshNodesService } from '../../core/services/mesh-nodes.service';
import { MoveServerDialogComponent } from '../../components/move-server-dialog/move-server-dialog.component';
import { PERMISSIONS } from '../../core/models/auth.model';
import { serverStatusKey } from '../../core/utils/server-status';
import { ServerHeaderComponent } from '../../components/server-header/server-header.component';
import { PlayerListComponent } from '../../components/player-list/player-list.component';
import { ModalComponent } from '../../components/modal/modal.component';
import { ServerStateComponent } from '../../components/server-state/server-state.component';
import { RconControlComponent } from '../../components/rcon-control/rcon-control.component';
import { ServerSettingsComponent } from '../../components/server-settings/server-settings.component';
import { BackupFrequency } from '../../components/server-settings/tabs/backup-tab/backup-tab.component';

/** Shared, so the console gets the same array while a server has no output and does not re-render. */
const NO_LOGS: string[] = [];

/** `success` is present only on a failure. */
interface OpenDirectoryReply {
  success?: boolean;
  id?: string;
  error?: string;
}

@Component({
  selector: 'app-server',
  standalone: true,
  imports: [NgIf, FormsModule, ModalComponent, ServerStateComponent, RconControlComponent, ServerSettingsComponent, ServerHeaderComponent, PlayerListComponent, MoveServerDialogComponent],
  templateUrl: './server.component.html'
})
export class ServerComponent implements OnInit, OnDestroy, ServerPageState {
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
  advancedSettingsMeta: FieldDefinition[] = [];

  get activeServerInstance(): ServerInstanceDraft | null {
    return this.activeServer;
  }
  set activeServerInstance(server: ServerInstanceDraft | null) {
    if (server?.id !== this.activeServer?.id) this.rconLastResponse = '';
    this.activeServer = server;
  }
  /** The settings as the backend last confirmed them; a save is sent only when the page differs. */
  originalServerInstance: ServerInstanceDraft | null = null;
  modList: ModEntry[] = [];
  rconConnected = false;
  rconLastResponse = '';
  selectedStatIndex = 0;
  /** Which page of the selected server is showing. Driven by the /server/:tab route; the sidebar owns the links. */
  activeTab: ServerTabId = DEFAULT_SERVER_TAB;
  /** Re-evaluated every 30s so the uptime in the header keeps counting. */
  now = Date.now();

  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly serverNav = inject(ServerNavService);
  private readonly liveServers = inject(LiveServersService);
  private readonly meshNodes = inject(MeshNodesService);
  private activeServer: ServerInstanceDraft | null = null;
  private activeServerSub?: Subscription;
  private subscriptions: Subscription[] = [];

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

  get statList(): string[] {
    return this.statMultiplierService.statList;
  }

  get knownRconCommands() {
    return this.rconManagementService.getKnownCommands();
  }

  get filteredLogs(): string[] {
    const id = this.activeServerInstance?.id;
    const logs = id ? this.serverStateService.getLogsForInstance(id) : NO_LOGS;
    return logs.length > 0 ? logs : NO_LOGS;
  }

  get settingsLocked(): boolean {
    return this.unreachable || this.serverStateService.areSettingsLocked(this.activeServerInstance?.state);
  }

  /**
   * On a mesh machine that cannot be reached. The live list says so: this page's own copy follows
   * state events, and a machine that has gone quiet sends none.
   */
  get unreachable(): boolean {
    return serverStatusKey(this.liveServer?.state) === 'unreachable' || serverStatusKey(this.activeServerInstance?.state) === 'unreachable';
  }

  constructor(
    private messaging: MessagingService,
    private statMultiplierService: StatMultiplierService,
    private rconManagementService: RconManagementService,
    private serverStateService: ServerStateService,
    private serverConfigurationService: ServerConfigurationService,
    private backupUIService: BackupUIService,
    private serverLifecycleService: ServerLifecycleService,
    private eventSubscriptionService: EventSubscriptionService,
    private automationService: AutomationService,
    private cdr: ChangeDetectorRef,
    private notificationService: NotificationService,
    private auth: AuthService
  ) {}

  /** The server the move dialog is open for. */
  movingServer: ServerInstance | null = null;

  /** The user may move servers and another machine in the mesh can take this one. The header offers it only while it is off. */
  get canMoveServer(): boolean {
    const server = this.activeServerInstance;
    if (!server || !this.auth.can(PERMISSIONS.SERVERS_MOVE)) return false;
    return this.meshNodes.destinationsFor({ nodeId: this.liveServer?.nodeId ?? server.nodeId }).length > 0;
  }

  openMove(): void {
    if (!this.activeServerInstance) return;
    this.movingServer = (this.liveServer || this.activeServerInstance) as ServerInstance;
    this.cdr.markForCheck();
  }

  closeMove(): void {
    this.movingServer = null;
    this.cdr.markForCheck();
  }

  /** The backend refuses RCON for roles without the permission; the panel is simply not shown. */
  /** Not for a server whose mesh machine cannot be reached: a command would not get there. */
  get canUseRcon(): boolean {
    return this.auth.can(PERMISSIONS.RCON_USE) && !this.unreachable;
  }

  ngOnInit() {
    this.activeServerSub = this.eventSubscriptionService.initializeSubscriptions(this, this.cdr);

    // The page shown is the :tab route parameter. Anything unknown falls back to the console.
    if (this.route?.paramMap) {
      this.subscriptions.push(this.route.paramMap.subscribe(params => {
        const tab = params.get('tab');
        if (this.serverNav.isValidTab(tab)) {
          this.activeTab = tab;
          this.serverNav.rememberTab(tab);
          this.cdr.markForCheck();
        } else if (tab) {
          this.router.navigate(['/server', DEFAULT_SERVER_TAB], { replaceUrl: true });
        }
      }));
    }

    this.subscriptions.push(this.liveServers.servers$.subscribe(() => this.cdr.markForCheck()));
    this.subscriptions.push(interval(30000).subscribe(() => {
      this.now = Date.now();
      this.cdr.markForCheck();
    }));
  }

  /** True for every page rendered by the settings component (everything except console and players). */
  get isSettingsTab(): boolean {
    return this.activeTab !== 'console' && this.activeTab !== 'players';
  }

  get pageTitle(): string {
    return this.serverNav.find(this.activeTab)?.label || '';
  }

  /** Roster entry for the selected server, carrying live CPU / uptime / player numbers. */
  get liveServer(): ServerInstance | null {
    return this.liveServers.find(this.activeServerInstance?.id) || null;
  }

  /** A child (settings toolbar, expert-mode toggle) asked for another page: it is a route change. */
  onTabChanged(tab: ServerTabId | string) {
    if (!this.serverNav.isValidTab(tab)) return;
    this.serverNav.rememberTab(tab);
    this.router.navigate(['/server', tab]);
  }

  goToDashboard() {
    this.router.navigate(['/dashboard']);
  }

  ngOnDestroy(): void {
    this.activeServerSub?.unsubscribe();
    this.eventSubscriptionService.destroySubscriptions();
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];
  }

  saveSettings() {
    const server = this.activeServerInstance;
    if (!server?.id) return;

    const validation = this.serverConfigurationService.validateServerConfiguration(server);
    if (!validation.isValid) {
      this.notificationService.error(validation.errors.join('\n'), 'Configuration Validation Failed');
      return;
    }
    if (validation.warnings.length > 0) {
      this.notificationService.warning(validation.warnings.join('\n'), 'Configuration Warnings');
    }

    // Edits made while the save is in flight are not in it, so the reply confirms this copy
    // and they stay pending for the next save.
    const sent = this.serverConfigurationService.createDeepCopy(server);
    this.serverConfigurationService.saveServerSettings(sent, this.originalServerInstance)?.subscribe({
      next: result => {
        if (result?.success === false) {
          this.notificationService.error(result.error || 'Failed to save server configuration.', 'Save Failed');
        } else if (this.activeServerInstance?.id === sent.id) {
          this.originalServerInstance = sent;
        }
      },
      error: error => {
        console.error('[server] Could not save the server settings:', error);
        this.notificationService.error('Failed to save server configuration.', 'Save Failed');
      }
    });
  }

  /** Import or copy replaced settings in bulk: rebuild the mod rows from them, then save. */
  onConfigApplied() {
    this.loadModList();
    this.saveSettings();
  }

  onAddMod(modData: { id: string; name: string }) {
    const server = this.activeServerInstance;
    if (!server || !this.modsEditable()) return;

    const id = modData.id?.trim();
    const name = modData.name?.trim();
    if (!id || !name) {
      this.notificationService.error('Please enter a valid mod ID and name');
      return;
    }
    if (!/^\d+$/.test(id)) {
      this.notificationService.error('Mod ID must be a numeric CurseForge ID (e.g. 731604991). Copy it from the CurseForge website.');
      return;
    }
    if (this.modList.some(mod => mod.id === id)) {
      this.notificationService.warning('Mod is already in the list');
      return;
    }

    this.modList = [...this.modList, { id, name, enabled: true, settings: {} }];
    server.mods = [...(server.mods ?? []), id];
    server.modSettings = { ...server.modSettings, [id]: { _name: name } };
    server.enabledMods = [...(server.enabledMods ?? []), id];

    this.saveSettings();
    this.notificationService.success('Mod added successfully');
  }

  onRemoveMod(mod: ModEntry) {
    const server = this.activeServerInstance;
    if (!server || !this.modsEditable()) return;

    this.modList = this.modList.filter(entry => entry.id !== mod.id);
    server.mods = (server.mods ?? []).filter(id => id !== mod.id);
    server.enabledMods = (server.enabledMods ?? []).filter(id => id !== mod.id);
    // The backend writes a [Mod_<id>] section for every entry here, listed mod or not.
    if (server.modSettings) {
      const { [mod.id]: _removed, ...kept } = server.modSettings;
      server.modSettings = kept;
    }

    this.saveSettings();
    this.notificationService.success('Mod removed successfully');
  }

  onUpdateModSettings(data: { mod: ModEntry; settings: Record<string, string> }) {
    const server = this.activeServerInstance;
    if (!server || !this.modsEditable()) return;

    const { mod, settings } = data;
    this.modList = this.modList.map(entry => entry.id === mod.id ? { ...entry, settings } : entry);
    // The stored name lives beside the settings; editing them must not drop it.
    const stored: ModSettings = { ...settings };
    const name = server.modSettings?.[mod.id]?._name;
    if (name) stored._name = name;
    server.modSettings = { ...server.modSettings, [mod.id]: stored };

    this.saveSettings();
    this.notificationService.success('Mod settings updated successfully');
  }

  /** The mods page has already flipped `mod.enabled`; this records it on the server and saves. */
  onToggleMod(mod: ModEntry) {
    const server = this.activeServerInstance;
    if (!server) return;
    if (!this.modsEditable()) {
      mod.enabled = !mod.enabled;
      return;
    }

    const enabled = server.enabledMods ?? [];
    if (mod.enabled) {
      server.enabledMods = enabled.includes(mod.id) ? enabled : [...enabled, mod.id];
    } else {
      server.enabledMods = enabled.filter(id => id !== mod.id);
    }

    this.saveSettings();
    this.notificationService.success(`Mod ${mod.enabled ? 'enabled' : 'disabled'} successfully`);
  }

  /** Builds the mod rows from the server's mod ids, enabled list and stored names. */
  loadModList() {
    const server = this.activeServerInstance;
    const mods = server?.mods ?? [];
    if (!server || mods.length === 0) {
      this.modList = [];
      return;
    }

    // Older configs have no enabled list: every mod in them was loaded.
    server.enabledMods ??= [...mods];
    server.modSettings ??= {};
    const enabledMods = server.enabledMods;
    const modSettings = server.modSettings;
    this.modList = mods.map(id => {
      const stored: ModSettings = modSettings[id] ?? {};
      const { _name, ...settings } = stored;
      return { id, name: _name || `Mod ${id}`, enabled: enabledMods.includes(id), settings };
    });
  }

  openServerDirectory() {
    const id = this.activeServerInstance?.id;
    if (!id) return;
    const failed = 'Could not open the server directory.';
    this.messaging.sendMessage<OpenDirectoryReply>('open-directory', { id }).subscribe({
      next: reply => {
        if (reply?.success === false) this.notificationService.error(reply.error || failed, 'Server');
      },
      error: error => {
        console.error('[server] Could not open the server directory:', error);
        this.notificationService.error(failed, 'Server');
      }
    });
  }

  startServer() {
    if (this.activeServerInstance?.id) {
      this.serverLifecycleService.startServer(this.activeServerInstance as ServerInstance, this.cdr);
    }
  }

  stopServer() {
    if (this.activeServerInstance?.id) {
      this.serverLifecycleService.stopServer(this.activeServerInstance as ServerInstance);
    }
  }

  forceStopServer() {
    if (this.activeServerInstance?.id) {
      this.serverLifecycleService.forceStopServer(this.activeServerInstance as ServerInstance);
    }
  }

  sendRconMessage(message: string) {
    const id = this.activeServerInstance?.id;
    if (!message?.trim() || !id) return;

    this.rconManagementService.sendRconCommand(id, message).subscribe({
      next: (reply: { response?: string } | null) => {
        if (reply?.response && this.activeServerInstance?.id === id) {
          this.rconLastResponse = reply.response;
          this.cdr.markForCheck();
        }
      },
      error: error => {
        console.error('[server] RCON command failed:', error);
        this.notificationService.error('The command could not be sent to the server.', 'RCON');
      }
    });
  }

  mapServerState(state: string | null | undefined): string {
    return this.serverStateService.mapServerState(state);
  }

  onToggleMultiOption(fieldKey: string, option: string, checked: boolean) {
    this.serverConfigurationService.toggleMultiOption(this.activeServerInstance as Record<string, unknown> | null, fieldKey, option, checked);
    this.saveSettings();
  }

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
    if (this.isCreatingBackup) return;
    this.backupUIService.hideBackupNameModal();
    this.cdr.detectChanges();
  }

  onBackupScheduleToggle() {
    this.backupUIService.updateBackupSettings({ backupScheduleEnabled: !this.backupScheduleEnabled });
    this.saveBackupSettings();
  }

  onBackupFrequencyChange(backupFrequency: BackupFrequency) {
    this.backupUIService.updateBackupSettings({ backupFrequency });
    this.saveBackupSettings();
  }

  onBackupTimeChange(backupTime: string) {
    this.backupUIService.updateBackupSettings({ backupTime });
    this.saveBackupSettings();
  }

  onBackupDayOfWeekChange(backupDayOfWeek: number) {
    this.backupUIService.updateBackupSettings({ backupDayOfWeek });
    this.saveBackupSettings();
  }

  onMaxBackupsToKeepChange(maxBackupsToKeep: number) {
    this.backupUIService.updateBackupSettings({ maxBackupsToKeep });
    this.saveBackupSettings();
  }

  saveBackupSettings() {
    if (!this.activeServerInstance?.id) return;
    this.backupUIService.saveBackupSettings(this.activeServerInstance.id);
  }

  loadBackupList() {
    if (!this.activeServerInstance?.id) return;
    this.backupUIService.refreshBackupList(this.activeServerInstance.id);
  }

  loadBackupSettings() {
    if (!this.activeServerInstance?.id) return;
    this.backupUIService.loadBackupSettings(this.activeServerInstance.id);
  }

  restoreBackup(backup: BackupMetadata) {
    if (!this.activeServerInstance?.id || !backup) return;

    // Restoring rewrites files a live process locks; a crashed or errored server has none.
    const state = (this.activeServerInstance.state || '').toLowerCase();
    if (!['stopped', 'crashed', 'error', ''].includes(state)) {
      this.notificationService.warning('Stop the server before restoring a backup.', 'Backup');
      return;
    }

    // backupUIService.restoreBackup asks for confirmation; asking here too would ask twice.
    this.backupUIService.restoreBackup(this.activeServerInstance.id, backup);
  }

  downloadBackup(backup: BackupMetadata) {
    if (!this.activeServerInstance?.id || !backup) return;
    this.backupUIService.downloadBackup(this.activeServerInstance.id, backup);
  }

  deleteBackup(backup: BackupMetadata) {
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

  saveAutoStartSettings(): void {
    const server = this.activeServerInstance;
    if (!server?.id) return;
    this.saveSettings();

    this.automationService.configureAutoStart(server.id, {
      autoStartOnAppLaunch: server.autoStartOnAppLaunch || false,
      autoStartOnBoot: server.autoStartOnBoot || false
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
        console.error('[server] Auto-start configuration error:', error);
      }
    });
  }

  saveCrashDetectionSettings(): void {
    const server = this.activeServerInstance;
    if (!server?.id) return;
    this.saveSettings();

    this.automationService.configureCrashDetection(server.id, {
      enabled: server.crashDetectionEnabled || false,
      checkInterval: server.crashDetectionInterval || 60,
      maxRestartAttempts: server.maxRestartAttempts || 3
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
        console.error('[server] Crash detection configuration error:', error);
      }
    });
  }

  saveScheduledRestartSettings(): void {
    const server = this.activeServerInstance;
    if (!server?.id) return;
    this.saveSettings();

    this.automationService.configureScheduledRestart(server.id, {
      enabled: server.scheduledRestartEnabled || false,
      frequency: server.restartFrequency || 'daily',
      time: server.restartTime || '02:00',
      days: server.restartDays || [1],
      warningMinutes: server.restartWarningMinutes || 5
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
        console.error('[server] Scheduled restart configuration error:', error);
      }
    });
  }

  /** Mods cannot change while the server runs; the page disables the controls, this backs it up. */
  private modsEditable(): boolean {
    if (!this.settingsLocked) return true;
    this.notificationService.warning('Stop the server before changing its mods.', 'Mods');
    return false;
  }
}
