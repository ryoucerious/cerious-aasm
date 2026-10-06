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

  const now = Date.now();
  const alpha = { id: 'a', name: 'Alpha', state: 'running', players: 4, maxPlayers: 10, startedAt: now - 3600_000, sortOrder: 0 };
  const beta = { id: 'b', name: 'Beta', state: 'stopped', players: 0, maxPlayers: 20, sortOrder: 1 };

  beforeEach(async () => {
    servers$ = new BehaviorSubject<any[]>([alpha, beta]);
    items$ = new BehaviorSubject<any[]>([]);
    meshStatus = { enabled: false };
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
        { provide: SettingsDrawerService, useValue: settingsDrawer }
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

    it('shows the resources of every member, this machine\'s as it polls them', () => {
      open([desk, box, gone]);

      expect(component.resourceNodes.map(node => [node.name, node.local, node.cpuLabel, node.memoryLabel, node.diskLabel])).toEqual([
        ['Jareds-PC', true, '18%', '13.4 GB / 32 GB', '84 GB / 232 GB'],
        ['b3e6', false, '50%', '8 GB / 16 GB', '150 GB / 1000 GB']
      ]);
      expect(fixture.nativeElement.querySelectorAll('.dash-node-resources').length).toBe(2);
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
    expect(stored).toEqual({ view: 'list', filter: 'offline', sort: 'custom' });
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
    component.goToServerInstall();
    expect(settingsDrawer.open).toHaveBeenCalledWith('server-installation');
    component.goToSettings();
    expect(settingsDrawer.open).toHaveBeenCalledWith();
  });

  it('builds uptime bars with the longest uptime as the tallest', () => {
    const bars = component.uptimeBars;
    expect(bars.length).toBe(2);
    expect(bars[0].percent).toBe(100);
    expect(bars[1].percent).toBe(0);
    expect(bars[1].label).toBe('0m');
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
