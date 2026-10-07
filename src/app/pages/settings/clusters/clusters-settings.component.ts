import { Component, OnInit, OnDestroy, ChangeDetectorRef, ChangeDetectionStrategy, NgZone } from '@angular/core';
import { NgIf, NgFor, NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ModalComponent } from '../../../components/modal/modal.component';
import { ClusterOption, ClusterReply, ClustersService } from '../../../core/services/clusters.service';
import { MessagingService } from '../../../core/services/messaging/messaging.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { LiveServersService } from '../../../core/services/live-servers.service';
import { MeshNodesService } from '../../../core/services/mesh-nodes.service';
import { ServerInstance } from '../../../core/models/server-instance.model';
import { PERMISSIONS } from '../../../core/models/auth.model';

/** How one machine's copy of a cluster's transfer files stands, as its heartbeat reports it. */
interface ClusterSyncState {
  files: number;
  pendingSend: number;
  pendingReceive: number;
  conflicts: number;
  lastSyncAt: number;
  error: string | null;
}

interface MeshMachine {
  nodeId: string;
  name: string;
  status?: string;
  connected?: boolean;
  clusterSync?: Record<string, ClusterSyncState> | null;
}

interface MeshView {
  enabled: boolean;
  degraded?: boolean;
  nodeId?: string | null;
  nodes?: MeshMachine[];
}

export interface MachineSync {
  nodeId: string;
  name: string;
  text: string;
  tone: string;
}

/** Each machine reports at its heartbeat; the page looks again this often while it is open. */
const MESH_REFRESH_MS = 5_000;

/**
 * Settings → Clusters: the ARK clusters servers can join. A server chooses its cluster on its
 * Cluster tab. In a mesh the app keeps each cluster's transfer files on every machine, so a
 * player can upload on one machine and download on another with no shared folder.
 */
@Component({
  selector: 'app-clusters-settings',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, FormsModule, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './clusters-settings.component.html',
  styleUrls: ['./clusters-settings.component.scss']
})
export class ClustersSettingsComponent implements OnInit, OnDestroy {
  clusters: ClusterOption[] = [];
  mesh: MeshView | null = null;
  /** The servers in each cluster, by cluster id. */
  members: Record<string, ServerInstance[]> = {};

  createName = '';
  createId = '';
  busy = false;
  renamingId: string | null = null;
  renameText = '';
  removing: ClusterOption | null = null;

  /** Once an ID is typed, the name stops suggesting one. */
  private idTyped = false;
  private servers: ServerInstance[] = [];
  private readonly subs = new Subscription();
  private meshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private clustersService: ClustersService,
    private messaging: MessagingService,
    private notification: NotificationService,
    private auth: AuthService,
    private liveServers: LiveServersService,
    private meshNodes: MeshNodesService,
    private cdr: ChangeDetectorRef,
    private zone: NgZone
  ) {}

  ngOnInit(): void {
    this.subs.add(this.clustersService.clusters$.subscribe(clusters => {
      this.clusters = clusters;
      this.groupServers();
    }));
    this.subs.add(this.liveServers.servers$.subscribe(servers => {
      this.servers = servers;
      this.groupServers();
    }));
    this.subs.add(this.messaging.receiveMessage<MeshView>('mesh-status').subscribe(status => this.applyMesh(status)));
    this.refreshMesh();
    // Outside Angular's zone, so a page left open does not keep the app from settling.
    this.zone.runOutsideAngular(() => {
      this.meshTimer = setInterval(() => {
        if (this.inMesh) this.zone.run(() => this.refreshMesh());
      }, MESH_REFRESH_MS);
    });
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    if (this.meshTimer) clearInterval(this.meshTimer);
  }

  get inMesh(): boolean {
    return !!this.mesh?.enabled;
  }

  get canManage(): boolean {
    return this.auth.can(PERMISSIONS.CLUSTERS_MANAGE);
  }

  /** Changes to the mesh's clusters need quorum. */
  get held(): boolean {
    return this.inMesh && !!this.mesh?.degraded;
  }

  onCreateName(name: string): void {
    this.createName = name;
    if (!this.idTyped) this.createId = suggestId(name);
  }

  onCreateId(id: string): void {
    this.createId = id;
    this.idTyped = id !== '';
  }

  create(): void {
    this.busy = true;
    this.clustersService.create(this.createName, this.createId).subscribe({
      next: reply => {
        this.busy = false;
        if (!reply?.success) {
          this.notification.error(reply?.error || 'Could not create that cluster.');
        } else {
          this.notification.success(`Cluster ${reply.cluster?.name || this.createName} created. Choose it on a server's Cluster tab.`);
          this.createName = '';
          this.createId = '';
          this.idTyped = false;
          this.clustersService.refresh();
        }
        this.cdr.markForCheck();
      },
      error: () => this.failed('Could not create that cluster.')
    });
  }

  startRename(cluster: ClusterOption): void {
    this.renamingId = cluster.clusterId;
    this.renameText = cluster.name;
    this.cdr.markForCheck();
  }

  cancelRename(): void {
    this.renamingId = null;
    this.cdr.markForCheck();
  }

  saveRename(cluster: ClusterOption): void {
    this.clustersService.rename(cluster.clusterId, this.renameText).subscribe({
      next: reply => this.after(reply, 'Could not rename that cluster.', () => { this.renamingId = null; }),
      error: () => this.failed('Could not rename that cluster.')
    });
  }

  setUploadNotices(cluster: ClusterOption, enabled: boolean): void {
    this.clustersService.setUploadNotices(cluster.clusterId, enabled).subscribe({
      next: reply => {
        if (!reply?.success) this.notification.error(reply?.error || 'Could not change that cluster.');
        // Either way: a refused change puts the switch back as it was.
        this.clustersService.refresh();
        this.cdr.markForCheck();
      },
      error: () => {
        this.notification.error('Could not change that cluster.');
        this.clustersService.refresh();
      }
    });
  }

  askRemove(cluster: ClusterOption): void {
    this.removing = cluster;
    this.cdr.markForCheck();
  }

  cancelRemove(): void {
    this.removing = null;
    this.cdr.markForCheck();
  }

  confirmRemove(): void {
    const cluster = this.removing;
    this.removing = null;
    if (!cluster) return;
    this.clustersService.remove(cluster.clusterId).subscribe({
      next: reply => this.after(reply, 'Could not remove that cluster.', () => this.notification.success(`Cluster ${cluster.name} removed.`)),
      error: () => this.failed('Could not remove that cluster.')
    });
    this.cdr.markForCheck();
  }

  /** What the confirmation says happens to the cluster's servers and files. */
  get removeSummary(): string {
    if (!this.removing) return '';
    const count = (this.members[this.removing.clusterId] || []).length;
    const servers = count === 0
      ? 'No server is in it.'
      : count === 1 ? 'Its 1 server leaves the cluster at its next start.' : `Its ${count} servers leave the cluster at their next start.`;
    return `Remove ${this.removing.name}? ${servers} The transfer files already on each machine stay in its folder.`;
  }

  /** The machine a server runs on, in a mesh. */
  machineOf(server: ServerInstance): string {
    return this.inMesh ? this.meshNodes.nameOf(server.nodeId) : '';
  }

  /** Each machine of the mesh, and how its copy of the cluster's transfer files stands. */
  syncOf(cluster: ClusterOption): MachineSync[] {
    if (!this.inMesh || cluster.managed === false) return [];
    return (this.mesh?.nodes || [])
      .filter(node => node.status !== 'removed')
      .map(node => ({ nodeId: node.nodeId, name: node.name, ...this.syncState(cluster, node) }));
  }

  /** True when a machine set a copy aside: two machines changed one player's file at once. */
  hasConflicts(cluster: ClusterOption): boolean {
    return (this.mesh?.nodes || []).some(node => (node.clusterSync?.[cluster.clusterId]?.conflicts || 0) > 0);
  }

  trackByClusterId(_index: number, cluster: ClusterOption): string {
    return cluster.clusterId;
  }

  private syncState(cluster: ClusterOption, node: MeshMachine): { text: string; tone: string } {
    if (!node.connected && node.nodeId !== this.mesh?.nodeId) return { text: 'Unreachable', tone: 'tone-danger' };
    const sync = node.clusterSync?.[cluster.clusterId];
    if (!sync) return { text: 'No report yet', tone: 'tone-muted' };
    if (sync.error) return { text: sync.error, tone: 'tone-danger' };
    const parts: string[] = [];
    if (sync.pendingSend) parts.push(`Sending ${sync.pendingSend}`);
    if (sync.pendingReceive) parts.push(`Receiving ${sync.pendingReceive}`);
    const moving = parts.length > 0;
    if (!moving) parts.push('Up to date');
    parts.push(`${sync.files} ${sync.files === 1 ? 'file' : 'files'}`);
    if (sync.conflicts) parts.push(`${sync.conflicts} set aside`);
    return { text: parts.join(' · '), tone: moving || sync.conflicts ? 'tone-warning' : 'tone-success' };
  }

  private refreshMesh(): void {
    this.messaging.sendMessage<MeshView>('get-mesh-status', {}).subscribe({
      next: status => this.applyMesh(status),
      error: () => { /* the last status stays */ }
    });
  }

  private applyMesh(status: MeshView | null | undefined): void {
    if (!status || typeof status.enabled !== 'boolean') return;
    this.mesh = status;
    this.cdr.markForCheck();
  }

  private groupServers(): void {
    const members: Record<string, ServerInstance[]> = {};
    for (const server of this.servers) {
      if (server.clusterRef) (members[server.clusterRef] ||= []).push(server);
    }
    this.members = members;
    this.cdr.markForCheck();
  }

  private after(reply: ClusterReply | null | undefined, fallback: string, done: () => void): void {
    if (!reply?.success) {
      this.notification.error(reply?.error || fallback);
    } else {
      done();
      this.clustersService.refresh();
    }
    this.cdr.markForCheck();
  }

  private failed(message: string): void {
    this.busy = false;
    this.notification.error(message);
    this.cdr.markForCheck();
  }
}

/** An ARK cluster ID from a name: the characters ARK and every machine's folders take. */
function suggestId(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '').replace(/^[^A-Za-z0-9]+/, '').slice(0, 64);
}
