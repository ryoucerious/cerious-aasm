import { Injectable, ChangeDetectorRef } from '@angular/core';
import { Subscription, distinctUntilChanged } from 'rxjs';
import { MessagingService } from './messaging/messaging.service';
import { ServerInstanceService } from './server-instance.service';
import { ServerStateService } from './server-state.service';
import { ServerConfigurationService } from './server-configuration.service';
import { RconManagementService } from './rcon-management.service';
import { FieldDefinition, FieldDefinitionsService } from './field-definitions.service';
import {
  InstanceMemoryEvent, InstancePlayersEvent, InstanceStateEvent, RconStatusEvent, ServerInstance, ServerInstanceDraft
} from '../models/server-instance.model';

/** The parts of the server page this service keeps up to date. */
export interface ServerPageState {
  advancedSettingsMeta: FieldDefinition[];
  activeServerInstance: ServerInstanceDraft | null;
  /** The settings as the backend last confirmed them. Where the page differs, the user has unsaved edits. */
  originalServerInstance: ServerInstanceDraft | null;
  rconConnected: boolean;
  loadBackupSettings: () => void;
  loadBackupList: () => void;
  loadModList: () => void;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

@Injectable({
  providedIn: 'root'
})
export class EventSubscriptionService {
  private subscriptions: Subscription[] = [];

  constructor(
    private messaging: MessagingService,
    private serverInstanceService: ServerInstanceService,
    private serverStateService: ServerStateService,
    private serverConfigurationService: ServerConfigurationService,
    private rconManagementService: RconManagementService,
    private fieldDefinitionsService: FieldDefinitionsService
  ) {}

  /**
   * Wires the server page to the backend's broadcasts and loads the selected server.
   * Returns the active-server subscription; the rest end with destroySubscriptions().
   */
  initializeSubscriptions(component: ServerPageState, cdr: ChangeDetectorRef): Subscription {
    /** The page's server, but only while it is still the one with this id. */
    const activeServer = (id: unknown): ServerInstanceDraft | null =>
      id && component.activeServerInstance?.id === id ? component.activeServerInstance : null;

    this.subscriptions.push(
      this.fieldDefinitionsService.getFieldDefinitions().subscribe({
        next: meta => {
          component.advancedSettingsMeta = meta;
          cdr.markForCheck();
        },
        error: () => { /* the settings tabs stay empty; nothing else depends on them */ }
      }),

      this.messaging.receiveMessage<{ instanceId?: string }>('clear-server-instance-logs').subscribe(msg => {
        if (msg?.instanceId) {
          this.serverStateService.clearLogsForInstance(msg.instanceId);
          cdr.markForCheck();
        }
      }),

      this.serverStateService.logsChanged$.subscribe(() => cdr.markForCheck()),

      this.rconManagementService.subscribeToRconStatus().subscribe((msg: RconStatusEvent) => {
        if (activeServer(msg?.instanceId)) {
          component.rconConnected = !!msg.connected;
          cdr.markForCheck();
        }
      }),

      this.messaging.receiveMessage<InstancePlayersEvent>('server-instance-players').subscribe(msg => {
        const server = activeServer(msg?.instanceId);
        if (server && typeof msg.players === 'number') {
          server.players = msg.players;
          cdr.markForCheck();
        }
      }),

      this.messaging.receiveMessage<InstanceStateEvent>('server-instance-state').subscribe(msg => {
        const server = activeServer(msg?.instanceId);
        if (server && msg.state) {
          server.state = this.serverStateService.mapServerState(msg.state);
          cdr.markForCheck();
        }
      }),

      this.messaging.receiveMessage<Partial<ServerInstance>>('server-instance-updated').subscribe(msg => {
        const server = activeServer(msg?.id);
        if (server && this.applyUpdate(component, server, msg)) cdr.markForCheck();
      }),

      this.messaging.receiveMessage<ServerInstance[]>('server-instances').subscribe(instances => {
        const id = component.activeServerInstance?.id;
        const updated = Array.isArray(instances) && id ? instances.find(inst => inst.id === id) : undefined;
        const server = activeServer(id);
        if (server && updated?.memory !== undefined) {
          server.memory = updated.memory;
          cdr.markForCheck();
        }
      }),

      this.messaging.receiveMessage<InstanceMemoryEvent>('server-instance-memory').subscribe(msg => {
        const server = activeServer(msg?.instanceId);
        if (server && typeof msg.memory === 'number') {
          server.memory = msg.memory;
          cdr.markForCheck();
        }
      })
    );

    // Only a different server resets the page. The same one is announced again after every
    // save; its edits arrive through server-instance-updated, which keeps unsaved ones.
    return this.serverInstanceService.getActiveServer().pipe(
      distinctUntilChanged((previous, next) => previous?.id === next?.id)
    ).subscribe(selected => {
      if (!selected) {
        component.activeServerInstance = null;
        component.originalServerInstance = null;
        component.loadModList();
        return;
      }

      // A copy: the selected object is shared with the sidebar and the service's cache.
      const server = this.serverConfigurationService.initializeServerInstance(
        this.serverConfigurationService.createDeepCopy(selected)
      );
      component.activeServerInstance = server;
      component.loadModList();
      // After loadModList, which fills in fields of its own.
      component.originalServerInstance = this.serverConfigurationService.createDeepCopy(server);

      if (server.id) {
        this.requestLiveState(server.id, activeServer, component, cdr);
        component.loadBackupSettings();
        component.loadBackupList();
      }
    });
  }

  destroySubscriptions(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];
  }

  /**
   * Takes the backend's copy of the page's server: a save echoing back, or another client's edit.
   * A field the user has changed since the last save keeps the user's value; it goes out with the
   * next save. State is left to server-instance-state. Returns whether anything changed.
   */
  private applyUpdate(component: ServerPageState, server: ServerInstanceDraft, update: Partial<ServerInstance>): boolean {
    const { state, ...incoming } = update;
    const current = server as Record<string, unknown>;
    const saved = component.originalServerInstance as Record<string, unknown> | null;
    const editedHere = (key: string) => saved !== null && !sameValue(current[key], saved[key]);
    const taken = Object.entries(incoming).filter(([key, value]) => !editedHere(key) && !sameValue(current[key], value));
    if (taken.length === 0) return false;

    const merged = this.serverConfigurationService.initializeServerInstance({ ...server, ...Object.fromEntries(taken) });
    const confirmed = Object.fromEntries(taken.map(([key]) => [key, (merged as Record<string, unknown>)[key]]));
    component.activeServerInstance = merged;
    component.originalServerInstance = this.serverConfigurationService.createDeepCopy({ ...(saved ?? merged), ...confirmed } as ServerInstanceDraft);
    component.loadModList();
    return true;
  }

  /** Asks for the server's current state; replies for a server no longer shown are dropped. */
  private requestLiveState(
    id: string,
    activeServer: (id: unknown) => ServerInstanceDraft | null,
    component: ServerPageState,
    cdr: ChangeDetectorRef
  ): void {
    const ignoreFailure = () => { /* the next broadcast brings the same data */ };

    this.messaging.sendMessage<InstanceStateEvent>('get-server-instance-state', { id }).subscribe({
      next: msg => {
        const server = activeServer(id);
        if (server && msg?.state) {
          server.state = this.serverStateService.mapServerState(msg.state);
          cdr.markForCheck();
        }
      },
      error: ignoreFailure
    });

    // The reply itself is picked up by ServerStateService.
    this.messaging.sendMessage('get-server-instance-logs', { id, maxLines: 200 }).subscribe({ error: ignoreFailure });

    this.messaging.sendMessage<InstancePlayersEvent>('get-server-instance-players', { id }).subscribe({
      next: msg => {
        const server = activeServer(id);
        if (server && typeof msg?.players === 'number') {
          server.players = msg.players;
          cdr.markForCheck();
        }
      },
      error: ignoreFailure
    });

    this.messaging.sendMessage<RconStatusEvent>('get-rcon-status', { id }).subscribe({
      next: msg => {
        if (activeServer(id) && msg?.instanceId === id) {
          component.rconConnected = !!msg.connected;
          cdr.markForCheck();
        }
      },
      error: ignoreFailure
    });
  }
}
