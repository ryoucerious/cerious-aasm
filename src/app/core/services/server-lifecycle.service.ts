import { Injectable, ChangeDetectorRef } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { MessagingService } from './messaging/messaging.service';
import { RconManagementService } from './rcon-management.service';
import { ServerStateService } from './server-state.service';
import { NotificationService } from './notification.service';
import { LiveServersService } from './live-servers.service';
import { ServerInstanceService } from './server-instance.service';
import { ServerInstance } from '../models/server-instance.model';
import { serverStatusKey } from '../utils/server-status';

const SHUTDOWN_WARNING = 'ServerChat Server is shutting down in 5 seconds!';
export const SHUTDOWN_WARNING_MS = 5_000;
/**
 * The backend saves, sends DoExit, waits up to two minutes for the process to go, then sends
 * SIGTERM and kills it: about 190 s at worst.
 */
export const STOP_TIMEOUT_MS = 210_000;
/** Closing the app stops waiting on its servers after this long and exits anyway. Not above STOP_TIMEOUT_MS. */
export const EXIT_SHUTDOWN_CAP_MS = 150_000;

/** Reply to stop-server-instance, or the local stand-in when the request itself failed. */
export interface StopServerResult {
  success: boolean;
  instanceId?: string;
  error?: string;
}

/** Reply to start-all-instances and stop-all-instances, which answer before the servers change state. */
interface ControlAllResult {
  success?: boolean;
  error?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

@Injectable({
  providedIn: 'root'
})
export class ServerLifecycleService {

  constructor(
    private messaging: MessagingService,
    private rconManagementService: RconManagementService,
    private serverStateService: ServerStateService,
    private notificationService: NotificationService,
    private liveServers: LiveServersService,
    private serverInstanceService: ServerInstanceService
  ) {}

  startServer(serverInstance: ServerInstance, cdr: ChangeDetectorRef): void {
    if (!serverInstance || !serverInstance.id) return;

    serverInstance.state = undefined;
    this.serverStateService.clearLogsForInstance(serverInstance.id);
    cdr.markForCheck();

    // A delivered request needs no handling: the outcome arrives as a server-instance-state broadcast.
    this.messaging.sendMessage('start-server-instance', { id: serverInstance.id }).subscribe({
      error: error => this.reportFailedRequest('start', serverInstance, error)
    });
  }

  /**
   * Warns the players, waits five seconds, then has the backend stop the server gracefully.
   * Never rejects: a failure is shown to the user and returned.
   */
  async stopServer(serverInstance: ServerInstance): Promise<StopServerResult> {
    const id = serverInstance?.id;
    if (!id) return { success: false, error: 'No server to stop' };

    this.notificationService.info(`Stopping ${serverInstance.name || id}...`, 'Server Control');
    this.rconManagementService.sendRconCommand(id, SHUTDOWN_WARNING).subscribe({
      error: () => { /* RCON is not up yet while a server starts; stop it regardless */ }
    });
    await delay(SHUTDOWN_WARNING_MS);

    let result: StopServerResult;
    try {
      result = await firstValueFrom(
        this.messaging.sendMessage<StopServerResult>('stop-server-instance', { id }, { timeoutMs: STOP_TIMEOUT_MS })
      );
    } catch (error) {
      result = { success: false, instanceId: id, error: error instanceof Error ? error.message : String(error) };
    }

    if (!result.success) {
      this.notificationService.error(result.error || `Could not stop ${serverInstance.name || id}`, 'Server Control');
    }
    return result;
  }

  forceStopServer(serverInstance: ServerInstance): void {
    if (!serverInstance || !serverInstance.id) return;

    this.messaging.sendMessage('force-stop-server-instance', { id: serverInstance.id }).subscribe({
      error: error => this.reportFailedRequest('force stop', serverInstance, error)
    });
  }

  /** Queues every server that is not already up; the backend starts them one after another. */
  startAllServers(): void {
    if (!this.liveServers.servers.length) return;
    this.controlAll('start-all-instances', 'All servers are starting.', 'Failed to start all servers.');
  }

  /** Stops every running or starting server. */
  stopAllServers(): void {
    if (!this.runningServers().length) {
      this.notificationService.info('No servers are running.', 'Server Control');
      return;
    }
    this.controlAll('stop-all-instances', 'All servers are stopping.', 'Failed to stop all servers.');
  }

  /**
   * False, after telling the user why, when `server` may not be deleted: it is the last one, or
   * its live state is anything but stopped.
   */
  checkDeletable(server: ServerInstance): boolean {
    let refusal: string | null = null;
    if (this.liveServers.servers.length <= 1) {
      refusal = 'At least one server must remain.';
    } else if (serverStatusKey((this.liveServers.find(server.id) ?? server).state) !== 'stopped') {
      refusal = 'Server must be stopped before it can be deleted.';
    }
    if (refusal) this.notificationService.warning(refusal, 'Cannot Delete Server');
    return !refusal;
  }

  /** Deletes `server` if checkDeletable allows it. Resolves true once the backend has; never rejects. */
  async deleteServer(server: ServerInstance): Promise<boolean> {
    if (!this.checkDeletable(server)) return false;
    try {
      const result = await firstValueFrom(this.serverInstanceService.delete(server.id));
      if (result?.success) return true;
      this.notificationService.error(result?.error || `Could not delete ${server.name || server.id}`, 'Server Control');
    } catch (error) {
      this.reportFailedRequest('delete', server, error);
    }
    return false;
  }

  /** Servers that closing the app would take down: running, or on their way up. */
  runningServers(): ServerInstance[] {
    return this.liveServers.servers.filter(server => {
      const status = serverStatusKey(server.state);
      return status === 'running' || status === 'starting';
    });
  }

  /**
   * The servers with these ids, as the roster names them: those the desktop's main process says
   * run on this machine. In a mesh the roster lists every machine's servers.
   */
  serversRunningHere(ids: string[]): ServerInstance[] {
    return ids.map(id => this.liveServers.find(id) ?? ({ id, name: id } as ServerInstance));
  }

  /**
   * Stops these servers in parallel, before the app exits. Resolves when all have answered or
   * after EXIT_SHUTDOWN_CAP_MS, whichever comes first; never rejects.
   */
  async shutdownServers(servers: ServerInstance[]): Promise<void> {
    const stops = Promise.all(servers.map(server => this.stopServer(server)));
    let cap: ReturnType<typeof setTimeout> | undefined;
    const capped = new Promise<void>(resolve => cap = setTimeout(resolve, EXIT_SHUTDOWN_CAP_MS));
    try {
      await Promise.race([stops, capped]);
    } finally {
      clearTimeout(cap);
    }
  }

  private controlAll(channel: string, accepted: string, failed: string): void {
    this.messaging.sendMessage<ControlAllResult>(channel, {}).subscribe({
      next: result => {
        if (result?.success) this.notificationService.success(accepted, 'Server Control');
        else this.notificationService.error(result?.error || failed, 'Server Control');
      },
      error: error => {
        console.error(`[server-lifecycle] ${channel} failed:`, error);
        this.notificationService.error(failed, 'Server Control');
      }
    });
  }

  private reportFailedRequest(action: string, server: ServerInstance, error: unknown): void {
    console.error(`[server-lifecycle] Could not ${action} ${server.id}:`, error);
    this.notificationService.error(`Could not ${action} ${server.name || server.id}`, 'Server Control');
  }
}
