import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, NavigationEnd } from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
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
import { AppUpdateService } from '../../core/services/app-update.service';
import { WebSocketService } from '../../core/services/web-socket.service';
import { ServerLifecycleService } from '../../core/services/server-lifecycle.service';
import { AuthService } from '../../core/services/auth.service';
import { PoolDirectoryService } from '../../core/services/pool-directory.service';
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
  /** Permissions the stubbed identity lacks; empty means an admin. */
  let denied: Set<string>;
  let identity: { isAdmin: boolean };

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
      find: (id: string) => servers$.value.find(server => server.id === id),
      reorder: jasmine.createSpy('reorder')
    };
    serverInstanceService = {
      getActiveServer: () => activeServer$.asObservable(),
      setActiveServer: jasmine.createSpy('setActiveServer').and.callFake((s: any) => activeServer$.next(s)),
      save: jasmine.createSpy('save').and.returnValue(of({ success: true })),
      delete: jasmine.createSpy('delete').and.returnValue(of({ success: true })),
      getDefaultInstanceFromMeta: () => of({}),
      importServerFromBackup: () => of({})
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
    denied = new Set();
    identity = { isAdmin: false };

    await TestBed.configureTestingModule({
      imports: [SidebarComponent, HttpClientTestingModule],
      providers: [
        { provide: Router, useValue: router },
        { provide: MessagingService, useClass: MockMessagingService },
        { provide: ServerInstanceService, useValue: serverInstanceService },
        { provide: LiveServersService, useValue: liveServers },
        { provide: ServerNavService, useValue: serverNav },
        { provide: TOAST_CONFIG, useValue: { iconClasses: {} } },
        { provide: ToastrService, useValue: { success: () => {}, error: () => {}, info: () => {}, warning: () => {} } },
        { provide: NotificationService, useValue: notification },
        { provide: GlobalConfigService, useClass: MockGlobalConfigService },
        { provide: WebSocketService, useValue: { connected$: of(false) } },
        { provide: SettingsDrawerService, useValue: settingsDrawer },
        { provide: AuthService, useValue: { can: (permission: string) => !denied.has(permission), identity, identity$: of(identity) } },
        { provide: PoolDirectoryService, useValue: { changed$: of(undefined), operatorLabel: () => 'Admin', assigneeLabel: () => 'Not assigned' } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(SidebarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('labels a row with the assignee, and with the operator for an admin', () => {
    const directory = TestBed.inject(PoolDirectoryService) as unknown as {
      operatorLabel: () => string;
      assigneeLabel: () => string;
    };
    directory.operatorLabel = () => 'Ops';
    directory.assigneeLabel = () => 'Server Manager · mia';
    const server = { id: '1', name: 'Alpha', operatorUserId: 'op1', managerUserId: 'm1' } as any;

    expect(component.listLabel(server)).toBe('Server Manager · mia');
    identity.isAdmin = true;
    expect(component.listLabel(server)).toBe('Ops · Server Manager · mia');
  });

  it('leaves the subtitle blank when a server has no operator or assignee', () => {
    expect(component.listLabel({ id: '1', name: 'Alpha', gamePort: 7777, multiHome: '203.0.113.5' } as any)).toBe('');
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

  it('downloads an app update from the version icon without opening settings', () => {
    const appUpdate = TestBed.inject(AppUpdateService);
    spyOn(appUpdate, 'download');
    (component as any).appUpdateExplain = false;
    (component as any).appUpdateState = 'available';
    component.onAppUpdateClick();
    expect(appUpdate.download).toHaveBeenCalled();
    expect(settingsDrawer.open).not.toHaveBeenCalled();
    expect(component.showUpdateHelp).toBeFalse();
  });

  it('explains how to update in the browser instead of installing', () => {
    const appUpdate = TestBed.inject(AppUpdateService);
    spyOn(appUpdate, 'download');
    spyOn(appUpdate, 'install');
    (component as any).appUpdateExplain = true;
    (component as any).appUpdateInstructions = 'docker compose pull';
    (component as any).appUpdateState = 'available';
    component.onAppUpdateClick();
    expect(component.showUpdateHelp).toBeTrue();
    expect(component.updateHelpText).toBe('docker compose pull');
    expect(appUpdate.download).not.toHaveBeenCalled();
    expect(appUpdate.install).not.toHaveBeenCalled();
    expect(settingsDrawer.open).not.toHaveBeenCalled();
  });

  it('installs an app update that has already been downloaded', () => {
    const appUpdate = TestBed.inject(AppUpdateService);
    spyOn(appUpdate, 'install');
    (component as any).appUpdateExplain = false;
    (component as any).appUpdateState = 'downloaded';
    component.onAppUpdateClick();
    expect(appUpdate.install).toHaveBeenCalled();
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

  it('reports a rename that failed and leaves the name as it was', () => {
    spyOn(notification, 'error');
    spyOn(console, 'error');
    serverInstanceService.save.and.returnValue(throwError(() => new Error('timeout')));
    component.editingServerId = '1';
    component.editingServerName = 'Renamed';
    component.onServerNameKeydown({ key: 'Enter' } as any, stopped as any);
    expect(notification.error).toHaveBeenCalled();
    expect(component.editingServerId).toBeNull();
  });

  it('ends the rename on an empty reply', () => {
    serverInstanceService.save.and.returnValue(of(null));
    component.editingServerId = '1';
    component.editingServerName = 'Renamed';
    component.onServerNameKeydown({ key: 'Enter' } as any, stopped as any);
    expect(component.editingServerId).toBeNull();
  });

  it('saves only the settings of a renamed server', () => {
    component.editingServerId = '2';
    component.editingServerName = 'Renamed';
    component.onServerNameKeydown({ key: 'Enter' } as any, running as any);
    const saved = serverInstanceService.save.calls.mostRecent().args[0];
    expect(saved).toEqual({ id: '2', name: 'Renamed' });
  });

  it('does not save an empty or unchanged server name', () => {
    component.editingServerName = '';
    component.onServerNameBlur(stopped as any);
    component.editingServerName = 'Alpha';
    component.onServerNameBlur(stopped as any);
    expect(serverInstanceService.save).not.toHaveBeenCalled();
  });

  it('reorders servers, including for an admin', () => {
    identity.isAdmin = true;
    servers$.next([stopped, running]);
    component.onDrop({ previousIndex: 0, currentIndex: 1 } as any);
    expect(liveServers.reorder).toHaveBeenCalledWith(['2', '1']);
  });

  it('keeps the saved order instead of grouping an admin by pool', () => {
    identity.isAdmin = true;
    servers$.next([
      { id: '1', name: 'Zulu', sortOrder: 0 },
      { id: '2', name: 'Alpha', sortOrder: 1, operatorUserId: 'bob' }
    ]);
    expect(component.servers.map(server => server.id)).toEqual(['1', '2']);
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
    servers$.next([stopped, running]);
    component.onDeleteServer(running as any, { stopPropagation: () => {} } as any);
    expect(notification.warning).toHaveBeenCalled();
    expect(component.showConfirmDeleteModal).toBeFalse();
  });

  it('should show confirm delete modal if server is stopped', () => {
    servers$.next([stopped, running]);
    component.onDeleteServer(stopped as any, { stopPropagation: () => {} } as any);
    expect(component.serverToDelete).toBe(stopped as any);
    expect(component.showConfirmDeleteModal).toBeTrue();
  });

  it('should not confirm delete if only one server', async () => {
    servers$.next([stopped]);
    component.serverToDelete = stopped as any;
    await component.onConfirmDelete();
    expect(serverInstanceService.delete).not.toHaveBeenCalled();
    expect(component.serverToDelete).toBeNull();
  });

  it('should confirm delete if server stopped and more than one server', async () => {
    servers$.next([stopped, running]);
    component.serverToDelete = stopped as any;
    await component.onConfirmDelete();
    expect(serverInstanceService.delete).toHaveBeenCalledWith('1');
    expect(component.serverToDelete).toBeNull();
    expect(component.showConfirmDeleteModal).toBeFalse();
  });

  it('closes the confirmation and reports a delete that failed', async () => {
    spyOn(notification, 'error');
    spyOn(console, 'error');
    serverInstanceService.delete.and.returnValue(throwError(() => new Error('timeout')));
    servers$.next([stopped, running]);
    component.serverToDelete = stopped as any;
    component.showConfirmDeleteModal = true;
    await component.onConfirmDelete();
    expect(notification.error).toHaveBeenCalled();
    expect(component.showConfirmDeleteModal).toBeFalse();
    expect(component.selectedServerId).toBe('1');
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

  it('offers Stop All only while a server is running or starting', () => {
    const stopAll = () => fixture.nativeElement.querySelector('button[title="Stop all servers"]') as HTMLButtonElement;
    servers$.next([stopped, { ...running, state: 'crashed' }]);
    fixture.detectChanges();
    expect(stopAll().disabled).toBeTrue();

    servers$.next([stopped, { ...running, state: 'starting' }]);
    fixture.detectChanges();
    expect(stopAll().disabled).toBeFalse();
  });

  it('starts and stops all servers once confirmed', () => {
    const lifecycle = TestBed.inject(ServerLifecycleService);
    spyOn(lifecycle, 'startAllServers');
    spyOn(lifecycle, 'stopAllServers');

    component.startAllServers();
    expect(component.showConfirmStartAllModal).toBeTrue();
    expect(lifecycle.startAllServers).not.toHaveBeenCalled();
    component.onConfirmStartAll();
    expect(component.showConfirmStartAllModal).toBeFalse();
    expect(lifecycle.startAllServers).toHaveBeenCalled();

    component.stopAllServers();
    component.onConfirmStopAll();
    expect(component.showConfirmStopAllModal).toBeFalse();
    expect(lifecycle.stopAllServers).toHaveBeenCalled();
  });

  it('should unsubscribe on destroy', () => {
    const sub = { unsubscribe: jasmine.createSpy() };
    component['subs'] = [sub as any];
    component.ngOnDestroy();
    expect(sub.unsubscribe).toHaveBeenCalled();
  });
  describe('permissions', () => {
    const recheck = () => {
      (component as unknown as { cdr: { markForCheck(): void } }).cdr.markForCheck();
      fixture.detectChanges();
    };

    it('offers adding, renaming and deleting to an admin', () => {
      servers$.next([stopped, running]);
      recheck();
      const el: HTMLElement = fixture.nativeElement;

      expect(el.querySelector('button[title="Add server"]')).not.toBeNull();
      expect(el.querySelector('.delete-server-btn')).not.toBeNull();
      component.onServerNameDoubleClick(stopped as never, new Event('dblclick'));
      expect(component.editingServerId).toBe('1');
    });

    it('hides adding, renaming and deleting when the role lacks them', () => {
      denied = new Set(['servers.create', 'servers.delete', 'servers.configure']);
      servers$.next([stopped, running]);
      recheck();
      const el: HTMLElement = fixture.nativeElement;

      expect(el.querySelector('button[title="Add server"]')).toBeNull();
      expect(el.querySelector('.delete-server-btn')).toBeNull();
      component.onServerNameDoubleClick(stopped as never, new Event('dblclick'));
      expect(component.editingServerId).toBeNull();
    });
  });
});
