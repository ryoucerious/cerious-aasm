import { Component, ChangeDetectorRef, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgFor, NgIf, NgClass, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { NotificationService } from '../../core/services/notification.service';
import { IpcService } from '../../core/services/ipc.service';
import { WebSocketService } from '../../core/services/web-socket.service';
import { INSTALL_TIMEOUT_MS, MessagingService } from '../../core/services/messaging/messaging.service';
import { GlobalConfigService } from '../../core/services/global-config.service';
import { LiveServersService } from '../../core/services/live-servers.service';
import { ModalComponent } from '../../components/modal/modal.component';
import { DrawerComponent } from '../../components/drawer/drawer.component';
import { UsersSettingsComponent } from './users/users-settings.component';
import { ProfileSettingsComponent } from './profile/profile-settings.component';
import { SettingsDrawerService, SettingsSection } from '../../core/services/settings-drawer.service';
import { AuthService } from '../../core/services/auth.service';
import { environment } from '../../../environments/environment';
import { ThemeService, ThemePreference } from '../../core/services/theme.service';
import { GlobalConfig } from '../../core/interfaces/global-config.interface';
import { isBusyStatus } from '../../core/utils/server-status';

/** The folder picker is a native dialog: the reply comes only once the user has chosen. */
const DIRECTORY_DIALOG_TIMEOUT_MS = 10 * 60_000;
const MIN_WEB_SERVER_PORT = 1024;
const MAX_WEB_SERVER_PORT = 65535;

interface SettingsTab {
  id: SettingsSection;
  label: string;
  icon: string;
  group: string;
  showUpdateBadge?: boolean;
}

interface InstallProgress {
  percent: number;
  step: string;
  message: string;
  phase?: string;
  success?: boolean;
  failed?: boolean;
}

/** One message on the 'install' channel; `data` is the installer's progress report. */
interface InstallEvent {
  data?: {
    step?: string;
    message?: string;
    error?: string;
    phase?: string;
    overallPhase?: string;
    phasePercent?: number;
    cancelled?: boolean;
  };
}

interface ArkInstallationReply {
  success?: boolean;
  installed?: boolean;
  installedBuildId?: string | null;
  latestBuildId?: string | null;
  updateAvailable?: boolean;
  lastCheckedAt?: number | null;
  installPath?: string;
}

interface WebServerReply {
  success?: boolean;
  running?: boolean;
  port?: number;
  message?: string;
}

/** `success` is present only on a failure. */
interface OpenDirectoryReply {
  success?: boolean;
  configDir?: string;
  error?: string;
}

interface SystemInfoReply {
  nodeVersion?: string;
  electronVersion?: string;
  platform?: string;
  configPath?: string;
}

@Component({
  selector: 'app-settings-page',
  standalone: true,
  imports: [NgFor, NgIf, NgClass, DatePipe, ModalComponent, FormsModule, DrawerComponent, UsersSettingsComponent, ProfileSettingsComponent],
  templateUrl: './settings.component.html'
})
export class SettingsPageComponent implements OnInit {
  readonly isElectron: boolean;
  readonly tabs: SettingsTab[];

  webServerRunning = false;
  webServerPort = 3000;
  startWebServerOnLoad = false;
  authenticationEnabled = false;
  /** True once at least one account exists, so we know whether anyone could sign in. */
  accountsInUse = false;
  maxBackupDownloadSizeMB = 100;
  serverDataDir = '';
  autoUpdateArkServer = false;
  updateWarningMinutes = 15;
  serverStartDelaySeconds = 60;

  // Unlike the settings around it this is a per-device preference held in localStorage, not
  // part of the server-side global config (see ThemeService).
  themePreference: ThemePreference = 'system';
  readonly themeOptions: { value: ThemePreference; label: string; icon: string }[] = [
    { value: 'system', label: 'System', icon: 'brightness_auto' },
    { value: 'light', label: 'Light', icon: 'light_mode' },
    { value: 'dark', label: 'Dark', icon: 'dark_mode' }
  ];
  backendNodeVersion: string | null = null;
  backendElectronVersion: string | null = null;
  backendPlatform: string | null = null;
  backendConfigPath: string | null = null;
  /** Mirrors SettingsDrawerService so the template can bind without an async pipe. */
  drawerOpen = false;
  activeTab = 'server-installation';

  /**
   * The rail, grouped under headings, preserving the order of `tabs`.
   *
   * Built once rather than on demand: a getter would hand *ngFor a new array on every
   * change detection pass, which rebuilds the buttons continuously and stops clicks from
   * registering at all. The tab objects themselves are mutated in place (the update badge),
   * so the grouping stays correct.
   */
  tabGroups: { name: string; tabs: SettingsTab[] }[] = [];

  /** What is installed, what Steam has, and where it lives. Null until the first load. */
  arkInstallation: {
    installed: boolean;
    installedBuildId: string | null;
    latestBuildId: string | null;
    updateAvailable: boolean;
    lastCheckedAt: number | null;
    installPath: string;
  } | null = null;
  arkInstallationLoading = false;

  showInstallModal = false;
  installProgress: InstallProgress | null = null;
  showSudoPasswordModal = false;
  sudoPassword = '';
  pendingInstallTarget = '';
  /** Running, starting, queued or stopping: an install would change files a server is using. */
  hasRunningServers = false;

  private readonly settingsDrawer = inject(SettingsDrawerService);
  private readonly auth = inject(AuthService);
  private readonly webSocket = inject(WebSocketService);
  private readonly destroyRef = inject(DestroyRef);
  private installSub?: Subscription;
  private arkInstallationRequest?: Subscription;

  constructor(
    private messaging: MessagingService,
    private cdr: ChangeDetectorRef,
    private ipc: IpcService,
    private notification: NotificationService,
    private configService: GlobalConfigService,
    private liveServers: LiveServersService,
    private themeService: ThemeService
  ) {
    this.themePreference = this.themeService.preference;
    this.isElectron = this.ipc.isElectron;
    // Grouped by what the operator is trying to change, rather than one catch-all "General".
    this.tabs = [
      { id: 'server-installation', label: 'ARK Installation', icon: 'inventory_2', showUpdateBadge: false, group: 'Server' },
      { id: 'servers', label: 'Server Defaults', icon: 'tune', group: 'Server' },
      { id: 'updates', label: 'Updates', icon: 'system_update_alt', group: 'Server' },
      { id: 'storage', label: 'Storage', icon: 'folder', group: 'Server' },
      { id: 'profile', label: 'My Account', icon: 'account_circle', group: 'Access' },
      { id: 'users', label: 'Users & Roles', icon: 'group', group: 'Access' },
      ...(this.isElectron ? [{ id: 'web-server' as const, label: 'Web Server', icon: 'cloud', group: 'Access' }] : []),
      { id: 'appearance', label: 'Appearance', icon: 'palette', group: 'Application' },
      { id: 'about', label: 'About', icon: 'info', group: 'Application' }
    ];
    this.buildTabGroups();
    this.destroyRef.onDestroy(() => this.installSub?.unsubscribe());
  }

  get activeTabLabel(): string {
    return this.tabs.find(tab => tab.id === this.activeTab)?.label || '';
  }

  ngOnInit(): void {
    this.auth.identity$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(identity => {
      this.accountsInUse = identity.accountsInUse;
      this.cdr.markForCheck();
    });

    this.settingsDrawer.isOpen$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(open => {
      this.drawerOpen = open;
      if (open) this.loadArkInstallation();
      this.cdr.markForCheck();
    });
    this.settingsDrawer.section$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(section => {
      this.activeTab = section;
      this.cdr.markForCheck();
    });

    this.liveServers.servers$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(servers => {
      this.hasRunningServers = servers.some(server => isBusyStatus(server.state));
      this.cdr.markForCheck();
    });

    // GlobalConfigService asks for the settings whenever the connection comes up, and replays
    // the latest to a listener that arrives after them.
    this.configService.config$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(config => this.applyConfig(config));

    this.messaging.receiveMessage<{ hasUpdate?: boolean }>('ark-update-status').pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(status => status?.hasUpdate ? this.updateArkUpdateBadge() : this.clearArkUpdateBadge());

    if (this.isElectron) {
      this.messaging.receiveMessage<WebServerReply>('web-server-status').pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(status => {
          this.webServerRunning = !!status?.running;
          if (typeof status?.port === 'number') this.webServerPort = status.port;
          this.cdr.markForCheck();
        });
      // The status comes back on the channel above, without the request id a reply would carry.
      this.messaging.sendNotification('web-server-status', {});
    }

    // The web UI asks whenever its socket comes up: a request made before that, or after the
    // session was refused, is dropped and only times out. The desktop app has no socket and
    // asks once.
    this.webSocket.connected$.pipe(filter(connected => connected), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadSystemInfo());
    if (this.isElectron) this.loadSystemInfo();
  }

  trackByGroupName(_index: number, group: { name: string }): string {
    return group.name;
  }

  trackByTabId(_index: number, tab: SettingsTab): string {
    return tab.id;
  }

  onCloseDrawer(): void {
    this.settingsDrawer.close();
  }

  private loadSystemInfo(): void {
    this.messaging.sendMessage<SystemInfoReply>('get-system-info', {}).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: info => {
        this.backendNodeVersion = info?.nodeVersion || null;
        this.backendElectronVersion = info?.electronVersion || null;
        this.backendPlatform = info?.platform || null;
        this.backendConfigPath = info?.configPath || null;
        this.cdr.markForCheck();
      },
      error: error => console.error('[settings] Could not get the system info:', error)
    });
  }

  /** Pull the installation status. Called when the drawer opens and after an install. */
  loadArkInstallation(): void {
    this.arkInstallationLoading = true;
    this.cdr.markForCheck();
    this.arkInstallationRequest?.unsubscribe();
    this.arkInstallationRequest = this.messaging.sendMessage<ArkInstallationReply>('get-ark-installation', {})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: res => {
          if (res && res.success !== false) {
            this.arkInstallation = {
              installed: !!res.installed,
              installedBuildId: res.installedBuildId ?? null,
              latestBuildId: res.latestBuildId ?? null,
              updateAvailable: !!res.updateAvailable,
              lastCheckedAt: res.lastCheckedAt ?? null,
              installPath: res.installPath || ''
            };
          }
          this.arkInstallationLoading = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.arkInstallationLoading = false;
          this.cdr.markForCheck();
        }
      });
  }

  get arkStatusLabel(): string {
    if (!this.arkInstallation) return 'Checking...';
    if (!this.arkInstallation.installed) return 'Not installed';
    return this.arkInstallation.updateAvailable ? 'Update available' : 'Up to date';
  }

  /**
   * A soft tint rather than a solid fill: "Update available" on a saturated yellow forced
   * near-black text to stay legible, which read as a warning sign rather than a status.
   */
  get arkStatusClass(): string {
    if (!this.arkInstallation) return 'tone-muted';
    if (!this.arkInstallation.installed) return 'tone-danger';
    return this.arkInstallation.updateAvailable ? 'tone-warning' : 'tone-success';
  }

  /** Takes effect at once with no Save step: the result is visible immediately and stays on this device. */
  onThemeChange(preference: ThemePreference) {
    this.themePreference = preference;
    this.themeService.setPreference(preference);
    this.cdr.markForCheck();
  }

  selectTab(tabId: string) {
    this.activeTab = tabId;
    this.settingsDrawer.selectSection(tabId as SettingsSection);
  }

  onInstallServer() {
    this.checkInstallationRequirements('server');
  }

  checkInstallationRequirements(target: string) {
    this.messaging.sendMessage<{ success?: boolean; error?: string; requiresSudo?: boolean; canProceed?: boolean }>(
      'check-install-requirements', { target }
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: response => {
        if (response?.success === false) {
          this.notification.error(`Failed to check installation requirements: ${response.error || 'Unknown error'}`, 'Installation Error');
        } else if (response?.requiresSudo && !response.canProceed) {
          this.pendingInstallTarget = target;
          this.sudoPassword = '';
          this.showSudoPasswordModal = true;
          this.cdr.markForCheck();
        } else {
          this.startInstallation(target);
        }
      },
      error: error => {
        this.notification.error('Failed to check installation requirements: ' + error.message, 'Installation Error');
      }
    });
  }

  onSudoPasswordConfirm() {
    if (!this.sudoPassword.trim()) {
      this.notification.warning('Please enter your sudo password', 'Password Required');
      return;
    }

    this.showSudoPasswordModal = false;
    this.startInstallation(this.pendingInstallTarget, this.sudoPassword);
    this.sudoPassword = '';
    this.pendingInstallTarget = '';
    this.cdr.markForCheck();
  }

  onSudoPasswordCancel() {
    this.showSudoPasswordModal = false;
    this.sudoPassword = '';
    this.pendingInstallTarget = '';
    this.cdr.markForCheck();
  }

  private startInstallation(target: string, sudoPassword?: string) {
    this.showInstallModal = true;
    this.installProgress = { percent: 0, step: 'Starting', message: 'Initializing install...' };
    this.installSub?.unsubscribe();
    this.installSub = this.messaging.receiveMessage<InstallEvent>('install').subscribe(event => {
      const progress = event?.data;
      if (!progress) return;

      if (progress.message?.includes('already in progress')) {
        this.notification.warning(progress.message, 'Install Warning');
        this.onCloseInstall();
        return;
      }

      if (progress.step === 'error' || progress.error) {
        this.showInstallFailure(progress.message || progress.error || 'Installation failed. Check server logs for details.', progress.phase);
        return;
      }

      if (progress.cancelled) {
        this.showInstallModal = false;
        this.installProgress = null;
        this.cdr.markForCheck();
        return;
      }

      if (progress.step) {
        const isComplete = progress.phase === 'validation' && progress.overallPhase === 'Installation Complete';
        this.installProgress = {
          percent: isComplete ? 100 : (progress.phasePercent ?? 0),
          step: isComplete ? 'Installation Complete' : (progress.overallPhase || ''),
          message: progress.message || '',
          phase: progress.phase || '',
          success: isComplete ? true : undefined
        };
        // Show the new build straight away rather than the pre-install "Update available".
        if (isComplete) this.loadArkInstallation();
        this.cdr.markForCheck();
      }
    });

    const installPayload = sudoPassword ? { target, sudoPassword } : { target };
    this.messaging.sendMessage('install', installPayload, { timeoutMs: INSTALL_TIMEOUT_MS })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        error: error => {
          console.error('[settings] The install request failed:', error);
          this.showInstallFailure('Installation failed. Check server logs for details.');
        }
      });
  }

  /** Between the start of an install and its success, failure or cancellation. */
  get installRunning(): boolean {
    return !!this.installProgress && !this.installProgress.success && !this.installProgress.failed;
  }

  /**
   * Escape or a click beside the dialog. Ignored while the install runs: only the Cancel Install
   * button should throw away a download of several gigabytes.
   */
  onDismissInstall() {
    if (this.installRunning) return;
    this.onCloseInstall();
  }

  onCloseInstall() {
    this.showInstallModal = false;
    this.installSub?.unsubscribe();
  }

  onCancelInstall() {
    this.onCloseInstall();
    this.installProgress = null;
    this.messaging.sendMessage('cancel-install', { target: 'server' }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      error: error => console.error('[settings] Could not cancel the install:', error)
    });
  }

  onOpenConfigDirectory() {
    if (!this.isElectron) return;
    const failed = 'Could not open the config directory.';
    this.messaging.sendMessage<OpenDirectoryReply>('open-config-directory', {}).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: reply => {
        if (reply?.success === false) this.notification.error(reply.error || failed, 'Settings');
      },
      error: error => {
        console.error('[settings] Could not open the config directory:', error);
        this.notification.error(failed, 'Settings');
      }
    });
  }

  getAppVersion() {
    return environment.version || '1.2.2';
  }

  getPlatform() {
    if (this.backendPlatform) return this.backendPlatform;
    if (typeof navigator !== 'undefined') {
      const platform = navigator.platform || navigator.userAgent;
      if (platform.includes('Win')) return 'Windows';
      if (platform.includes('Mac')) return 'macOS';
      if (platform.includes('Linux')) return 'Linux';
    }
    return 'Unknown';
  }

  getNodeVersion() {
    if (this.backendNodeVersion) return this.backendNodeVersion;
    if (this.isElectron) return this.ipc.versions?.node || 'Unknown';
    return 'Not Available (Browser)';
  }

  getElectronVersion() {
    if (this.backendElectronVersion) return this.backendElectronVersion;
    if (this.isElectron) return this.ipc.versions?.electron || 'Unknown';
    return 'Not Available (Browser)';
  }

  getConfigPath() {
    if (this.backendConfigPath) return this.backendConfigPath;
    return this.isElectron ? 'Unknown' : 'N/A (Browser Mode - No Local Config)';
  }

  onStartWebServer() {
    this.configService.webServerPort = this.webServerPort;
    this.messaging.sendMessage<WebServerReply>('start-web-server', { port: this.webServerPort })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: res => {
          this.webServerRunning = !!res?.success;
          if (res?.success) {
            this.notification.success(`Web server started on port ${this.webServerPort}`, 'Web Server');
          } else {
            this.notification.error(res?.message || 'Failed to start web server.', 'Web Server');
          }
          this.cdr.markForCheck();
        },
        error: () => {
          this.webServerRunning = false;
          this.notification.error('Failed to start web server.', 'Web Server');
          this.cdr.markForCheck();
        }
      });
  }

  /** Saved when the field is committed ('change' fires on blur or Enter), never per keystroke. */
  onPortChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const port = Number(input.value);
    if (!input.value || !Number.isInteger(port) || port < MIN_WEB_SERVER_PORT || port > MAX_WEB_SERVER_PORT) {
      this.notification.warning(`Enter a port between ${MIN_WEB_SERVER_PORT} and ${MAX_WEB_SERVER_PORT}.`, 'Web Server');
      input.value = String(this.webServerPort);
      return;
    }
    if (port === this.webServerPort) return;
    this.webServerPort = port;
    this.configService.webServerPort = port;
  }

  onStartOnLoadChange(newValue: boolean) {
    this.startWebServerOnLoad = newValue;
    this.configService.startWebServerOnLoad = newValue;
  }

  onStopWebServer() {
    this.messaging.sendMessage<WebServerReply>('stop-web-server', {})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: res => {
          if (res?.success) {
            this.webServerRunning = false;
            this.notification.info('Web server stopped.', 'Web Server');
          } else {
            this.notification.error(res?.message || 'Failed to stop web server.', 'Web Server');
          }
          this.cdr.markForCheck();
        },
        error: () => {
          this.notification.error('Failed to stop web server.', 'Web Server');
          this.cdr.markForCheck();
        }
      });
  }

  /**
   * Who may sign in comes from the accounts under Users & Roles; an install that still has the
   * older single login keeps it as a fallback until its owner replaces it with an account.
   */
  onAuthenticationEnabledChange(newValue: boolean) {
    this.authenticationEnabled = newValue;
    this.configService.authenticationEnabled = newValue;

    if (newValue) {
      this.notification.success('Authentication enabled. Restart the web server for changes to take effect.', 'Authentication');
      if (!this.accountsInUse) {
        this.notification.info('Add an account under Users & Roles so someone can sign in.', 'Authentication');
      }
    } else {
      this.notification.info('Authentication disabled.', 'Authentication');
    }
  }

  /** "2025" in the first year, "2025-2026" and onwards after that. */
  get copyrightYears(): string {
    const first = 2025;
    const now = new Date().getFullYear();
    return now > first ? `${first}–${now}` : `${first}`;
  }

  /** Jump to the accounts list, which is where web access is decided. */
  goToUsers(): void {
    this.settingsDrawer.open('users');
  }

  onMaxBackupDownloadSizeChange(newValue: string) {
    const sizeValue = parseInt(newValue, 10);
    if (!isNaN(sizeValue) && sizeValue >= 1 && sizeValue <= 2048) {
      this.maxBackupDownloadSizeMB = sizeValue;
      this.configService.maxBackupDownloadSizeMB = sizeValue;
      this.notification.success(`Backup download size limit set to ${sizeValue}MB`, 'Settings');
    } else {
      this.notification.warning('Invalid size limit. Please enter a value between 1 and 2048 MB.', 'Settings');
      setTimeout(() => {
        this.maxBackupDownloadSizeMB = this.configService.maxBackupDownloadSizeMB || 100;
      }, 100);
    }
  }

  onServerDataDir(path: string) {
    this.serverDataDir = path;
    this.configService.serverDataDir = path;
    this.notification.success('Server Data Directory Updated', 'Settings');
  }

  clearServerDataDir() {
    this.serverDataDir = '';
    this.configService.serverDataDir = '';
    this.notification.info('Server Data Directory reset to default. Restart required.', 'Settings');
  }

  onAutoUpdateArkServerChange(event: Event) {
    const val = (event.target as HTMLInputElement).checked;
    this.autoUpdateArkServer = val;
    this.configService.autoUpdateArkServer = val;
    this.notification.info(`Auto-Update Ark Server is now ${val ? 'Enabled' : 'Disabled'}`, 'Settings');
  }

  onUpdateWarningMinutesChange(val: string) {
    const minutes = parseInt(val, 10);
    if (!isNaN(minutes) && minutes >= 1 && minutes <= 60) {
      this.updateWarningMinutes = minutes;
      this.configService.updateWarningMinutes = minutes;
      this.notification.success(`Update Warning set to ${minutes} minutes`, 'Settings');
    } else {
      this.notification.warning('Invalid warning time (1-60 minutes).', 'Settings');
      setTimeout(() => {
        this.updateWarningMinutes = this.configService.updateWarningMinutes || 15;
      }, 100);
    }
  }

  onServerStartDelaySecondsChange(val: string) {
    const seconds = parseInt(val, 10);
    if (!isNaN(seconds) && seconds >= 10 && seconds <= 300) {
      this.serverStartDelaySeconds = seconds;
      this.configService.serverStartDelaySeconds = seconds;
      this.notification.success(`Server Start Delay set to ${seconds} seconds`, 'Settings');
    } else {
      this.notification.warning('Invalid delay (10-300 seconds).', 'Settings');
      setTimeout(() => {
        this.serverStartDelaySeconds = this.configService.serverStartDelaySeconds || 60;
      }, 100);
    }
  }

  selectServerDataDir() {
    if (!this.isElectron) return;
    this.messaging.sendMessage<{ path?: string; error?: string }>(
      'select-directory', { title: 'Select Server Data Directory' }, { timeoutMs: DIRECTORY_DIALOG_TIMEOUT_MS }
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => {
        if (result?.path) {
          this.onServerDataDir(result.path);
        } else if (result?.error) {
          this.notification.error(result.error, 'Directory Selection Failed');
        }
      },
      error: error => {
        console.error('[settings] Failed to select directory:', error);
        this.notification.error('Failed to select directory', 'Error');
      }
    });
  }

  private applyConfig(config: Partial<GlobalConfig> | null | undefined): void {
    if (!config) return;
    this.webServerPort = config.webServerPort ?? this.webServerPort;
    this.startWebServerOnLoad = !!config.startWebServerOnLoad;
    this.authenticationEnabled = !!config.authenticationEnabled;
    this.maxBackupDownloadSizeMB = config.maxBackupDownloadSizeMB ?? 100;
    this.serverDataDir = config.serverDataDir || '';
    this.autoUpdateArkServer = !!config.autoUpdateArkServer;
    this.updateWarningMinutes = config.updateWarningMinutes || 15;
    this.serverStartDelaySeconds = config.serverStartDelaySeconds || 60;
    this.cdr.markForCheck();
  }

  private buildTabGroups(): void {
    const groups: { name: string; tabs: SettingsTab[] }[] = [];
    for (const tab of this.tabs) {
      let group = groups.find(g => g.name === tab.group);
      if (!group) {
        group = { name: tab.group, tabs: [] };
        groups.push(group);
      }
      group.tabs.push(tab);
    }
    this.tabGroups = groups;
  }

  private showInstallFailure(message: string, phase?: string): void {
    this.notification.error(message, 'Installation Failed');
    this.installProgress = {
      percent: this.installProgress?.percent ?? 0,
      step: 'Installation Failed',
      message,
      phase: phase || 'error',
      success: false,
      failed: true
    };
    this.cdr.markForCheck();
  }

  private updateArkUpdateBadge() {
    this.notification.info('A new ARK server update is available!', 'Update Available');
    const tab = this.tabs.find(t => t.id === 'server-installation');
    if (tab) tab.showUpdateBadge = true;
    this.cdr.markForCheck();
  }

  private clearArkUpdateBadge() {
    const tab = this.tabs.find(t => t.id === 'server-installation');
    if (tab) tab.showUpdateBadge = false;
    this.cdr.markForCheck();
  }
}
