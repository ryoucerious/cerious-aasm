import { Component, ChangeDetectorRef } from '@angular/core';
import { NotificationService } from '../../core/services/notification.service';
import { UtilityService } from '../../core/services/utility.service';
import { NgFor, NgIf, NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MessagingService } from '../../core/services/messaging/messaging.service';
import { GlobalConfigService } from '../../core/services/global-config.service';
import { ModalComponent } from '../../components/modal/modal.component';
import { Subscription } from 'rxjs';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-settings-page',
  standalone: true,
  imports: [NgFor, NgIf, NgClass, ModalComponent, FormsModule],
  templateUrl: './settings.component.html'  
})
export class SettingsPageComponent {
  public isElectron: boolean;
  tabs = [
    { id: 'server-installation', label: 'Server Installation', icon: 'dns', showUpdateBadge: false },
    { id: 'about', label: 'About', icon: 'info' }
  ];

  arkUpdateAvailable = false;
  webServerRunning = false;
  webServerPort = 3000;
  startWebServerOnLoad = false;
  authenticationEnabled = false;
  authenticationUsername = '';
  authenticationPassword = '';
  maxBackupDownloadSizeMB = 100;
  // Backend-provided system info (populated when running in Electron)
  backendNodeVersion: string | null = null;
  backendElectronVersion: string | null = null;
  backendPlatform: string | null = null;
  backendConfigPath: string | null = null;
  subscriptions: Subscription[] = [];
  showSettings = true;

  ngOnInit() {
    // Load config first
    this.configService.loadConfig().then(cfg => {
      this.webServerPort = cfg.webServerPort;
      this.startWebServerOnLoad = cfg.startWebServerOnLoad;
      this.authenticationEnabled = cfg.authenticationEnabled;
      this.authenticationUsername = cfg.authenticationUsername;
      this.authenticationPassword = cfg.authenticationPassword;
      this.maxBackupDownloadSizeMB = cfg.maxBackupDownloadSizeMB;
      this.cdr.markForCheck();
    });
    // Reactively update UI on any global-config broadcast
    this.subscriptions.push(this.messaging.receiveMessage('global-config').subscribe((cfg: any) => {
      this.webServerPort = cfg.webServerPort;
      this.startWebServerOnLoad = cfg.startWebServerOnLoad;
      this.authenticationEnabled = cfg.authenticationEnabled;
      this.authenticationUsername = cfg.authenticationUsername;
      this.authenticationPassword = cfg.authenticationPassword;
      this.maxBackupDownloadSizeMB = cfg.maxBackupDownloadSizeMB;
      this.cdr.markForCheck();
    }));
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
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.installSub?.unsubscribe();
  }

  activeTab = 'server-installation';

  // Modal and progress state
  showInstallModal = false;
  installProgress: { percent: number, step: string, message: string, phase?: string, success?: boolean, blocked?: boolean } | null = null;
  private installSub?: Subscription;
  
  // Sudo password collection state
  showSudoPasswordModal = false;
  sudoPassword = '';
  pendingInstallTarget = '';

  constructor(
    private messaging: MessagingService,
    private cdr: ChangeDetectorRef,
    private utility: UtilityService,
  private notification: NotificationService,
    private configService: GlobalConfigService
  ) {
    this.isElectron = this.utility.getPlatform() === 'Electron';
    this.tabs = [
      { id: 'server-installation', label: 'Server Installation', icon: 'dns', showUpdateBadge: false },
      ...(this.isElectron ? [{ id: 'web-server', label: 'Web Server', icon: 'cloud' }] : []),
      { id: 'about', label: 'About', icon: 'info' }
    ];
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
      var progress = msg?.data;

      // Show toast for error/info messages
      if (progress.message.includes('already in progress')) {
        this.notification.warning(progress.message, 'Install Warning');
        this.onCloseInstall();
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
    return environment.version || '1.0.0-beta.6.4';
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

  onAuthenticationEnabledChange(newValue: boolean) {
    if (newValue) {
      // First, enable authentication to show the fields
      this.authenticationEnabled = true;
      this.configService.authenticationEnabled = true;
      
      // Then check if validation is needed - if fields are empty, show helpful message
      if (!this.authenticationUsername.trim() || !this.authenticationPassword.trim()) {
        this.notification.info('Please enter username and password below to complete authentication setup', 'Authentication');
        return;
      }
      
      // If we have both username and password, show success message
      this.notification.success('Authentication enabled. Restart the web server for changes to take effect.', 'Authentication');
    } else {
      // Disabling authentication
      this.authenticationEnabled = false;
      this.configService.authenticationEnabled = false;
      
      // Clear username and password when disabling
      this.authenticationUsername = '';
      this.authenticationPassword = '';
      this.configService.authenticationUsername = '';
      this.configService.authenticationPassword = '';
      
      this.notification.info('Authentication disabled.', 'Authentication');
    }
  }

  onAuthenticationUsernameChange(newValue: string) {
    this.authenticationUsername = newValue;
    this.configService.authenticationUsername = newValue;
    
    // Only show feedback when user finishes editing (on blur)
    if (this.authenticationEnabled && newValue.trim() && this.authenticationPassword.trim()) {
      this.notification.success('Authentication is now configured. Restart the web server for changes to take effect.', 'Authentication');
    } else if (this.authenticationEnabled && !newValue.trim() && this.authenticationPassword.trim()) {
      this.notification.warning('Username is required for authentication', 'Authentication');
    }
  }

  onAuthenticationPasswordChange(newValue: string) {
    this.authenticationPassword = newValue;
    this.configService.authenticationPassword = newValue;
    
    // Only show feedback when user finishes editing (on blur)
    if (this.authenticationEnabled && newValue.trim() && this.authenticationUsername.trim()) {
      this.notification.success('Authentication is now configured. Restart the web server for changes to take effect.', 'Authentication');
    } else if (this.authenticationEnabled && !newValue.trim() && this.authenticationUsername.trim()) {
      this.notification.warning('Password is required for authentication', 'Authentication');
    }
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
}