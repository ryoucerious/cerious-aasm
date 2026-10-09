import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { MessagingService } from './messaging/messaging.service';
import { WebSocketService } from './web-socket.service';
import { IpcService } from './ipc.service';
import type { ServerPortRanges } from './firewall.service';
import { isLocalPageHost } from '../utils/format.utils';

interface MeshMember {
  nodeId: string;
  name: string;
  status?: string;
  maintenance?: boolean;
  connected?: boolean;
  /** The host other machines dial: a name, when one was given in Change address. */
  host?: string;
  /** From its heartbeat: the ranges its servers take their ports from, and whether its firewall lets players in. */
  capabilities?: { serverPorts?: { ranges: ServerPortRanges; portsOpen: boolean | null } };
}

interface MeshStatusMembers {
  enabled?: boolean;
  /** This machine. */
  nodeId?: string | null;
  nodes?: MeshMember[];
  /** Too few machines can be reached for the mesh to agree on a change. */
  degraded?: boolean;
  voterCount?: number;
  /** In a mesh, not yet back in touch with it after a restart. */
  reconnecting?: boolean;
  /** Every machine this one reaches refuses it: the others removed it. */
  removedFromMesh?: boolean;
}

/**
 * How the mesh stands, in a word and a count: every machine reachable, only some while the
 * mesh can still agree, too few to agree, this machine reconnecting, or removed by the others.
 */
export interface MeshHealth {
  state: 'healthy' | 'partial' | 'degraded' | 'reconnecting' | 'removed';
  reachable: number;
  total: number;
  /** How many must be reached for the mesh to agree on a change: a majority. */
  needed: number;
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
  private meshHealth: MeshHealth | null = null;
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

  /** How the mesh stands; null outside a mesh. */
  get health(): MeshHealth | null {
    return this.meshHealth;
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

  /**
   * The ranges a machine's servers take their ports from, and whether its firewall lets players
   * reach them, with its name. Null for a machine that has not said, or outside a mesh.
   */
  serverPortsOf(nodeId: string): { name: string; ranges: ServerPortRanges; portsOpen: boolean | null } | null {
    const member = this.members.find(item => item.nodeId === nodeId);
    const ports = member?.capabilities?.serverPorts;
    return member && ports?.ranges ? { name: member.name, ranges: ports.ranges, portsOpen: ports.portsOpen ?? null } : null;
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
    const health = healthOf(status, members);
    const fingerprint = JSON.stringify([localNodeId, health, members.map(member =>
      [member.nodeId, member.name, member.status, !!member.maintenance, !!member.connected, member.host || '', member.capabilities?.serverPorts ?? null])]);
    if (fingerprint === this.fingerprint) return;
    this.fingerprint = fingerprint;
    this.members = members;
    this.localNodeId = localNodeId;
    this.meshHealth = health;
    this.changes.next();
  }
}

function healthOf(status: MeshStatusMembers, members: MeshMember[]): MeshHealth | null {
  if (!status.enabled) return status.reconnecting ? { state: 'reconnecting', reachable: 0, total: 0, needed: 0 } : null;
  const current = members.filter(member => member.status !== 'removed');
  const total = status.voterCount || current.length;
  const reachable = current.filter(member => member.connected).length;
  const needed = Math.floor(total / 2) + 1;
  const state = status.removedFromMesh ? 'removed'
    : status.degraded ? 'degraded'
    : reachable < current.length ? 'partial'
    : 'healthy';
  return { state, reachable, total, needed };
}
