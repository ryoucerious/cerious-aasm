import {
  Component, EventEmitter, Input, Output, OnInit, OnDestroy, ChangeDetectorRef,
  ChangeDetectionStrategy, HostListener, ViewChild, ElementRef, inject
} from '@angular/core';
import { NgIf, NgFor, NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ThemeService, ResolvedTheme } from '../../core/services/theme.service';
import { ActivityService, ActivityItem } from '../../core/services/activity.service';
import { LiveServersService } from '../../core/services/live-servers.service';
import { ServerInstanceService } from '../../core/services/server-instance.service';
import { GlobalConfigService } from '../../core/services/global-config.service';
import { IpcService } from '../../core/services/ipc.service';
import { NotificationService } from '../../core/services/notification.service';
import { ServerNavService } from '../../core/services/server-nav.service';
import { SettingsDrawerService } from '../../core/services/settings-drawer.service';
import { AuthService } from '../../core/services/auth.service';
import { MeshHealth, MeshNodesService } from '../../core/services/mesh-nodes.service';
import { AuthenticatedUser } from '../../core/models/auth.model';
import { ServerInstance } from '../../core/models/server-instance.model';
import { formatRelativeTime, initialOf } from '../../core/utils/format.utils';
import { ACTIVITY_ICONS } from '../../core/utils/activity-icons';
import { mapDisplayName } from '../../core/utils/map-visuals';
import { WindowControlsComponent } from '../window-controls/window-controls.component';
import { ModalComponent } from '../modal/modal.component';

/** One row in the search dropdown: a server or a page. */
export interface SearchResult {
  kind: 'server' | 'page';
  label: string;
  detail: string;
  icon: string;
  action: () => void;
}

/**
 * The app-wide header: brand, global search, theme toggle, notification bell and user menu.
 * On narrow screens it also hosts the hamburger that opens the sidebar.
 */
@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, FormsModule, WindowControlsComponent, ModalComponent],
  templateUrl: './topbar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TopbarComponent implements OnInit, OnDestroy {
  @Input() isMobile = false;
  @Input() menuOpen = false;
  @Output() menuToggle = new EventEmitter<void>();
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  searchQuery = '';
  searchOpen = false;
  searchResults: SearchResult[] = [];
  highlightedIndex = 0;

  notificationsOpen = false;
  userMenuOpen = false;
  showAllActivity = false;
  unreadCount = 0;
  /** Full feed, shown in the modal. The bell dropdown only uses the latest few. */
  activity: ActivityItem[] = [];
  recentActivity: ActivityItem[] = [];
  theme: ResolvedTheme = 'dark';

  userName = 'Admin';
  userRole = 'Administrator';
  isWebMode = false;
  authenticationEnabled = false;

  /** The signed-in account, when there is one. Null in the desktop app. */
  private account: AuthenticatedUser | null = null;

  private servers: ServerInstance[] = [];
  private subs: Subscription[] = [];
  private readonly meshNodes = inject(MeshNodesService);

  /** How the mesh stands, for the indicator beside the actions; null outside a mesh. */
  meshHealth: MeshHealth | null = null;

  readonly activityIcons = ACTIVITY_ICONS;

  constructor(
    private router: Router,
    private themeService: ThemeService,
    private activityService: ActivityService,
    private liveServers: LiveServersService,
    private serverInstanceService: ServerInstanceService,
    private globalConfigService: GlobalConfigService,
    ipc: IpcService,
    private notificationService: NotificationService,
    private serverNav: ServerNavService,
    private settingsDrawer: SettingsDrawerService,
    private auth: AuthService,
    private cdr: ChangeDetectorRef
  ) {
    this.isWebMode = !ipc.isElectron;
  }

  ngOnInit(): void {
    this.subs.push(this.themeService.resolved$.subscribe(theme => {
      this.theme = theme;
      this.cdr.markForCheck();
    }));
    this.subs.push(this.activityService.items$.subscribe(items => {
      this.activity = items;
      this.recentActivity = items.slice(0, 8);
      this.unreadCount = this.activityService.unreadCount;
      this.cdr.markForCheck();
    }));
    this.subs.push(this.liveServers.servers$.subscribe(servers => {
      this.servers = servers;
      if (this.searchOpen) this.runSearch();
      this.cdr.markForCheck();
    }));
    this.subs.push(this.auth.displayName$.subscribe(name => {
      this.userName = name;
      this.cdr.markForCheck();
    }));
    this.subs.push(this.meshNodes.changed$.subscribe(() => {
      this.meshHealth = this.meshNodes.health;
      this.cdr.markForCheck();
    }));
    this.subs.push(this.auth.identity$.subscribe(identity => {
      this.account = identity.user;
      this.applyRole();
    }));

    // Until the settings are known the defaults stand; GlobalConfigService asks once the connection is up.
    this.subs.push(this.globalConfigService.config$.subscribe(config => {
      this.authenticationEnabled = !!config?.authenticationEnabled;
      this.applyRole();
    }));
  }

  get meshText(): string {
    const health = this.meshHealth;
    if (!health) return '';
    if (health.state === 'reconnecting') return 'Mesh reconnecting';
    if (health.state === 'removed') return 'Removed from the mesh';
    const count = `${health.reachable} of ${health.total} machine${health.total === 1 ? '' : 's'}`;
    return health.state === 'degraded' ? `Mesh degraded · ${count}` : `Mesh · ${count}`;
  }

  get meshTone(): string {
    switch (this.meshHealth?.state) {
      case 'healthy': return 'tone-success';
      case 'partial': return 'tone-warning';
      case 'degraded':
      case 'removed': return 'tone-danger';
      default: return 'tone-muted';
    }
  }

  /** What the state means, and what still works. */
  get meshTitle(): string {
    const health = this.meshHealth;
    if (!health) return '';
    const unreachable = health.total - health.reachable;
    switch (health.state) {
      case 'healthy': return 'Every machine in the mesh can be reached.';
      case 'partial': return `${unreachable} machine${unreachable === 1 ? '' : 's'} cannot be reached. The mesh can still agree on changes.`;
      case 'degraded': return `Only ${health.reachable} of ${health.total} machines can be reached, and changes to the mesh need ${health.needed}. Each machine's own servers can still be controlled.`;
      case 'reconnecting': return 'This machine is getting back in touch with the mesh after a restart.';
      case 'removed': return 'The other machines removed this one from the mesh. Open Settings → Mesh to leave it.';
    }
  }

  openMeshSettings(): void {
    this.settingsDrawer.open('mesh');
  }

  ngOnDestroy(): void {
    this.subs.forEach(sub => sub.unsubscribe());
  }

  get userInitial(): string {
    return initialOf(this.userName);
  }

  get themeIcon(): string {
    return this.theme === 'dark' ? 'light_mode' : 'dark_mode';
  }

  get themeTitle(): string {
    return this.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.focusSearch();
      return;
    }
    if (event.key === 'Escape' && (this.searchOpen || this.notificationsOpen || this.userMenuOpen)) {
      this.closeAll();
      this.cdr.markForCheck();
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (target && target.closest('.topbar')) return;
    if (this.searchOpen || this.notificationsOpen || this.userMenuOpen) {
      this.closeAll();
      this.cdr.markForCheck();
    }
  }

  closeAll(): void {
    this.searchOpen = false;
    this.notificationsOpen = false;
    this.userMenuOpen = false;
  }

  focusSearch(): void {
    this.searchInput?.nativeElement.focus();
    this.openSearch();
  }

  openSearch(): void {
    this.notificationsOpen = false;
    this.userMenuOpen = false;
    this.searchOpen = true;
    this.runSearch();
    this.cdr.markForCheck();
  }

  onSearchInput(): void {
    this.searchOpen = true;
    this.runSearch();
  }

  onSearchKeydown(event: KeyboardEvent): void {
    if (!this.searchOpen) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.highlightedIndex = Math.min(this.searchResults.length - 1, this.highlightedIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.highlightedIndex = Math.max(0, this.highlightedIndex - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const result = this.searchResults[this.highlightedIndex];
      if (result) this.runResult(result);
    }
  }

  runResult(result: SearchResult): void {
    result.action();
    this.searchQuery = '';
    this.searchResults = [];
    this.closeAll();
    this.searchInput?.nativeElement.blur();
    this.cdr.markForCheck();
  }

  /** Servers first (name or map), then pages. Empty query lists everything so the box doubles as a launcher. */
  runSearch(): void {
    const query = this.searchQuery.trim().toLowerCase();
    const matches = (text: string) => !query || text.toLowerCase().includes(query);

    const serverResults: SearchResult[] = this.servers
      .filter(server => matches(server.name || '') || matches(mapDisplayName(server.mapName)))
      .slice(0, 6)
      .map(server => ({
        kind: 'server' as const,
        label: server.name,
        detail: `${mapDisplayName(server.mapName)} · ${LiveServersService.isOnline(server) ? 'Online' : 'Offline'}`,
        icon: 'dns',
        action: () => this.openServer(server)
      }));

    const pages: { label: string; detail: string; icon: string; run: () => void }[] = [
      { label: 'Dashboard', detail: 'Overview of all servers', icon: 'home', run: () => this.router.navigate(['/dashboard']) },
      { label: 'Settings', detail: 'Application settings', icon: 'settings', run: () => this.settingsDrawer.open() },
      ...this.serverNav.visibleTabs().map(tab => ({
        label: tab.label,
        detail: 'Selected server page',
        icon: tab.icon,
        run: () => { this.router.navigate(['/server', tab.id]); }
      }))
    ];

    const pageResults: SearchResult[] = pages
      .filter(page => matches(page.label))
      .slice(0, 8)
      .map(page => ({
        kind: 'page' as const,
        label: page.label,
        detail: page.detail,
        icon: page.icon,
        action: page.run
      }));

    this.searchResults = [...serverResults, ...pageResults];
    this.highlightedIndex = 0;
    this.cdr.markForCheck();
  }

  private openServer(server: ServerInstance): void {
    this.serverInstanceService.setActiveServer(server);
    this.router.navigate(['/server', this.serverNav.lastTab]);
  }

  toggleTheme(): void {
    this.themeService.toggle();
  }

  toggleNotifications(): void {
    const open = !this.notificationsOpen;
    this.closeAll();
    this.notificationsOpen = open;
    if (open) {
      this.activityService.markAllSeen();
      this.unreadCount = 0;
    }
    this.cdr.markForCheck();
  }

  toggleUserMenu(): void {
    const open = !this.userMenuOpen;
    this.closeAll();
    this.userMenuOpen = open;
    this.cdr.markForCheck();
  }

  goToDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  /** Open the signed-in account's own settings. */
  openAccount(): void {
    this.closeAll();
    this.settingsDrawer.open('profile');
  }

  goToSettings(): void {
    this.closeAll();
    this.settingsDrawer.open();
  }

  /** The role under the name: the account's, else what kind of session this is. */
  private applyRole(): void {
    if (this.account) {
      this.userRole = this.account.roleName || 'Administrator';
    } else if (this.isWebMode) {
      this.userRole = this.authenticationEnabled ? 'Administrator' : 'Web Console';
    } else {
      this.userRole = 'Local Administrator';
    }
    this.cdr.markForCheck();
  }

  /** Why there is nothing to sign out of, shown in place of the sign-out item. */
  get signOutNote(): string {
    return this.isWebMode ? 'Authentication is off' : 'Signed in on this machine';
  }

  /**
   * The web interface with authentication on, or a mesh account signed in on the desktop.
   * The desktop outside a mesh is the machine owner and has no session to end.
   */
  get canSignOut(): boolean {
    if (!this.isWebMode) return !!this.account;
    return this.authenticationEnabled || !!this.account;
  }

  viewAllActivity(): void {
    this.closeAll();
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

  relativeTime(item: ActivityItem): string {
    return formatRelativeTime(item.timestamp);
  }

  trackActivity(_index: number, item: ActivityItem): string {
    return item.id;
  }

  /** Ends the session and returns to the login page. */
  async logout(): Promise<void> {
    this.closeAll();
    if (!this.canSignOut) return;
    if (await this.auth.logout()) {
      this.router.navigate(['/login']);
    } else {
      this.notificationService.error('Failed to logout', 'Authentication');
    }
  }
}
