import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, NavigationEnd } from '@angular/router';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { TOAST_CONFIG, ToastrService } from 'ngx-toastr';
import { SidebarComponent } from './sidebar.component';
import { MessagingService } from '../../core/services/messaging/messaging.service';
import { ServerInstanceService } from '../../core/services/server-instance.service';
import { NotificationService } from '../../core/services/notification.service';
import { GlobalConfigService } from '../../core/services/global-config.service';
import { LiveServersService } from '../../core/services/live-servers.service';
import { ServerNavService } from '../../core/services/server-nav.service';
import { SettingsDrawerService } from '../../core/services/settings-drawer.service';
import { MockMessagingService } from '../../../../test/mocks/mock-messaging.service';
import { MockNotificationService } from '../../../../test/mocks/mock-notification.service';
import { MockGlobalConfigService } from '../../../../test/mocks/mock-global-config.service';

describe('SidebarComponent', () => {
  let component: SidebarComponent;
  let fixture: ComponentFixture<SidebarComponent>;
  let servers$: BehaviorSubject<any[]>;
  let activeServer$: BehaviorSubject<any>;
  let routerEvents$: Subject<any>;
  let router: jasmine.SpyObj<Router>;
  let liveServers: any;
  let serverInstanceService: any;
  let serverNav: any;
  let notification: MockNotificationService;
  let settingsDrawer: jasmine.SpyObj<SettingsDrawerService>;

  const stopped = { id: '1', name: 'Alpha', state: 'stopped' };
  const running = { id: '2', name: 'Beta', state: 'running', players: 3 };

  beforeEach(async () => {
    servers$ = new BehaviorSubject<any[]>([]);
    activeServer$ = new BehaviorSubject<any>(null);
    routerEvents$ = new Subject<any>();

    router = jasmine.createSpyObj('Router', ['navigate'], { events: routerEvents$.asObservable(), url: '/dashboard' });
    router.navigate.and.returnValue(Promise.resolve(true));

    liveServers = {
      servers$: servers$.asObservable(),
      get servers() { return servers$.value; },
      applyOrder: jasmine.createSpy('applyOrder')
    };
    serverInstanceService = {
      getActiveServer: () => activeServer$.asObservable(),
      setActiveServer: jasmine.createSpy('setActiveServer').and.callFake((s: any) => activeServer$.next(s)),
      save: jasmine.createSpy('save').and.returnValue(of({ success: true })),
      delete: jasmine.createSpy('delete').and.returnValue(of({})),
      reorderServers: jasmine.createSpy('reorderServers').and.returnValue(of({})),
      getDefaultInstanceFromMeta: () => of({}),
      importServerFromBackup: () => of({}),
      messaging: { sendMessage: jasmine.createSpy('sendMessage').and.returnValue(of({ success: true })) }
    };
    serverNav = {
      expertMode$: of(false),
      isLinux$: of(false),
      lastTab: 'console',
      rememberTab: jasmine.createSpy('rememberTab'),
      isValidTab: (tab: string) => ['console', 'players', 'general', 'rates', 'structures', 'stats', 'misc', 'cluster', 'mods', 'arkapi', 'whitelist', 'automation', 'broadcasts', 'discord', 'firewall', 'backup', 'ini-Game'].includes(tab),
      visibleTabs: () => [
        { id: 'console', label: 'Console', icon: 'terminal', group: 'overview' },
        { id: 'general', label: 'General', icon: 'tune', group: 'config' },
        { id: 'rates', label: 'Rates', icon: 'speed', group: 'config' },
        { id: 'mods', label: 'Mods', icon: 'extension', group: 'features' }
      ]
    };
    notification = new MockNotificationService();
    settingsDrawer = jasmine.createSpyObj('SettingsDrawerService', ['open', 'close', 'selectSection'], { isOpen: false });

    await TestBed.configureTestingModule({
      imports: [SidebarComponent, HttpClientTestingModule],
      providers: [
        { provide: Router, useValue: router },
        { provide: MessagingService, useClass: MockMessagingService },
        { provide: 'MessageTransport', useValue: {} },
        { provide: ServerInstanceService, useValue: serverInstanceService },
        { provide: LiveServersService, useValue: liveServers },
        { provide: ServerNavService, useValue: serverNav },
        { provide: TOAST_CONFIG, useValue: { iconClasses: {} } },
        { provide: ToastrService, useValue: { success: () => {}, error: () => {}, info: () => {}, warning: () => {} } },
        { provide: NotificationService, useValue: notification },
        { provide: GlobalConfigService, useClass: MockGlobalConfigService },
        { provide: SettingsDrawerService, useValue: settingsDrawer }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(SidebarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('groups the visible tabs into overview, configuration and features', () => {
    expect(component.overviewTabs.map(t => t.id)).toEqual(['console']);
    expect(component.configTabs.map(t => t.id)).toEqual(['general', 'rates']);
    expect(component.featureTabs.map(t => t.id)).toEqual(['mods']);
  });

  it('auto-selects the first server when none is selected', () => {
    spyOn(component.selectServer, 'emit');
    servers$.next([stopped, running]);
    expect(component.selectedServerId).toBe('1');
    expect(serverInstanceService.setActiveServer).toHaveBeenCalledWith(stopped);
    expect(component.selectServer.emit).toHaveBeenCalledWith(stopped);
  });

  it('falls back to another server when the selected one disappears', () => {
    servers$.next([stopped, running]);
    servers$.next([running]);
    expect(component.selectedServerId).toBe('2');
    expect(component.selectedServer).toEqual(running);
  });

  it('navigates to the remembered tab when a server is clicked', () => {
    spyOn(component.closeMobileMenu, 'emit');
    serverNav.lastTab = 'mods';
    component.onServerClick(running as any);
    expect(serverInstanceService.setActiveServer).toHaveBeenCalledWith(running);
    expect(serverNav.rememberTab).toHaveBeenCalledWith('mods');
    expect(router.navigate).toHaveBeenCalledWith(['/server', 'mods']);
    expect(component.closeMobileMenu.emit).toHaveBeenCalled();
  });

  it('opens a tab for the selected server', () => {
    servers$.next([stopped]);
    component.openTab({ id: 'rates', label: 'Rates', icon: 'speed', group: 'config' });
    expect(router.navigate).toHaveBeenCalledWith(['/server', 'rates']);
    expect(serverNav.rememberTab).toHaveBeenCalledWith('rates');
  });

  it('selects the first server before opening a tab when nothing is selected', () => {
    servers$.next([stopped, running]);
    component.selectedServerId = null;
    component.openTab({ id: 'mods', label: 'Mods', icon: 'extension', group: 'features' });
    expect(serverInstanceService.setActiveServer).toHaveBeenCalledWith(stopped);
    expect(router.navigate).toHaveBeenCalledWith(['/server', 'mods']);
  });

  it('derives the active tab from the current url and expands the configuration group', () => {
    routerEvents$.next(new NavigationEnd(1, '/server/rates', '/server/rates'));
    expect(component.activeTab).toBe('rates');
    expect(component.configGroupActive).toBeTrue();
    expect(component.configOpen).toBeTrue();
    expect(component.isTabActive({ id: 'rates', label: 'Rates', icon: 'speed', group: 'config' })).toBeTrue();
  });

  it('treats an unknown server sub-route as the console', () => {
    routerEvents$.next(new NavigationEnd(1, '/server/bogus', '/server/bogus'));
    expect(component.activeTab).toBe('console');
  });

  it('highlights dashboard and settings routes', () => {
    routerEvents$.next(new NavigationEnd(1, '/settings/general', '/settings/general'));
    expect(component.isRouteActive('/dashboard')).toBeFalse();
    expect(component.currentUrl.startsWith('/settings/')).toBeTrue();
    component.goToDashboard();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
    component.onSettingsClick();
    expect(settingsDrawer.open).toHaveBeenCalled();
  });

  it('should not allow editing server name if busy', () => {
    const event = { stopPropagation: jasmine.createSpy() } as any;
    component.onServerNameDoubleClick(running as any, event);
    expect(component.editingServerId).toBeNull();
  });

  it('should allow editing server name if not busy', () => {
    const event = { stopPropagation: jasmine.createSpy() } as any;
    component.onServerNameDoubleClick(stopped as any, event);
    expect(component.editingServerId).toBe('1');
    expect(component.editingServerName).toBe('Alpha');
  });

  it('saves a changed server name on Enter and cancels on Escape', () => {
    servers$.next([{ ...stopped }]);
    component.editingServerId = '1';
    component.editingServerName = 'Renamed';
    component.onServerNameKeydown({ key: 'Enter' } as any, stopped as any);
    expect(serverInstanceService.save).toHaveBeenCalledWith(jasmine.objectContaining({ id: '1', name: 'Renamed' }));
    expect(component.editingServerId).toBeNull();

    component.editingServerId = '1';
    component.onServerNameKeydown({ key: 'Escape' } as any, stopped as any);
    expect(component.editingServerId).toBeNull();
  });

  it('does not save an empty or unchanged server name', () => {
    component.editingServerName = '';
    component.onServerNameBlur(stopped as any);
    component.editingServerName = 'Alpha';
    component.onServerNameBlur(stopped as any);
    expect(serverInstanceService.save).not.toHaveBeenCalled();
  });

  it('reorders servers locally and persists the order', () => {
    servers$.next([stopped, running]);
    component.onDrop({ previousIndex: 0, currentIndex: 1 } as any);
    expect(liveServers.applyOrder).toHaveBeenCalledWith(['2', '1']);
    expect(serverInstanceService.reorderServers).toHaveBeenCalledWith(['2', '1']);
  });

  it('maps server states to status classes', () => {
    expect(component.getServerStatusClass({ state: 'running' } as any)).toBe('status-running');
    expect(component.getServerStatusClass({ state: 'starting' } as any)).toBe('status-starting');
    expect(component.getServerStatusClass({ state: 'stopping' } as any)).toBe('status-stopping');
    expect(component.getServerStatusClass({ state: 'crashed' } as any)).toBe('status-error');
    expect(component.getServerStatusClass({ state: undefined } as any)).toBe('status-stopped');
  });

  it('should not delete server if not stopped', () => {
    spyOn(notification, 'warning');
    component.onDeleteServer(running as any, { stopPropagation: () => {} } as any);
    expect(notification.warning).toHaveBeenCalled();
    expect(component.showConfirmDeleteModal).toBeFalse();
  });

  it('should show confirm delete modal if server is stopped', () => {
    component.onDeleteServer(stopped as any, { stopPropagation: () => {} } as any);
    expect(component.serverToDelete).toBe(stopped as any);
    expect(component.showConfirmDeleteModal).toBeTrue();
  });

  it('should not confirm delete if only one server', () => {
    servers$.next([stopped]);
    component.serverToDelete = stopped as any;
    component.onConfirmDelete();
    expect(serverInstanceService.delete).not.toHaveBeenCalled();
    expect(component.serverToDelete).toBeNull();
  });

  it('should confirm delete if server stopped and more than one server', () => {
    servers$.next([stopped, running]);
    component.serverToDelete = stopped as any;
    component.onConfirmDelete();
    expect(serverInstanceService.delete).toHaveBeenCalledWith('1');
    expect(component.serverToDelete).toBeNull();
    expect(component.showConfirmDeleteModal).toBeFalse();
  });

  it('opens and closes the add-server modal and selects a created server', () => {
    spyOn(component.selectServer, 'emit');
    component.onAddServerClick();
    expect(component.showAddModal).toBeTrue();
    component.onAddModalClosed();
    expect(component.showAddModal).toBeFalse();
    component.onServerCreated({ id: '9', name: 'New' } as any);
    expect(component.selectedServerId).toBe('9');
    expect(component.selectServer.emit).toHaveBeenCalled();
  });

  it('starts and stops all servers through the messaging channel', () => {
    spyOn(notification, 'success');
    component.startAllServers();
    expect(component.showConfirmStartAllModal).toBeTrue();
    component.onConfirmStartAll();
    expect(serverInstanceService.messaging.sendMessage).toHaveBeenCalledWith('start-all-instances', {});
    component.stopAllServers();
    component.onConfirmStopAll();
    expect(serverInstanceService.messaging.sendMessage).toHaveBeenCalledWith('stop-all-instances', {});
    expect(notification.success).toHaveBeenCalledTimes(2);
  });

  it('should unsubscribe on destroy', () => {
    const sub = { unsubscribe: jasmine.createSpy() };
    component['subs'] = [sub as any];
    component.ngOnDestroy();
    expect(sub.unsubscribe).toHaveBeenCalled();
  });
});
