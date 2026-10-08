import { ComponentFixture, TestBed, discardPeriodicTasks, fakeAsync, tick } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, NEVER, Subject, of } from 'rxjs';
import { DashboardComponent } from './dashboard.component';
import { LiveServersService } from '../../core/services/live-servers.service';
import { ServerInstanceService } from '../../core/services/server-instance.service';
import { ServerLifecycleService } from '../../core/services/server-lifecycle.service';
import { MessagingService } from '../../core/services/messaging/messaging.service';
import { ActivityService } from '../../core/services/activity.service';
import { BackupService } from '../../core/services/backup.service';
import { NotificationService } from '../../core/services/notification.service';
import { ServerNavService } from '../../core/services/server-nav.service';
import { SettingsDrawerService } from '../../core/services/settings-drawer.service';
import { AuthService } from '../../core/services/auth.service';
import { PoolDirectoryService } from '../../core/services/pool-directory.service';
import { MeshNodesService } from '../../core/services/mesh-nodes.service';
import { ServerCardComponent } from '../../components/server-card/server-card.component';
import { By } from '@angular/platform-browser';
import { MockNotificationService } from '../../../../test/mocks/mock-notification.service';

describe('DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;
  let servers$: BehaviorSubject<any[]>;
  let items$: BehaviorSubject<any[]>;
  let router: jasmine.SpyObj<Router>;
  let messaging: any;
  let lifecycle: jasmine.SpyObj<ServerLifecycleService>;
  let serverInstanceService: any;
  let liveServers: any;
  let activity: any;
  let backup: any;
  let notification: MockNotificationService;
  let settingsDrawer: jasmine.SpyObj<SettingsDrawerService>;
  let displayName$: BehaviorSubject<string>;
  /** Permissions the stubbed identity lacks; empty means an admin. */
  let denied: Set<string>;
  /** What get-mesh-status answers; standalone unless a test sets it before creating the page. */
  let meshStatus: any;
  /** Where the mesh says a server could move to. */
  let moveDestinations: Array<{ nodeId: string; name: string }>;

  const now = Date.now();
  const alpha = { id: 'a', name: 'Alpha', state: 'running', players: 4, maxPlayers: 10, startedAt: now - 3600_000, sortOrder: 0 };
  const beta = { id: 'b', name: 'Beta', state: 'stopped', players: 0, maxPlayers: 20, sortOrder: 1 };

  beforeEach(async () => {
    servers$ = new BehaviorSubject<any[]>([alpha, beta]);
    items$ = new BehaviorSubject<any[]>([]);
    meshStatus = { enabled: false };
    moveDestinations = [];
    router = jasmine.createSpyObj('Router', ['navigate']);
    router.navigate.and.returnValue(Promise.resolve(true));
    messaging = {
      sendMessage: jasmine.createSpy('sendMessage').and.callFake((channel: string) => {
        if (channel === 'get-host-resources') return of({ cpuPercent: 18, memory: { used: 13.4 * 1024 ** 3, total: 32 * 1024 ** 3 }, disk: { used: 84 * 1024 ** 3, total: 232 * 1024 ** 3 } });
        if (channel === 'get-player-history') return of({ samples: [{ t: now - 60_000, counts: { a: 4, b: 0 } }, { t: now - 120_000, counts: { a: 6 } }] });
        if (channel === 'get-mesh-status') return of(meshStatus);
        return of({ success: true });
      }),
      receiveMessage: () => of(null)
    };
    lifecycle = jasmine.createSpyObj('ServerLifecycleService', [
      'startServer', 'stopServer', 'forceStopServer', 'startAllServers', 'stopAllServers', 'runningServers', 'checkDeletable', 'deleteServer'
    ]);
    lifecycle.runningServers.and.returnValue([alpha]);
    lifecycle.checkDeletable.and.callFake(server => server.state === 'stopped');
    lifecycle.deleteServer.and.resolveTo(true);
    serverInstanceService = {
      getActiveServer: () => of(alpha),
      setActiveServer: jasmine.createSpy('setActiveServer')
    };
    liveServers = { servers$: servers$.asObservable(), reorder: jasmine.createSpy('reorder') };
    activity = { items$: items$.asObservable(), add: jasmine.createSpy('add'), clear: jasmine.createSpy('clear') };
    backup = { createBackup: jasmine.createSpy('createBackup').and.returnValue(of({ success: true })) };
    notification = new MockNotificationService();
    settingsDrawer = jasmine.createSpyObj('SettingsDrawerService', ['open', 'close', 'selectSection'], { isOpen: false });
    displayName$ = new BehaviorSubject('Admin');
    denied = new Set();
    localStorage.removeItem('cerious-aasm.dashboard');

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        { provide: Router, useValue: router },
        { provide: LiveServersService, useValue: liveServers },
        { provide: ServerInstanceService, useValue: serverInstanceService },
        { provide: ServerLifecycleService, useValue: lifecycle },
        { provide: MessagingService, useValue: messaging },
        { provide: ActivityService, useValue: activity },
        { provide: BackupService, useValue: backup },
        { provide: NotificationService, useValue: notification },
        { provide: AuthService, useValue: { displayName$: displayName$.asObservable(), can: (permission: string) => !denied.has(permission) } },
        { provide: PoolDirectoryService, useValue: { changed$: of(undefined), operatorLabel: () => 'Admin', assigneeLabel: () => 'Not assigned' } },
        { provide: ServerNavService, useValue: { rememberTab: jasmine.createSpy('rememberTab') } },
        { provide: SettingsDrawerService, useValue: settingsDrawer },
        { provide: MeshNodesService, useValue: { changed$: of(undefined), destinationsFor: () => moveDestinations, nameOf: () => '', placementChoices: () => [] } }
      ],
      schemas: [NO_ERRORS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.removeItem('cerious-aasm.dashboard');
  });

  it('should create and summarise the fleet', () => {
    expect(component).toBeTruthy();
    expect(component.summary).toEqual({ total: 2, online: 1, offline: 1, players: 4, maxPlayers: 30 });
    expect(component.statusLine).toBe('1 of 2 servers are online.');
    expect(component.userName).toBe('Admin');
  });

  it('greets whoever is signed in', () => {
    displayName$.next('Ann B');
    expect(component.userName).toBe('Ann B');
  });

  it('loads host resources and player history on init', () => {
    expect(messaging.sendMessage).toHaveBeenCalledWith('get-host-resources', {});
    expect(messaging.sendMessage).toHaveBeenCalledWith('get-player-history', {});
    expect(component.cpuLabel).toBe('18%');
    expect(Math.round(component.memoryPercent)).toBe(42);
    expect(component.diskLabel).toBe('84 GB / 232 GB');
    expect(component.playerPeak).toBe(6);
    expect(component.playerChartLine).toContain('M');
    expect(component.historyFor(alpha as any).length).toBe(48);
    expect(component.hostMemoryTotal).toBe(32 * 1024 ** 3);
  });

  it('shows only this machine\'s resources, and the cards as the page sees them, outside a mesh', () => {
    expect(component.resourceNodes).toEqual([]);
    expect(component.joinHost(alpha as any)).toBeNull();
    expect(component.hostMemoryTotalFor(alpha as any)).toBe(32 * 1024 ** 3);
  });

  describe('in a mesh', () => {
    const GB = 1024 ** 3;
    const desk = { nodeId: 'desk', name: 'Jareds-PC', host: '192.168.1.155', status: 'alive', resources: { cpuPercent: 3, memory: { used: 1 * GB, total: 32 * GB }, disk: null } };
    const box = { nodeId: 'box', name: 'b3e6', host: '10.0.0.2', status: 'alive', resources: { cpuPercent: 50, memory: { used: 8 * GB, total: 16 * GB }, disk: { used: 150 * GB, total: 1000 * GB } } };
    const gone = { nodeId: 'gone', name: 'Old', host: '10.0.0.9', status: 'removed', resources: null };
    let pageHost: string;

    function open(nodes: any[]): void {
      meshStatus = { enabled: true, nodeId: 'desk', nodes };
      // Nothing broadcast yet; the default stub's null would stand for an empty mesh-status.
      messaging.receiveMessage = () => NEVER;
      servers$.next([{ ...alpha, nodeId: 'box' }, { ...beta, nodeId: 'desk' }]);
      fixture = TestBed.createComponent(DashboardComponent);
      component = fixture.componentInstance;
      pageHost = 'localhost';
      spyOn(component as any, 'pageHostname').and.callFake(() => pageHost);
      fixture.detectChanges();
    }

    // White text meant for the artwork sat on the page background: unreadable in light theme.
    it('leaves a degraded mesh to the top bar, and shows any other mesh warning as a notice', () => {
      open([desk, box]);
      component['applyMesh']({ enabled: true, degraded: true, nodeId: 'desk', nodes: [desk, box] });
      fixture.detectChanges();
      const page = fixture.nativeElement as HTMLElement;
      expect(page.textContent).not.toContain('Mesh Degraded');
      expect(page.querySelector('.dash-mesh-warning')).toBeNull();

      component['applyMesh']({ enabled: true, nodeId: 'desk', nodes: [desk, box], warning: 'Docker 1 runs an older app version.' });
      fixture.detectChanges();

      const notice = page.querySelector('.dash-mesh-warning');
      expect(notice?.textContent).toContain('Docker 1 runs an older app version.');
      expect(notice?.classList).toContain('ark-install-notice');
    });

    it('shows the resources of every member, this machine\'s as it polls them', () => {
      open([desk, box, gone]);

      expect(component.resourceNodes.map(node => [node.name, node.local, node.cpuLabel, node.memoryLabel, node.diskLabel])).toEqual([
        ['Jareds-PC', true, '18%', '13.4 GB / 32 GB', '84 GB / 232 GB'],
        ['b3e6', false, '50%', '8 GB / 16 GB', '150 GB / 1000 GB']
      ]);
      expect(fixture.nativeElement.querySelectorAll('.dash-node-resources').length).toBe(2);
    });

    // In a mesh the card showed each machine's meters only: not whether it could be reached,
    // what it runs, or since when it has been quiet.
    describe('the Machines card', () => {
      const hour = 3600_000;
      const card = () => (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.dash-machines-card');
      const pills = () => Array.from(card()?.querySelectorAll('.dash-node-pill') || []).map(pill => pill.textContent?.trim());

      it('says of each machine whether it can be reached, how many of its servers run, and its version', () => {
        open([{ ...desk, connected: true, version: '1.2.2' }, { ...box, connected: true, version: '1.2.1' }]);

        expect(card()?.querySelector('h3')?.textContent?.trim()).toBe('Machines');
        expect(pills()).toEqual(['Connected', 'Connected']);
        expect(component.resourceNodes.map(node => node.detail)).toEqual([
          '0 of 1 server running · Version 1.2.2',
          '1 of 1 server running · Version 1.2.1'
        ]);
      });

      it('says when a machine that cannot be reached was last heard from', () => {
        open([{ ...desk, connected: true, version: '1.2.2' }, { ...box, connected: false, version: '0', resources: null, lastContactAt: Date.now() - 3 * hour }]);

        expect(pills()).toEqual(['Connected', 'Unreachable']);
        expect(component.resourceNodes[1].detail).toBe('1 of 1 server running · Last contact 3 hours ago');
      });

      it('says when a machine runs no servers', () => {
        open([{ ...desk, connected: true, version: '1.2.2' }, { ...box, connected: true, version: '1.2.2' }, { nodeId: 'spare', name: 'Spare', status: 'alive', connected: true, version: '1.2.2' }]);

        expect(component.resourceNodes[2].detail).toBe('No servers · Version 1.2.2');
      });

      it('opens Settings at the Mesh page from Manage', () => {
        open([{ ...desk, connected: true }, { ...box, connected: true }]);

        card()!.querySelector<HTMLButtonElement>('.dash-machines-manage')!.click();

        expect(settingsDrawer.open).toHaveBeenCalledWith('mesh');
      });

      it('stays System Resources, for this machine alone, outside a mesh', () => {
        expect(card()).toBeNull();
        expect((fixture.nativeElement as HTMLElement).textContent).toContain('System Resources');
      });
    });

    it('shows a member that has stopped reporting as not reporting', () => {
      open([desk, { ...box, resources: null }]);

      expect(component.resourceNodes[1]).toEqual(jasmine.objectContaining({ name: 'b3e6', reporting: false }));
    });

    it('gives a card the memory and address of the machine hosting its server', () => {
      open([desk, box]);

      expect(component.hostMemoryTotalFor({ ...alpha, nodeId: 'box' } as any)).toBe(16 * GB);
      expect(component.joinHost({ ...alpha, nodeId: 'box' } as any)).toBe('10.0.0.2');
      expect(component.joinHost({ ...beta, nodeId: 'desk' } as any)).toBe('192.168.1.155');
    });

    it('keeps the name the page was opened on for servers on this machine', () => {
      open([desk, box]);
      pageHost = 'ark.example.org';

      expect(component.joinHost({ ...beta, nodeId: 'desk' } as any)).toBeNull();
      expect(component.joinHost({ ...alpha, nodeId: 'box' } as any)).toBe('10.0.0.2');
    });
  });

  describe('moving a server', () => {
    it('lets a card offer Move when the user may move servers and another machine can take it', () => {
      moveDestinations = [{ nodeId: 'box', name: 'Basement Box' }];
      expect(component.canMoveServer(beta as any)).toBeTrue();

      denied.add('servers.move');
      expect(component.canMoveServer(beta as any)).toBeFalse();

      denied.clear();
      moveDestinations = [];
      expect(component.canMoveServer(beta as any)).toBeFalse();
    });

    it('opens the move dialog for a card\'s server, and closes it', () => {
      component.openMove(beta as any);
      fixture.detectChanges();
      expect(component.movingServer).toEqual(beta as any);
      expect(fixture.debugElement.query(By.css('app-move-server-dialog')).componentInstance.server).toEqual(beta);

      component.closeMove();

      expect(component.movingServer).toBeNull();
    });
  });

  it('filters and sorts the visible servers', () => {
    component.filter = 'online';
    component.onFilterChange();
    expect(component.visibleServers.map(s => s.id)).toEqual(['a']);

    component.filter = 'all';
    component.sort = 'name-desc';
    component.onSortChange();
    expect(component.visibleServers.map(s => s.id)).toEqual(['b', 'a']);
    expect(component.canReorder).toBeFalse();

    component.sort = 'players';
    component.onSortChange();
    expect(component.visibleServers[0].id).toBe('a');

    component.sort = 'custom';
    component.onSortChange();
    expect(component.canReorder).toBeTrue();
  });

  it('persists view preferences', () => {
    component.setView('list');
    component.filter = 'offline';
    component.onFilterChange();
    const stored = JSON.parse(localStorage.getItem('cerious-aasm.dashboard') || '{}');
    expect(stored).toEqual({ view: 'list', filter: 'offline', sort: 'custom', machine: 'all' });
  });

  // The status dropdown was the only way to narrow the list: no search, and no machine in a mesh.
  describe('searching and filtering the servers', () => {
    const island = {
      id: 'i', name: 'Island PvE', sessionName: 'Chill Island', mapName: 'TheIsland_WP', state: 'stopped', players: 0, maxPlayers: 70,
      sortOrder: 2, nodeId: 'box', operatorUserId: 'op1'
    };
    const desk = { nodeId: 'desk', name: 'Jareds-PC', status: 'alive' };
    const box = { nodeId: 'box', name: 'b3e6', status: 'alive' };
    const visible = () => component.visibleServers.map(server => server.id);
    const page = () => fixture.nativeElement as HTMLElement;

    /** The page with these servers, in a mesh of these machines (none: standalone). */
    function open(servers: any[], nodes: any[] = []): void {
      meshStatus = nodes.length ? { enabled: true, nodeId: 'desk', nodes } : { enabled: false };
      messaging.receiveMessage = () => NEVER;
      servers$.next(servers);
      fixture = TestBed.createComponent(DashboardComponent);
      component = fixture.componentInstance;
      (component.poolDirectory as any).operatorLabel = (server: any) => server?.operatorUserId === 'op1' ? 'Ops Team' : 'Admin';
      fixture.detectChanges();
    }

    function search(text: string): void {
      const input = page().querySelector<HTMLInputElement>('.dash-search')!;
      input.value = text;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }

    it('finds servers by name, session name, map, machine or operator as you type', () => {
      open([{ ...alpha, nodeId: 'box' }, { ...beta, nodeId: 'desk' }, island], [desk, box]);

      search('chill');
      expect(visible()).toEqual(['i']);
      search('the island');
      expect(visible()).toEqual(['i']);
      search('b3e6');
      expect(visible()).toEqual(['a', 'i']);
      search('ops team');
      expect(visible()).toEqual(['i']);
      search('BETA');
      expect(visible()).toEqual(['b']);
      search('');
      expect(visible()).toEqual(['a', 'b', 'i']);
    });

    it('filters by machine in a mesh, even with every server on one machine, and not outside one', () => {
      open([{ ...alpha, nodeId: 'desk' }, beta], [desk, box]);

      expect(page().querySelector('.dash-machine-filter')).not.toBeNull();
      expect(component.machineOptions.map(option => option.label)).toEqual(['All machines', 'Jareds-PC', 'b3e6']);
      component.machine = 'box';
      component.onFilterChange();
      expect(visible()).toEqual([]);
      // A server without a machine of its own is on this one.
      component.machine = 'desk';
      component.onFilterChange();
      expect(visible()).toEqual(['a', 'b']);

      open([alpha, beta]);
      expect(page().querySelector('.dash-machine-filter')).toBeNull();
    });

    it('narrows by search, status and machine together, and reorders only the whole list', () => {
      open([{ ...alpha, nodeId: 'box' }, { ...beta, nodeId: 'desk' }, island], [desk, box]);

      component.machine = 'box';
      component.onFilterChange();
      expect(visible()).toEqual(['a', 'i']);
      expect(component.canReorder).toBeFalse();
      component.filter = 'offline';
      component.onFilterChange();
      expect(visible()).toEqual(['i']);

      component.filter = 'all';
      component.machine = 'all';
      component.onFilterChange();
      expect(component.canReorder).toBeTrue();
      search('alpha');
      expect(component.canReorder).toBeFalse();
    });

    it('says when nothing matches, and clears the search and filters', async () => {
      open([alpha, beta]);
      component.filter = 'online';
      component.onFilterChange();

      search('nothing like this');
      expect(page().querySelector('.dash-empty')?.textContent).toContain('No servers match');
      page().querySelector<HTMLButtonElement>('.dash-empty-clear')!.click();
      fixture.detectChanges();
      // ngModel writes the new value into the box a microtask later. (whenStable never settles here:
      // the page polls on a timer.)
      await Promise.resolve();

      expect(visible()).toEqual(['a', 'b']);
      expect(component.searchText).toBe('');
      expect(component.filter).toBe('all');
      expect(page().querySelector<HTMLInputElement>('.dash-search')!.value).toBe('');
    });

    // At 875px, with a filter on and the machine dropdown, the search took a row to itself: it
    // asked for 220px before shrinking. (The test page is narrower, so this measures without them.)
    it('keeps the search and the filters on one row while there is room, and wraps only when there is not', () => {
      open([alpha, beta]);
      const head = page().querySelector<HTMLElement>('.dash-servers-head')!;
      const rowOf = (selector: string) => Math.round(page().querySelector<HTMLElement>(selector)!.getBoundingClientRect().top);
      const sameRow = () => Math.abs(rowOf('.dash-search') - rowOf('.dash-toolbar-filters')) < 12;

      head.style.width = '600px';
      expect(sameRow()).withContext('600px').toBeTrue();

      head.style.width = '480px';
      expect(sameRow()).withContext('480px').toBeFalse();
    });

    it('remembers the machine but not the search, and forgets a machine no longer in the mesh', () => {
      open([alpha, beta], [desk, box]);
      component.machine = 'box';
      component.onFilterChange();
      search('alpha');

      expect(JSON.parse(localStorage.getItem('cerious-aasm.dashboard') || '{}')).toEqual({ view: 'grid', filter: 'all', sort: 'custom', machine: 'box' });
      open([alpha, beta], [desk, box]);
      expect(component.machine).toBe('box');
      expect(component.searchText).toBe('');

      open([alpha, beta], [desk]);
      expect(component.machine).toBe('all');
      expect(visible()).toEqual(['a', 'b']);
    });
  });

  // With 38 servers Server Uptime was a long scrolling list of tiny bars, in the order of the list.
  describe('server uptime', () => {
    const hour = 3600_000;
    /** Twelve servers: s0 started 12 hours ago, s11 an hour ago; two more are stopped. */
    const fleet = [
      ...Array.from({ length: 12 }, (_, index) => ({ id: `s${index}`, name: `Server ${index}`, state: 'running', startedAt: now - (12 - index) * hour, sortOrder: index })),
      { id: 'x1', name: 'Stopped 1', state: 'stopped', sortOrder: 12 },
      { id: 'x2', name: 'Stopped 2', state: 'stopped', sortOrder: 13, nodeId: 'box' }
    ];
    const bars = () => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.dash-uptime-name')).map(name => name.textContent?.trim());
    const more = () => (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.dash-uptime-more');

    beforeEach(() => {
      servers$.next(fleet);
      fixture.detectChanges();
    });

    it('shows the ten longest-running servers, longest first', () => {
      expect(bars()).toEqual(Array.from({ length: 10 }, (_, index) => `Server ${index}`));
      expect(more()?.textContent?.trim()).toBe('Show all 14');
    });

    it('shows them all on request, and fewer again', () => {
      more()!.click();
      fixture.detectChanges();
      expect(bars().length).toBe(14);
      expect(bars().slice(-2)).toEqual(['Stopped 1', 'Stopped 2']);
      expect(more()?.textContent?.trim()).toBe('Show fewer');

      more()!.click();
      fixture.detectChanges();
      expect(bars().length).toBe(10);
    });

    it('follows the machine chosen for the server list', () => {
      component['applyMesh']({ enabled: true, nodeId: 'desk', nodes: [{ nodeId: 'desk', name: 'Desk' }, { nodeId: 'box', name: 'Box' }] });
      component.machine = 'box';
      component.onFilterChange();
      fixture.detectChanges();

      expect(bars()).toEqual(['Stopped 2']);
      expect(more()).toBeNull();
    });
  });

  // "Create Backup" sat among the all-servers actions, though it backs up one server.
  it('keeps the actions on every server apart from the rest, and says the backup is of one server', () => {
    const groups = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.dash-action-group'));
    const labels = (group: Element) => Array.from(group.querySelectorAll('.dash-action')).map(action => action.textContent?.replace(/^\s*\S+\s+/, '').trim());

    expect(groups.map(group => group.querySelector('.dash-action-group-title')?.textContent?.trim())).toEqual(['All servers', 'More']);
    expect(labels(groups[0])).toEqual(['Start All Servers', 'Stop All Servers']);
    expect(labels(groups[1])).toEqual(['Back Up a Server…', 'Add Server', 'Settings']);
  });

  it('reorders cards', () => {
    component.onCardDrop({ previousIndex: 0, currentIndex: 1 } as any);
    expect(liveServers.reorder).toHaveBeenCalledWith(['b', 'a']);
  });

  it('routes card actions to the lifecycle service and server pages', () => {
    component.startServer(beta as any);
    expect(lifecycle.startServer).toHaveBeenCalled();
    component.stopServer(alpha as any);
    expect(lifecycle.stopServer).toHaveBeenCalledWith(alpha);
    component.forceStopServer(alpha as any);
    expect(lifecycle.forceStopServer).toHaveBeenCalledWith(alpha);

    component.openConsole(alpha as any);
    expect(serverInstanceService.setActiveServer).toHaveBeenCalledWith(alpha);
    expect(router.navigate).toHaveBeenCalledWith(['/server', 'console']);
    component.configureServer(beta as any);
    expect(router.navigate).toHaveBeenCalledWith(['/server', 'general']);
    component.openBackups(beta as any);
    expect(router.navigate).toHaveBeenCalledWith(['/server', 'backup']);
  });

  it('asks for confirmation only for a server that may be deleted, then deletes it', async () => {
    component.requestDelete(alpha as any);
    expect(lifecycle.checkDeletable).toHaveBeenCalledWith(alpha as any);
    expect(component.serverToDelete).toBeNull();

    component.requestDelete(beta as any);
    expect(component.serverToDelete).toBe(beta as any);
    await component.confirmDelete();
    expect(lifecycle.deleteServer).toHaveBeenCalledWith(beta as any);
    // The backend records the feed; the page does not write to it.
    expect(activity.add).not.toHaveBeenCalled();
    expect(component.serverToDelete).toBeNull();
  });

  it('closes the confirmation when a delete fails', async () => {
    lifecycle.deleteServer.and.resolveTo(false);
    component.requestDelete(beta as any);
    await component.confirmDelete();
    expect(component.serverToDelete).toBeNull();
  });

  it('starts and stops all servers from the quick actions', () => {
    component.showConfirmStartAll = true;
    component.confirmStartAll();
    expect(component.showConfirmStartAll).toBeFalse();
    expect(lifecycle.startAllServers).toHaveBeenCalled();

    component.showConfirmStopAll = true;
    component.confirmStopAll();
    expect(component.showConfirmStopAll).toBeFalse();
    expect(lifecycle.stopAllServers).toHaveBeenCalled();
  });

  it('offers Stop All while any server is running or starting', () => {
    expect(component.canStopAll).toBeTrue();
    lifecycle.runningServers.and.returnValue([]);
    expect(component.canStopAll).toBeFalse();
  });

  it('creates a backup for the chosen server', () => {
    spyOn(notification, 'success');
    component.openBackupModal();
    expect(component.showBackupModal).toBeTrue();
    expect(component.backupServerId).toBe('a');
    expect(component.backupName).toMatch(/^Backup-/);
    component.backupName = 'Nightly';
    component.createBackup();
    expect(backup.createBackup).toHaveBeenCalledWith({ instanceId: 'a', type: 'manual', name: 'Nightly' });
    expect(notification.success).toHaveBeenCalled();
    expect(component.showBackupModal).toBeFalse();
  });

  it('opens the settings drawer from the quick actions', () => {
    component.goToSettings();
    expect(settingsDrawer.open).toHaveBeenCalledWith();
  });

  // An update is per machine, with warnings to its players: Settings → Mesh, or ARK Installation.
  it('has no Update ARK action of its own', () => {
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Update ARK Server');
  });

  it('builds uptime bars with the longest uptime as the tallest', () => {
    const bars = component.uptimeBars;
    expect(bars.length).toBe(2);
    expect(bars[0].percent).toBe(100);
    expect(bars[1].percent).toBe(0);
    expect(bars[1].label).toBe('0m');
  });

  // With a dozen or more servers up, the vertical bars were too thin to hold "3d 14h": the values
  // ran into each other and every name was cut to a letter.
  it('keeps each uptime and name readable with many servers up', () => {
    const names = ['The Island', 'Scorched Earth', 'The Center', 'Aberration', 'Extinction', 'Astraeos', 'Ragnarok',
      'Valguero', 'Lost Colony', 'Svartalfheim', 'Club ARK', 'Genesis', 'Fjordur', 'Crystal Isles'];
    servers$.next(names.map((name, index) => ({
      id: `s${index}`, name, state: 'running', players: 1, maxPlayers: 70,
      startedAt: now - (3 * 86400 + 14 * 3600 + index * 600) * 1000, sortOrder: index
    })));
    const card = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.dash-uptime-card')!;
    card.style.width = '360px';
    // Every row, not just the longest-running ten.
    component.toggleUptime();
    fixture.detectChanges();

    const texts = Array.from(card.querySelectorAll<HTMLElement>('.dash-uptime-value, .dash-uptime-name'));
    const cut = texts.filter(text => text.scrollWidth > text.clientWidth).map(text => text.textContent?.trim());
    const boxes = Array.from(card.querySelectorAll<HTMLElement>('.dash-uptime-value')).map(value => value.getBoundingClientRect());
    const overlapping = boxes.filter((box, index) => boxes.some((other, otherIndex) => otherIndex !== index &&
      box.left < other.right && other.left < box.right && box.top < other.bottom && other.top < box.bottom));

    expect(texts.length).toBe(names.length * 2);
    expect(cut).toEqual([]);
    expect(overlapping.length).toBe(0);
  });

  it('exposes recent activity and the full list modal', () => {
    items$.next(Array.from({ length: 8 }, (_, i) => ({ id: String(i), kind: 'info', message: `m${i}`, timestamp: now })));
    expect(component.recentActivity.length).toBe(6);
    component.openAllActivity();
    expect(component.showAllActivity).toBeTrue();
    component.closeAllActivity();
    expect(component.showAllActivity).toBeFalse();
    component.clearActivity();
    expect(activity.clear).toHaveBeenCalled();
  });

  describe('polling', () => {
    let replies: Record<string, Subject<any>[]>;
    let polled: ComponentFixture<DashboardComponent>;
    const requests = (channel: string) => (replies[channel] || []).length;

    beforeEach(() => {
      fixture.destroy();
      replies = {};
      messaging.sendMessage.and.callFake((channel: string) => {
        const reply = new Subject<any>();
        replies[channel] = [...(replies[channel] || []), reply];
        return reply;
      });
    });

    function answer(channel: string, value: unknown): void {
      const reply = replies[channel][replies[channel].length - 1];
      reply.next(value);
      reply.complete();
    }

    it('does not ask again while a request is still out', fakeAsync(() => {
      polled = TestBed.createComponent(DashboardComponent);
      polled.detectChanges();

      tick(15_000);
      expect(requests('get-host-resources')).toBe(1);

      answer('get-host-resources', { cpuPercent: 5, memory: { used: 1, total: 2 } });
      tick(5_000);
      expect(requests('get-host-resources')).toBe(2);

      tick(120_000);
      expect(requests('get-player-history')).toBe(1);

      polled.destroy();
      discardPeriodicTasks();
    }));

    it('flags host resources as unavailable on error', fakeAsync(() => {
      polled = TestBed.createComponent(DashboardComponent);
      polled.detectChanges();
      answer('get-host-resources', { error: 'nope' });
      expect(polled.componentInstance.hostResourcesError).toBeTrue();

      tick(5_000);
      replies['get-host-resources'][1].error(new Error('timeout'));
      expect(polled.componentInstance.hostResourcesError).toBeTrue();
      tick(5_000);
      expect(requests('get-host-resources')).toBe(3);

      polled.destroy();
      discardPeriodicTasks();
    }));
  });
  describe('pools and permissions', () => {
    const card = () => fixture.debugElement.query(By.directive(ServerCardComponent)).componentInstance as ServerCardComponent;
    const recheck = () => {
      (component as unknown as { cdr: { markForCheck(): void } }).cdr.markForCheck();
      fixture.detectChanges();
    };

    it('labels each card with its assignee and pool', () => {
      expect(card().assigneeLabel).toBe('Not assigned');
      expect(card().operatorLabel).toBe('Admin');
      expect(card().canConfigure).toBeTrue();
      expect(card().canDelete).toBeTrue();
    });

    it('hides what the role may not do', () => {
      denied = new Set(['servers.create', 'servers.configure', 'servers.delete']);
      recheck();

      expect(card().canConfigure).toBeFalse();
      expect(card().canDelete).toBeFalse();
      expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Add Server');
    });
  });
});
