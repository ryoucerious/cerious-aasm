import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { MessagingService } from './messaging/messaging.service';

interface LogEntry {
  instanceId: string;
  line: string;
}

@Injectable({
  providedIn: 'root'
})
export class ServerStateService {
  
  private allLogs: LogEntry[] = [];
  private lastBulkLogLine: { [instanceId: string]: string | null } = {};
  private subscriptions: Subscription[] = [];
  
  // Observable for logs
  private logsSubject = new BehaviorSubject<LogEntry[]>([]);
  public logs$ = this.logsSubject.asObservable();

  constructor(private messaging: MessagingService) {
    this.initializeSubscriptions();
  }

  /**
   * Initialize messaging subscriptions for log and state management
   */
  private initializeSubscriptions(): void {
    // Listen for bulk server instance logs
    this.subscriptions.push(
      this.messaging.receiveMessage('server-instance-bulk-logs').subscribe((msg: any) => {
        if (msg && msg.logs && msg.instanceId) {
          // Clear old logs for this instance
          this.allLogs = this.allLogs.filter(l => l.instanceId !== msg.instanceId);
          
          // Add new logs
          const lines = msg.logs.split('\n').filter((line: string) => line.trim());
          lines.forEach((line: string) => {
            this.allLogs.push({ instanceId: msg.instanceId, line });
          });
          
          this.lastBulkLogLine[msg.instanceId] = lines.length > 0 ? lines[lines.length - 1] : null;
          
          // Trim to last 1000 logs per instance
          const logsForId = this.allLogs.filter(l => l.instanceId === msg.instanceId);
          if (logsForId.length > 1000) {
            this.allLogs = this.allLogs.filter(l => {
              return l.instanceId !== msg.instanceId || logsForId.indexOf(l) >= logsForId.length - 1000;
            });
          }
          
          this.logsSubject.next([...this.allLogs]);
        }
      })
    );

    // Listen for get-server-instance-logs response (handles initial log loading on refresh)
    this.subscriptions.push(
      this.messaging.receiveMessage('get-server-instance-logs').subscribe((msg: any) => {
        if (msg && msg.log && msg.instanceId) {
          // Clear old logs for this instance
          this.allLogs = this.allLogs.filter(l => l.instanceId !== msg.instanceId);
          
          // Process log response - could be string array or string
          let lines: string[] = [];
          if (Array.isArray(msg.log)) {
            lines = msg.log.filter((line: string) => line && line.trim());
          } else if (typeof msg.log === 'string') {
            lines = msg.log.split('\n').filter((line: string) => line.trim());
          }
          
          // Add new logs
          lines.forEach((line: string) => {
            this.allLogs.push({ instanceId: msg.instanceId, line });
          });
          
          this.lastBulkLogLine[msg.instanceId] = lines.length > 0 ? lines[lines.length - 1] : null;
          
          // Trim to last 1000 logs per instance
          const logsForId = this.allLogs.filter(l => l.instanceId === msg.instanceId);
          if (logsForId.length > 1000) {
            this.allLogs = this.allLogs.filter(l => {
              return l.instanceId !== msg.instanceId || logsForId.indexOf(l) >= logsForId.length - 1000;
            });
          }
          
          this.logsSubject.next([...this.allLogs]);
        }
      })
    );

    // Listen for individual server instance logs
    this.subscriptions.push(
      this.messaging.receiveMessage('server-instance-log').subscribe((msg: any) => {
        if (msg && msg.log && msg.instanceId) {
          const line = msg.log.trim();
          if (line && line !== this.lastBulkLogLine[msg.instanceId]) {
            // Avoid duplicates
            const exists = this.allLogs.some(l => l.instanceId === msg.instanceId && l.line === line);
            if (!exists) {
              this.allLogs.push({ instanceId: msg.instanceId, line });
              
              // Trim logs if we exceed 1000 per instance
              const ids = new Set(this.allLogs.map(l => l.instanceId));
              ids.forEach(id => {
                const logsForId = this.allLogs.filter(l => l.instanceId === id);
                if (logsForId.length > 1000) {
                  this.allLogs = this.allLogs.filter(l => {
                    return l.instanceId !== id || logsForId.indexOf(l) >= logsForId.length - 1000;
                  });
                }
              });
              
              this.logsSubject.next([...this.allLogs]);
            }
          }
        }
      })
    );
  }

  /**
   * Get filtered logs for a specific instance
   */
  getLogsForInstance(instanceId: string): string[] {
    if (!instanceId) return [];
    return this.allLogs.filter(l => l.instanceId === instanceId).map(l => l.line);
  }

  /**
   * Clear logs for a specific instance
   */
  clearLogsForInstance(instanceId: string): void {
    this.allLogs = this.allLogs.filter(l => l.instanceId !== instanceId);
    this.logsSubject.next([...this.allLogs]);
  }

  /**
   * Maps backend state values to display values for the UI.
   * Accepts lowercase, uppercase, or mixed-case from backend.
   */
  mapServerState(state: string | null | undefined): string {
    if (!state || state.toLowerCase() === 'unknown') return 'Stopped';
    switch (state.toLowerCase()) {
      case 'starting': return 'Starting';
      case 'running': return 'Running';
      case 'stopping': return 'Stopping';
      case 'stopped': return 'Stopped';
      case 'error': return 'Error';
      case 'already-running': return 'Already Running';
      case 'instance-folder-missing': return 'Instance Folder Missing';
      // Note: 'not-installed' removed - servers should show 'Stopped' to allow starting after installation
      default: return state.charAt(0).toUpperCase() + state.slice(1);
    }
  }

  /**
   * Check if an instance can be started based on its current state
   */
  canStartInstance(state: string | null | undefined): boolean {
    const mappedState = this.mapServerState(state);
    return mappedState === 'Stopped' || mappedState === 'Error' || mappedState === 'Unknown';
  }

  /**
   * Check if settings should be locked based on server state
   */
  areSettingsLocked(state: string | null | undefined): boolean {
    const mappedState = this.mapServerState(state);
    return mappedState === 'Starting' || mappedState === 'Stopping' || mappedState === 'Running';
  }

  /**
   * Check if backup settings should be locked based on server state
   */
  areBackupSettingsLocked(state: string | null | undefined): boolean {
    const mappedState = this.mapServerState(state);
    // Only lock backup settings during Starting/Stopping, allow during Running
    return mappedState === 'Starting' || mappedState === 'Stopping';
  }

  /**
   * Clean up subscriptions
   */
  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }
}