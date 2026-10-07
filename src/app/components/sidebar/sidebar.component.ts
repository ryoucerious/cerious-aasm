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
import { PoolDirectoryService } from '../../core/services/pool-directory.service';
import { MeshNodesService } from '../../core/services/mesh-nodes.service';
import { ServerListPreferencesService } from '../../core/services/server-list-preferences.service';
import { ServerNavService, ServerTabDef, ServerTabId } from '../../core/services/server-nav.service';
import { ModalComponent } from '../modal/modal.component';
import { AddServerModalComponent } from '../add-server-modal/add-server-modal.component';
import { NotificationService } from '../../core/services/notification.service';
import { SettingsDrawerService } from '../../core/services/settings-drawer.service';
import { AppUpdateService } from '../../core/services/app-update.service';
import { IpcService } from '../../core/services/ipc.service';
import { AuthService } from '../../core/services/auth.service';
import { PERMISSIONS } from '../../core/models/auth.model';
import { environment } from '../../../environments/environment';

/**
 * One row of the server list: a group (an operator, or a machine of a mesh) or a server under it.
 * The tree is flattened into rows, each with its depth, so the list stays one list to drag.
 */
export interface ServerListRow {
  kind: 'group' | 'server';
  /** A group's key, kept to remember it folded; a server's id. */
  key: string;
  depth: number;
  label?: string;
  /** Beside a group's name: which machine is this one. */
  note?: string;
  /** How many servers a group holds, as searched. */
  count?: number;
  open?: boolean;
  server?: ServerInstance;
}

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
  /**
   * The list as shown: searched, and grouped only where servers really are apart. Under the
   * machines of a mesh whose servers are on more than one; under operators as well when that is
   * switched on in Settings → Servers and some server has one.
   */
  serverRows: ServerListRow[] = [];
  searchText = '';
  /** The list is grouped by machine: a mesh whose servers run on more than one machine. */
  groupedByMachine = false;
  groupedByOperator = false;
  private groupByOperator = false;
  /** Groups folded away, kept in this browser. */
  private readonly closedGroups = readClosedGroups();
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
    private auth: AuthService,
    private poolDirectory: PoolDirectoryService,
    private meshNodes: MeshNodesService,
    private listPreferences: ServerListPreferencesService,
    private cdr: ChangeDetectorRef
  ) {}

  // The backend enforces these; the list only hides controls that would be refused.
  get canCreateServer(): boolean {
    return this.auth.can(PERMISSIONS.SERVERS_CREATE);
  }

  get canRenameServer(): boolean {
    return this.auth.can(PERMISSIONS.SERVERS_CONFIGURE);
  }

  get canDeleteServer(): boolean {
    return this.auth.can(PERMISSIONS.SERVERS_DELETE);
  }

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

    this.subs.push(this.poolDirectory.changed$.subscribe(() => { this.regroup(); this.cdr.markForCheck(); }));
    this.subs.push(this.meshNodes.changed$.subscribe(() => { this.regroup(); this.cdr.markForCheck(); }));
    this.subs.push(this.listPreferences.groupByOperator$.subscribe(on => {
      this.groupByOperator = on;
      this.regroup();
      this.cdr.markForCheck();
    }));
    this.subs.push(this.auth.identity$.subscribe(() => this.cdr.markForCheck()));

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
      this.regroup();
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

  onSearch(text: string): void {
    this.searchText = text;
    this.regroup();
  }

  /** Folds a group away, or opens it again. Searching opens every group it finds servers in. */
  toggleGroup(key: string): void {
    if (this.closedGroups.has(key)) this.closedGroups.delete(key);
    else this.closedGroups.add(key);
    saveClosedGroups(this.closedGroups);
    this.regroup();
    this.cdr.markForCheck();
  }

  /** Dragging reorders the saved order, so only the whole list, ungrouped, can be dragged. */
  get reorderable(): boolean {
    return !this.searchText.trim() && !this.groupedByMachine && !this.groupedByOperator;
  }

  trackByRow(_index: number, row: ServerListRow): string {
    return `${row.kind}:${row.key}`;
  }

  private regroup(): void {
    const query = this.searchText.trim().toLowerCase();
    const visible = this.servers.filter(server => !query
      || [server.name, server.mapName, this.meshNodes.nameOf(server.nodeId), this.listLabel(server)]
        .some(value => String(value || '').toLowerCase().includes(query)));
    // Decided on every server, not the ones a search shows, so the tree keeps its shape as you type.
    this.groupedByMachine = this.meshNodes.machines().length > 0 && new Set(this.servers.map(server => this.machineKeyOf(server))).size > 1;
    this.groupedByOperator = this.groupByOperator && this.servers.some(server => !!server.operatorUserId);

    const rows: ServerListRow[] = [];
    const group = (key: string, label: string, note: string, depth: number, servers: ServerInstance[], inside: (depth: number) => void) => {
      const open = !!query || !this.closedGroups.has(key);
      rows.push({ kind: 'group', key, label, note, depth, count: servers.length, open });
      if (open) inside(depth + 1);
    };
    const serversAt = (servers: ServerInstance[], depth: number) => {
      for (const server of servers) rows.push({ kind: 'server', key: server.id, depth, server });
    };
    const machinesAt = (servers: ServerInstance[], depth: number, parent: string) => {
      if (!this.groupedByMachine) {
        serversAt(servers, depth);
        return;
      }
      for (const machine of this.machineGroups(servers)) {
        group(`${parent}machine:${machine.key}`, machine.label, machine.here ? 'this machine' : '', depth, machine.servers,
          inner => serversAt(machine.servers, inner));
      }
    };

    if (this.groupedByOperator) {
      for (const pool of this.operatorGroups(visible)) {
        const key = `operator:${pool.key}`;
        group(key, pool.label, '', 0, pool.servers, inner => machinesAt(pool.servers, inner, `${key}/`));
      }
    } else {
      machinesAt(visible, 0, '');
    }
    this.serverRows = rows;
  }

  /** The machine a server runs on: its node, or this machine for one the mesh has not placed. */
  private machineKeyOf(server: ServerInstance): string {
    if (server.nodeId) return server.nodeId;
    return this.meshNodes.machines().find(machine => this.meshNodes.isHere(machine.nodeId))?.nodeId ?? 'here';
  }

  /** Each machine's servers in the saved order, this machine first, then by name. */
  private machineGroups(servers: ServerInstance[]): Array<{ key: string; label: string; here: boolean; servers: ServerInstance[] }> {
    const groups = new Map<string, ServerInstance[]>();
    for (const server of servers) {
      const key = this.machineKeyOf(server);
      groups.set(key, [...(groups.get(key) ?? []), server]);
    }
    return [...groups.entries()]
      .map(([key, members]) => ({
        key,
        label: this.meshNodes.nameOf(key) || (key === 'here' ? 'This machine' : 'Unknown machine'),
        here: key === 'here' || this.meshNodes.isHere(key),
        servers: members
      }))
      .sort((a, b) => Number(b.here) - Number(a.here) || a.label.localeCompare(b.label));
  }

  /** Each operator's servers, by the operator's name, the admin pool last. */
  private operatorGroups(servers: ServerInstance[]): Array<{ key: string; label: string; servers: ServerInstance[] }> {
    const groups = new Map<string, { label: string; servers: ServerInstance[] }>();
    for (const server of servers) {
      const key = server.operatorUserId || 'admin';
      const label = server.operatorUserId ? this.poolDirectory.operatorLabel(server) : ADMIN_POOL;
      const existing = groups.get(key);
      if (existing) existing.servers.push(server);
      else groups.set(key, { label, servers: [server] });
    }
    return [...groups.entries()]
      .map(([key, pool]) => ({ key, ...pool }))
      .sort((a, b) => (a.key === 'admin' ? 1 : b.key === 'admin' ? -1 : a.label.localeCompare(b.label)));
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
    // A rename of a server whose machine cannot be reached would not get there.
    if (!this.canRenameServer || this.isServerBusy(server) || serverStatusKey(server.state) === 'unreachable') return;
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

  /** An admin's row names both the operator and the assignee. */
  get groupsByOperator(): boolean {
    return this.auth.identity.isAdmin;
  }

  /**
   * Admin sees the operator and the assignee. Anyone else sees the assignee.
   * "Admin" and "Not assigned" are not names, and the join address stays on the card.
   */
  /** The machine a server runs on in a mesh, then who it is assigned to; not what a group above already says. */
  subtitle(server: ServerInstance): string {
    return [this.groupedByMachine ? '' : this.meshNodes.nameOf(server.nodeId), this.listLabel(server)].filter(Boolean).join(' · ');
  }

  listLabel(server: ServerInstance): string {
    const assignee = this.poolDirectory.assigneeLabel(server);
    const hasAssignee = !!server.managerUserId && assignee !== 'Not assigned';
    const operator = this.poolDirectory.operatorLabel(server);
    const hasOperator = !!server.operatorUserId && operator !== 'Operator';
    const namesOperator = this.groupsByOperator && hasOperator && !this.groupedByOperator;
    if (namesOperator && hasAssignee) return `${operator} · ${assignee}`;
    if (namesOperator) return operator;
    if (hasAssignee) return assignee;
    return '';
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

const ADMIN_POOL = 'Admin pool';
const CLOSED_GROUPS_KEY = 'aasm.sidebar.closedGroups';

/** Per viewer: kept in this browser only. */
function readClosedGroups(): Set<string> {
  try {
    const saved = JSON.parse(localStorage.getItem(CLOSED_GROUPS_KEY) || '[]');
    return new Set(Array.isArray(saved) ? saved.filter((key): key is string => typeof key === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveClosedGroups(keys: Set<string>): void {
  try {
    localStorage.setItem(CLOSED_GROUPS_KEY, JSON.stringify([...keys]));
  } catch {
    /* folded until the page closes */
  }
}
