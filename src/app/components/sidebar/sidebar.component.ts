import { Component, EventEmitter, Output, ChangeDetectionStrategy, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { Subscription, take } from 'rxjs';
import { NgFor, NgIf, NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, NavigationEnd } from '@angular/router';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';

import { ServerInstance } from '../../core/models/server-instance.model';
import { ServerInstanceService } from '../../core/services/server-instance.service';
import { LiveServersService } from '../../core/services/live-servers.service';
import { serverStatusKey, serverStatusClass, serverStatusLabel, isOnlineStatus, isBusyStatus } from '../../core/utils/server-status';
import { ServerNavService, ServerTabDef, ServerTabId } from '../../core/services/server-nav.service';
import { ModalComponent } from '../modal/modal.component';
import { AddServerModalComponent } from '../add-server-modal/add-server-modal.component';
import { NotificationService } from '../../core/services/notification.service';
import { SettingsDrawerService } from '../../core/services/settings-drawer.service';
import { AppUpdateService } from '../../core/services/app-update.service';
import { environment } from '../../../environments/environment';

/**
 * Left-hand navigation: Dashboard, the server list, the selected server's pages, Settings.
 *
 * Server pages are routes (/server/<tab>) so the browser back button, reloads and the top
 * bar's search can all land on a specific page. The list keeps everything it always did:
 * drag to reorder, double-click to rename, delete stopped servers, start/stop all, add.
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

  overviewTabs: ServerTabDef[] = [];
  configTabs: ServerTabDef[] = [];
  featureTabs: ServerTabDef[] = [];
  expertMode = false;

  // Inline rename
  editingServerId: string | null = null;
  editingServerName = '';

  // Modals
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
    private serverNav: ServerNavService,
    private notificationService: NotificationService,
    private settingsDrawer: SettingsDrawerService,
    private appUpdate: AppUpdateService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.subs.push(this.appUpdate.status$.subscribe(status => {
      this.appUpdatePending = AppUpdateService.isPending(status);
      this.appUpdateTitle = status?.version
        ? `Version ${status.version} is ready to install`
        : 'An update is available';
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

  // -------------------- Navigation --------------------

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

  // -------------------- Server list --------------------

  onDrop(event: CdkDragDrop<ServerInstance[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    const reordered = this.servers.slice();
    moveItemInArray(reordered, event.previousIndex, event.currentIndex);
    const orderedIds = reordered.map(server => server.id);
    this.liveServers.applyOrder(orderedIds);
    this.serverInstanceService.reorderServers(orderedIds).pipe(take(1)).subscribe();
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
    const updatedServer = { ...server, name: trimmedName };
    this.serverInstanceService.save(updatedServer).pipe(take(1)).subscribe((result) => {
      if (result && result.success === false && result.error) {
        this.notificationService.warning(result.error);
      } else {
        const idx = this.servers.findIndex(s => s.id === server.id);
        if (idx !== -1) this.servers[idx].name = trimmedName;
      }
      this.cancelServerNameEdit();
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

  // -------------------- Add / delete --------------------

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
    if (LiveServersService.normalizeState(server.state) !== 'stopped') {
      this.notificationService.warning('Cannot Delete Server', 'Server must be stopped before it can be deleted.');
      return;
    }
    this.serverToDelete = server;
    this.showConfirmDeleteModal = true;
    this.cdr.markForCheck();
  }

  onConfirmDelete(): void {
    if (this.serverToDelete && this.servers.length > 1) {
      if (LiveServersService.normalizeState(this.serverToDelete.state) !== 'stopped') {
        this.notificationService.error('Cannot Delete Server', 'Server must be stopped before it can be deleted.');
        this.onCancelDelete();
        return;
      }
      this.serverInstanceService.delete(this.serverToDelete.id).pipe(take(1)).subscribe(() => {
        if (this.selectedServerId === this.serverToDelete?.id) {
          this.selectedServerId = null;
        }
        this.serverToDelete = null;
        this.showConfirmDeleteModal = false;
        this.cdr.markForCheck();
      });
    } else {
      this.onCancelDelete();
    }
  }

  onCancelDelete(): void {
    this.serverToDelete = null;
    this.showConfirmDeleteModal = false;
    this.cdr.markForCheck();
  }

  // -------------------- Start / stop all --------------------

  startAllServers(): void {
    this.showConfirmStartAllModal = true;
    this.cdr.markForCheck();
  }

  onConfirmStartAll(): void {
    this.showConfirmStartAllModal = false;
    this.serverInstanceService.messaging.sendMessage('start-all-instances', {}).subscribe({
      next: (res: any) => {
        if (res?.success) this.notificationService.success('All servers are starting.', 'Server Control');
        else this.notificationService.error(res?.error || 'Failed to start all servers.', 'Server Control');
        this.cdr.markForCheck();
      },
      error: () => this.notificationService.error('Failed to start all servers.', 'Server Control')
    });
  }

  stopAllServers(): void {
    this.showConfirmStopAllModal = true;
    this.cdr.markForCheck();
  }

  onConfirmStopAll(): void {
    this.showConfirmStopAllModal = false;
    this.serverInstanceService.messaging.sendMessage('stop-all-instances', {}).subscribe({
      next: (res: any) => {
        if (res?.success) this.notificationService.success('All servers are stopping.', 'Server Control');
        else this.notificationService.error(res?.error || 'Failed to stop all servers.', 'Server Control');
        this.cdr.markForCheck();
      },
      error: () => this.notificationService.error('Failed to stop all servers.', 'Server Control')
    });
  }
}
