import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { MessagingService } from './messaging/messaging.service';
import { WebSocketService } from './web-socket.service';
import { IpcService } from './ipc.service';
import { isLocalPageHost } from '../utils/format.utils';

interface MeshMember {
  nodeId: string;
  name: string;
  status?: string;
  maintenance?: boolean;
  connected?: boolean;
  /** The host other machines dial: a name, when one was given in Change address. */
  host?: string;
}

interface MeshStatusMembers {
  enabled?: boolean;
  /** This machine. */
  nodeId?: string | null;
  nodes?: MeshMember[];
}

/** A machine a server can be moved to. */
export interface MoveDestination {
  nodeId: string;
  name: string;
}

/**
 * The machines in this machine's mesh: their names, to show which one a server runs on, and
 * which can take a server. Empty outside a mesh. Kept current from mesh-status, which follows
 * joins, leaves, renames and who is reachable.
 */
@Injectable({ providedIn: 'root' })
export class MeshNodesService implements OnDestroy {
  private members: MeshMember[] = [];
  private localNodeId: string | null = null;
  private fingerprint = '';
  private readonly changes = new BehaviorSubject<void>(undefined);
  private readonly subs: Subscription[] = [];

  constructor(private messaging: MessagingService, webSocket: WebSocketService, ipc: IpcService) {
    this.subs.push(this.messaging.receiveMessage<MeshStatusMembers>('mesh-status').subscribe(status => this.apply(status)));
    // The web UI asks once its socket is up: a request before that is dropped. The desktop app
    // has no socket and asks now; both ask again after a sign-in.
    this.subs.push(webSocket.connected$.pipe(filter(connected => connected)).subscribe(() => this.refresh()));
    if (ipc.isElectron) this.refresh();
    this.subs.push(this.messaging.receiveMessage('mesh-auth-changed').subscribe(() => this.refresh()));
  }

  ngOnDestroy(): void {
    this.subs.forEach(sub => sub.unsubscribe());
  }

  /** Emits whenever a name, or what a machine can take, may have changed. */
  get changed$(): Observable<void> {
    return this.changes.asObservable();
  }

  /** The machine's name; empty outside a mesh or for a machine no longer in it. */
  nameOf(nodeId: string | null | undefined): string {
    return (nodeId && this.members.find(member => member.nodeId === nodeId)?.name) || '';
  }

  /**
   * The machines a server can be moved to: members that are reachable and not draining, other
   * than the one hosting it. A server without a node is on this machine.
   */
  destinationsFor(server: { nodeId?: string | null }): MoveDestination[] {
    const host = server.nodeId || this.localNodeId;
    return this.members
      .filter(member => member.nodeId !== host && member.status !== 'removed' && !member.maintenance && !!member.connected)
      .map(member => ({ nodeId: member.nodeId, name: member.name }));
  }

  /**
   * The machines a new server can be created on: every member reachable now. One skipping new
   * servers is offered but says so; Auto-select passes it over.
   */
  placementChoices(): Array<{ nodeId: string; name: string; skipping: boolean }> {
    return this.members
      .filter(member => member.status !== 'removed' && !!member.connected)
      .map(member => ({ nodeId: member.nodeId, name: member.name, skipping: !!member.maintenance }));
  }

  /**
   * The host players connect to for a server: its machine's address, a stable name when one was
   * set. Null to use the page's own host: outside a mesh, or for a server on this machine when
   * the page was opened by a name other machines can use.
   */
  joinHostFor(server: { nodeId?: string | null }, pageHost: string): string | null {
    const member = this.members.find(item => item.nodeId === (server.nodeId || this.localNodeId));
    if (!member?.host) return null;
    if (member.nodeId === this.localNodeId && !isLocalPageHost(pageHost)) return null;
    return member.host;
  }

  /** Whether a server runs on this machine: outside a mesh, or with no node, it does. */
  isHere(nodeId: string | null | undefined): boolean {
    return !nodeId || !this.localNodeId || nodeId === this.localNodeId;
  }

  /** The machines of the mesh, to filter servers by; empty outside a mesh. */
  machines(): Array<{ nodeId: string; name: string }> {
    return this.members
      .filter(member => member.status !== 'removed')
      .map(member => ({ nodeId: member.nodeId, name: member.name }));
  }

  refresh(): void {
    this.messaging.sendMessage<MeshStatusMembers>('get-mesh-status', {}).subscribe({
      next: status => this.apply(status),
      error: () => { /* the machines stay as they were */ }
    });
  }

  private apply(status: MeshStatusMembers | null | undefined): void {
    if (!status || typeof status.enabled !== 'boolean') return;
    const members = status.enabled ? (status.nodes || []) : [];
    const localNodeId = status.enabled ? status.nodeId || null : null;
    const fingerprint = JSON.stringify([localNodeId, members.map(member =>
      [member.nodeId, member.name, member.status, !!member.maintenance, !!member.connected, member.host || ''])]);
    if (fingerprint === this.fingerprint) return;
    this.fingerprint = fingerprint;
    this.members = members;
    this.localNodeId = localNodeId;
    this.changes.next();
  }
}
