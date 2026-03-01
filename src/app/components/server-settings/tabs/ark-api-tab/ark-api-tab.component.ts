import { Component, Input, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MessagingService } from '../../../../core/services/messaging/messaging.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { ModalComponent } from '../../../modal/modal.component';

export interface PluginInfo {
  name: string;
  version: string;
  author: string;
  description: string;
  folderName: string;
  hasPluginJson: boolean;
}

@Component({
  selector: 'app-ark-api-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, ModalComponent],
  templateUrl: './ark-api-tab.component.html',
})
export class ArkApiTabComponent implements OnInit, OnDestroy {
  @Input() serverInstance: any;

  plugins: PluginInfo[] = [];
  loading = false;

  latestVersion = '';
  latestDownloadUrl = '';
  checkingLatest = false;
  installing = false;

  showConfirmRemove = false;
  pluginToRemove: PluginInfo | null = null;

  // Install from URL
  pluginInstallUrl = '';
  installingFromUrl = false;

  // Install from ZIP
  installingFromZip = false;

  constructor(
    private messaging: MessagingService,
    private notification: NotificationService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.loadPlugins();
  }

  ngOnDestroy() {}

  loadPlugins() {
    if (!this.serverInstance?.id) return;
    this.loading = true;
    this.cdr.markForCheck();
    this.messaging.sendMessage('list-ark-api-plugins', { instanceId: this.serverInstance.id }).subscribe({
      next: (res: any) => {
        this.plugins = res?.plugins ?? [];
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.notification.error('Failed to load plugins.', 'ArkApi');
        this.cdr.markForCheck();
      },
    });
  }

  checkLatestAsaApi() {
    this.checkingLatest = true;
    this.cdr.markForCheck();
    this.messaging.sendMessage('get-asaapi-latest', {}).subscribe({
      next: (res: any) => {
        this.checkingLatest = false;
        if (res?.success) {
          this.latestVersion = res.version;
          this.latestDownloadUrl = res.downloadUrl;
          this.notification.info(`Latest AsaApi: ${res.version}`, 'AsaApi');
        } else {
          this.notification.error(res?.error || 'Failed to fetch release info.', 'AsaApi');
        }
        this.cdr.markForCheck();
      },
      error: () => {
        this.checkingLatest = false;
        this.notification.error('Failed to reach GitHub.', 'AsaApi');
        this.cdr.markForCheck();
      },
    });
  }

  installAsaApi() {
    if (!this.latestDownloadUrl) return;
    this.installing = true;
    this.cdr.markForCheck();
    this.messaging.sendMessage('download-asaapi', {
      instanceId: this.serverInstance.id,
      downloadUrl: this.latestDownloadUrl,
    }).subscribe({
      next: (res: any) => {
        this.installing = false;
        if (res?.success) {
          this.notification.success('AsaApi installed successfully.', 'AsaApi');
          this.loadPlugins();
        } else {
          this.notification.error(res?.error || 'Installation failed.', 'AsaApi');
        }
        this.cdr.markForCheck();
      },
      error: () => {
        this.installing = false;
        this.notification.error('Installation failed.', 'AsaApi');
        this.cdr.markForCheck();
      },
    });
  }

  installPluginFromUrl() {
    const url = this.pluginInstallUrl.trim();
    if (!url || !this.serverInstance?.id) return;
    this.installingFromUrl = true;
    this.cdr.markForCheck();
    this.messaging.sendMessage('install-plugin-from-url', { instanceId: this.serverInstance.id, url }).subscribe({
      next: (res: any) => {
        this.installingFromUrl = false;
        if (res?.success) {
          this.notification.success('Plugin installed from URL.', 'ArkApi');
          this.pluginInstallUrl = '';
          this.loadPlugins();
        } else {
          this.notification.error(res?.error || 'Failed to install plugin.', 'ArkApi');
        }
        this.cdr.markForCheck();
      },
      error: () => {
        this.installingFromUrl = false;
        this.notification.error('Failed to install plugin from URL.', 'ArkApi');
        this.cdr.markForCheck();
      },
    });
  }

  onZipFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.serverInstance?.id) return;
    // In Electron, File objects have a .path property with the real filesystem path
    const zipPath = (file as any).path;
    if (!zipPath) {
      this.notification.error('Could not read file path. Are you running in Electron?', 'ArkApi');
      return;
    }
    this.installingFromZip = true;
    this.cdr.markForCheck();
    this.messaging.sendMessage('install-plugin-from-zip', { instanceId: this.serverInstance.id, zipPath }).subscribe({
      next: (res: any) => {
        this.installingFromZip = false;
        input.value = '';
        if (res?.success) {
          this.notification.success('Plugin installed from ZIP.', 'ArkApi');
          this.loadPlugins();
        } else {
          this.notification.error(res?.error || 'Failed to install plugin.', 'ArkApi');
        }
        this.cdr.markForCheck();
      },
      error: () => {
        this.installingFromZip = false;
        input.value = '';
        this.notification.error('Failed to install plugin from ZIP.', 'ArkApi');
        this.cdr.markForCheck();
      },
    });
  }

  confirmRemove(plugin: PluginInfo) {
    this.pluginToRemove = plugin;
    this.showConfirmRemove = true;
    this.cdr.markForCheck();
  }

  doRemove() {
    if (!this.pluginToRemove) return;
    const folderName = this.pluginToRemove.folderName;
    this.showConfirmRemove = false;
    this.messaging.sendMessage('remove-ark-api-plugin', {
      instanceId: this.serverInstance.id,
      folderName,
    }).subscribe({
      next: (res: any) => {
        if (res?.success) {
          this.notification.success(`Plugin "${folderName}" removed.`, 'ArkApi');
          this.loadPlugins();
        } else {
          this.notification.error(res?.error || 'Failed to remove plugin.', 'ArkApi');
        }
        this.cdr.markForCheck();
      },
      error: () => {
        this.notification.error('Failed to remove plugin.', 'ArkApi');
        this.cdr.markForCheck();
      },
    });
    this.pluginToRemove = null;
  }

  cancelRemove() {
    this.showConfirmRemove = false;
    this.pluginToRemove = null;
    this.cdr.markForCheck();
  }
}
