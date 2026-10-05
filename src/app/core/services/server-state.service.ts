import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject, Subscription } from 'rxjs';
import { MessagingService } from './messaging/messaging.service';

/** Lines kept per server; the oldest drop off the front. */
const MAX_LOG_LINES = 1000;

interface InstanceLogMessage {
  instanceId?: string;
  /** Bulk load: the whole tail as one string. */
  logs?: string;
  /** Reply to get-server-instance-logs (string or lines), or one live line. */
  log?: string | string[];
}

function isNonBlank(line: unknown): line is string {
  return typeof line === 'string' && line.trim().length > 0;
}

@Injectable({
  providedIn: 'root'
})
export class ServerStateService implements OnDestroy {
  /** Each change stores a new array, so a view bound to the old one sees the update. */
  private readonly logs = new Map<string, string[]>();
  /** Last line of the latest bulk load: the live stream can deliver it once more. */
  private readonly bulkTail = new Map<string, string>();
  private readonly logsChangedSubject = new Subject<string>();
  private readonly subscriptions: Subscription[] = [];

  constructor(private messaging: MessagingService) {
    this.subscriptions.push(
      this.messaging.receiveMessage<InstanceLogMessage>('server-instance-bulk-logs').subscribe(msg => {
        if (msg?.instanceId && msg.logs) this.replaceLog(msg.instanceId, msg.logs);
      }),
      this.messaging.receiveMessage<InstanceLogMessage>('get-server-instance-logs').subscribe(msg => {
        if (msg?.instanceId && msg.log) this.replaceLog(msg.instanceId, msg.log);
      }),
      this.messaging.receiveMessage<InstanceLogMessage>('server-instance-log').subscribe(msg => {
        if (msg?.instanceId && typeof msg.log === 'string') this.appendLine(msg.instanceId, msg.log.trim());
      })
    );
  }

  /** Emits the id of each instance whose log changed. */
  get logsChanged$(): Observable<string> {
    return this.logsChangedSubject.asObservable();
  }

  getLogsForInstance(instanceId: string): string[] {
    return (instanceId && this.logs.get(instanceId)) || [];
  }

  clearLogsForInstance(instanceId: string): void {
    this.logs.delete(instanceId);
    this.bulkTail.delete(instanceId);
    this.logsChangedSubject.next(instanceId);
  }

  /** Backend state (any case) to the words the server page shows. */
  mapServerState(state: string | null | undefined): string {
    if (!state || state.toLowerCase() === 'unknown') return 'Stopped';
    switch (state.toLowerCase()) {
      case 'queued': return 'Preparing to start';
      case 'starting': return 'Starting';
      case 'running': return 'Running';
      case 'stopping': return 'Stopping';
      case 'stopped': return 'Stopped';
      case 'crashed': return 'Crashed';
      case 'error': return 'Error';
      case 'already-running': return 'Already Running';
      case 'instance-folder-missing': return 'Instance Folder Missing';
      default: return state.charAt(0).toUpperCase() + state.slice(1);
    }
  }

  areSettingsLocked(state: string | null | undefined): boolean {
    const mappedState = this.mapServerState(state);
    return mappedState === 'Preparing to start' || mappedState === 'Starting' || mappedState === 'Stopping' || mappedState === 'Running';
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  private replaceLog(instanceId: string, log: string | string[]): void {
    const lines = (Array.isArray(log) ? log : log.split('\n')).filter(isNonBlank);
    const tail = lines[lines.length - 1];
    if (tail) this.bulkTail.set(instanceId, tail);
    else this.bulkTail.delete(instanceId);
    this.setLog(instanceId, lines.slice(-MAX_LOG_LINES));
  }

  private appendLine(instanceId: string, line: string): void {
    if (!line) return;
    const tail = this.bulkTail.get(instanceId);
    this.bulkTail.delete(instanceId);
    if (line === tail) return;

    const current = this.getLogsForInstance(instanceId);
    const kept = current.length < MAX_LOG_LINES ? current : current.slice(1);
    this.setLog(instanceId, [...kept, line]);
  }

  private setLog(instanceId: string, lines: string[]): void {
    this.logs.set(instanceId, lines);
    this.logsChangedSubject.next(instanceId);
  }
}
