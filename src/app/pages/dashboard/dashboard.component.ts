import { Component, OnInit, OnDestroy, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { NgIf, NgFor, NgClass, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription, interval, take } from 'rxjs';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';

import { ServerInstance } from '../../core/models/server-instance.model';
import { LiveServersService, ServerSummary } from '../../core/services/live-servers.service';
import { ServerInstanceService } from '../../core/services/server-instance.service';
import { ServerLifecycleService } from '../../core/services/server-lifecycle.service';
import { MessagingService } from '../../core/services/messaging/messaging.service';
import { ActivityService, ActivityItem } from '../../core/services/activity.service';
import { BackupService } from '../../core/services/backup.service';
import { NotificationService } from '../../core/services/notification.service';
import { GlobalConfigService } from '../../core/services/global-config.service';
import { ServerNavService } from '../../core/services/server-nav.service';
import { SettingsDrawerService } from '../../core/services/settings-drawer.service';
import { AuthService } from '../../core/services/auth.service';
import { ServerCardComponent } from '../../components/server-card/server-card.component';
import { AddServerModalComponent } from '../../components/add-server-modal/add-server-modal.component';
import { ModalComponent } from '../../components/modal/modal.component';
import { DropdownComponent, DropdownOption } from '../../components/dropdown/dropdown.component';
import { AnimateReflowDirective } from '../../core/directives/animate-reflow.directive';
import { ACTIVITY_ICONS } from '../../components/topbar/topbar.component';
import { bucketSamples, seriesStats, toPoints, linePath, areaPath, PlayerHistorySample, ChartPoint } from '../../core/utils/chart.utils';
import { formatRelativeTime, formatBytes, formatPercent, toPercent, formatUptime, formatHourLabel } from '../../core/utils/format.utils';

export interface HostResources {
  cpuPercent: number;
  memory: { used: number; total: number };
  disk: { used: number; total: number } | null;
}

export type ServerFilter = 'all' | 'online' | 'offline';
export type ServerSort = 'custom' | 'name-asc' | 'name-desc' | 'status' | 'players';

const HERO_IMAGE = 'assets/background/the-island.png';
const DAY_MS = 24 * 60 * 60 * 1000;
const BUCKET_MS = 30 * 60 * 1000;
const CHART_WIDTH = 640;
const CHART_HEIGHT = 150;
const CHART_PAD = 4;

/**
 * Landing page: fleet summary, one card per server, quick actions, host resources, the
 * activity feed and two small charts (players over the last day, uptime per server).
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, DecimalPipe, FormsModule, DragDropModule, ServerCardComponent, AddServerModalComponent, ModalComponent, DropdownComponent, AnimateReflowDirective],
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
  private activeServerId: string | null = null;

  readonly chartWidth = CHART_WIDTH;
  readonly chartHeight = CHART_HEIGHT;
  /**
   * Artwork behind the welcome banner. Bound here rather than named in the stylesheet
   * because a url() in SCSS compiles to an absolute /assets path, which does not resolve
   * when the desktop app loads the bundle over file://.
   */
  readonly heroBackground = `url("${HERO_IMAGE}")`;

  private subs: Subscription[] = [];

  constructor(
    private liveServers: LiveServersService,
    private serverInstanceService: ServerInstanceService,
    private serverLifecycle: ServerLifecycleService,
    private messaging: MessagingService,
    private activityService: ActivityService,
    private backupService: BackupService,
    private notificationService: NotificationService,
    private globalConfigService: GlobalConfigService,
    private serverNav: ServerNavService,
    private settingsDrawer: SettingsDrawerService,
    private auth: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.readViewPreferences();

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

    this.subs.push(this.route.fragment.subscribe(fragment => {
      if (fragment === 'activity') {
        this.showAllActivity = true;
        this.cdr.markForCheck();
      }
    }));

    // Greet whoever is actually signed in. The legacy single username is the fallback for
    // an install that has no accounts.
    this.subs.push(this.auth.identity$.subscribe(identity => {
      const account = identity.user;
      if (account) {
        this.userName = account.displayName || account.username;
        this.cdr.markForCheck();
      }
    }));

    this.globalConfigService.loadConfig().then(config => {
      if (this.auth.currentUser) return;
      const username = (config as any)?.authenticationUsername;
      this.userName = config?.authenticationEnabled && username ? username : 'Admin';
      this.cdr.markForCheck();
    }).catch(() => { /* defaults are fine */ });

    this.loadHostResources();
    this.loadPlayerHistory();
    this.subs.push(interval(5000).subscribe(() => this.loadHostResources()));
    this.subs.push(interval(60000).subscribe(() => this.loadPlayerHistory()));
    this.subs.push(interval(30000).subscribe(() => {
      this.now = Date.now();
      this.cdr.markForCheck();
    }));
  }

  ngOnDestroy(): void {
    this.subs.forEach(sub => sub.unsubscribe());
  }

  // -------------------- Header --------------------

  get statusLine(): string {
    if (this.summary.total === 0) return 'No servers yet. Add one to get started.';
    if (this.summary.online === this.summary.total) return `All systems operational. ${this.summary.online} of ${this.summary.total} servers are online.`;
    if (this.summary.online === 0) return `All servers are offline. ${this.summary.total} server${this.summary.total === 1 ? '' : 's'} configured.`;
    return `${this.summary.online} of ${this.summary.total} servers are online.`;
  }

  // -------------------- Server list --------------------

  setView(view: 'grid' | 'list'): void {
    this.view = view;
    this.saveViewPreferences();
  }

  onFilterChange(): void {
    this.refreshVisible();
    this.saveViewPreferences();
  }

  onSortChange(): void {
    this.refreshVisible();
    this.saveViewPreferences();
  }

  get canReorder(): boolean {
    return this.sort === 'custom' && this.filter === 'all';
  }

  refreshVisible(): void {
    let list = this.servers.slice();
    if (this.filter === 'online') list = list.filter(server => LiveServersService.isOnline(server));
    if (this.filter === 'offline') list = list.filter(server => !LiveServersService.isOnline(server));

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
    const orderedIds = reordered.map(server => server.id);
    this.liveServers.applyOrder(orderedIds);
    this.serverInstanceService.reorderServers(orderedIds).pipe(take(1)).subscribe();
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

  // -------------------- Card actions --------------------

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

  requestDelete(server: ServerInstance): void {
    if (this.servers.length <= 1) {
      this.notificationService.warning('Cannot Delete Server', 'At least one server must remain.');
      return;
    }
    if (LiveServersService.normalizeState(server.state) !== 'stopped') {
      this.notificationService.warning('Cannot Delete Server', 'Server must be stopped before it can be deleted.');
      return;
    }
    this.serverToDelete = server;
    this.cdr.markForCheck();
  }

  cancelDelete(): void {
    this.serverToDelete = null;
    this.cdr.markForCheck();
  }

  confirmDelete(): void {
    const server = this.serverToDelete;
    if (!server) return;
    this.serverInstanceService.delete(server.id).pipe(take(1)).subscribe(() => {
      this.serverToDelete = null;
      this.cdr.markForCheck();
    });
  }

  // -------------------- Quick actions --------------------

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
    this.messaging.sendMessage('start-all-instances', {}).subscribe({
      next: (res: any) => {
        if (res?.success) {
          this.notificationService.success('All servers are starting.', 'Server Control');
        } else {
          this.notificationService.error(res?.error || 'Failed to start all servers.', 'Server Control');
        }
        this.cdr.markForCheck();
      },
      error: () => this.notificationService.error('Failed to start all servers.', 'Server Control')
    });
  }

  confirmStopAll(): void {
    this.showConfirmStopAll = false;
    this.messaging.sendMessage('stop-all-instances', {}).subscribe({
      next: (res: any) => {
        if (res?.success) {
          this.notificationService.success('All servers are stopping.', 'Server Control');
        } else {
          this.notificationService.error(res?.error || 'Failed to stop all servers.', 'Server Control');
        }
        this.cdr.markForCheck();
      },
      error: () => this.notificationService.error('Failed to stop all servers.', 'Server Control')
    });
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
      .pipe(take(1))
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

  goToServerInstall(): void {
    this.settingsDrawer.open('server-installation');
  }

  goToSettings(): void {
    this.settingsDrawer.open();
  }

  // -------------------- Host resources --------------------

  loadHostResources(): void {
    this.messaging.sendMessage<any>('get-host-resources', {}).pipe(take(1)).subscribe({
      next: (res) => {
        if (res && !res.error && typeof res.cpuPercent === 'number') {
          this.hostResources = { cpuPercent: res.cpuPercent, memory: res.memory, disk: res.disk || null };
          this.hostResourcesError = false;
        } else if (res?.error) {
          this.hostResourcesError = true;
        }
        this.cdr.markForCheck();
      },
      error: () => {
        this.hostResourcesError = true;
        this.cdr.markForCheck();
      }
    });
  }

  get cpuPercent(): number {
    return this.hostResources ? Math.max(0, Math.min(100, this.hostResources.cpuPercent)) : 0;
  }

  get memoryPercent(): number {
    return toPercent(this.hostResources?.memory?.used, this.hostResources?.memory?.total);
  }

  get diskPercent(): number {
    return toPercent(this.hostResources?.disk?.used, this.hostResources?.disk?.total);
  }

  get cpuLabel(): string {
    return this.hostResources ? formatPercent(this.hostResources.cpuPercent) : '--';
  }

  get memoryLabel(): string {
    const memory = this.hostResources?.memory;
    return memory ? `${formatBytes(memory.used)} / ${formatBytes(memory.total, 0)}` : '--';
  }

  get diskLabel(): string {
    const disk = this.hostResources?.disk;
    return disk ? `${formatBytes(disk.used, 0)} / ${formatBytes(disk.total, 0)}` : 'Unavailable';
  }

  // -------------------- Player history --------------------

  loadPlayerHistory(): void {
    this.messaging.sendMessage<any>('get-player-history', {}).pipe(take(1)).subscribe({
      next: (res) => {
        if (res && Array.isArray(res.samples)) {
          this.historySamples = res.samples;
          this.rebuildHistories();
          this.cdr.markForCheck();
        }
      },
      error: () => { /* chart simply stays empty */ }
    });
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

  // -------------------- Uptime chart --------------------

  trackByUptimeBar(_index: number, bar: { server: ServerInstance }): string {
    return bar.server.id;
  }

  get uptimeBars(): { server: ServerInstance; percent: number; label: string }[] {
    const uptimes = this.servers.map(server => ({
      server,
      ms: LiveServersService.isOnline(server) && server.startedAt ? Math.max(0, this.now - server.startedAt) : 0
    }));
    const max = Math.max(1, ...uptimes.map(item => item.ms));
    return uptimes.map(item => ({
      server: item.server,
      percent: item.ms > 0 ? Math.max(4, (item.ms / max) * 100) : 0,
      label: item.ms > 0 ? formatUptime(this.now - item.ms, this.now) : '0m'
    }));
  }

  // -------------------- Activity --------------------

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

  // -------------------- Preferences --------------------

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
    } catch {
      // ignore corrupt or unavailable storage
    }
  }

  private saveViewPreferences(): void {
    try {
      localStorage.setItem('cerious-aasm.dashboard', JSON.stringify({ view: this.view, filter: this.filter, sort: this.sort }));
    } catch {
      // ignore
    }
  }
}
