import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { LiveServersService } from './live-servers.service';
import { ServerInstanceService } from './server-instance.service';
import { MessagingService } from './messaging/messaging.service';

describe('LiveServersService', () => {
  let service: LiveServersService;
  let instances$: Subject<any[]>;
  let channels: Record<string, Subject<any>>;

  beforeEach(() => {
    instances$ = new Subject<any[]>();
    channels = {};
    const messaging = {
      receiveMessage: (channel: string) => {
        channels[channel] = channels[channel] || new Subject<any>();
        return channels[channel].asObservable();
      },
      sendMessage: () => new Subject<any>().asObservable()
    };
    TestBed.configureTestingModule({
      providers: [
        LiveServersService,
        { provide: ServerInstanceService, useValue: { getInstances: () => instances$.asObservable() } },
        { provide: MessagingService, useValue: messaging }
      ]
    });
    service = TestBed.inject(LiveServersService);
  });

  it('sorts instances by sortOrder and normalises state', () => {
    instances$.next([
      { id: 'b', name: 'B', sortOrder: 2, state: 'Running' },
      { id: 'a', name: 'A', sortOrder: 1, state: undefined }
    ]);
    expect(service.servers.map(s => s.id)).toEqual(['a', 'b']);
    expect(service.servers[0].state).toBe('stopped');
    expect(service.servers[1].state).toBe('running');
  });

  it('applies live state, player, memory and cpu updates', () => {
    instances$.next([{ id: 'a', name: 'A', state: 'stopped', maxPlayers: 10 }]);
    channels['server-instance-state'].next({ instanceId: 'a', state: 'running' });
    expect(service.find('a')?.state).toBe('running');
    expect(service.find('a')?.startedAt).toBeGreaterThan(0);

    channels['server-instance-players'].next({ instanceId: 'a', players: 4 });
    channels['server-instance-memory'].next({ instanceId: 'a', memory: 2048 });
    channels['server-instance-cpu'].next({ instanceId: 'a', cpu: 12.5 });
    expect(service.find('a')).toEqual(jasmine.objectContaining({ players: 4, memory: 2048, cpu: 12.5 }));

    channels['server-instance-state'].next({ instanceId: 'a', state: 'stopped' });
    expect(service.find('a')).toEqual(jasmine.objectContaining({ state: 'stopped', players: 0, cpu: null, startedAt: null }));
  });

  it('accepts the legacy count field for player updates', () => {
    instances$.next([{ id: 'a', name: 'A', state: 'running' }]);
    channels['server-instance-players'].next({ instanceId: 'a', count: 7 });
    expect(service.find('a')?.players).toBe(7);
  });

  it('ignores events for unknown instances', () => {
    instances$.next([{ id: 'a', name: 'A', state: 'stopped' }]);
    channels['server-instance-players'].next({ instanceId: 'zzz', players: 4 });
    expect(service.servers.length).toBe(1);
    expect(service.find('a')?.players).toBe(0);
  });

  it('keeps live cpu and uptime across a list refresh that omits them', () => {
    instances$.next([{ id: 'a', name: 'A', state: 'running', startedAt: 100, cpu: 5 }]);
    instances$.next([{ id: 'a', name: 'A', state: 'running' }]);
    expect(service.find('a')?.cpu).toBe(5);
    expect(service.find('a')?.startedAt).toBe(100);
  });

  it('merges configuration updates without touching state', () => {
    instances$.next([{ id: 'a', name: 'A', state: 'running' }]);
    channels['server-instance-updated'].next({ id: 'a', name: 'Renamed', state: 'stopped' });
    expect(service.find('a')?.name).toBe('Renamed');
    expect(service.find('a')?.state).toBe('running');
  });

  it('summarises the fleet', () => {
    const summary = LiveServersService.summarise([
      { id: 'a', name: 'A', state: 'running', players: 3, maxPlayers: 10 },
      { id: 'b', name: 'B', state: 'stopped', players: 9, maxPlayers: 20 }
    ] as any);
    expect(summary).toEqual({ total: 2, online: 1, offline: 1, players: 3, maxPlayers: 30 });
  });

  it('applies a local reorder immediately', () => {
    instances$.next([{ id: 'a', name: 'A', sortOrder: 0 }, { id: 'b', name: 'B', sortOrder: 1 }, { id: 'c', name: 'C', sortOrder: 2 }]);
    service.applyOrder(['c', 'a']);
    expect(service.servers.map(s => s.id)).toEqual(['c', 'a', 'b']);
    expect(service.servers[0].sortOrder).toBe(0);
  });

  it('exposes state helpers', () => {
    expect(LiveServersService.isOnline({ state: 'RUNNING' } as any)).toBeTrue();
    expect(LiveServersService.isBusy({ state: 'starting' } as any)).toBeTrue();
    expect(LiveServersService.isBusy({ state: 'stopped' } as any)).toBeFalse();
    expect(LiveServersService.canStart({ state: 'crashed' } as any)).toBeTrue();
    expect(LiveServersService.canStart({ state: 'stopping' } as any)).toBeFalse();
    expect(LiveServersService.normalizeState('unknown')).toBe('stopped');
  });
});
