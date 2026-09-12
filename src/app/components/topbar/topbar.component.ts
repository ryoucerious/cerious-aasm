import {
  Component, EventEmitter, Input, Output, OnInit, OnDestroy, ChangeDetectorRef,
  ChangeDetectionStrategy, HostListener, ViewChild, ElementRef
} from '@angular/core';
import { NgIf, NgFor, NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ThemeService, ResolvedTheme } from '../../core/services/theme.service';
import { ActivityService, ActivityItem, ActivityKind } from '../../core/services/activity.service';
import { LiveServersService } from '../../core/services/live-servers.service';
import { ServerInstanceService } from '../../core/services/server-instance.service';
import { GlobalConfigService } from '../../core/services/global-config.service';
import { UtilityService } from '../../core/services/utility.service';
import { NotificationService } from '../../core/services/notification.service';
import { ServerNavService } from '../../core/services/server-nav.service';
import { SettingsDrawerService } from '../../core/services/settings-drawer.service';
import { AuthService } from '../../core/services/auth.service';
import { AuthenticatedUser } from '../../core/models/auth.model';
import { ServerInstance } from '../../core/models/server-instance.model';
import { formatRelativeTime, initialOf } from '../../core/utils/format.utils';
import { mapDisplayName } from '../../core/utils/map-visuals';
import { WindowControlsComponent } from '../window-controls/window-controls.component';

/** One row in the search dropdown: a server or a page. */
export interface SearchResult {
  kind: 'server' | 'page';
  label: string;
  detail: string;
  icon: string;
  action: () => void;
}

export const ACTIVITY_ICONS: Record<ActivityKind, { icon: string; tone: string }> = {
  start:  { icon: 'play_arrow',    tone: 'success' },
  stop:   { icon: 'stop',          tone: 'danger' },
  crash:  { icon: 'error',         tone: 'danger' },
  backup: { icon: 'backup',        tone: 'primary' },
  join:   { icon: 'person_add',    tone: 'info' },
  leave:  { icon: 'person_remove', tone: 'muted' },
  update: { icon: 'system_update', tone: 'warning' },
  error:  { icon: 'warning',       tone: 'danger' },
  info:   { icon: 'info',          tone: 'info' },
  account:{ icon: 'manage_accounts', tone: 'violet' }
};

/**
 * The app-wide header: brand, global search, theme toggle, notification bell and user menu.
 * On narrow screens it also hosts the hamburger that opens the sidebar.
 */
@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, FormsModule, WindowControlsComponent],
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
  unreadCount = 0;
  recentActivity: ActivityItem[] = [];
  theme: ResolvedTheme = 'dark';

  userName = 'Admin';
  userRole = 'Administrator';
  isWebMode = false;
  authenticationEnabled = false;

  /** The signed-in account, when there is one. Null in the desktop app. */
  private account: AuthenticatedUser | null = null;
  /** Legacy single-password username, used only when no account backs this session. */
  private configUsername = '';

  private servers: ServerInstance[] = [];
  private selectedServerId: string | null = null;
  private subs: Subscription[] = [];

  readonly activityIcons = ACTIVITY_ICONS;

  constructor(
    private router: Router,
    private themeService: ThemeService,
    private activityService: ActivityService,
    private liveServers: LiveServersService,
    private serverInstanceService: ServerInstanceService,
    private globalConfigService: GlobalConfigService,
    private utility: UtilityService,
    private notificationService: NotificationService,
    private serverNav: ServerNavService,
    private settingsDrawer: SettingsDrawerService,
    private auth: AuthService,
    private cdr: ChangeDetectorRef
  ) {
    this.isWebMode = this.utility.getPlatform() === 'Web';
  }

  ngOnInit(): void {
    this.subs.push(this.themeService.resolved$.subscribe(theme => {
      this.theme = theme;
      this.cdr.markForCheck();
    }));
    this.subs.push(this.activityService.items$.subscribe(items => {
      this.recentActivity = items.slice(0, 8);
      this.unreadCount = this.activityService.unreadCount;
      this.cdr.markForCheck();
    }));
    this.subs.push(this.liveServers.servers$.subscribe(servers => {
      this.servers = servers;
      if (this.searchOpen) this.runSearch();
      this.cdr.markForCheck();
    }));
    this.subs.push(this.serverInstanceService.getActiveServer().subscribe(server => {
      this.selectedServerId = server?.id || null;
    }));
    // Who is actually signed in, once accounts exist. The desktop owns the machine and has
    // no account of its own, so it keeps the local-administrator label.
    this.subs.push(this.auth.identity$.subscribe(identity => {
      this.account = identity.user;
      this.applyIdentity();
    }));

    this.globalConfigService.loadConfig().then(config => {
      this.authenticationEnabled = !!config?.authenticationEnabled;
      this.configUsername = (config as any)?.authenticationUsername || '';
      this.applyIdentity();
    }).catch(() => {
      // Config unavailable (e.g. before the connection is up); defaults are fine.
    });
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

  // -------------------- Keyboard & outside clicks --------------------

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

  // -------------------- Search --------------------

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

  // -------------------- Theme, notifications, user --------------------

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

  /**
   * There is only something to sign out of in the web interface with authentication on.
   * The desktop app is the machine owner and has no session to end.
   */
  /** Name and role shown in the menu, preferring the account over the legacy config. */
  private applyIdentity(): void {
    if (this.account) {
      this.userName = this.account.displayName || this.account.username;
      this.userRole = this.account.roleName || 'Administrator';
    } else if (this.isWebMode) {
      this.userName = this.authenticationEnabled && this.configUsername ? this.configUsername : 'Admin';
      this.userRole = this.authenticationEnabled ? 'Administrator' : 'Web Console';
    } else {
      this.userName = 'Admin';
      this.userRole = 'Local Administrator';
    }
    this.cdr.markForCheck();
  }

  /** Why there is nothing to sign out of, shown in place of the sign-out item. */
  get signOutNote(): string {
    return this.isWebMode ? 'Authentication is off' : 'Signed in on this machine';
  }

  get canSignOut(): boolean {
    if (!this.isWebMode) return false;
    return this.authenticationEnabled || !!this.account;
  }

  viewAllActivity(): void {
    this.closeAll();
    this.router.navigate(['/dashboard'], { fragment: 'activity' });
  }

  relativeTime(item: ActivityItem): string {
    return formatRelativeTime(item.timestamp);
  }

  trackActivity(_index: number, item: ActivityItem): string {
    return item.id;
  }

  /** Web mode only: end the session and return to the login page. */
  async logout(): Promise<void> {
    this.closeAll();
    if (!this.isWebMode) return;
    try {
      const response = await fetch('/api/logout', { method: 'POST', credentials: 'include' });
      if (response.ok) {
        this.router.navigate(['/login']);
      } else {
        console.error('Logout failed with status:', response.status);
        this.notificationService.error('Failed to logout', 'Authentication');
      }
    } catch (error) {
      console.error('Logout failed:', error);
      this.notificationService.error('Failed to logout', 'Authentication');
    }
  }
}
