import { Component, OnInit, OnDestroy, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { NgIf, NgFor, NgClass, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { EMPTY, Observable, Subscription, catchError, exhaustMap, interval, startWith, tap } from 'rxjs';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';

import { ServerInstance } from '../../core/models/server-instance.model';
import { LiveServersService, ServerSummary } from '../../core/services/live-servers.service';
import { ServerInstanceService } from '../../core/services/server-instance.service';
import { ServerLifecycleService } from '../../core/services/server-lifecycle.service';
import { MessagingService } from '../../core/services/messaging/messaging.service';
import { ActivityService, ActivityItem } from '../../core/services/activity.service';
import { BackupService } from '../../core/services/backup.service';
import { NotificationService } from '../../core/services/notification.service';
import { ServerNavService } from '../../core/services/server-nav.service';
import { SettingsDrawerService } from '../../core/services/settings-drawer.service';
import { AuthService } from '../../core/services/auth.service';
import { PoolDirectoryService } from '../../core/services/pool-directory.service';
import { MeshNodesService } from '../../core/services/mesh-nodes.service';
import { MoveServerDialogComponent } from '../../components/move-server-dialog/move-server-dialog.component';
import { PERMISSIONS } from '../../core/models/auth.model';
import { ServerCardComponent } from '../../components/server-card/server-card.component';
import { AddServerModalComponent } from '../../components/add-server-modal/add-server-modal.component';
import { ModalComponent } from '../../components/modal/modal.component';
import { DropdownComponent, DropdownOption } from '../../components/dropdown/dropdown.component';
import { AnimateReflowDirective } from '../../core/directives/animate-reflow.directive';
import { ACTIVITY_ICONS } from '../../core/utils/activity-icons';
import { getMapVisual } from '../../core/utils/map-visuals';
import { bucketSamples, seriesStats, toPoints, linePath, areaPath, PlayerHistorySample, ChartPoint } from '../../core/utils/chart.utils';
import { formatRelativeTime, formatBytes, formatPercent, toPercent, formatUptime, formatHourLabel, isLocalPageHost } from '../../core/utils/format.utils';

export interface HostResources {
  cpuPercent: number;
  memory: { used: number; total: number };
  disk: { used: number; total: number } | null;
}

interface HostResourcesReply extends Partial<HostResources> {
  error?: string;
}

/** A mesh member as get-mesh-status and mesh-status describe it. */
interface MeshNodeView {
  nodeId: string;
  name: string;
  status?: string;
  /** The address other machines reach it at. */
  host?: string;
  /** From its last heartbeat; null once that is stale. */
  resources?: HostResources | null;
  connected?: boolean;
  version?: string;
  /** When this machine last heard from it; null when never. */
  lastContactAt?: number | null;
}

interface MeshStatusView {
  enabled?: boolean;
  degraded?: boolean;
  warning?: string | null;
  /** This machine. */
  nodeId?: string | null;
  nodes?: MeshNodeView[];
}

/** One machine in System Resources, in a mesh. */
export interface NodeResourceRow {
  nodeId: string;
  name: string;
  local: boolean;
  reporting: boolean;
  cpuPercent: number;
  cpuLabel: string;
  memoryPercent: number;
  memoryLabel: string;
  diskPercent: number;
  diskLabel: string;
  connected: boolean;
  /** Under the name: how many of its servers run, its version, and when last heard from if it cannot be reached. */
  detail: string;
}

export type ServerFilter = 'all' | 'online' | 'offline';
export type ServerSort = 'custom' | 'name-asc' | 'name-desc' | 'status' | 'players';

const HERO_IMAGE = 'assets/background/the-island.png';
const DAY_MS = 24 * 60 * 60 * 1000;
const BUCKET_MS = 30 * 60 * 1000;
const CHART_WIDTH = 640;
const CHART_HEIGHT = 150;
const CHART_PAD = 4;
const HOST_RESOURCES_POLL_MS = 5_000;
const PLAYER_HISTORY_POLL_MS = 60_000;
const CLOCK_TICK_MS = 30_000;

/**
 * Landing page: fleet summary, one card per server, quick actions, host resources, the
 * activity feed and two small charts (players over the last day, uptime per server).
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, DecimalPipe, FormsModule, DragDropModule, ServerCardComponent, AddServerModalComponent, ModalComponent, DropdownComponent, AnimateReflowDirective, MoveServerDialogComponent],
  templateUrl: './dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardComponent implements OnInit, OnDestroy {
  servers: ServerInstance[] = [];
  visibleServers: ServerInstance[] = [];
  summary: ServerSummary = { total: 0, online: 0, offline: 0, players: 0, maxPlayers: 0 };
  userName = 'Admin';
  now = Date.now();

  view: 'grid' | 'list' = 'grid';
  filter: ServerFilter = 'all';
  sort: ServerSort = 'custom';
  /** Matched against the name, session name, map, machine and operator. Not remembered. */
  searchText = '';
  /** A machine's node id, or 'all'. Offered only in a mesh. */
  machine = 'all';
  /** "All machines" and each machine, in a mesh; empty outside one. */
  machineOptions: DropdownOption<string>[] = [];
  readonly filterOptions: DropdownOption<ServerFilter>[] = [
    { value: 'all', label: 'All Servers' },
    { value: 'online', label: 'Online' },
    { value: 'offline', label: 'Offline' }
  ];
  readonly sortOptions: DropdownOption<ServerSort>[] = [
    { value: 'custom', label: 'Custom order' },
    { value: 'name-asc', label: 'Name (A–Z)' },
    { value: 'name-desc', label: 'Name (Z–A)' },
    { value: 'status', label: 'Status' },
    { value: 'players', label: 'Players' }
  ];
  /** Servers as dropdown options, for the Create Backup dialog. */
  serverOptions: DropdownOption<string>[] = [];

  hostResources: HostResources | null = null;
  hostResourcesError = false;

  historySamples: PlayerHistorySample[] = [];
  playerChartLine = '';
  playerChartArea = '';
  playerChartLabels: { x: number; text: string }[] = [];
  playerChartTicks: { y: number; text: string; baseline: boolean }[] = [];
  playerPeak = 0;
  playerAverage = 0;
  serverHistories: Record<string, number[]> = {};

  activity: ActivityItem[] = [];
  showAllActivity = false;
  readonly activityIcons = ACTIVITY_ICONS;

  showAddModal = false;
  showConfirmStartAll = false;
  showConfirmStopAll = false;
  showBackupModal = false;
  backupServerId = '';
  backupName = '';
  creatingBackup = false;
  serverToDelete: ServerInstance | null = null;
  /** The server the move dialog is open for. */
  movingServer: ServerInstance | null = null;
  private activeServerId: string | null = null;

  readonly chartWidth = CHART_WIDTH;
  readonly chartHeight = CHART_HEIGHT;
  /**
   * Artwork behind the welcome banner. Bound here rather than named in the stylesheet
   * because a url() in SCSS compiles to an absolute /assets path, which does not resolve
   * when the desktop app loads the bundle over file://.
   */
  readonly heroBackground = `url("${HERO_IMAGE}")`;
  meshBanner = '';
  private nodeNames = new Map<string, string>();
  /** Members of this machine's mesh, removed ones left out; empty when standalone. */
  private meshNodes: MeshNodeView[] = [];
  private localNodeId: string | null = null;

  private subs: Subscription[] = [];

  constructor(
    private liveServers: LiveServersService,
    private serverInstanceService: ServerInstanceService,
    private serverLifecycle: ServerLifecycleService,
    private messaging: MessagingService,
    private activityService: ActivityService,
    private backupService: BackupService,
    private notificationService: NotificationService,
    private serverNav: ServerNavService,
    private settingsDrawer: SettingsDrawerService,
    private auth: AuthService,
    public poolDirectory: PoolDirectoryService,
    private meshMachines: MeshNodesService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  // The backend enforces these; the page only hides controls that would be refused.
  get canCreateServer(): boolean {
    return this.auth.can(PERMISSIONS.SERVERS_CREATE);
  }

  get canDeleteServer(): boolean {
    return this.auth.can(PERMISSIONS.SERVERS_DELETE);
  }

  get canConfigure(): boolean {
    return this.auth.can(PERMISSIONS.SERVERS_CONFIGURE);
  }

  get canBackups(): boolean {
    return this.auth.can(PERMISSIONS.BACKUPS_VIEW);
  }

  private applyMesh(status: MeshStatusView | null | undefined): void {
    if (!status?.enabled) {
      this.meshBanner = '';
      this.nodeNames.clear();
      this.meshNodes = [];
      this.localNodeId = null;
      this.machineOptions = [];
    } else {
      this.nodeNames = new Map((status.nodes || []).map(node => [node.nodeId, node.name]));
      this.meshNodes = (status.nodes || []).filter(node => node.status !== 'removed');
      this.localNodeId = status.nodeId || null;
      // A degraded mesh shows in the top bar, on every page.
      this.meshBanner = status.warning || '';
      this.machineOptions = [{ value: 'all', label: 'All machines' }, ...this.meshNodes.map(node => ({ value: node.nodeId, label: node.name }))];
      // A machine since removed would leave nothing to show and no way to pick it again.
      if (this.machine !== 'all' && !this.meshNodes.some(node => node.nodeId === this.machine)) this.machine = 'all';
    }
    this.refreshVisible();
    this.cdr.markForCheck();
  }

  ngOnInit(): void {
    this.readViewPreferences();
    this.subs.push(this.messaging.sendMessage<MeshStatusView>('get-mesh-status', {}).subscribe(status => this.applyMesh(status)));
    // Sent again after each heartbeat, which carries the sender's resources.
    this.subs.push(this.messaging.receiveMessage<MeshStatusView>('mesh-status').subscribe(status => this.applyMesh(status)));

    // Which machines can take a server follows who is reachable and draining.
    this.subs.push(this.meshMachines.changed$.subscribe(() => this.cdr.markForCheck()));
    this.subs.push(this.liveServers.servers$.subscribe(servers => {
      this.servers = servers;
      this.serverOptions = servers.map(server => ({ value: server.id, label: server.name }));
      this.summary = LiveServersService.summarise(servers);
      this.refreshVisible();
      this.rebuildHistories();
      this.cdr.markForCheck();
    }));

    this.subs.push(this.activityService.items$.subscribe(items => {
      this.activity = items;
      this.cdr.markForCheck();
    }));

    this.subs.push(this.serverInstanceService.getActiveServer().subscribe(server => {
      this.activeServerId = server?.id || null;
    }));

    this.subs.push(this.auth.displayName$.subscribe(name => {
      this.userName = name;
      this.cdr.markForCheck();
    }));

    // The cards' ownership labels come from the directory, which reloads as accounts change.
    this.subs.push(this.poolDirectory.changed$.subscribe(() => this.cdr.markForCheck()));

    // exhaustMap: a slow backend is not sent a new request while it still owes the last one.
    this.subs.push(interval(HOST_RESOURCES_POLL_MS).pipe(startWith(0), exhaustMap(() => this.fetchHostResources())).subscribe());
    this.subs.push(interval(PLAYER_HISTORY_POLL_MS).pipe(startWith(0), exhaustMap(() => this.fetchPlayerHistory())).subscribe());
    this.subs.push(interval(CLOCK_TICK_MS).subscribe(() => {
      this.now = Date.now();
      this.cdr.markForCheck();
    }));
  }

  ngOnDestroy(): void {
    this.subs.forEach(sub => sub.unsubscribe());
  }

  get statusLine(): string {
    if (this.summary.total === 0) return 'No servers yet. Add one to get started.';
    if (this.summary.online === this.summary.total) return `All systems operational. ${this.summary.online} of ${this.summary.total} servers are online.`;
    if (this.summary.online === 0) return `All servers are offline. ${this.summary.total} server${this.summary.total === 1 ? '' : 's'} configured.`;
    return `${this.summary.online} of ${this.summary.total} servers are online.`;
  }

  setView(view: 'grid' | 'list'): void {
    this.view = view;
    this.saveViewPreferences();
  }

  onFilterChange(): void {
    this.refreshVisible();
    this.saveViewPreferences();
    this.cdr.markForCheck();
  }

  onSortChange(): void {
    this.refreshVisible();
    this.saveViewPreferences();
    this.cdr.markForCheck();
  }

  onSearchChange(): void {
    this.refreshVisible();
    this.cdr.markForCheck();
  }

  /** From "No servers match": back to every server. */
  clearSearchAndFilters(): void {
    this.searchText = '';
    this.filter = 'all';
    this.machine = 'all';
    this.refreshVisible();
    this.saveViewPreferences();
    this.cdr.markForCheck();
  }

  /** Dragging reorders the saved order, so only the whole list, unsorted, can be dragged. */
  get canReorder(): boolean {
    return this.sort === 'custom' && this.filter === 'all' && !this.filteringByMachine && !this.searchText.trim();
  }

  private get filteringByMachine(): boolean {
    return this.machine !== 'all' && this.meshNodes.length > 0;
  }

  /** A server without a machine of its own runs on this one. */
  private machineOf(server: ServerInstance): string | null {
    return server.nodeId || this.localNodeId;
  }

  private matchesSearch(server: ServerInstance, query: string): boolean {
    const fields = [
      server.name,
      server.sessionName,
      server.mapName,
      getMapVisual(server.mapName).label,
      this.nodeLabel(server),
      // "Admin" stands for no operator, which would match every server not in a pool.
      server.operatorUserId ? this.poolDirectory.operatorLabel(server) : ''
    ];
    return fields.some(value => String(value || '').toLowerCase().includes(query));
  }

  nodeLabel(server: ServerInstance): string {
    if (!server.nodeId) return '';
    return this.nodeNames.get(server.nodeId) || server.nodeId;
  }

  refreshVisible(): void {
    let list = this.servers.slice();
    if (this.filter === 'online') list = list.filter(server => LiveServersService.isOnline(server));
    if (this.filter === 'offline') list = list.filter(server => !LiveServersService.isOnline(server));
    if (this.filteringByMachine) list = list.filter(server => this.machineOf(server) === this.machine);
    const query = this.searchText.trim().toLowerCase();
    if (query) list = list.filter(server => this.matchesSearch(server, query));

    const byName = (a: ServerInstance, b: ServerInstance) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
    switch (this.sort) {
      case 'name-asc': list.sort(byName); break;
      case 'name-desc': list.sort((a, b) => byName(b, a)); break;
      case 'status': list.sort((a, b) => Number(LiveServersService.isOnline(b)) - Number(LiveServersService.isOnline(a)) || byName(a, b)); break;
      case 'players': list.sort((a, b) => ((b.players || 0) - (a.players || 0)) || byName(a, b)); break;
      default: break; // custom = the sidebar order the service already applies
    }
    this.visibleServers = list;
  }

  onCardDrop(event: CdkDragDrop<ServerInstance[]>): void {
    if (!this.canReorder || event.previousIndex === event.currentIndex) return;
    const reordered = this.visibleServers.slice();
    moveItemInArray(reordered, event.previousIndex, event.currentIndex);
    this.liveServers.reorder(reordered.map(server => server.id));
  }

  trackByServerId(_index: number, server: ServerInstance): string {
    return server.id;
  }

  historyFor(server: ServerInstance): number[] {
    return this.serverHistories[server.id] || [];
  }

  get hostMemoryTotal(): number | null {
    return this.hostResources?.memory?.total || null;
  }

  /** The memory of the machine a server runs on: this one, or the member hosting it. */
  hostMemoryTotalFor(server: ServerInstance): number | null {
    const node = this.hostNodeOf(server);
    if (!node || node.nodeId === this.localNodeId) return this.hostMemoryTotal;
    return node.resources?.memory?.total || null;
  }

  /**
   * The address players use for a server in a mesh: that of the member hosting it. A server on
   * this machine keeps the name the page was opened on, unless that is localhost or the desktop
   * app, which other machines cannot use. Null outside a mesh.
   */
  joinHost(server: ServerInstance): string | null {
    const node = this.hostNodeOf(server);
    if (!node?.host) return null;
    if (node.nodeId === this.localNodeId && !isLocalPageHost(this.pageHostname())) return null;
    return node.host;
  }

  /** Every member's CPU, memory and disk, this machine's as it is polled here. Empty unless the mesh has another member. */
  /** The machines of the mesh, for the Machines card; empty outside a mesh. */
  get resourceNodes(): NodeResourceRow[] {
    if (!this.meshNodes.length) return [];
    return this.meshNodes.map(node => {
      const local = node.nodeId === this.localNodeId;
      const connected = local || !!node.connected;
      return {
        ...resourceRow(node.nodeId, node.name, local, local ? this.hostResources : node.resources || null),
        connected,
        detail: this.machineDetail(node, connected)
      };
    });
  }

  private machineDetail(node: MeshNodeView, connected: boolean): string {
    const servers = this.servers.filter(server => this.machineOf(server) === node.nodeId);
    const running = servers.filter(server => LiveServersService.isOnline(server)).length;
    const parts = [servers.length ? `${running} of ${servers.length} server${servers.length === 1 ? '' : 's'} running` : 'No servers'];
    // A machine's record holds '0' until its first heartbeat is written.
    if (node.version && node.version !== '0') parts.push(`Version ${node.version}`);
    if (!connected && node.lastContactAt !== undefined) {
      parts.push(node.lastContactAt === null ? 'Never heard from' : `Last contact ${formatRelativeTime(node.lastContactAt, this.now)}`);
    }
    return parts.join(' · ');
  }

  openMeshSettings(): void {
    this.settingsDrawer.open('mesh');
  }

  trackNode(_index: number, node: NodeResourceRow): string {
    return node.nodeId;
  }

  private hostNodeOf(server: ServerInstance): MeshNodeView | null {
    if (!this.meshNodes.length) return null;
    const nodeId = server.nodeId || this.localNodeId;
    return this.meshNodes.find(node => node.nodeId === nodeId) || null;
  }

  /** The host in the address bar; empty in the desktop app. Separate so tests can set it. */
  protected pageHostname(): string {
    return typeof window === 'undefined' ? '' : window.location.hostname;
  }

  startServer(server: ServerInstance): void {
    this.serverLifecycle.startServer(server, this.cdr);
  }

  stopServer(server: ServerInstance): void {
    this.serverLifecycle.stopServer(server);
  }

  forceStopServer(server: ServerInstance): void {
    this.serverLifecycle.forceStopServer(server);
  }

  openConsole(server: ServerInstance): void {
    this.openServerPage(server, 'console');
  }

  configureServer(server: ServerInstance): void {
    this.openServerPage(server, 'general');
  }

  openBackups(server: ServerInstance): void {
    this.openServerPage(server, 'backup');
  }

  private openServerPage(server: ServerInstance, tab: 'console' | 'general' | 'backup'): void {
    this.serverInstanceService.setActiveServer(server);
    this.serverNav.rememberTab(tab);
    this.router.navigate(['/server', tab]);
  }

  /** The user may move servers, and another machine in the mesh can take this one. The card offers it only while the server is off. */
  canMoveServer(server: ServerInstance): boolean {
    return this.auth.can(PERMISSIONS.SERVERS_MOVE) && this.meshMachines.destinationsFor(server).length > 0;
  }

  openMove(server: ServerInstance): void {
    this.movingServer = server;
    this.cdr.markForCheck();
  }

  closeMove(): void {
    this.movingServer = null;
    this.cdr.markForCheck();
  }

  requestDelete(server: ServerInstance): void {
    if (!this.serverLifecycle.checkDeletable(server)) return;
    this.serverToDelete = server;
    this.cdr.markForCheck();
  }

  cancelDelete(): void {
    this.serverToDelete = null;
    this.cdr.markForCheck();
  }

  async confirmDelete(): Promise<void> {
    const server = this.serverToDelete;
    this.cancelDelete();
    if (server) await this.serverLifecycle.deleteServer(server);
  }

  openAddServer(): void {
    this.showAddModal = true;
    this.cdr.markForCheck();
  }

  onAddModalClosed(): void {
    this.showAddModal = false;
    this.cdr.markForCheck();
  }

  confirmStartAll(): void {
    this.showConfirmStartAll = false;
    this.serverLifecycle.startAllServers();
  }

  get canStopAll(): boolean {
    return this.serverLifecycle.runningServers().length > 0;
  }

  confirmStopAll(): void {
    this.showConfirmStopAll = false;
    this.serverLifecycle.stopAllServers();
  }

  openBackupModal(): void {
    if (!this.servers.length) {
      this.notificationService.warning('Add a server before creating a backup.', 'Backup');
      return;
    }
    const preferred = this.servers.find(server => server.id === this.activeServerId) || this.servers[0];
    this.backupServerId = preferred.id;
    this.backupName = this.defaultBackupName();
    this.showBackupModal = true;
    this.cdr.markForCheck();
  }

  closeBackupModal(): void {
    if (this.creatingBackup) return;
    this.showBackupModal = false;
    this.cdr.markForCheck();
  }

  createBackup(): void {
    const server = this.servers.find(item => item.id === this.backupServerId);
    if (!server || this.creatingBackup) return;
    this.creatingBackup = true;
    this.cdr.markForCheck();
    this.backupService.createBackup({ instanceId: server.id, type: 'manual', name: this.backupName || this.defaultBackupName() })
      .subscribe({
        next: (response) => {
          this.creatingBackup = false;
          if (response?.success) {
            this.notificationService.success('Backup created successfully', 'Backup');
            this.showBackupModal = false;
          } else {
            this.notificationService.error(response?.error || 'Failed to create backup', 'Backup Error');
          }
          this.cdr.markForCheck();
        },
        error: () => {
          this.creatingBackup = false;
          this.notificationService.error('Failed to create backup', 'Backup Error');
          this.cdr.markForCheck();
        }
      });
  }

  goToSettings(): void {
    this.settingsDrawer.open();
  }

  private fetchHostResources(): Observable<unknown> {
    return this.messaging.sendMessage<HostResourcesReply>('get-host-resources', {}).pipe(
      tap(res => {
        if (res && !res.error && typeof res.cpuPercent === 'number' && res.memory) {
          this.hostResources = { cpuPercent: res.cpuPercent, memory: res.memory, disk: res.disk || null };
          this.hostResourcesError = false;
        } else if (res?.error) {
          this.hostResourcesError = true;
        }
        this.cdr.markForCheck();
      }),
      catchError(() => {
        this.hostResourcesError = true;
        this.cdr.markForCheck();
        return EMPTY;
      })
    );
  }

  get cpuPercent(): number {
    return cpuPercentOf(this.hostResources);
  }

  get memoryPercent(): number {
    return toPercent(this.hostResources?.memory?.used, this.hostResources?.memory?.total);
  }

  get diskPercent(): number {
    return toPercent(this.hostResources?.disk?.used, this.hostResources?.disk?.total);
  }

  get cpuLabel(): string {
    return cpuLabelOf(this.hostResources);
  }

  get memoryLabel(): string {
    return memoryLabelOf(this.hostResources);
  }

  get diskLabel(): string {
    return diskLabelOf(this.hostResources);
  }

  private fetchPlayerHistory(): Observable<unknown> {
    return this.messaging.sendMessage<{ samples?: PlayerHistorySample[] }>('get-player-history', {}).pipe(
      tap(res => {
        if (Array.isArray(res?.samples)) {
          this.historySamples = res.samples;
          this.rebuildHistories();
          this.cdr.markForCheck();
        }
      }),
      // The chart keeps what it has; the next poll tries again.
      catchError(() => EMPTY)
    );
  }

  /** True once any player count has been recorded; until then there is no chart to draw. */
  get hasPlayerHistory(): boolean {
    return this.historySamples.length > 0;
  }

  private rebuildHistories(): void {
    const now = Date.now();
    const total = bucketSamples(this.historySamples, DAY_MS, BUCKET_MS, now);
    const stats = seriesStats(total);
    this.playerPeak = stats.peak;
    this.playerAverage = stats.average;

    const values = total.map(point => point.value);
    const ceiling = Math.max(4, Math.ceil(stats.peak / 4) * 4);
    const points: ChartPoint[] = toPoints(values, CHART_WIDTH, CHART_HEIGHT, ceiling, CHART_PAD);
    this.playerChartLine = linePath(points);
    this.playerChartArea = areaPath(points, CHART_HEIGHT, CHART_PAD);

    // Six labels across the day: enough to read the shape, few enough not to collide on a
    // narrow card.
    const labelEvery = Math.max(1, Math.round(total.length / 6));
    this.playerChartLabels = total
      .map((point, index) => ({ index, point }))
      .filter(({ index }) => index % labelEvery === 0)
      .map(({ index, point }) => ({
        x: points[index]?.x ?? 0,
        text: formatHourLabel(point.t)
      }));
    this.playerChartTicks = [0, 0.5, 1].map(fraction => ({
      y: CHART_PAD + (CHART_HEIGHT - CHART_PAD * 2) * (1 - fraction),
      text: String(Math.round(ceiling * fraction)),
      // The line the chart stands on is drawn solid; the ones above it are guides.
      baseline: fraction === 0
    }));

    const histories: Record<string, number[]> = {};
    for (const server of this.servers) {
      histories[server.id] = bucketSamples(this.historySamples, DAY_MS, BUCKET_MS, now, server.id).map(point => point.value);
    }
    this.serverHistories = histories;
  }

  trackByUptimeBar(_index: number, bar: { server: ServerInstance }): string {
    return bar.server.id;
  }

  /** Server Uptime shows the longest-running few until asked for every server. */
  showAllUptime = false;
  readonly uptimeTop = UPTIME_TOP;

  /** The servers Server Uptime is about: those on the machine chosen for the server list. */
  private get uptimeServers(): ServerInstance[] {
    return this.filteringByMachine ? this.servers.filter(server => this.machineOf(server) === this.machine) : this.servers;
  }

  get uptimeTotal(): number {
    return this.uptimeServers.length;
  }

  toggleUptime(): void {
    this.showAllUptime = !this.showAllUptime;
    this.cdr.markForCheck();
  }

  /** Longest-running first; with many servers a list in the sidebar's order said little. */
  get uptimeBars(): { server: ServerInstance; percent: number; label: string }[] {
    const uptimes = this.uptimeServers.map(server => ({
      server,
      ms: LiveServersService.isOnline(server) && server.startedAt ? Math.max(0, this.now - server.startedAt) : 0
    })).sort((a, b) => b.ms - a.ms);
    const max = Math.max(1, ...uptimes.map(item => item.ms));
    return (this.showAllUptime ? uptimes : uptimes.slice(0, UPTIME_TOP)).map(item => ({
      server: item.server,
      percent: item.ms > 0 ? Math.max(4, (item.ms / max) * 100) : 0,
      label: item.ms > 0 ? formatUptime(this.now - item.ms, this.now) : '0m'
    }));
  }

  get recentActivity(): ActivityItem[] {
    return this.activity.slice(0, 6);
  }

  relativeTime(item: ActivityItem): string {
    return formatRelativeTime(item.timestamp, this.now);
  }

  trackActivity(_index: number, item: ActivityItem): string {
    return item.id;
  }

  openAllActivity(): void {
    this.showAllActivity = true;
    this.cdr.markForCheck();
  }

  closeAllActivity(): void {
    this.showAllActivity = false;
    this.cdr.markForCheck();
  }

  clearActivity(): void {
    this.activityService.clear();
  }

  private defaultBackupName(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `Backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  private readViewPreferences(): void {
    try {
      const raw = localStorage.getItem('cerious-aasm.dashboard');
      if (!raw) return;
      const prefs = JSON.parse(raw);
      if (prefs.view === 'grid' || prefs.view === 'list') this.view = prefs.view;
      if (['all', 'online', 'offline'].includes(prefs.filter)) this.filter = prefs.filter;
      if (['custom', 'name-asc', 'name-desc', 'status', 'players'].includes(prefs.sort)) this.sort = prefs.sort;
      if (typeof prefs.machine === 'string' && prefs.machine) this.machine = prefs.machine;
    } catch {
      // Corrupt or unavailable storage: keep the defaults.
    }
  }

  private saveViewPreferences(): void {
    try {
      localStorage.setItem('cerious-aasm.dashboard', JSON.stringify({ view: this.view, filter: this.filter, sort: this.sort, machine: this.machine }));
    } catch {
      // Unavailable storage: the choice lasts for this visit only.
    }
  }
}

/** How many servers Server Uptime shows before "Show all". */
const UPTIME_TOP = 10;

function cpuPercentOf(resources: HostResources | null | undefined): number {
  return resources ? Math.max(0, Math.min(100, resources.cpuPercent)) : 0;
}

function cpuLabelOf(resources: HostResources | null | undefined): string {
  return resources ? formatPercent(resources.cpuPercent) : '--';
}

function memoryLabelOf(resources: HostResources | null | undefined): string {
  const memory = resources?.memory;
  return memory ? `${formatBytes(memory.used)} / ${formatBytes(memory.total, 0)}` : '--';
}

function diskLabelOf(resources: HostResources | null | undefined): string {
  const disk = resources?.disk;
  return disk ? `${formatBytes(disk.used, 0)} / ${formatBytes(disk.total, 0)}` : 'Unavailable';
}

function resourceRow(nodeId: string, name: string, local: boolean, resources: HostResources | null): Omit<NodeResourceRow, 'connected' | 'detail'> {
  return {
    nodeId,
    name,
    local,
    reporting: !!resources,
    cpuPercent: cpuPercentOf(resources),
    cpuLabel: cpuLabelOf(resources),
    memoryPercent: toPercent(resources?.memory?.used, resources?.memory?.total),
    memoryLabel: memoryLabelOf(resources),
    diskPercent: toPercent(resources?.disk?.used, resources?.disk?.total),
    diskLabel: diskLabelOf(resources)
  };
}
