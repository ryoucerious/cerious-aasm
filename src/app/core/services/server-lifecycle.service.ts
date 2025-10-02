import { Injectable, ChangeDetectorRef } from '@angular/core';
import { Observable, take } from 'rxjs';
import { MessagingService } from './messaging/messaging.service';
import { RconManagementService } from './rcon-management.service';
import { ServerStateService } from './server-state.service';
import { NotificationService } from './notification.service';

/**
 * Service responsible for managing server lifecycle operations
 * Handles start, stop, restart, and force stop operations
 */
@Injectable({
  providedIn: 'root'
})
export class ServerLifecycleService {

  constructor(
    private messaging: MessagingService,
    private rconManagementService: RconManagementService,
    private serverStateService: ServerStateService,
    private notificationService: NotificationService
  ) {}

  /**
   * Start a server instance
   */
  startServer(serverInstance: any, cdr: ChangeDetectorRef): void {
    if (!serverInstance || !serverInstance.id) return;
    
    // Clear logs and reset state
    serverInstance.logs = [];
    serverInstance.state = null;
    this.serverStateService.clearLogsForInstance(serverInstance.id);
    cdr.markForCheck();
    
    // Send start command
    this.messaging.sendMessage('start-server-instance', { id: serverInstance.id })
      .pipe(take(1))
      .subscribe();
  }

  /**
   * Gracefully stop a server instance with warning
   * Broadcasts shutdown message and waits 5 seconds before stopping
   */
  stopServer(serverInstance: any): void {
    if (!serverInstance || !serverInstance.id) return;
    
    // Show toast notification that we're stopping the server
    const serverName = serverInstance.name || serverInstance.id;
    this.notificationService.info(`Stopping server ${serverName}...`, 'Server Control');
    
    // First, broadcast a shutdown message to the server using ServerChat
    this.rconManagementService.sendRconCommand(
      serverInstance.id, 
      'ServerChat Server is shutting down in 5 seconds!'
    ).subscribe(() => {
      // Wait 5 seconds, then send DoExit
      setTimeout(() => {
        this.rconManagementService.sendRconCommand(
          serverInstance.id, 
          'DoExit'
        ).pipe(take(1)).subscribe(() => {
          this.messaging.sendMessage('stop-server-instance', { id: serverInstance.id })
            .pipe(take(1))
            .subscribe();
        });
      }, 5000);
    });
  }

  /**
   * Force stop a server instance immediately
   * Does not send warning or graceful shutdown
   */
  forceStopServer(serverInstance: any): void {
    if (!serverInstance || !serverInstance.id) return;
    
    this.messaging.sendMessage('force-stop-server-instance', { id: serverInstance.id })
      .pipe(take(1))
      .subscribe();
  }

  /**
   * Restart a server instance
   * Combines stop and start operations
   */
  restartServer(serverInstance: any, cdr: ChangeDetectorRef): void {
    if (!serverInstance || !serverInstance.id) return;
    
    // Stop the server first
    this.stopServer(serverInstance);
    
    // Wait for server to stop, then start it again
    // Note: In a real implementation, you might want to listen for server stopped events
    setTimeout(() => {
      this.startServer(serverInstance, cdr);
    }, 7000); // Wait 7 seconds to ensure shutdown completes
  }

  /**
   * Check if an instance can be started based on its current state
   */
  canStartInstance(state: string | null | undefined): boolean {
    return this.serverStateService.canStartInstance(state);
  }

  /**
   * Map server state to human readable format
   */
  mapServerState(state: string | null | undefined): string {
    return this.serverStateService.mapServerState(state);
  }
}