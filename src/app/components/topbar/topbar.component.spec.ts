import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { TopbarComponent } from './topbar.component';
import { ThemeService } from '../../core/services/theme.service';
import { ActivityService } from '../../core/services/activity.service';
import { LiveServersService } from '../../core/services/live-servers.service';
import { ServerInstanceService } from '../../core/services/server-instance.service';
import { GlobalConfigService } from '../../core/services/global-config.service';
import { UtilityService } from '../../core/services/utility.service';
import { NotificationService } from '../../core/services/notification.service';
import { ServerNavService } from '../../core/services/server-nav.service';
import { SettingsDrawerService } from '../../core/services/settings-drawer.service';
import { AuthService } from '../../core/services/auth.service';
import { MockNotificationService } from '../../../../test/mocks/mock-notification.service';

describe('TopbarComponent', () => {
  let component: TopbarComponent;
  let fixture: ComponentFixture<TopbarComponent>;
  let router: jasmine.SpyObj<Router>;
  let theme: any;
  let activity: any;
  let servers$: BehaviorSubject<any[]>;
  let items$: BehaviorSubject<any[]>;
  let serverInstanceService: any;
  let utility: any;
  let config: any;
  let notification: MockNotificationService;
  let settingsDrawer: jasmine.SpyObj<SettingsDrawerService>;
  let identity$: BehaviorSubject<any>;
  let auth: any;

  beforeEach(async () => {
    router = jasmine.createSpyObj('Router', ['navigate']);
    router.navigate.and.returnValue(Promise.resolve(true));
    theme = { resolved$: new BehaviorSubject('dark'), toggle: jasmine.createSpy('toggle') };
    items$ = new BehaviorSubject<any[]>([]);
    activity = { items$: items$.asObservable(), unreadCount: 0, markAllSeen: jasmine.createSpy('markAllSeen') };
    servers$ = new BehaviorSubject<any[]>([
      { id: 'a', name: 'Aberration', mapName: 'Aberration_WP', state: 'running' },
      { id: 'b', name: 'Ragnarok', mapName: 'Ragnarok_WP', state: 'stopped' }
    ]);
    serverInstanceService = { getActiveServer: () => of(null), setActiveServer: jasmine.createSpy('setActiveServer') };
    utility = { getPlatform: () => 'Web' };
    config = { loadConfig: () => Promise.resolve({ authenticationEnabled: true, authenticationUsername: 'jared' }) };
    notification = new MockNotificationService();
    settingsDrawer = jasmine.createSpyObj('SettingsDrawerService', ['open', 'close', 'selectSection'], { isOpen: false });
    identity$ = new BehaviorSubject<any>({ user: null, isLocalDesktop: false, isAdmin: true, permissions: [], accountsInUse: false });
    auth = { identity$: identity$.asObservable(), get currentUser() { return identity$.value.user; }, refresh: jasmine.createSpy('refresh') };

    await TestBed.configureTestingModule({
      imports: [TopbarComponent],
      providers: [
        { provide: Router, useValue: router },
        { provide: ThemeService, useValue: theme },
        { provide: ActivityService, useValue: activity },
        { provide: LiveServersService, useValue: { servers$: servers$.asObservable() } },
        { provide: ServerInstanceService, useValue: serverInstanceService },
        { provide: GlobalConfigService, useValue: config },
        { provide: UtilityService, useValue: utility },
        { provide: NotificationService, useValue: notification },
        { provide: ServerNavService, useValue: { lastTab: 'console', visibleTabs: () => [{ id: 'mods', label: 'Mods', icon: 'extension', group: 'features' }] } },
        { provide: SettingsDrawerService, useValue: settingsDrawer },
        { provide: AuthService, useValue: auth }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(TopbarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows the configured username when authentication is enabled', async () => {
    await fixture.whenStable();
    expect(component.userName).toBe('jared');
    expect(component.userInitial).toBe('J');
    expect(component.authenticationEnabled).toBeTrue();
  });

  it('reflects the resolved theme in the toggle icon', () => {
    expect(component.themeIcon).toBe('light_mode');
    theme.resolved$.next('light');
    expect(component.themeIcon).toBe('dark_mode');
    component.toggleTheme();
    expect(theme.toggle).toHaveBeenCalled();
  });

  it('searches servers by name or map and pages by label', () => {
    component.searchQuery = 'rag';
    component.runSearch();
    expect(component.searchResults.map(r => r.label)).toEqual(['Ragnarok']);

    component.searchQuery = 'aberr';
    component.runSearch();
    expect(component.searchResults[0].detail).toContain('Aberration');

    component.searchQuery = 'mods';
    component.runSearch();
    expect(component.searchResults.map(r => r.kind)).toEqual(['page']);
  });

  it('lists everything for an empty query', () => {
    component.searchQuery = '';
    component.runSearch();
    expect(component.searchResults.filter(r => r.kind === 'server').length).toBe(2);
    expect(component.searchResults.some(r => r.label === 'Dashboard')).toBeTrue();
  });

  it('selects a server and navigates when a server result runs', () => {
    component.searchQuery = 'rag';
    component.runSearch();
    component.runResult(component.searchResults[0]);
    expect(serverInstanceService.setActiveServer).toHaveBeenCalledWith(jasmine.objectContaining({ id: 'b' }));
    expect(router.navigate).toHaveBeenCalledWith(['/server', 'console']);
    expect(component.searchOpen).toBeFalse();
    expect(component.searchQuery).toBe('');
  });

  it('navigates with the keyboard through results', () => {
    component.openSearch();
    component.onSearchKeydown({ key: 'ArrowDown', preventDefault: () => {} } as any);
    expect(component.highlightedIndex).toBe(1);
    component.onSearchKeydown({ key: 'ArrowUp', preventDefault: () => {} } as any);
    expect(component.highlightedIndex).toBe(0);
    component.onSearchKeydown({ key: 'Enter', preventDefault: () => {} } as any);
    expect(serverInstanceService.setActiveServer).toHaveBeenCalled();
  });

  it('opens the notifications panel and marks activity seen', () => {
    activity.unreadCount = 3;
    items$.next([{ id: '1', kind: 'start', message: 'Alpha started', timestamp: Date.now() }]);
    expect(component.unreadCount).toBe(3);
    component.toggleNotifications();
    expect(component.notificationsOpen).toBeTrue();
    expect(activity.markAllSeen).toHaveBeenCalled();
    expect(component.unreadCount).toBe(0);
    expect(component.recentActivity.length).toBe(1);
    component.toggleNotifications();
    expect(component.notificationsOpen).toBeFalse();
  });

  it('closes menus on Escape and on outside clicks', () => {
    component.toggleUserMenu();
    expect(component.userMenuOpen).toBeTrue();
    component.onDocumentKeydown({ key: 'Escape', ctrlKey: false, metaKey: false, preventDefault: () => {} } as any);
    expect(component.userMenuOpen).toBeFalse();

    component.toggleUserMenu();
    component.onDocumentClick({ target: document.body } as any);
    expect(component.userMenuOpen).toBeFalse();
  });

  it('focuses search on Ctrl+K', () => {
    const preventDefault = jasmine.createSpy('preventDefault');
    component.onDocumentKeydown({ key: 'k', ctrlKey: true, metaKey: false, preventDefault } as any);
    expect(preventDefault).toHaveBeenCalled();
    expect(component.searchOpen).toBeTrue();
  });

  it('opens settings and navigates to the dashboard and activity list', () => {
    component.goToSettings();
    expect(settingsDrawer.open).toHaveBeenCalled();
    // "User Settings" lands on the account section rather than the drawer's default.
    component.openAccount();
    expect(settingsDrawer.open).toHaveBeenCalledWith('profile');
    component.goToDashboard();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
    component.viewAllActivity();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard'], { fragment: 'activity' });
  });

  it('shows the signed-in account in place of the configured username', () => {
    identity$.next({
      user: { username: 'jared', displayName: 'Jared K', roleName: 'Server Manager' },
      isLocalDesktop: false, isAdmin: false, permissions: ['servers.view'], accountsInUse: true
    });
    expect(component.userName).toBe('Jared K');
    expect(component.userRole).toBe('Server Manager');
    expect(component.canSignOut).toBeTrue();
  });

  it('logs out through the api in web mode', async () => {
    spyOn(window, 'fetch').and.returnValue(Promise.resolve({ ok: true } as Response));
    await component.logout();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);

    (window.fetch as jasmine.Spy).and.returnValue(Promise.resolve({ ok: false, status: 500 } as Response));
    spyOn(notification, 'error');
    await component.logout();
    expect(notification.error).toHaveBeenCalled();
  });
});
