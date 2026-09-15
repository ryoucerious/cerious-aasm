import { Component, ChangeDetectorRef, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NotificationService } from '../../core/services/notification.service';
import { UtilityService } from '../../core/services/utility.service';
import { NgFor, NgIf, NgClass, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MessagingService } from '../../core/services/messaging/messaging.service';
import { GlobalConfigService } from '../../core/services/global-config.service';
import { ServerInstanceService } from '../../core/services/server-instance.service';
import { ModalComponent } from '../../components/modal/modal.component';
import { DrawerComponent } from '../../components/drawer/drawer.component';
import { UsersSettingsComponent } from './users/users-settings.component';
import { ProfileSettingsComponent } from './profile/profile-settings.component';
import { SettingsDrawerService, SettingsSection } from '../../core/services/settings-drawer.service';
import { AuthService } from '../../core/services/auth.service';
import { Subscription } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ThemeService, ThemePreference } from '../../core/services/theme.service';

@Component({
  selector: 'app-settings-page',
  standalone: true,
  imports: [NgFor, NgIf, NgClass, DatePipe, ModalComponent, FormsModule, DrawerComponent, UsersSettingsComponent, ProfileSettingsComponent],
  templateUrl: './settings.component.html'  
})
export class SettingsPageComponent {
  public isElectron: boolean;
  tabs: any[] = [];

  arkUpdateAvailable = false;
  webServerRunning = false;
  webServerPort = 3000;
  startWebServerOnLoad = false;
  authenticationEnabled = false;
  authenticationUsername = '';
  authenticationPassword = '';
  /** True once at least one account exists, so we know whether anyone could sign in. */
  accountsInUse = false;
  maxBackupDownloadSizeMB = 100;
  serverDataDir = '';
  autoUpdateArkServer = false;
  updateWarningMinutes = 15;
  serverStartDelaySeconds = 60;

  // Appearance. Unlike the settings around it this is a per-device preference held in
  // localStorage, not part of the server-side global config — see ThemeService.
  themePreference: ThemePreference = 'system';
  readonly themeOptions: { value: ThemePreference; label: string; icon: string }[] = [
    { value: 'system', label: 'System', icon: 'brightness_auto' },
    { value: 'light', label: 'Light', icon: 'light_mode' },
    { value: 'dark', label: 'Dark', icon: 'dark_mode' }
  ];
  // Backend-provided system info (populated when running in Electron)
  backendNodeVersion: string | null = null;
  backendElectronVersion: string | null = null;
  backendPlatform: string | null = null;
  backendConfigPath: string | null = null;
  subscriptions: Subscription[] = [];
  showSettings = true;
  /** Mirrors SettingsDrawerService so the template can bind without an async pipe. */
  drawerOpen = false;
  private readonly settingsDrawer = inject(SettingsDrawerService);
  private readonly auth = inject(AuthService);

  get activeTabLabel(): string {
    return this.tabs.find(tab => tab.id === this.activeTab)?.label || '';
  }

  /**
   * The rail, grouped under headings, preserving the order of `tabs`.
   *
   * Built once rather than on demand: a getter would hand *ngFor a new array on every
   * change detection pass, which rebuilds the buttons continuously and stops clicks from
   * registering at all. The tab objects themselves are mutated in place (the update badge),
   * so the grouping stays correct.
   */
  tabGroups: { name: string; tabs: any[] }[] = [];

  private buildTabGroups(): void {
    const groups: { name: string; tabs: any[] }[] = [];
    for (const tab of this.tabs) {
      const name = tab.group || 'General';
      let group = groups.find(g => g.name === name);
      if (!group) {
        group = { name, tabs: [] };
        groups.push(group);
      }
      group.tabs.push(tab);
    }
    this.tabGroups = groups;
  }

  trackByGroupName(_index: number, group: { name: string }): string {
    return group.name;
  }

  trackByTabId(_index: number, tab: { id: string }): string {
    return tab.id;
  }

  onCloseDrawer(): void {
    this.settingsDrawer.close();
  }

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

  /** Pull the installation status. Called when the drawer opens and after an install. */
  loadArkInstallation(): void {
    this.arkInstallationLoading = true;
    this.cdr.markForCheck();
    this.subscriptions.push(
      this.messaging.sendMessage<any>('get-ark-installation', {}).subscribe({
        next: (res) => {
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
      })
    );
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

  async ngOnInit() {
    this.subscriptions.push(this.auth.identity$.subscribe(identity => {
      this.accountsInUse = identity.accountsInUse;
      this.cdr.markForCheck();
    }));

    this.subscriptions.push(this.settingsDrawer.isOpen$.subscribe(open => {
      this.drawerOpen = open;
      if (open) this.loadArkInstallation();
      this.cdr.markForCheck();
    }));
    this.subscriptions.push(this.settingsDrawer.section$.subscribe(section => {
      this.activeTab = section;
      this.cdr.markForCheck();
    }));
    // Track whether any server instances are running/starting
    this.subscriptions.push(
      this.serverInstanceService.getInstances().subscribe(instances => {
        this.hasRunningServers = instances.some(i => {
          const state = (i.state || i.status || '').toLowerCase();
          return state === 'running' || state === 'starting' || state === 'stopping';
        });
        this.cdr.markForCheck();
      })
    );

    // Load config first
    const cfg: any = await this.configService.loadConfig();
    if (cfg) {
      this.webServerPort = cfg.webServerPort;
      this.startWebServerOnLoad = cfg.startWebServerOnLoad;
      this.authenticationEnabled = cfg.authenticationEnabled;
      this.authenticationUsername = cfg.authenticationUsername;
      this.authenticationPassword = cfg.authenticationPassword;
      this.maxBackupDownloadSizeMB = cfg.maxBackupDownloadSizeMB;
      this.serverDataDir = cfg.serverDataDir || '';
      this.autoUpdateArkServer = cfg.autoUpdateArkServer || false;
      this.updateWarningMinutes = cfg.updateWarningMinutes || 15;
      this.serverStartDelaySeconds = cfg.serverStartDelaySeconds || 60;
      this.cdr.markForCheck();
    }

    // Reactively update UI on any global-config broadcast
    this.subscriptions.push(this.messaging.receiveMessage('global-config').subscribe((cfg: any) => {
      this.webServerPort = cfg.webServerPort;
      this.startWebServerOnLoad = cfg.startWebServerOnLoad;
      this.authenticationEnabled = cfg.authenticationEnabled;
      this.authenticationUsername = cfg.authenticationUsername;
      this.authenticationPassword = cfg.authenticationPassword;
      this.maxBackupDownloadSizeMB = cfg.maxBackupDownloadSizeMB;
      this.serverDataDir = cfg.serverDataDir || '';
      this.autoUpdateArkServer = cfg.autoUpdateArkServer || false;
      this.updateWarningMinutes = cfg.updateWarningMinutes || 15;
      this.serverStartDelaySeconds = cfg.serverStartDelaySeconds || 60;
      this.cdr.markForCheck();
    })
  );
  this.subscriptions.push(this.messaging.receiveMessage('ark-update-status').subscribe((msg: any) => {
      if (msg?.hasUpdate) {
        this.updateArkUpdateBadge();
      } else {
        this.clearArkUpdateBadge();
      }
    }));
    // Always refresh web server status on init if Electron
    if (this.isElectron) {
      // Listen for backend polling events
      this.subscriptions.push(this.messaging.receiveMessage('web-server-status').subscribe((msg: any) => {
        this.webServerRunning = !!msg?.running;
        if (typeof msg?.port === 'number') {
          this.webServerPort = msg.port;
        }
        this.cdr.markForCheck();
      }));
      // Initial status request
      this.messaging.sendMessage('web-server-status', {});
    }

    // Request system info from backend to display accurate platform/node/electron versions
    this.subscriptions.push(
      this.messaging.sendMessage('get-system-info', {}).subscribe({
        next: (res: any) => {
          if (res) {
            this.backendNodeVersion = res.nodeVersion || null;
            this.backendElectronVersion = res.electronVersion || null;
            this.backendPlatform = res.platform || null;
            this.backendConfigPath = res.configPath || null;
            this.cdr.markForCheck();
          }
        },
        error: (err) => {
          console.error('Failed to get system info:', err);
          // ignore - fall back to client-side heuristics
        }
      })
    );
  }

  ngOnDestroy() {
    // Tolerate an entry that never produced a real Subscription: this component is always
    // mounted now (it hosts the settings drawer), so a teardown error here would surface
    // on every page it outlives.
    this.subscriptions.forEach(sub => sub?.unsubscribe?.());
    this.installSub?.unsubscribe?.();
  }

  activeTab = 'server-installation';

  // Modal and progress state
  showInstallModal = false;
  installProgress: { percent: number, step: string, message: string, phase?: string, success?: boolean, failed?: boolean, blocked?: boolean } | null = null;
  private installSub?: Subscription;
  
  // Sudo password collection state
  showSudoPasswordModal = false;
  sudoPassword = '';
  pendingInstallTarget = '';
  hasRunningServers = false;

  constructor(
    private messaging: MessagingService,
    private cdr: ChangeDetectorRef,
    private utility: UtilityService,
    private notification: NotificationService,
    private configService: GlobalConfigService,
    private serverInstanceService: ServerInstanceService,
    private themeService: ThemeService
  ) {
    this.themePreference = this.themeService.preference;
    this.isElectron = this.utility.getPlatform() === 'Electron';
    // Grouped by what the operator is trying to change, rather than one catch-all "General".
    this.tabs = [
      { id: 'server-installation', label: 'ARK Installation', icon: 'inventory_2', showUpdateBadge: false, group: 'Server' },
      { id: 'servers', label: 'Server Defaults', icon: 'tune', group: 'Server' },
      { id: 'updates', label: 'Updates', icon: 'system_update_alt', group: 'Server' },
      { id: 'storage', label: 'Storage', icon: 'folder', group: 'Server' },
      { id: 'profile', label: 'My Account', icon: 'account_circle', group: 'Access' },
      { id: 'users', label: 'Users & Roles', icon: 'group', group: 'Access' },
      ...(this.isElectron ? [{ id: 'web-server', label: 'Web Server', icon: 'cloud', group: 'Access' }] : []),
      { id: 'appearance', label: 'Appearance', icon: 'palette', group: 'Application' },
      { id: 'about', label: 'About', icon: 'info', group: 'Application' }
    ];
    this.buildTabGroups();
  }

  /**
   * Apply a theme choice. Takes effect immediately — there is no Save step, because the
   * result is visible the moment it is clicked and is stored on this device only.
   */
  onThemeChange(preference: ThemePreference) {
    this.themePreference = preference;
    this.themeService.setPreference(preference);
    this.cdr.markForCheck();
  }

  private updateArkUpdateBadge() {
    this.arkUpdateAvailable = true;
    this.notification.info('A new ARK server update is available!', 'Update Available');
    // Set badge on tab
    const tab = this.tabs.find(t => t.id === 'server-installation');
    if (tab) tab.showUpdateBadge = true;
    this.cdr.markForCheck();
  }

  private clearArkUpdateBadge() {
    this.arkUpdateAvailable = false;
    // Remove badge from tab
    const tab = this.tabs.find(t => t.id === 'server-installation');
    if (tab) tab.showUpdateBadge = false;
    this.cdr.markForCheck();
  }

  selectTab(tabId: string) {
    this.activeTab = tabId;
    this.settingsDrawer.selectSection(tabId as SettingsSection);
  }

  getActiveTabLabel() {
    return this.tabs.find(tab => tab.id === this.activeTab)?.label || '';
  }

  onInstallServer() {
    // First check installation requirements
    this.checkInstallationRequirements('server');
  }

  checkInstallationRequirements(target: string) {
    this.subscriptions.push(
      this.messaging.sendMessage('check-install-requirements', { target }).subscribe({
        next: (response: any) => {
          if (response.requiresSudo && !response.canProceed) {
            // Need sudo password
            this.pendingInstallTarget = target;
            this.sudoPassword = '';
            this.showSudoPasswordModal = true;
            this.cdr.markForCheck();
          } else {
            // Can proceed directly with installation
            this.startInstallation(target);
          }
        },
        error: (error) => {
          this.notification.error('Failed to check installation requirements: ' + error.message, 'Installation Error');
        }
      })
    );
  }

  onSudoPasswordConfirm() {
    if (!this.sudoPassword.trim()) {
      this.notification.warning('Please enter your sudo password', 'Password Required');
      return;
    }
    
    this.showSudoPasswordModal = false;
    this.startInstallation(this.pendingInstallTarget, this.sudoPassword);
    
    // Clear sensitive data
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
    if (this.installSub) this.installSub.unsubscribe();
    this.installSub = this.messaging.receiveMessage('install').subscribe((msg: any) => {
      const progress = msg?.data;
      if (!progress) return;

      // Show toast for concurrent-install warning
      if (progress.message?.includes('already in progress')) {
        this.notification.warning(progress.message, 'Install Warning');
        this.onCloseInstall();
        return;
      }

      // Handle error state – show toast and update modal with failure details
      if (progress.step === 'error' || progress.error) {
        const errorMsg = progress.message || progress.error || 'Installation failed. Check server logs for details.';
        this.notification.error(errorMsg, 'Installation Failed');
        this.installProgress = {
          percent: this.installProgress?.percent ?? 0,
          step: 'Installation Failed',
          message: errorMsg,
          phase: progress.phase || 'error',
          success: false,
          failed: true
        };
        this.cdr.markForCheck();
        return;
      }

      // Handle cancellation
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
        this.cdr.markForCheck();
      }
    });
    
    // Start installation with sudo password if provided
    const installPayload = sudoPassword ? { target, sudoPassword } : { target };
    this.subscriptions.push(this.messaging.sendMessage('install', installPayload).subscribe());
  }

  onCloseInstall() {
    this.showInstallModal = false;
    if (this.installSub) this.installSub.unsubscribe();
  }

  onCancelInstall() {
    this.onCloseInstall();
    this.installProgress = null;
    this.subscriptions.push(this.messaging.sendMessage('cancel-install', { target: 'server' }).subscribe());
  }

  onOpenConfigDirectory() {
    if (!this.isElectron) return;
    this.subscriptions.push(this.messaging.sendMessage('open-config-directory', {}).subscribe());
  }

  onCheckForUpdates() {
    this.notification.info('Checking for ARK server updates...', 'Check for Updates');
    this.subscriptions.push(this.messaging.sendMessage('check-ark-update', {}).subscribe({
      next: (response: any) => {
        if (response?.hasUpdate) {
          this.updateArkUpdateBadge();
        } else {
          this.clearArkUpdateBadge();
          this.notification.info('ARK server is up to date.', 'Check for Updates');
        }
      },
      error: () => {
        this.notification.error('Failed to check for ARK server updates.', 'Check for Updates');
      }
    }));
  }

  getBuildDate() {
    return new Date().toLocaleDateString();
  }

  getAppVersion() {
    return environment.version || '1.1.1';
  }

  getPlatform() {
    // Prefer backend-provided platform when available
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
    // Prefer backend-provided value (more accurate in Electron)
    if (this.backendNodeVersion) return this.backendNodeVersion;
    // In Electron, we can access process.versions in renderer; fallback to that if available
    if (this.isElectron && typeof (globalThis as any).process !== 'undefined') {
      return (globalThis as any).process.versions?.node || 'Unknown';
    }
    return 'Not Available (Browser)';
  }

  getElectronVersion() {
    if (this.backendElectronVersion) return this.backendElectronVersion;
    if (this.isElectron && typeof (globalThis as any).process !== 'undefined') {
      return (globalThis as any).process.versions?.electron || 'Unknown';
    }
    return 'Not Available (Browser)';
  }

  getConfigPath() {
    if (this.backendConfigPath) return this.backendConfigPath;
    if (this.isElectron && typeof (globalThis as any).process !== 'undefined') {
      try {
        const os = (globalThis as any).require('os');
        const path = (globalThis as any).require('path');
        return path.join(os.homedir(), 'AppData', 'Roaming', 'Cerious AASM');
      } catch (e) {
        return 'Unknown';
      }
    }
    return 'N/A (Browser Mode - No Local Config)';
  }

  onStartWebServer() {
    this.configService.webServerPort = this.webServerPort;
    this.subscriptions.push(this.messaging.sendMessage('start-web-server', { port: this.webServerPort }).subscribe({
      next: (res: any) => {
        this.webServerRunning = true;
        this.notification.success(`Web server started on port ${this.webServerPort}`, 'Web Server');
        this.cdr.markForCheck();
      },
      error: () => {
        this.webServerRunning = false;
        this.notification.error('Failed to start web server.', 'Web Server');
        this.cdr.markForCheck();
      }
    }));
  }

  onPortChange(newPort: number) {
    this.webServerPort = newPort;
    this.configService.webServerPort = newPort;
  }

  onStartOnLoadChange(newValue: boolean) {
    this.startWebServerOnLoad = newValue;
    this.configService.startWebServerOnLoad = newValue;
  }

  onStopWebServer() {
    this.subscriptions.push(this.messaging.sendMessage('stop-web-server', {}).subscribe({
      next: (res: any) => {
        this.webServerRunning = false;
        this.notification.info('Web server stopped.', 'Web Server');
        this.cdr.markForCheck();
      },
      error: () => {
        this.notification.error('Failed to stop web server.', 'Web Server');
        this.cdr.markForCheck();
      }
    }));
  }

  /**
   * Turning authentication on or off. Who may sign in comes from the accounts under Users &
   * Roles; the single username and password this page used to collect is gone, and an
   * install that still has one keeps it as a fallback until its owner replaces it with an
   * account.
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

  /** Jump to the accounts list, which is where web access is decided now. */
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
      // Reset to current value
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

  onAutoUpdateArkServerChange(event: any) {
    const val = (event && typeof event === 'object' && event.target) ? event.target.checked : event;
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
    this.messaging.sendMessage('select-directory', { title: 'Select Server Data Directory' })
      .subscribe({
        next: (result: any) => {
          if (result && result.path) {
            this.onServerDataDir(result.path);
          } else if (result && result.error) {
            this.notification.error(result.error, 'Directory Selection Failed');
          }
        },
        error: (err: any) => {
          console.error('Failed to select directory:', err);
          this.notification.error('Failed to select directory', 'Error');
        }
      });
  }

}