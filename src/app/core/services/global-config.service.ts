import { Injectable } from '@angular/core';
import { GlobalConfig } from '../interfaces/global-config.interface';
import { MessagingService } from './messaging/messaging.service';



@Injectable({ providedIn: 'root' })
export class GlobalConfigService {
  private config: GlobalConfig | null = null;

  constructor(private messaging: MessagingService) {
    // Subscribe to global-config messages for real-time updates
    this.messaging.receiveMessage<GlobalConfig>('global-config').subscribe(cfg => {
      this.config = cfg;
    });
  }

  /** Loads config from backend (returns a promise) */
  loadConfig(): Promise<GlobalConfig> {
    return new Promise((resolve, reject) => {
      // Listen for the next 'global-config' message after requesting
      let sub: any;
      sub = this.messaging.receiveMessage<GlobalConfig>('global-config').subscribe({
        next: (cfg: GlobalConfig) => {
          this.config = cfg;
          resolve(cfg);
          if (sub) sub.unsubscribe();
        },
        error: reject
      });
      this.messaging.sendMessage('get-global-config', {}).subscribe();
    });
  }

  /** Saves config to backend (returns a promise, uses requestId) */
  saveConfig(cfg: GlobalConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      this.messaging.sendMessage('set-global-config', { config: cfg }).subscribe({
        next: (res: any) => {
          if (res.success) {
            this.config = cfg;
            resolve();
          } else {
            reject(res.error || 'Failed to save config');
          }
        },
        error: reject
      });
    });
  }

  get startWebServerOnLoad() {
    return this.config?.startWebServerOnLoad ?? false;
  }
  set startWebServerOnLoad(val: boolean) {
    if (!this.config) return;
    this.config.startWebServerOnLoad = val;
    this.saveConfig(this.config);
  }

  get webServerPort() {
    return this.config?.webServerPort ?? 3000;
  }
  set webServerPort(val: number) {
    if (!this.config) return;
    this.config.webServerPort = val;
    this.saveConfig(this.config);
  }

  get authenticationEnabled() {
    return this.config?.authenticationEnabled ?? false;
  }
  set authenticationEnabled(val: boolean) {
    if (!this.config) return;
    this.config.authenticationEnabled = val;
    this.saveConfig(this.config);
  }

  get authenticationUsername() {
    return this.config?.authenticationUsername ?? '';
  }
  set authenticationUsername(val: string) {
    if (!this.config) return;
    this.config.authenticationUsername = val;
    this.saveConfig(this.config);
  }

  get authenticationPassword() {
    return this.config?.authenticationPassword ?? '';
  }
  set authenticationPassword(val: string) {
    if (!this.config) return;
    this.config.authenticationPassword = val;
    this.saveConfig(this.config);
  }

  get maxBackupDownloadSizeMB() {
    return this.config?.maxBackupDownloadSizeMB ?? 100;
  }
  set maxBackupDownloadSizeMB(val: number) {
    if (!this.config) return;
    this.config.maxBackupDownloadSizeMB = val;
    this.saveConfig(this.config).catch(err => console.error(err));
  }

  get serverDataDir() {
    return this.config?.serverDataDir ?? '';
  }
  set serverDataDir(val: string) {
    if (!this.config) return;
    this.config.serverDataDir = val;
    this.saveConfig(this.config).catch(err => console.error(err));
  }

  get autoUpdateArkServer() {
    return this.config?.autoUpdateArkServer ?? false;
  }
  set autoUpdateArkServer(val: boolean) {
    if (!this.config) return;
    this.config.autoUpdateArkServer = val;
    this.saveConfig(this.config).catch(err => console.error(err));
  }

  get curseForgeApiKey() {
    return this.config?.curseForgeApiKey ?? '';
  }
  set curseForgeApiKey(val: string) {
    if (!this.config) return;
    this.config.curseForgeApiKey = val;
    this.saveConfig(this.config).catch(err => console.error(err));
  }

  get updateWarningMinutes() {
    return this.config?.updateWarningMinutes ?? 15;
  }
  set updateWarningMinutes(val: number) {
    if (!this.config) return;
    this.config.updateWarningMinutes = val;
    this.saveConfig(this.config).catch(err => console.error(err));
  }
}
