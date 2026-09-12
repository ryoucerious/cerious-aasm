import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { map } from 'rxjs/operators';
import { ServerInstance } from '../models/server-instance.model';
import { ServerInstanceService } from './server-instance.service';
import { MessagingService } from './messaging/messaging.service';

/** Roll-up numbers for the dashboard's stat tiles. */
export interface ServerSummary {
  total: number;
  online: number;
  offline: number;
  players: number;
  maxPlayers: number;
}

/**
 * One always-current list of servers with their live runtime fields merged in.
 *
 * The backend broadcasts the full instance list only on meaningful state changes; in between
 * it streams per-instance events (state, players, memory, cpu). Every screen that shows more
 * than one server at a time — sidebar, dashboard, top bar — needs the same merge, so it lives
 * here once instead of being re-implemented per component. State is kept in the backend's
 * lowercase form ('running', 'stopped', ...); use {@link isOnline} / {@link isBusy} rather
 * than comparing strings.
 */
@Injectable({ providedIn: 'root' })
export class LiveServersService implements OnDestroy {
  private readonly serversSubject = new BehaviorSubject<ServerInstance[]>([]);
  private readonly subs: Subscription[] = [];

  constructor(
    private serverInstanceService: ServerInstanceService,
    private messaging: MessagingService
  ) {
    this.subs.push(
      this.serverInstanceService.getInstances().subscribe(instances => {
        const list = Array.isArray(instances) ? instances : [];
        this.serversSubject.next(this.sort(list.map(instance => this.mergeWithExisting(instance))));
      })
    );

    this.subs.push(
      this.messaging.receiveMessage<any>('server-instance-state').subscribe(msg => {
        if (msg?.instanceId && msg.state) {
          this.patch(msg.instanceId, server => {
            const state = String(msg.state).toLowerCase();
            const next: Partial<ServerInstance> = { state };
            if (state === 'running' && !server.startedAt) next.startedAt = Date.now();
            if (state !== 'running') {
              next.cpu = null;
              next.startedAt = null;
              if (state === 'stopped' || state === 'crashed' || state === 'error') next.players = 0;
            }
            return next;
          });
        }
      })
    );

    this.subs.push(
      this.messaging.receiveMessage<any>('server-instance-players').subscribe(msg => {
        const players = typeof msg?.players === 'number' ? msg.players : (typeof msg?.count === 'number' ? msg.count : null);
        if (msg?.instanceId && players !== null) {
          this.patch(msg.instanceId, () => ({ players }));
        }
      })
    );

    this.subs.push(
      this.messaging.receiveMessage<any>('server-instance-memory').subscribe(msg => {
        if (msg?.instanceId && typeof msg.memory === 'number') {
          this.patch(msg.instanceId, () => ({ memory: msg.memory }));
        }
      })
    );

    this.subs.push(
      this.messaging.receiveMessage<any>('server-instance-cpu').subscribe(msg => {
        if (msg?.instanceId && typeof msg.cpu === 'number') {
          this.patch(msg.instanceId, () => ({ cpu: msg.cpu }));
        }
      })
    );

    this.subs.push(
      this.messaging.receiveMessage<any>('server-instance-updated').subscribe(msg => {
        if (msg?.id) {
          // Configuration edits from any client. State is owned by the state channel.
          const { state, ...rest } = msg;
          this.patch(msg.id, () => rest);
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach(sub => sub?.unsubscribe?.());
  }

  /** Current list, sorted by the user's sidebar order. */
  get servers(): ServerInstance[] {
    return this.serversSubject.value;
  }

  get servers$(): Observable<ServerInstance[]> {
    return this.serversSubject.asObservable();
  }

  get summary$(): Observable<ServerSummary> {
    return this.servers$.pipe(map(servers => LiveServersService.summarise(servers)));
  }

  find(id: string | null | undefined): ServerInstance | undefined {
    return id ? this.servers.find(server => server.id === id) : undefined;
  }

  /** Apply a local reorder immediately so the UI does not wait for the backend echo. */
  applyOrder(orderedIds: string[]): void {
    const byId = new Map(this.servers.map(server => [server.id, server]));
    const reordered: ServerInstance[] = [];
    orderedIds.forEach((id, index) => {
      const server = byId.get(id);
      if (server) reordered.push({ ...server, sortOrder: index });
    });
    const missing = this.servers.filter(server => !orderedIds.includes(server.id));
    this.serversSubject.next([...reordered, ...missing]);
  }

  static summarise(servers: ServerInstance[]): ServerSummary {
    const online = servers.filter(server => LiveServersService.isOnline(server));
    return {
      total: servers.length,
      online: online.length,
      offline: servers.length - online.length,
      players: online.reduce((sum, server) => sum + (server.players || 0), 0),
      maxPlayers: servers.reduce((sum, server) => sum + (server.maxPlayers || 0), 0)
    };
  }

  static normalizeState(state: string | null | undefined): string {
    const value = (state || '').toLowerCase();
    return value === '' || value === 'unknown' ? 'stopped' : value;
  }

  static isOnline(server: ServerInstance | null | undefined): boolean {
    return LiveServersService.normalizeState(server?.state) === 'running';
  }

  /** Anything in flight: starting, stopping, queued, or running. Edits are blocked here. */
  static isBusy(server: ServerInstance | null | undefined): boolean {
    const state = LiveServersService.normalizeState(server?.state);
    return state === 'queued' || state === 'starting' || state === 'running' || state === 'stopping';
  }

  static canStart(server: ServerInstance | null | undefined): boolean {
    const state = LiveServersService.normalizeState(server?.state);
    return state === 'stopped' || state === 'error' || state === 'crashed';
  }

  private patch(id: string, update: (server: ServerInstance) => Partial<ServerInstance>): void {
    const current = this.servers;
    const index = current.findIndex(server => server.id === id);
    if (index === -1) return;
    const next = current.slice();
    next[index] = { ...current[index], ...update(current[index]) };
    this.serversSubject.next(next);
  }

  /** Keep live-only fields the fresh list does not carry (a list refresh omits CPU between polls). */
  private mergeWithExisting(instance: ServerInstance): ServerInstance {
    const existing = this.find(instance.id);
    const state = LiveServersService.normalizeState(instance.state);
    return {
      ...existing,
      ...instance,
      state,
      cpu: instance.cpu ?? (state === 'running' ? existing?.cpu ?? null : null),
      startedAt: instance.startedAt ?? (state === 'running' ? existing?.startedAt ?? null : null),
      players: typeof instance.players === 'number' ? instance.players : (existing?.players ?? 0)
    };
  }

  private sort(servers: ServerInstance[]): ServerInstance[] {
    return servers.slice().sort((a, b) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity));
  }
}
