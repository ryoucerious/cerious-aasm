import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { MessagingService } from './messaging/messaging.service';
import { WebSocketService } from './web-socket.service';
import { IpcService } from './ipc.service';

interface MeshStatusNames {
  enabled?: boolean;
  nodes?: Array<{ nodeId: string; name: string }>;
}

/**
 * The names of the machines in this machine's mesh, to show which one a server runs on. Empty
 * outside a mesh. Kept current from mesh-status, which follows joins, leaves and renames.
 */
@Injectable({ providedIn: 'root' })
export class MeshNodesService implements OnDestroy {
  private names = new Map<string, string>();
  private readonly changes = new BehaviorSubject<void>(undefined);
  private readonly subs: Subscription[] = [];

  constructor(private messaging: MessagingService, webSocket: WebSocketService, ipc: IpcService) {
    this.subs.push(this.messaging.receiveMessage<MeshStatusNames>('mesh-status').subscribe(status => this.apply(status)));
    // The web UI asks once its socket is up: a request before that is dropped. The desktop app
    // has no socket and asks now; both ask again after a sign-in.
    this.subs.push(webSocket.connected$.pipe(filter(connected => connected)).subscribe(() => this.refresh()));
    if (ipc.isElectron) this.refresh();
    this.subs.push(this.messaging.receiveMessage('mesh-auth-changed').subscribe(() => this.refresh()));
  }

  ngOnDestroy(): void {
    this.subs.forEach(sub => sub.unsubscribe());
  }

  /** Emits whenever a name may have changed. */
  get changed$(): Observable<void> {
    return this.changes.asObservable();
  }

  /** The machine's name; empty outside a mesh or for a machine no longer in it. */
  nameOf(nodeId: string | null | undefined): string {
    return nodeId ? this.names.get(nodeId) || '' : '';
  }

  refresh(): void {
    this.messaging.sendMessage<MeshStatusNames>('get-mesh-status', {}).subscribe({
      next: status => this.apply(status),
      error: () => { /* the names stay as they were */ }
    });
  }

  private apply(status: MeshStatusNames | null | undefined): void {
    if (!status || typeof status.enabled !== 'boolean') return;
    const next = new Map(status.enabled ? (status.nodes || []).map(node => [node.nodeId, node.name] as [string, string]) : []);
    const same = next.size === this.names.size && [...next].every(([id, name]) => this.names.get(id) === name);
    if (same) return;
    this.names = next;
    this.changes.next();
  }
}
