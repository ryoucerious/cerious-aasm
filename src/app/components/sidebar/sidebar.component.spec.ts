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
import { MeshNodesService } from '../../core/services/mesh-nodes.service';
import { ServerListPreferencesService } from '../../core/services/server-list-preferences.service';
import { MockMessagingService } from '../../../../test/mocks/mock-messaging.service';
import { MockNotificationService } from '../../../../test/mocks/mock-notification.service';
import { MockGlobalConfigService } from '../../../../test/mocks/mock-global-config.service';
import { RestartsService } from '../../core/services/restarts.service';

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
  /** Mesh machine names by node id; empty outside a mesh. */
  let machineNames: Record<string, string>;
  let meshNodesChanged$: Subject<void>;
  /** This machine's node id in a mesh. */
  let localNode: string;
  /** Operator names by user id. */
  let operatorNames: Record<string, string>;

  const stopped = { id: '1', name: 'Alpha', state: 'stopped' };
  const running = { id: '2', name: 'Beta', state: 'running', players: 3 };

  let restarts: jasmine.SpyObj<RestartsService> & { changed$: unknown };

  beforeEach(async () => {
    restarts = Object.assign(jasmine.createSpyObj('RestartsService', ['restartAll', 'cancelAll', 'restartingAllAt']), { changed$: of(undefined) });
    restarts.restartingAllAt.and.returnValue(null);
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
    machineNames = {};
    meshNodesChanged$ = new Subject<void>();
    localNode = '';
    operatorNames = {};
    // The list's choices are kept in this browser; each test starts without them.
    localStorage.removeItem('aasm.sidebar.groupByOperator');
    localStorage.removeItem('aasm.sidebar.closedGroups');

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
        { provide: RestartsService, useValue: restarts },
        { provide: WebSocketService, useValue: { connected$: of(false) } },
        { provide: SettingsDrawerService, useValue: settingsDrawer },
        { provide: AuthService, useValue: { can: (permission: string) => !denied.has(permission), identity, identity$: of(identity) } },
        { provide: PoolDirectoryService, useValue: { changed$: of(undefined), operatorLabel: (server: any) => (server?.operatorUserId && operatorNames[server.operatorUserId]) || 'Admin', assigneeLabel: () => 'Not assigned' } },
        { provide: MeshNodesService, useValue: { changed$: meshNodesChanged$.asObservable(), nameOf: (id?: string) => (id && machineNames[id]) || '', placementChoices: () => [],
          isHere: (id?: string | null) => !id || id === localNode,
          machines: () => Object.entries(machineNames).map(([nodeId, name]) => ({ nodeId, name })) } }
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

  // In a mesh a server can run on any member.
  it('names the machine a server runs on, ahead of who it is assigned to', () => {
    machineNames = { desk: 'Jareds-PC', box: 'Basement Box' };
    const directory = TestBed.inject(PoolDirectoryService) as unknown as { assigneeLabel: () => string };
    directory.assigneeLabel = () => 'Server Manager · mia';

    expect(component.subtitle({ id: '1', name: 'Alpha', nodeId: 'box' } as any)).toBe('Basement Box');
    expect(component.subtitle({ id: '1', name: 'Alpha', nodeId: 'desk', managerUserId: 'm1' } as any)).toBe('Jareds-PC · Server Manager · mia');
    expect(component.subtitle({ id: '1', name: 'Alpha' } as any)).toBe('');
  });

  it('shows the machine under the server in the list', () => {
    machineNames = { box: 'Basement Box' };
    servers$.next([{ ...stopped, nodeId: 'box' }]);
    meshNodesChanged$.next();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.server-item-manager')?.textContent).toContain('Basement Box');
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

  // A tree that groups only what is really apart: the machines of a mesh, and the operators when
  // that is switched on in Settings → Servers.
  describe('the server tree', () => {
    const list = [
      { id: 'a', name: 'The Island', mapName: 'TheIsland_WP', nodeId: 'n1', operatorUserId: 'op1' },
      { id: 'b', name: 'Ragnarok', mapName: 'Ragnarok_WP', nodeId: 'n2' },
      { id: 'c', name: 'Aberration', mapName: 'Aberration_WP', nodeId: 'n2', operatorUserId: 'op1' }
    ];
    /** The rows as shown: groups as "label (count)", servers by id, indented by depth. */
    const rows = () => component.serverRows.map(row =>
      `${'  '.repeat(row.depth)}${row.kind === 'group' ? `${row.label}${row.note ? ` [${row.note}]` : ''} (${row.count})` : row.server!.id}`);
    const page = () => fixture.nativeElement as HTMLElement;

    function inMesh(): void {
      machineNames = { n1: 'PC 1', n2: 'Dallas01' };
      localNode = 'n1';
      meshNodesChanged$.next();
    }

    beforeEach(() => {
      operatorNames = { op1: 'Ops' };
      servers$.next(list);
    });

    it('is one flat list outside a mesh', () => {
      expect(rows()).toEqual(['a', 'b', 'c']);
      fixture.detectChanges();
      expect(page().querySelectorAll('.server-group').length).toBe(0);
    });

    it('puts each server under its machine in a mesh, this machine first', () => {
      inMesh();

      expect(rows()).toEqual(['PC 1 [this machine] (1)', '  a', 'Dallas01 (2)', '  b', '  c']);
      fixture.detectChanges();
      expect(Array.from(page().querySelectorAll('.server-group-name')).map(name => name.textContent?.trim())).toEqual(['PC 1', 'Dallas01']);
    });

    it('stays flat in a mesh whose servers are all on one machine, naming it under each server', () => {
      inMesh();
      servers$.next(list.map(server => ({ ...server, nodeId: 'n2' })));

      expect(rows()).toEqual(['a', 'b', 'c']);
      expect(component.subtitle(component.servers[1])).toBe('Dallas01');
    });

    it('does not repeat the machine under a server grouped beneath it', () => {
      inMesh();

      expect(component.subtitle(component.servers[1])).toBe('');
    });

    it('folds a machine away, and remembers it', () => {
      inMesh();

      component.toggleGroup('machine:n2');
      expect(rows()).toEqual(['PC 1 [this machine] (1)', '  a', 'Dallas01 (2)']);
      expect(component.serverRows.find(row => row.key === 'machine:n2')?.open).toBeFalse();

      const again = TestBed.createComponent(SidebarComponent).componentInstance;
      again.ngOnInit();
      expect(again.serverRows.find(row => row.key === 'machine:n2')?.open).toBeFalse();
      again.ngOnDestroy();
    });

    it('finds servers by name, map or machine as you type, opening the groups it finds them in', () => {
      inMesh();
      component.toggleGroup('machine:n2');

      component.onSearch('ragn');
      expect(rows()).toEqual(['Dallas01 (1)', '  b']);
      component.onSearch('island');
      expect(rows()).toEqual(['PC 1 [this machine] (1)', '  a']);
      component.onSearch('dallas');
      expect(rows()).toEqual(['Dallas01 (2)', '  b', '  c']);
    });

    it('groups by operator above the machines when that is switched on, with the admin pool last', () => {
      inMesh();
      TestBed.inject(ServerListPreferencesService).setGroupByOperator(true);

      expect(rows()).toEqual([
        'Ops (2)', '  PC 1 [this machine] (1)', '    a', '  Dallas01 (1)', '    c',
        'Admin pool (1)', '  Dallas01 (1)', '    b'
      ]);
    });

    it('groups by operator without machines outside a mesh', () => {
      TestBed.inject(ServerListPreferencesService).setGroupByOperator(true);

      expect(rows()).toEqual(['Ops (2)', '  a', '  c', 'Admin pool (1)', '  b']);
    });

    it('has no operator level when no server has an operator', () => {
      servers$.next(list.map(server => ({ ...server, operatorUserId: undefined })));
      TestBed.inject(ServerListPreferencesService).setGroupByOperator(true);

      expect(rows()).toEqual(['a', 'b', 'c']);
    });

    it('offers no machine dropdown or operator box of its own', () => {
      inMesh();
      fixture.detectChanges();

      expect(page().querySelector('.server-list-tools select')).toBeNull();
      expect(page().querySelector('.server-list-tools input[type="checkbox"]')).toBeNull();
    });

    // A search box over a short list is clutter; it comes in at ten servers.
    describe('searching', () => {
      const many = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `s${index}`, name: `Server ${index}`, mapName: 'TheIsland_WP' }));
      const box = () => page().querySelector('.server-search');

      it('is offered from ten servers', () => {
        servers$.next(many(9));
        fixture.detectChanges();
        expect(box()).toBeNull();

        servers$.next(many(10));
        fixture.detectChanges();
        expect(box()).not.toBeNull();
      });

      // With 38 servers the list pushed the server's own pages far down; a scrolling list inside a
      // scrolling sidebar then gave two scrollbars. Each part scrolls on its own instead.
      it('scrolls the server list and the server\'s pages each on their own, not the whole sidebar', () => {
        const host = page();
        host.style.display = 'block';
        host.style.height = '600px';
        servers$.next(many(30));
        fixture.detectChanges();

        const body = host.querySelector<HTMLElement>('.sidenav-body')!;
        const list = host.querySelector<HTMLElement>('.server-list')!;
        const pages = host.querySelector<HTMLElement>('.sidenav-pages')!;
        expect(['auto', 'scroll']).not.toContain(getComputedStyle(body).overflowY);
        expect(getComputedStyle(list).overflowY).toBe('auto');
        expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
        expect(getComputedStyle(pages).overflowY).toBe('auto');
        // The list has at most half; the server's pages keep the rest.
        expect(host.querySelector<HTMLElement>('.sidenav-servers')!.offsetHeight).toBeLessThanOrEqual(body.clientHeight / 2 + 1);
        expect(pages.offsetHeight).toBeGreaterThan(100);
      });

      // The selected server's name scrolled away with its pages.
      it('keeps the selected server\'s name in place while its pages scroll', () => {
        const host = page();
        host.style.display = 'block';
        host.style.height = '420px';
        servers$.next(many(30));
        fixture.detectChanges();

        const pages = host.querySelector<HTMLElement>('.sidenav-pages')!;
        const name = () => pages.querySelector<HTMLElement>('.nav-section-header')!.getBoundingClientRect().top;
        expect(pages.scrollHeight).withContext('the pages need to scroll for this').toBeGreaterThan(pages.clientHeight);
        const before = name();

        pages.scrollTop = 60;

        expect(pages.scrollTop).toBeGreaterThan(0);
        expect(name()).toBeCloseTo(before, 0);
      });

      it('lets go of a search once the list is too short for the box', () => {
        servers$.next(many(10));
        component.onSearch('Server 3');
        expect(rows()).toEqual(['s3']);

        servers$.next(many(9));

        expect(component.searchText).toBe('');
        expect(rows().length).toBe(9);
      });
    });

    it('reorders only a flat list that is not being searched', () => {
      expect(component.reorderable).toBeTrue();
      component.onSearch('ragn');
      expect(component.reorderable).toBeFalse();
      component.onSearch('');
      inMesh();
      expect(component.reorderable).toBeFalse();
    });
  });

  it('does not rename a server whose machine cannot be reached', () => {
    const unreachable = { id: '9', name: 'Far', state: 'unreachable' };
    servers$.next([unreachable]);

    component.onServerNameDoubleClick(unreachable as any, { stopPropagation: () => {} } as any);

    expect(component.editingServerId).toBeNull();
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

  // Catches mod updates, which ARK fetches as a server starts.
  describe('restarting every server', () => {
    const restartAll = () => fixture.nativeElement.querySelector('button[title="Restart all servers"]') as HTMLButtonElement;

    it('is offered only while a server is running', () => {
      servers$.next([stopped]);
      fixture.detectChanges();
      expect(restartAll().disabled).toBeTrue();

      servers$.next([stopped, running]);
      fixture.detectChanges();
      expect(restartAll().disabled).toBeFalse();
    });

    it('asks first, then restarts every server after the warning, or now', () => {
      component.restartAllServers();
      expect(component.showConfirmRestartAllModal).toBeTrue();
      expect(component.restartAllWarningMinutes).toBe(15);

      component.onConfirmRestartAll(true);
      expect(restarts.restartAll).toHaveBeenCalledWith(15);
      expect(component.showConfirmRestartAllModal).toBeFalse();

      component.restartAllServers();
      component.onConfirmRestartAll(false);
      expect(restarts.restartAll).toHaveBeenCalledWith(0);
    });

    it('shows it counting down, with a way to cancel it', () => {
      restarts.restartingAllAt.and.returnValue(Date.now() + 12 * 60_000 - 1_000);
      fixture.detectChanges();
      const pending = fixture.nativeElement.querySelector('.restart-all-pending') as HTMLElement;

      expect(pending.textContent?.replace(/\s+/g, ' ')).toContain('Restarting all in 12 min');
      (pending.querySelector('button') as HTMLButtonElement).click();
      expect(restarts.cancelAll).toHaveBeenCalled();
    });
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
