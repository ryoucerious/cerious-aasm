import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MessagingService } from './messaging/messaging.service';
import { ReplaySubject, Observable, tap, filter, take, Subscription, BehaviorSubject, of, firstValueFrom } from 'rxjs';
import { map, shareReplay, filter as rxFilter, take as rxTake } from 'rxjs/operators';
import { ServerInstance } from '../models/server-instance.model';
import { WebSocketService } from './web-socket.service';
import { UtilityService } from './utility.service';

@Injectable({ providedIn: 'root' })
export class ServerInstanceService {
  private instances$ = new ReplaySubject<ServerInstance[]>(1);
  private activeServer$ = new BehaviorSubject<ServerInstance | null>(null);
  private _shouldCreateDefault = false;
  private subs: Subscription[] = [];
  private latestInstances: ServerInstance[] = [];

  private metaDefaults$: Observable<any> | null = null;

  constructor(
    public messaging: MessagingService,
    private http: HttpClient,
    private ws: WebSocketService,
    private util: UtilityService
  ) {
    // Listen for backend push updates (if any)
    this.subs.push(this.messaging.receiveMessage<ServerInstance[]>('server-instances').subscribe(instances => {
      const list = Array.isArray(instances) ? instances : [];
      this.latestInstances = list;
      this.instances$.next(list);
      // If no servers exist, create a default (only on first load)
      if (this._shouldCreateDefault && list.length === 0) {
        this._shouldCreateDefault = false;
        this.getDefaultInstanceFromMeta().subscribe(instance => {
          // Keep name and sessionName in sync
          instance.sessionName = instance.name;
          this.save(instance).subscribe((res: any) => {
            // Select the new server as active
            if (res && res.instance && res.instance.id) {
              this.setActiveServer(res.instance);
            }
          });
        });
      }
    }));

    // Listen for real-time updates to a single instance
    this.subs.push(this.messaging.receiveMessage<any>('server-instance-updated').subscribe(updated => {
      if (updated && updated.id) {
        // If the updated instance is the active one, update activeServer$
        const current = this.activeServer$.getValue();
        if (current && current.id === updated.id) {
          // Don't update state from server-instance-updated messages unless it has a valid state
          const { state, ...updatedWithoutState } = updated;
          
          const merged = { ...current, ...updatedWithoutState };
          if (state != null) {
            merged.state = state;
          }
          this.activeServer$.next(merged);
        }
      }
    }));

    // Initial load: only call refresh after WebSocket is connected in web mode
    this._shouldCreateDefault = true;
    if (this.util.getPlatform() === 'Web') {
      this.ws.connected$.pipe(
        rxFilter(connected => connected),
        rxTake(1)
      ).subscribe(() => {
        this.refresh();
      });
    } else {
      this.refresh();
    }
  }

  /**
   * Returns a Promise that resolves to the list of running server instances.
   * Used for shutdown confirmation on app close.
   */

  getInstancesOnce(): Promise<ServerInstance[]> {
    return new Promise(resolve => {
      this.instances$.pipe(take(1)).subscribe((instances: ServerInstance[]) => {
        resolve(instances.filter(i => {
          const state = (i.state || i.status || '').toLowerCase();
          return state === 'running' || state === 'starting';
        }));
      });
    });
  }

  /**
   * Shuts down all running servers. Returns a Promise that resolves when done.
   */
  shutdownAllServers(): Promise<void> {
    return new Promise(resolve => {
      this.instances$.pipe(take(1)).subscribe((instances: ServerInstance[]) => {
        const toShutdown = instances.filter(i => {
          const state = (i.state || i.status || '').toLowerCase();
          return state === 'running' || state === 'starting';
        });
        if (toShutdown.length === 0) {
          resolve();
          return;
        }
        let completed = 0;
        toShutdown.forEach(instance => {
          this.stopInstance(instance).then(() => {
            completed++;
            if (completed === toShutdown.length) {
              resolve();
            }
          });
        });
      });
    });
  }

  /**
   * Stop a server instance. This should be implemented to actually stop the server.
   */
  public stopInstance(instance: ServerInstance): Promise<void> {
    // Gracefully stop the server using the same logic as stopServer in ServerComponent
    return new Promise((resolve) => {
      if (!instance || !instance.id) return resolve();
      // First, broadcast a shutdown message to the server using ServerChat
      this.messaging.sendMessage('rcon-command', {
        id: instance.id,
        command: 'ServerChat Server is shutting down in 5 seconds!',
        requestId: 'shutdown-broadcast-' + Date.now()
      }).subscribe(() => {
        // Wait 5 seconds, then send DoExit
        setTimeout(() => {
          this.messaging.sendMessage('rcon-command', {
            id: instance.id,
            command: 'DoExit',
            requestId: 'stop-' + Date.now()
          }).subscribe(() => {
            this.messaging.sendMessage('stop-server-instance', { id: instance.id }).subscribe(() => {
              resolve();
            });
          });
        }, 5000);
      });
    });
  }

  /**
   * Returns a new ServerInstance object with all default values from advanced-settings-meta.json
   * This is async and returns an Observable.
   */
  getDefaultInstanceFromMeta(): Observable<any> {
    if (!this.metaDefaults$) {
      this.metaDefaults$ = this.http.get<any[]>('assets/advanced-settings-meta.json').pipe(
        map((metaArr: any[]) => {
          const defaults: any = {};
          for (const entry of metaArr) {
            if (entry.key && entry.hasOwnProperty('default')) {
              defaults[entry.key] = entry.default;
            }
          }
          // Add required fields not in meta
          defaults.name = 'My Server';
          defaults.sessionName = defaults.sessionName || 'ARK Server';
          
          // Add essential server configuration not in meta file
          defaults.gamePort = 7777;
          defaults.queryPort = 27015;
          defaults.rconPort = 27020;
          defaults.rconPassword = '';
          defaults.battleEye = false; // Default to disabled for easier setup
          defaults.noTransferFromFiltering = false;
          defaults.installed = false;
          defaults.currentVersion = null;
          defaults.autoUpdateEnabled = true;
          
          return defaults;
        }),
        shareReplay(1)
      );
    }
    return this.metaDefaults$;
  }

  /**
   * @deprecated Use getDefaultInstanceFromMeta() instead for meta-driven defaults
   */
  static getDefaultInstance(): any {
    const defaultStatArray = Array(12).fill(1);
    return {
      name: 'My Server',
      sessionName: 'ARK Server',
      serverPassword: '',
      serverAdminPassword: '',
      maxPlayers: 70,
      mapName: 'TheIsland_WP',
      gamePort: 7777,
      queryPort: 27015,
      rconPort: 27020,
      bPvE: false,
      difficultyOffset: 1.0,
      allowThirdPersonPlayer: false,
      crossplay: ['Steam (PC)'],
      mods: [],
      perLevelStatsMultiplier_Player: [...defaultStatArray],
      perLevelStatsMultiplier_DinoTamed: [...defaultStatArray],
      perLevelStatsMultiplier_DinoWild: [...defaultStatArray],
      perLevelStatsMultiplier_DinoTamed_Add: [...defaultStatArray],
      perLevelStatsMultiplier_DinoTamed_Affinity: [...defaultStatArray],
      perLevelStatsMultiplier_DinoTamed_Torpidity: [...defaultStatArray],
      perLevelStatsMultiplier_DinoTamed_Clamp: [...defaultStatArray]
    };
  }

  ngOnDestroy() {
    this.subs.forEach(sub => sub.unsubscribe());
  }

  /** Observable for components to subscribe to */
  getInstances(): Observable<any[]> {
    return this.instances$.asObservable();
  }

  /** Set the active server instance */
  setActiveServer(server: any) {
    this.activeServer$.next(server);
  }

  /** Observable for the active server instance */
  getActiveServer(): Observable<any | null> {
    return this.activeServer$.asObservable();
  }

  /** Request latest from backend */
  refresh() {
    this.messaging.sendMessage('get-server-instances', {}).subscribe();
  }

  /**
   * Save the instance only if its settings have actually changed compared to the current one in the list.
   */
  save(instance: any): Observable<any> {
    let shouldSave = true;
    const existing = this.latestInstances.find((i: any) => i.id === instance.id);
    if (existing) {
      // Shallow compare all keys
      const iAny = instance as any;
      const eAny = existing as any;
      shouldSave = Object.keys(instance).some(key => {
        // Compare arrays by value
        if (Array.isArray(iAny[key]) && Array.isArray(eAny[key])) {
          return iAny[key].length !== eAny[key].length || iAny[key].some((v: any, idx: number) => v !== eAny[key][idx]);
        }
        return iAny[key] !== eAny[key];
      });
    }
    if (!shouldSave) {
      // Return an observable that completes immediately (no save needed)
      return new Observable(observer => { observer.complete(); });
    }
    // Use sendMessage which handles requestId automatically
    return this.messaging.sendMessage('save-server-instance', { instance });
  }

  delete(id: string): Observable<any> {
    // Use sendMessage which handles requestId automatically
    return this.messaging.sendMessage('delete-server-instance', { id });
  }

  /**
   * Import a server from backup file
   */
  importServerFromBackup(serverName: string, backupFilePath?: string, fileData?: string, fileName?: string): Observable<any> {
    return this.messaging.sendMessage('import-server-from-backup', { 
      serverName, 
      backupFilePath,
      fileData,
      fileName
    });
  }
}
