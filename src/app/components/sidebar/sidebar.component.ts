import { Component, EventEmitter, Output, ChangeDetectionStrategy, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { Subscription } from 'rxjs';
import { NgFor, NgIf, NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, NavigationEnd } from '@angular/router';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';

import { ServerInstance } from '../../core/models/server-instance.model';
import { ServerInstanceService, withoutRuntimeFields } from '../../core/services/server-instance.service';
import { LiveServersService } from '../../core/services/live-servers.service';
import { ServerLifecycleService } from '../../core/services/server-lifecycle.service';
import { serverStatusKey, serverStatusClass, serverStatusLabel, isOnlineStatus, isBusyStatus } from '../../core/utils/server-status';
import { ServerNavService, ServerTabDef, ServerTabId } from '../../core/services/server-nav.service';
import { ModalComponent } from '../modal/modal.component';
import { AddServerModalComponent } from '../add-server-modal/add-server-modal.component';
import { NotificationService } from '../../core/services/notification.service';
import { SettingsDrawerService } from '../../core/services/settings-drawer.service';
import { AppUpdateService } from '../../core/services/app-update.service';
import { IpcService } from '../../core/services/ipc.service';
import { environment } from '../../../environments/environment';

/**
 * Left-hand navigation: Dashboard, the server list, the selected server's pages, Settings.
 *
 * Server pages are routes (/server/<tab>) so the browser back button, reloads and the top
 * bar's search can all land on a specific page. The server list offers drag to reorder,
 * double-click to rename, delete (stopped servers only), start/stop all and add.
 */
@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [NgFor, NgIf, NgClass, ModalComponent, FormsModule, DragDropModule, AddServerModalComponent],
  templateUrl: './sidebar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SidebarComponent implements OnInit, OnDestroy {
  @Output() selectServer = new EventEmitter<ServerInstance>();
  @Output() closeMobileMenu = new EventEmitter<void>();

  servers: ServerInstance[] = [];
  selectedServerId: string | null = null;
  selectedServer: ServerInstance | null = null;
  currentUrl = '';
  showServers = true;
  configOpen = false;
  readonly version = environment.version;
  /** A new version of the app is waiting, shown as a download mark beside the version. */
  appUpdatePending = false;
  appUpdateTitle = '';
  appUpdateIcon = 'download';
  appUpdateBusy = false;
  appUpdatePercent = 0;
  /** Browser and headless installs explain the update instead of applying it. */
  appUpdateExplain = false;
  appUpdateInstructions = '';
  appUpdateInstructionsUrl = '';
  showUpdateHelp = false;
  private appUpdateState: string | null = null;

  overviewTabs: ServerTabDef[] = [];
  configTabs: ServerTabDef[] = [];
  featureTabs: ServerTabDef[] = [];
  expertMode = false;

  editingServerId: string | null = null;
  editingServerName = '';

  showAddModal = false;
  showConfirmDeleteModal = false;
  serverToDelete: ServerInstance | null = null;
  showConfirmStartAllModal = false;
  showConfirmStopAllModal = false;

  private subs: Subscription[] = [];
  private isLinux = false;

  constructor(
    private router: Router,
    private serverInstanceService: ServerInstanceService,
    private liveServers: LiveServersService,
    private serverLifecycle: ServerLifecycleService,
    private serverNav: ServerNavService,
    private notificationService: NotificationService,
    private settingsDrawer: SettingsDrawerService,
    private appUpdate: AppUpdateService,
    private ipc: IpcService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.subs.push(this.appUpdate.status$.subscribe(status => {
      this.appUpdateState = status?.status ?? null;
      this.appUpdatePending = AppUpdateService.isPending(status);
      this.appUpdateExplain = !this.ipc.isElectron || !!status?.manual;
      this.appUpdateInstructions = status?.instructions || '';
      this.appUpdateInstructionsUrl = status?.instructionsUrl || '';
      this.appUpdateBusy = !this.appUpdateExplain && status?.status === 'downloading';
      this.appUpdatePercent = Math.round(status?.percent ?? 0);
      this.appUpdateIcon = this.appUpdateExplain ? 'info' : (status?.status === 'downloaded' ? 'system_update_alt' : 'download');
      const version = status?.version ? `v${status.version}` : 'the update';
      if (this.appUpdateExplain) this.appUpdateTitle = `How to update to ${version}`;
      else if (status?.status === 'downloaded') this.appUpdateTitle = `Install ${version}`;
      else if (status?.status === 'downloading') this.appUpdateTitle = `Downloading ${version}… ${this.appUpdatePercent}%`;
      else if (status?.status === 'error') this.appUpdateTitle = status.error ? `Update failed: ${status.error}. Click to retry.` : 'Update failed. Click to retry.';
      else this.appUpdateTitle = `Download ${version}`;
      this.cdr.markForCheck();
    }));

    this.currentUrl = this.router.url;
    this.subs.push(this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd) {
        this.currentUrl = event.urlAfterRedirects || event.url;
        this.syncConfigOpen();
        this.cdr.markForCheck();
      }
    }));

    this.subs.push(this.liveServers.servers$.subscribe(servers => {
      this.servers = servers;
      // Auto-select the first server if none is selected so server pages have something to show.
      if (this.servers.length > 0 && !this.selectedServerId) {
        const first = this.servers[0];
        this.selectedServerId = first.id;
        this.selectServer.emit(first);
        this.serverInstanceService.setActiveServer(first);
      }
      if (this.selectedServerId && !this.servers.some(server => server.id === this.selectedServerId)) {
        // The selected server was deleted (possibly from another client).
        const next = this.servers[0] || null;
        this.selectedServerId = next?.id || null;
        this.serverInstanceService.setActiveServer(next);
      }
      this.selectedServer = this.servers.find(server => server.id === this.selectedServerId) || null;
      this.cdr.markForCheck();
    }));

    this.subs.push(this.serverInstanceService.getActiveServer().subscribe(server => {
      this.selectedServerId = server?.id || null;
      this.selectedServer = this.servers.find(item => item.id === this.selectedServerId) || server || null;
      this.cdr.markForCheck();
    }));

    this.subs.push(this.serverNav.expertMode$.subscribe(expertMode => {
      this.expertMode = expertMode;
      this.rebuildTabs();
    }));
    this.subs.push(this.serverNav.isLinux$.subscribe(isLinux => {
      this.isLinux = isLinux;
      this.rebuildTabs();
    }));
  }

  ngOnDestroy(): void {
    this.subs.forEach(sub => sub.unsubscribe());
  }

  get onServerPage(): boolean {
    return this.currentUrl.startsWith('/server');
  }

  get activeTab(): ServerTabId | null {
    const match = this.currentUrl.match(/^\/server\/([^/?#]+)/);
    const tab = match ? decodeURIComponent(match[1]) : null;
    return this.serverNav.isValidTab(tab) ? tab : (this.onServerPage ? 'console' : null);
  }

  get activeConfigLabel(): string {
    const tab = this.activeTab;
    const def = tab ? this.configTabs.find(item => item.id === tab) : undefined;
    return def ? def.label : (this.expertMode ? 'INI files' : 'Configuration');
  }

  isRouteActive(path: string): boolean {
    return this.currentUrl === path || this.currentUrl.startsWith(path + '?') || this.currentUrl.startsWith(path + '#');
  }

  isTabActive(tab: ServerTabDef): boolean {
    return this.onServerPage && this.activeTab === tab.id;
  }

  get configGroupActive(): boolean {
    const tab = this.activeTab;
    return !!tab && this.configTabs.some(item => item.id === tab);
  }

  goToDashboard(): void {
    this.router.navigate(['/dashboard']);
    this.closeMobileMenu.emit();
  }

  /** Settings is a drawer over the current page, so this does not navigate. */
  onSettingsClick(): void {
    this.settingsDrawer.open();
    this.closeMobileMenu.emit();
  }

  /** Download or install the app itself. This is not the ARK server update in Settings. */
  onAppUpdateClick(): void {
    if (this.appUpdateExplain) {
      this.showUpdateHelp = true;
      this.cdr.markForCheck();
      return;
    }
    if (this.appUpdateState === 'downloaded') this.appUpdate.install();
    else if (this.appUpdateState === 'available' || this.appUpdateState === 'error') this.appUpdate.download();
  }

  closeUpdateHelp(): void {
    this.showUpdateHelp = false;
    this.cdr.markForCheck();
  }

  /** Shown when this page cannot install the update itself. */
  get updateHelpText(): string {
    if (this.appUpdateInstructions) return this.appUpdateInstructions;
    return 'This page cannot install the update. Use the Cerious AASM window on the computer that runs the app, and click the update button next to the version there.';
  }

  openTab(tab: ServerTabDef): void {
    if (!this.selectedServerId && this.servers.length) {
      this.onServerClick(this.servers[0], tab.id);
      return;
    }
    this.serverNav.rememberTab(tab.id);
    this.router.navigate(['/server', tab.id]);
    this.closeMobileMenu.emit();
  }

  toggleConfig(): void {
    this.configOpen = !this.configOpen;
  }

  onServerClick(server: ServerInstance, tab: ServerTabId = this.serverNav.lastTab): void {
    this.selectedServerId = server.id;
    this.selectedServer = server;
    this.selectServer.emit(server);
    this.serverInstanceService.setActiveServer(server);
    this.serverNav.rememberTab(tab);
    this.router.navigate(['/server', tab]);
    this.closeMobileMenu.emit();
  }

  private rebuildTabs(): void {
    const tabs = this.serverNav.visibleTabs(this.expertMode, this.isLinux);
    this.overviewTabs = tabs.filter(tab => tab.group === 'overview');
    this.configTabs = tabs.filter(tab => tab.group === 'config' || tab.group === 'ini');
    this.featureTabs = tabs.filter(tab => tab.group === 'features');
    this.syncConfigOpen();
    this.cdr.markForCheck();
  }

  private syncConfigOpen(): void {
    if (this.configGroupActive) this.configOpen = true;
  }

  onDrop(event: CdkDragDrop<ServerInstance[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    const reordered = this.servers.slice();
    moveItemInArray(reordered, event.previousIndex, event.currentIndex);
    this.liveServers.reorder(reordered.map(server => server.id));
    this.cdr.markForCheck();
  }

  onServerNameDoubleClick(server: ServerInstance, event: Event): void {
    event.stopPropagation();
    if (this.isServerBusy(server)) return;
    this.editingServerId = server.id;
    this.editingServerName = server.name;
    this.cdr.markForCheck();
    setTimeout(() => {
      const input = document.querySelector('.editing-server-name') as HTMLInputElement | null;
      if (input) {
        input.focus();
        input.select();
      }
    }, 0);
  }

  onServerNameKeydown(event: KeyboardEvent, server: ServerInstance): void {
    if (event.key === 'Enter') this.saveServerName(server);
    else if (event.key === 'Escape') this.cancelServerNameEdit();
  }

  onServerNameBlur(server: ServerInstance): void {
    this.saveServerName(server);
  }

  private saveServerName(server: ServerInstance): void {
    const trimmedName = this.editingServerName.trim();
    if (!trimmedName || trimmedName === server.name) {
      this.cancelServerNameEdit();
      return;
    }
    // The new name reaches the list with the backend's broadcast of the saved server.
    this.serverInstanceService.save(withoutRuntimeFields({ ...server, name: trimmedName })).subscribe({
      next: result => {
        if (result?.success === false) this.notificationService.warning(result.error || 'Could not rename the server.');
        this.cancelServerNameEdit();
      },
      error: error => {
        console.error('[sidebar] Could not rename the server:', error);
        this.notificationService.error('Could not rename the server.', 'Server Control');
        this.cancelServerNameEdit();
      }
    });
  }

  private cancelServerNameEdit(): void {
    this.editingServerId = null;
    this.editingServerName = '';
    this.cdr.markForCheck();
  }

  isServerRunning(server: ServerInstance): boolean {
    return isOnlineStatus(server.state);
  }

  isServerBusy(server: ServerInstance): boolean {
    return isBusyStatus(server.state);
  }

  getServerStatusClass(server: ServerInstance): string {
    return serverStatusClass(server.state);
  }

  /** Tooltip on the status dot, e.g. "Online". */
  getServerStatusLabel(server: ServerInstance): string {
    return serverStatusLabel(server.state);
  }

  /** Deleting is only offered for a server that is fully stopped. */
  isServerStopped(server: ServerInstance): boolean {
    return serverStatusKey(server.state) === 'stopped';
  }

  trackByServerId(_index: number, server: ServerInstance): string {
    return server.id;
  }

  trackByTabId(_index: number, tab: ServerTabDef): string {
    return tab.id;
  }

  onAddServerClick(): void {
    this.showAddModal = true;
    this.cdr.markForCheck();
  }

  onAddModalClosed(): void {
    this.showAddModal = false;
    this.cdr.markForCheck();
  }

  onServerCreated(server: ServerInstance): void {
    this.selectedServerId = server.id;
    this.selectServer.emit(server);
    this.closeMobileMenu.emit();
  }

  onDeleteServer(server: ServerInstance, event: Event): void {
    event.stopPropagation();
    if (!this.serverLifecycle.checkDeletable(server)) return;
    this.serverToDelete = server;
    this.showConfirmDeleteModal = true;
    this.cdr.markForCheck();
  }

  async onConfirmDelete(): Promise<void> {
    const server = this.serverToDelete;
    this.onCancelDelete();
    if (!server || !await this.serverLifecycle.deleteServer(server)) return;
    if (this.selectedServerId === server.id) this.selectedServerId = null;
    this.cdr.markForCheck();
  }

  onCancelDelete(): void {
    this.serverToDelete = null;
    this.showConfirmDeleteModal = false;
    this.cdr.markForCheck();
  }

  startAllServers(): void {
    this.showConfirmStartAllModal = true;
    this.cdr.markForCheck();
  }

  onConfirmStartAll(): void {
    this.showConfirmStartAllModal = false;
    this.serverLifecycle.startAllServers();
  }

  get canStopAll(): boolean {
    return this.serverLifecycle.runningServers().length > 0;
  }

  stopAllServers(): void {
    this.showConfirmStopAllModal = true;
    this.cdr.markForCheck();
  }

  onConfirmStopAll(): void {
    this.showConfirmStopAllModal = false;
    this.serverLifecycle.stopAllServers();
  }
}
