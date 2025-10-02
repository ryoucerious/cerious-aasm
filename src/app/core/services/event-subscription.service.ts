import { Injectable, ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subscription, take } from 'rxjs';
import { MessagingService } from './messaging/messaging.service';
import { ServerInstanceService } from './server-instance.service';
import { ServerStateService } from './server-state.service';
import { ServerConfigurationService } from './server-configuration.service';
import { RconManagementService } from './rcon-management.service';
import { NotificationService } from './notification.service';

/**
 * Service responsible for managing event subscriptions and messaging
 * Centralizes all the subscription logic from the server component
 */
@Injectable({
  providedIn: 'root'
})
export class EventSubscriptionService {
  private subscriptions: Subscription[] = [];

  constructor(
    private http: HttpClient,
    private messaging: MessagingService,
    private serverInstanceService: ServerInstanceService,
    private serverStateService: ServerStateService,
    private serverConfigurationService: ServerConfigurationService,
    private rconManagementService: RconManagementService,
    private notificationService: NotificationService
  ) {}

  /**
   * Initialize all event subscriptions for the server component
   */
  initializeSubscriptions(
    component: {
      advancedSettingsMeta: any[];
      activeServerInstance: any;
      originalServerInstance: any;
      modsInput: string;
      rconConnected: boolean;
      crossplayPlatforms: string[];
      loadBackupSettings: () => void;
      loadBackupList: () => void;
      loadModList: () => void;
      scrollLogsToBottom: () => void;
    },
    cdr: ChangeDetectorRef
  ): Subscription {
    // Load advanced settings metadata
    this.subscriptions.push(
      this.http.get<any[]>('assets/advanced-settings-meta.json').subscribe(meta => {
        component.advancedSettingsMeta = meta;
        cdr.markForCheck();
      })
    );

    // Listen for error notifications (e.g., port in use) only once
    this.subscriptions.push(
      this.messaging.receiveMessage('notification').subscribe((msg: any) => {
        if (msg && msg.type === 'error' && msg.message) {
          this.notificationService.error(msg.message, 'Server Start Error');
        }
      })
    );

    // Listen for clear logs event from backend and delegate to service
    this.subscriptions.push(
      this.messaging.receiveMessage('clear-server-instance-logs').subscribe((msg: any) => {
        if (msg && msg.instanceId) {
          this.serverStateService.clearLogsForInstance(msg.instanceId);
          cdr.markForCheck();
        }
      })
    );

    // Subscribe to ServerStateService logs for UI updates
    this.subscriptions.push(
      this.serverStateService.logs$.subscribe(() => {
        cdr.markForCheck();
        component.scrollLogsToBottom();
      })
    );

    // Listen for RCON status
    this.subscriptions.push(
      this.rconManagementService.subscribeToRconStatus().subscribe((msg: any) => {
        if (msg && msg.instanceId === component.activeServerInstance?.id) {
          component.rconConnected = !!msg.connected;
          cdr.markForCheck();
        }
      })
    );

    // Listen for backend player count updates
    this.subscriptions.push(
      this.messaging.receiveMessage('server-instance-players').subscribe((msg: any) => {
        if (msg && msg.instanceId === component.activeServerInstance?.id && typeof msg.players === 'number') {
          component.activeServerInstance.players = msg.players;
          cdr.markForCheck();
        }
      })
    );

    // Listen for server state updates
    this.subscriptions.push(
      this.messaging.receiveMessage('server-instance-state').subscribe((msg: any) => {
        if (
          msg && msg.state &&
          component.activeServerInstance &&
          (msg.instanceId === component.activeServerInstance.id)
        ) {
          const mappedState = this.serverStateService.mapServerState(msg.state);
          component.activeServerInstance.state = mappedState;
          
          cdr.markForCheck();
        }
      })
    );

    // Listen for server instance updates from other clients
    this.subscriptions.push(
      this.messaging.receiveMessage('server-instance-updated').subscribe((msg: any) => {
        if (
          msg && 
          component.activeServerInstance &&
          msg.id === component.activeServerInstance.id
        ) {
          // Don't update state from server-instance-updated messages, only from server-instance-state
          const { state, ...msgWithoutState } = msg;
          
          // Merge the updated server data with defaults (excluding state)
          const defaults = ServerInstanceService.getDefaultInstance();
          const merged = { ...defaults, ...component.activeServerInstance, ...msgWithoutState };
          
          component.activeServerInstance = merged;
          
          // Handle crossplay array conversion
          if (typeof component.activeServerInstance.crossplay === 'boolean') {
            component.activeServerInstance.crossplay = component.activeServerInstance.crossplay ? [...component.crossplayPlatforms] : [];
          } else if (!Array.isArray(component.activeServerInstance.crossplay)) {
            component.activeServerInstance.crossplay = [];
          }
          
          // Ensure mods is always an array
          if (!Array.isArray(component.activeServerInstance.mods)) {
            component.activeServerInstance.mods = [];
          }
          component.modsInput = component.activeServerInstance.mods?.join(',') || '';
          
          // Update the original instance to reflect the new state from other clients
          component.originalServerInstance = JSON.parse(JSON.stringify(component.activeServerInstance));
          
          cdr.markForCheck();
        }
      })
    );

    // Listen for server instances list updates (includes memory data)
    this.subscriptions.push(
      this.messaging.receiveMessage('server-instances').subscribe((instances: any[]) => {
        if (instances && component.activeServerInstance) {
          const updatedInstance = instances.find(inst => inst.id === component.activeServerInstance.id);
          if (updatedInstance && updatedInstance.memory !== undefined) {
            component.activeServerInstance.memory = updatedInstance.memory;
            cdr.markForCheck();
          }
        }
      })
    );

    // Listen for continuous memory updates while server is running
    this.subscriptions.push(
      this.messaging.receiveMessage('server-instance-memory').subscribe((msg: any) => {
        if (msg && msg.instanceId === component.activeServerInstance?.id && typeof msg.memory === 'number') {
          component.activeServerInstance.memory = msg.memory;
          cdr.markForCheck();
        }
      })
    );

    // Initialize server instance with proper defaults and normalization
    return this.serverInstanceService.getActiveServer().subscribe(server => {
      component.activeServerInstance = this.serverConfigurationService.initializeServerInstance(server);
      // Store a deep copy of the original for change detection
      component.originalServerInstance = this.serverConfigurationService.createDeepCopy(component.activeServerInstance);
      
      // Convert mods array to input string
      component.modsInput = this.serverConfigurationService.modsArrayToString(component.activeServerInstance.mods);
      
      // Initialize mod list for the new UI
      if (component.loadModList) {
        component.loadModList();
      }
      
      // Update the original after any initialization changes
      component.originalServerInstance = this.serverConfigurationService.createDeepCopy(component.activeServerInstance);

      // Request current state, logs, and player count for this instance
      if (component.activeServerInstance && component.activeServerInstance.id) {
        this.messaging.sendMessage('get-server-instance-state', { id: component.activeServerInstance.id }).pipe(take(1)).subscribe((msg: any) => {
          if (msg && msg.state) {
            component.activeServerInstance.state = this.serverStateService.mapServerState(msg.state);
            cdr.markForCheck();
          }
        });
        this.messaging.sendMessage('get-server-instance-logs', { id: component.activeServerInstance.id, maxLines: 200 }).pipe(take(1)).subscribe(() => {
          // Log fetching is now handled by ServerStateService
          component.scrollLogsToBottom();
        });
        // Request current player count
        this.messaging.sendMessage('get-server-instance-players', { id: component.activeServerInstance.id }).pipe(take(1)).subscribe((msg: any) => {
          if (msg && typeof msg.players === 'number') {
            component.activeServerInstance.players = msg.players;
            cdr.markForCheck();
          }
        });
        // Request current RCON status for this specific instance
        this.messaging.sendMessage('get-rcon-status', { id: component.activeServerInstance.id }).pipe(take(1)).subscribe((msg: any) => {
          if (msg && msg.instanceId === component.activeServerInstance?.id) {
            component.rconConnected = !!msg.connected;
            cdr.markForCheck();
          }
        });
        // Load backup settings and list for this instance
        component.loadBackupSettings();
        component.loadBackupList();
      }
    });
  }

  /**
   * Clean up all subscriptions
   */
  destroySubscriptions(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];
  }
}