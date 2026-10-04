import { Component, Input, OnChanges, OnDestroy, SimpleChanges, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EMPTY, Subject, Subscription, catchError, defer, finalize, map, of, switchMap } from 'rxjs';
import { FILE_TRANSFER_TIMEOUT_MS, MessagingService } from '../../../../core/services/messaging/messaging.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { ModalComponent } from '../../../modal/modal.component';
import type { DesktopFile } from '../../../../core/types/electron-api';

export interface PluginInfo {
  name: string;
  version: string;
  author: string;
  description: string;
  folderName: string;
  hasPluginJson: boolean;
}

interface ActionReply {
  success?: boolean;
  error?: string;
}

@Component({
  selector: 'app-ark-api-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, ModalComponent],
  templateUrl: './ark-api-tab.component.html',
})
export class ArkApiTabComponent implements OnChanges, OnDestroy {
  @Input() serverInstance: { id?: string } | null = null;

  plugins: PluginInfo[] = [];
  loading = false;
  asaApiInstalled: boolean | null = null;

  latestVersion = '';
  latestDownloadUrl = '';
  checkingLatest = false;
  installing = false;

  showConfirmRemove = false;
  pluginToRemove: PluginInfo | null = null;

  pluginInstallUrl = '';
  installingFromUrl = false;
  installingFromZip = false;

  // Each request replaces the one in flight, so a late reply for the previous server never lands.
  private readonly pluginRequests = new Subject<string>();
  private readonly statusRequests = new Subject<string>();
  private readonly subscriptions = new Subscription();
  /** Installs and removals for the server shown; dropped on a switch, so their replies do not report on the next one. */
  private serverActions = new Subscription();

  constructor(
    private messaging: MessagingService,
    private notification: NotificationService,
    private cdr: ChangeDetectorRef
  ) {
    this.subscriptions.add(this.pluginRequests.pipe(
      switchMap(instanceId => defer(() => {
        this.loading = true;
        return this.messaging.sendMessage<{ plugins?: PluginInfo[] }>('list-ark-api-plugins', { instanceId });
      }).pipe(
        catchError(() => {
          this.notification.error('Failed to load plugins.', 'ArkApi');
          return EMPTY;
        }),
        finalize(() => {
          this.loading = false;
          this.cdr.markForCheck();
        })
      ))
    ).subscribe(reply => {
      this.plugins = reply?.plugins ?? [];
      this.cdr.markForCheck();
    }));

    this.subscriptions.add(this.statusRequests.pipe(
      switchMap(instanceId => this.messaging.sendMessage<{ installed?: boolean }>('get-asaapi-status', { instanceId }).pipe(
        map(reply => !!reply?.installed),
        catchError(() => of(null))
      ))
    ).subscribe(installed => {
      this.asaApiInstalled = installed;
      this.cdr.markForCheck();
    }));
  }

  ngOnChanges(changes: SimpleChanges): void {
    const change = changes['serverInstance'];
    if (!change || (!change.firstChange && change.previousValue?.id === change.currentValue?.id)) return;

    this.serverActions.unsubscribe();
    this.serverActions = new Subscription();
    this.plugins = [];
    this.asaApiInstalled = null;
    this.pluginInstallUrl = '';
    this.installing = false;
    this.installingFromUrl = false;
    this.installingFromZip = false;
    this.cancelRemove();
    this.loadPlugins();
    this.refreshAsaApiStatus();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.serverActions.unsubscribe();
  }

  refreshAsaApiStatus() {
    if (this.serverInstance?.id) this.statusRequests.next(this.serverInstance.id);
  }

  loadPlugins() {
    if (this.serverInstance?.id) this.pluginRequests.next(this.serverInstance.id);
  }

  checkLatestAsaApi() {
    this.checkingLatest = true;
    this.cdr.markForCheck();
    this.messaging.sendMessage<ActionReply & { version?: string; downloadUrl?: string }>('get-asaapi-latest', {}).subscribe({
      next: res => {
        this.checkingLatest = false;
        if (res?.success) {
          this.latestVersion = res.version ?? '';
          this.latestDownloadUrl = res.downloadUrl ?? '';
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
    const instanceId = this.serverInstance?.id;
    if (!this.latestDownloadUrl || !instanceId) return;
    this.installing = true;
    this.cdr.markForCheck();
    this.serverActions.add(this.messaging.sendMessage<ActionReply>('download-asaapi', {
      instanceId,
      downloadUrl: this.latestDownloadUrl,
    }, { timeoutMs: FILE_TRANSFER_TIMEOUT_MS }).subscribe({
      next: res => {
        this.installing = false;
        if (res?.success) {
          this.notification.success('AsaApi installed successfully. Restart the server to load via AsaApiLoader.', 'AsaApi');
          this.loadPlugins();
          this.refreshAsaApiStatus();
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
    }));
  }

  installPluginFromUrl() {
    const url = this.pluginInstallUrl.trim();
    const instanceId = this.serverInstance?.id;
    if (!url || !instanceId) return;
    this.installingFromUrl = true;
    this.cdr.markForCheck();
    this.serverActions.add(this.messaging.sendMessage<ActionReply>(
      'install-plugin-from-url', { instanceId, url }, { timeoutMs: FILE_TRANSFER_TIMEOUT_MS }
    ).subscribe({
      next: res => {
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
    }));
  }

  onZipFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file: DesktopFile | undefined = input.files?.[0];
    const instanceId = this.serverInstance?.id;
    if (!file || !instanceId) return;
    const zipPath = file.path;
    if (!zipPath) {
      this.notification.error('Could not read file path. Are you running in Electron?', 'ArkApi');
      return;
    }
    this.installingFromZip = true;
    this.cdr.markForCheck();
    this.serverActions.add(this.messaging.sendMessage<ActionReply>('install-plugin-from-zip', { instanceId, zipPath }).subscribe({
      next: res => {
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
    }));
  }

  confirmRemove(plugin: PluginInfo) {
    this.pluginToRemove = plugin;
    this.showConfirmRemove = true;
    this.cdr.markForCheck();
  }

  /** Removes the confirmed plugin only if the current server still lists it. */
  doRemove() {
    const instanceId = this.serverInstance?.id;
    const plugin = this.plugins.find(p => p.folderName === this.pluginToRemove?.folderName);
    this.cancelRemove();
    if (!instanceId || !plugin) return;

    const folderName = plugin.folderName;
    this.serverActions.add(this.messaging.sendMessage<ActionReply>('remove-ark-api-plugin', { instanceId, folderName }).subscribe({
      next: res => {
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
    }));
  }

  cancelRemove() {
    this.showConfirmRemove = false;
    this.pluginToRemove = null;
    this.cdr.markForCheck();
  }
}
