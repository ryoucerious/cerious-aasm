import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { DashboardComponent } from './dashboard.component';
import { LiveServersService } from '../../core/services/live-servers.service';
import { ServerInstanceService } from '../../core/services/server-instance.service';
import { ServerLifecycleService } from '../../core/services/server-lifecycle.service';
import { MessagingService } from '../../core/services/messaging/messaging.service';
import { ActivityService } from '../../core/services/activity.service';
import { BackupService } from '../../core/services/backup.service';
import { NotificationService } from '../../core/services/notification.service';
import { GlobalConfigService } from '../../core/services/global-config.service';
import { ServerNavService } from '../../core/services/server-nav.service';
import { SettingsDrawerService } from '../../core/services/settings-drawer.service';
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

  const now = Date.now();
  const alpha = { id: 'a', name: 'Alpha', state: 'running', players: 4, maxPlayers: 10, startedAt: now - 3600_000, sortOrder: 0 };
  const beta = { id: 'b', name: 'Beta', state: 'stopped', players: 0, maxPlayers: 20, sortOrder: 1 };

  beforeEach(async () => {
    servers$ = new BehaviorSubject<any[]>([alpha, beta]);
    items$ = new BehaviorSubject<any[]>([]);
    router = jasmine.createSpyObj('Router', ['navigate']);
    router.navigate.and.returnValue(Promise.resolve(true));
    messaging = {
      sendMessage: jasmine.createSpy('sendMessage').and.callFake((channel: string) => {
        if (channel === 'get-host-resources') return of({ cpuPercent: 18, memory: { used: 13.4 * 1024 ** 3, total: 32 * 1024 ** 3 }, disk: { used: 84 * 1024 ** 3, total: 232 * 1024 ** 3 } });
        if (channel === 'get-player-history') return of({ samples: [{ t: now - 60_000, counts: { a: 4, b: 0 } }, { t: now - 120_000, counts: { a: 6 } }] });
        return of({ success: true });
      }),
      receiveMessage: () => of(null)
    };
    lifecycle = jasmine.createSpyObj('ServerLifecycleService', ['startServer', 'stopServer', 'forceStopServer']);
    serverInstanceService = {
      getActiveServer: () => of(alpha),
      setActiveServer: jasmine.createSpy('setActiveServer'),
      delete: jasmine.createSpy('delete').and.returnValue(of({})),
      reorderServers: jasmine.createSpy('reorderServers').and.returnValue(of({}))
    };
    liveServers = { servers$: servers$.asObservable(), applyOrder: jasmine.createSpy('applyOrder') };
    activity = { items$: items$.asObservable(), add: jasmine.createSpy('add'), clear: jasmine.createSpy('clear') };
    backup = { createBackup: jasmine.createSpy('createBackup').and.returnValue(of({ success: true })) };
    notification = new MockNotificationService();
    settingsDrawer = jasmine.createSpyObj('SettingsDrawerService', ['open', 'close', 'selectSection'], { isOpen: false });
    localStorage.removeItem('cerious-aasm.dashboard');

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: { fragment: of(null) } },
        { provide: LiveServersService, useValue: liveServers },
        { provide: ServerInstanceService, useValue: serverInstanceService },
        { provide: ServerLifecycleService, useValue: lifecycle },
        { provide: MessagingService, useValue: messaging },
        { provide: ActivityService, useValue: activity },
        { provide: BackupService, useValue: backup },
        { provide: NotificationService, useValue: notification },
        { provide: GlobalConfigService, useValue: { loadConfig: () => Promise.resolve({ authenticationEnabled: false }) } },
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

  it('reorders cards and persists the order', () => {
    component.onCardDrop({ previousIndex: 0, currentIndex: 1 } as any);
    expect(liveServers.applyOrder).toHaveBeenCalledWith(['b', 'a']);
    expect(serverInstanceService.reorderServers).toHaveBeenCalledWith(['b', 'a']);
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

  it('guards deletion and deletes stopped servers after confirmation', () => {
    spyOn(notification, 'warning');
    component.requestDelete(alpha as any);
    expect(notification.warning).toHaveBeenCalled();
    expect(component.serverToDelete).toBeNull();

    component.requestDelete(beta as any);
    expect(component.serverToDelete).toBe(beta as any);
    component.confirmDelete();
    expect(serverInstanceService.delete).toHaveBeenCalledWith('b');
    // The feed is recorded by the backend now, so the page does not write to it.
    expect(activity.add).not.toHaveBeenCalled();
    expect(component.serverToDelete).toBeNull();
  });

  it('starts and stops all servers from the quick actions', () => {
    spyOn(notification, 'success');
    component.confirmStartAll();
    expect(messaging.sendMessage).toHaveBeenCalledWith('start-all-instances', {});
    component.confirmStopAll();
    expect(messaging.sendMessage).toHaveBeenCalledWith('stop-all-instances', {});
    expect(notification.success).toHaveBeenCalledTimes(2);
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

  it('flags host resources as unavailable on error', () => {
    messaging.sendMessage.and.returnValue(of({ error: 'nope' }));
    component.loadHostResources();
    expect(component.hostResourcesError).toBeTrue();
  });
});
