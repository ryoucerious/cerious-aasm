import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, ReplaySubject, Subscription, of } from 'rxjs';
import { filter, map, switchMap } from 'rxjs/operators';
import { BACKUP_TIMEOUT_MS, MessagingService } from './messaging/messaging.service';
import { FieldDefinition, FieldDefinitionsService } from './field-definitions.service';
import { WebSocketService } from './web-socket.service';
import { IpcService } from './ipc.service';
import { SaveInstanceResult, ServerInstance, ServerInstanceDraft } from '../models/server-instance.model';

/** Reply to delete-server-instance. */
export interface DeleteInstanceResult {
  success: boolean;
  id?: string;
  error?: string;
}

/** Reply to import-server-from-backup. */
export interface ImportServerResult {
  success?: boolean;
  instance?: ServerInstance;
  message?: string;
  error?: string;
}

/** Fields the backend reports about a running process; they are not settings and are never saved. */
const RUNTIME_FIELDS = ['state', 'status', 'players', 'cpu', 'memory', 'startedAt'] as const;

/** A copy of `instance` holding only its settings, for saving it or basing a new server on it. */
export function withoutRuntimeFields<T extends ServerInstanceDraft>(instance: T): Omit<T, typeof RUNTIME_FIELDS[number]> {
  const settings: Partial<T> = { ...instance };
  for (const field of RUNTIME_FIELDS) delete settings[field];
  return settings as Omit<T, typeof RUNTIME_FIELDS[number]>;
}

/** True when any field of `instance` differs from `saved`; arrays compare by value. */
function differsFrom(instance: ServerInstanceDraft, saved: ServerInstance): boolean {
  return (Object.keys(instance) as (keyof ServerInstance)[]).some(key => {
    const a: unknown = instance[key];
    const b: unknown = saved[key];
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length !== b.length || a.some((value, index) => value !== b[index]);
    }
    return a !== b;
  });
}

function defaultsFromMeta(definitions: FieldDefinition[]): ServerInstanceDraft {
  const defaults: Record<string, unknown> = {};
  for (const entry of definitions) {
    if (entry.key && 'default' in entry) {
      // Cloned: the definitions are cached and shared, and callers edit what they get.
      defaults[entry.key] = structuredClone(entry.default);
    }
  }
  return {
    ...defaults,
    name: 'My Server',
    sessionName: typeof defaults['sessionName'] === 'string' && defaults['sessionName'] ? defaults['sessionName'] : 'ARK Server',
    gamePort: 7777,
    rconPort: 27020,
    queryPort: 27015,
    multiHome: '',
    rconPassword: '',
    battleEye: false,
    noTransferFromFiltering: false,
    useExclusiveList: false,
    installed: false,
    currentVersion: null,
    autoUpdateEnabled: true
  } as ServerInstanceDraft;
}

@Injectable({ providedIn: 'root' })
export class ServerInstanceService implements OnDestroy {
  private instances$ = new ReplaySubject<ServerInstance[]>(1);
  private activeServer$ = new BehaviorSubject<ServerInstance | null>(null);
  private shouldCreateDefault = true;
  private subs: Subscription[] = [];
  private latestInstances: ServerInstance[] = [];

  constructor(
    private messaging: MessagingService,
    private fieldDefinitionsService: FieldDefinitionsService,
    webSocket: WebSocketService,
    ipc: IpcService
  ) {
    // The web UI asks each time its socket comes up, which also covers a backend restart;
    // the desktop app has no socket and asks once.
    this.subs.push(webSocket.connected$.pipe(filter(connected => connected)).subscribe(() => this.refresh()));
    if (ipc.isElectron) this.refresh();

    this.subs.push(this.messaging.receiveMessage<ServerInstance[]>('server-instances').subscribe(instances => {
      const list = Array.isArray(instances) ? instances : [];
      this.latestInstances = list;
      this.instances$.next(list);
      // A first run with no servers gets one to start from.
      if (this.shouldCreateDefault) {
        this.shouldCreateDefault = false;
        if (list.length === 0) this.createDefaultServer();
      }
    }));

    this.subs.push(this.messaging.receiveMessage<Partial<ServerInstance>>('server-instance-updated').subscribe(updated => {
      const current = this.activeServer$.getValue();
      if (!updated?.id || current?.id !== updated.id) return;
      // Only a real state replaces the current one; config edits arrive without it.
      const { state, ...settings } = updated;
      this.activeServer$.next({ ...current, ...settings, ...(state != null ? { state } : {}) });
    }));
  }

  ngOnDestroy(): void {
    this.subs.forEach(sub => sub.unsubscribe());
  }

  /** A new server's settings, from advanced-settings-meta.json. Each subscriber gets its own copy. */
  getDefaultInstanceFromMeta(): Observable<ServerInstanceDraft> {
    return this.fieldDefinitionsService.getFieldDefinitions().pipe(map(defaultsFromMeta));
  }

  /** Values for the fields the server page expects on every instance. */
  static getDefaultInstance(): ServerInstanceDraft {
    const defaultStatArray = Array(12).fill(1);
    return {
      name: 'My Server',
      sessionName: 'ARK Server',
      serverPassword: '',
      serverAdminPassword: '',
      maxPlayers: 70,
      mapName: 'TheIsland_WP',
      gamePort: 7777,
      rconPort: 27020,
      queryPort: 27015,
      bPvE: false,
      difficultyOffset: 1.0,
      allowThirdPersonPlayer: false,
      crossplay: ['Steam (PC)'],
      mods: [],
      clusterDirOverride: '',
      clusterId: '',
      perLevelStatsMultiplier_Player: [...defaultStatArray],
      perLevelStatsMultiplier_DinoTamed: [...defaultStatArray],
      perLevelStatsMultiplier_DinoWild: [...defaultStatArray],
      perLevelStatsMultiplier_DinoTamed_Add: [...defaultStatArray],
      perLevelStatsMultiplier_DinoTamed_Affinity: [...defaultStatArray],
      perLevelStatsMultiplier_DinoTamed_Torpidity: [...defaultStatArray],
      perLevelStatsMultiplier_DinoTamed_Clamp: [...defaultStatArray]
    };
  }

  /** The last list the backend sent, as it sent it. LiveServersService adds the live fields. */
  getInstances(): Observable<ServerInstance[]> {
    return this.instances$.asObservable();
  }

  setActiveServer(server: ServerInstance | null): void {
    this.activeServer$.next(server);
  }

  getActiveServer(): Observable<ServerInstance | null> {
    return this.activeServer$.asObservable();
  }

  /** Asks for the list; it arrives as a server-instances broadcast. */
  refresh(): void {
    this.messaging.sendMessage('get-server-instances', {}).subscribe({
      error: () => { /* asked again on the next connect */ }
    });
  }

  /** Saves the instance, or answers `unchanged` without a round trip when it matches the last saved copy. */
  save(instance: ServerInstanceDraft): Observable<SaveInstanceResult> {
    const existing = instance.id ? this.latestInstances.find(i => i.id === instance.id) : undefined;
    if (existing && !differsFrom(instance, existing)) {
      return of({ success: true, unchanged: true });
    }
    return this.messaging.sendMessage<SaveInstanceResult>('save-server-instance', { instance });
  }

  delete(id: string): Observable<DeleteInstanceResult> {
    return this.messaging.sendMessage<DeleteInstanceResult>('delete-server-instance', { id });
  }

  /** Persists a new sidebar order; `orderedIds` is every server id in display order. */
  reorderServers(orderedIds: string[]): Observable<{ success?: boolean; error?: string }> {
    return this.messaging.sendMessage('reorder-server-instances', { orderedIds });
  }

  /** Creates a server from a backup zip: a path on the desktop, or the file's contents in the web UI. */
  importServerFromBackup(serverName: string, backupFilePath?: string, fileData?: string, fileName?: string): Observable<ImportServerResult> {
    return this.messaging.sendMessage<ImportServerResult>('import-server-from-backup', {
      serverName,
      backupFilePath,
      fileData,
      fileName
    }, { timeoutMs: BACKUP_TIMEOUT_MS });
  }

  private createDefaultServer(): void {
    this.getDefaultInstanceFromMeta().pipe(
      switchMap(defaults => this.save({ ...defaults, sessionName: defaults.name }))
    ).subscribe({
      next: res => {
        if (res.instance?.id) this.setActiveServer(res.instance);
      },
      error: error => console.error('[server-instance] Failed to create the default server:', error)
    });
  }
}
