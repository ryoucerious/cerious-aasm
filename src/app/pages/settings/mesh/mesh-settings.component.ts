import { Component, OnInit, OnDestroy, ChangeDetectorRef, ChangeDetectionStrategy, HostListener } from '@angular/core';
import { NgIf, NgFor, NgClass, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ModalComponent } from '../../../components/modal/modal.component';
import { MESH_ADDRESS_TIMEOUT_MS, MessagingService } from '../../../core/services/messaging/messaging.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { BusyService } from '../../../core/services/busy.service';
import { PERMISSIONS } from '../../../core/models/auth.model';
import { copyToClipboard } from '../../../core/utils/clipboard.utils';
import { formatRelativeTime } from '../../../core/utils/format.utils';

/** Where other machines reach one: a host, and the TCP ports they dial. */
interface MeshAddress {
  host: string;
  peerPort: number;
  raftPort: number;
}

/** An address as it is being typed: the ports are whatever the number boxes hold. */
interface AddressForm {
  host: string;
  peerPort: number | null;
  raftPort: number | null;
}

interface MeshNode {
  nodeId: string;
  name: string;
  status: string;
  maintenance: boolean;
  version: string;
  connected?: boolean;
  address?: MeshAddress | null;
  /** When this machine last heard from it; null when never. */
  lastContactAt?: number | null;
  /** How an ARK update on it is going, from its heartbeat. */
  arkUpdate?: { phase: string; message: string; minutesLeft?: number; percent?: number; at: number } | null;
  /**
   * From its heartbeat: portsOpen is false while Windows Firewall keeps players out of its server
   * ports; ark is its ARK build against Steam's latest, absent until it reports one.
   */
  capabilities?: {
    serverPorts?: { portsOpen: boolean | null };
    ark?: { installedBuild: string | null; latestBuild: string | null; updateAvailable: boolean };
  };
}

interface MeshStatus {
  enabled: boolean;
  degraded: boolean;
  meshName: string | null;
  nodeId: string | null;
  nodeName: string | null;
  voterCount: number;
  warning: string | null;
  nodes: MeshNode[];
  /** In a mesh, not yet back in touch with it after a restart. */
  reconnecting?: boolean;
  /** Outside a mesh: why this machine cannot run the mesh database, so it cannot create or join one. */
  blocker?: string | null;
  /** Every machine this one reaches refuses it: the others removed it while it was away. */
  removedFromMesh?: boolean;
  /** Where other machines reach this one, or would if it created or joined a mesh now. */
  advertise?: MeshAddress;
  /** Just after a join: the machine admin made for this machine's own admin password. */
  machineAdmin?: string;
}

const DEFAULT_PEER_PORT = 4747;
const DEFAULT_RAFT_PORT = 4002;

/**
 * Create or join a mesh, and see the nodes that share it.
 * A standalone install leaves this unused: nothing here starts rqlite until Create or Join.
 */
@Component({
  selector: 'app-mesh-settings',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, NgTemplateOutlet, FormsModule, ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mesh-settings.component.html',
  styleUrls: ['./mesh-settings.component.scss']
})
export class MeshSettingsComponent implements OnInit, OnDestroy {
  status: MeshStatus | null = null;
  createName = 'Mesh';
  adminUsername = 'admin';
  adminPassword = '';
  memberUrl = '';
  token = '';
  issuedToken = '';
  issuedExpiresAt: number | null = null;
  /** The reachability check, a line a machine. */
  diagnosticLines: string[] = [];
  wireguardText = '';
  busy = false;
  updatingKey = '';
  showConfirmLeave = false;
  /** Takes the app's overlay down once the mesh answers; null while nothing is under way. */
  private doneWorking: (() => void) | null = null;
  /** Leave anyway: without the others, which cannot agree or removed this machine. */
  showLeaveAnyway = false;
  /** Force remove: the machines ticked to be taken out of a mesh that cannot agree. */
  showForceRemove = false;
  forceRemoveIds = new Set<string>();
  forceRemoving = false;
  /** The machine whose name is being edited, and the name typed so far. */
  renamingNodeId: string | null = null;
  renameText = '';
  /** The machine whose address is being changed, and the address typed so far. */
  addressNodeId: string | null = null;
  addressForm: AddressForm = { host: '', peerPort: null, raftPort: null };
  savingAddress = false;
  /** Create or join at another address than this machine's own, such as a public one. */
  otherAddress = false;
  ownAddress: AddressForm = { host: '', peerPort: null, raftPort: null };
  private leavingNode: MeshNode | null = null;
  private statusSub?: Subscription;

  constructor(
    private messaging: MessagingService,
    private notification: NotificationService,
    private auth: AuthService,
    private busyOverlay: BusyService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.refresh();
    this.statusSub = this.messaging.receiveMessage<MeshStatus>('mesh-status').subscribe(status => this.apply(status));
  }

  ngOnDestroy(): void {
    this.statusSub?.unsubscribe();
  }

  refresh(): void {
    this.messaging.sendMessage<MeshStatus>('get-mesh-status', {}).subscribe({
      next: status => this.apply(status),
      error: () => this.cdr.markForCheck()
    });
  }

  create(): void {
    if (this.needsAdminPassword && this.adminPassword.length < 8) {
      this.notification.error('The admin password needs at least 8 characters.');
      return;
    }
    this.busy = true;
    this.messaging.sendMessage<{ success?: boolean; error?: string }>('create-mesh', {
      name: this.createName,
      ...(this.needsAdminPassword ? { adminUsername: this.adminUsername, adminPassword: this.adminPassword } : {}),
      ...this.typedAddress()
    }, { timeoutMs: MESH_ADDRESS_TIMEOUT_MS }).subscribe({
      next: result => this.finish(result.success ? 'Mesh created.' : (result.error || 'Could not create the mesh.'), result.success),
      error: () => this.finish('Could not create the mesh.', false)
    });
  }

  /** Shown after a join until the page closes: the name to sign in with from now on. */
  joinedAs: string | null = null;

  join(): void {
    this.busy = true;
    this.messaging.sendMessage<{ success?: boolean; error?: string; status?: MeshStatus }>('join-mesh', {
      // Pasted values often bring spaces or a line break with them.
      memberUrl: this.memberUrl.trim(),
      token: this.token.trim(),
      ...this.typedAddress()
    }, { timeoutMs: MESH_ADDRESS_TIMEOUT_MS }).subscribe({
      next: result => {
        if (result.success && result.status) this.apply(result.status);
        this.joinedAs = result.success ? result.status?.machineAdmin || null : null;
        const joined = this.joinedAs
          ? `Joined the mesh. This machine's admin password now signs in as ${this.joinedAs}.`
          : 'Joined the mesh.';
        this.finish(result.success ? joined : (result.error || 'Could not join.'), result.success);
      },
      error: () => this.finish('Could not join.', false)
    });
  }

  issueToken(): void {
    this.messaging.sendMessage<{ success?: boolean; token?: string; expiresAt?: number; error?: string }>('create-enrollment-token', {}).subscribe({
      next: result => {
        this.issuedToken = result.token || '';
        this.issuedExpiresAt = result.expiresAt ?? null;
        this.notification[result.success ? 'success' : 'error'](result.success ? 'Enrollment token created.' : (result.error || 'Could not create a token.'));
        this.cdr.markForCheck();
      }
    });
  }

  /** When the token issued here stops working. */
  get issuedUntil(): string {
    return this.issuedExpiresAt
      ? new Date(this.issuedExpiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : 'it expires';
  }

  /** What a joining machine types as the join address: this machine's peer URL. */
  get joinAddress(): string {
    const address = this.status?.advertise;
    return address ? `https://${address.host}:${address.peerPort}` : '';
  }

  /** Copied whole: a hand-typed join address once lost a digit. */
  async copy(text: string, what: string): Promise<void> {
    try {
      await copyToClipboard(text);
      this.notification.success(`${what} copied.`);
    } catch {
      this.notification.error(`Could not copy the ${what.toLowerCase()}. Select it and copy it instead.`);
    }
  }

  /** In a mesh that still counts this machine: removed by the others, there is only the way out. */
  get inMesh(): boolean {
    return !!this.status?.enabled && !this.status.removedFromMesh;
  }

  get canUpdate(): boolean {
    return this.auth.can(PERMISSIONS.APP_INSTALL);
  }

  /** The voting machines of the mesh. */
  get machinesTotal(): number {
    return this.status?.voterCount || this.nodes.filter(node => node.status !== 'removed').length;
  }

  get machinesReachable(): number {
    return this.nodes.filter(node => node.status !== 'removed' && node.connected).length;
  }

  /** A change to the mesh is agreed by a majority of its voting machines: 3 of 4, 2 of 3. */
  get quorumNeeded(): number {
    return Math.floor(this.machinesTotal / 2) + 1;
  }

  /** Why a change to the mesh cannot be made now; empty while it can. */
  get quorumReason(): string {
    return this.status?.degraded ? `Waits until ${this.quorumNeeded} of the ${this.machinesTotal} machines can be reached.` : '';
  }

  /**
   * Why a machine cannot be told to update; empty when it can. The request goes to the machine
   * itself, and to another machine only while the mesh has quorum. This one can always update.
   */
  updateBlock(node: MeshNode): string {
    if (!node.connected) return `${node.name} cannot be reached.`;
    if (node.nodeId !== this.status?.nodeId && this.status?.degraded) return 'Updating another machine waits until enough machines can be reached.';
    return '';
  }

  /**
   * Why ARK on a machine cannot be updated now; empty when it can. Only a machine whose ARK is
   * behind Steam's latest build, by its own check, is offered the update.
   */
  arkUpdateBlock(node: MeshNode): string {
    const blocked = this.updateBlock(node);
    if (blocked) return blocked;
    if (this.arkUpdateRunning) return 'A machine is updating ARK. Update one machine at a time.';
    const ark = node.capabilities?.ark;
    if (!ark) return `${node.name} has not reported its ARK build yet.`;
    if (!ark.installedBuild) return `ARK is not installed on ${node.name}.`;
    if (!ark.latestBuild) return `${node.name} has not checked Steam for a new ARK build yet.`;
    if (!ark.updateAvailable) return `ARK is up to date on ${node.name} (build ${ark.installedBuild}).`;
    return '';
  }

  /**
   * By machine: every heartbeat brings a new status, with new objects for the same machines.
   * Rebuilt for each, the cards took away the box being typed in every few seconds.
   */
  trackByNodeId(_index: number, node: MeshNode): string {
    return node.nodeId;
  }

  get nodes(): MeshNode[] {
    return (this.status?.nodes || []).filter(node => node.status !== 'removed');
  }

  /** The machine whose ⋯ menu is open: Rename, Change address and the red action live there. */
  menuNodeId: string | null = null;

  toggleMenu(node: MeshNode, event: Event): void {
    event.stopPropagation();
    this.menuNodeId = this.menuNodeId === node.nodeId ? null : node.nodeId;
    this.cdr.markForCheck();
  }

  @HostListener('document:click')
  @HostListener('document:keydown.escape')
  closeMenu(): void {
    if (this.menuNodeId === null) return;
    this.menuNodeId = null;
    this.cdr.markForCheck();
  }

  get canRemoveNodes(): boolean {
    return this.auth.can(PERMISSIONS.NODES_REMOVE);
  }

  /** Making an enrollment token: Admins only, as the backend has it. */
  get canEnrollNodes(): boolean {
    return this.auth.can(PERMISSIONS.NODES_ENROLL);
  }

  /** Under a machine's menu: why the items greyed out there cannot be used now; empty when all can. */
  menuNote(node: MeshNode): string {
    if (this.status?.degraded) {
      const waiting = [
        ...(this.canManageNodes ? ['Rename', 'Change address'] : []),
        ...(this.removeAction(node) === 'remove' ? [node.nodeId === this.status.nodeId ? 'Leave' : 'Remove'] : [])
      ];
      if (!waiting.length) return '';
      const listed = waiting.length > 1 ? `${waiting.slice(0, -1).join(', ')} and ${waiting[waiting.length - 1]}` : waiting[0];
      return `${listed} ${waiting.length > 1 ? 'wait' : 'waits'} until ${this.quorumNeeded} of the ${this.machinesTotal} machines can be reached.`;
    }
    // Every other machine checks it can reach the new address first, through the machine itself.
    if (this.canManageNodes && !node.connected) return `Change address waits until ${node.name} can be reached.`;
    return '';
  }

  /** When another machine was last heard from; empty for this one, or when the backend does not say. */
  /**
   * A server moved onto a machine whose firewall keeps players out can't be reached, and nobody may
   * be at that machine to answer Windows: one admin prompt there opens the ports for good.
   */
  portsText(node: MeshNode): string {
    if (node.capabilities?.serverPorts?.portsOpen !== false) return '';
    return node.nodeId === this.status?.nodeId
      ? 'Windows Firewall keeps players out of the server ports here. Open them in Settings → Server Defaults → Server Ports.'
      : `Windows Firewall keeps players out of its server ports. Open them in Settings → Server Defaults → Server Ports on ${node.name}.`;
  }

  contactText(node: MeshNode): string {
    if (node.nodeId === this.status?.nodeId || node.lastContactAt === undefined) return '';
    return node.lastContactAt === null ? 'Never heard from' : `Last contact ${formatRelativeTime(node.lastContactAt)}`;
  }

  /** A machine's record holds '0' from its enrollment until its first heartbeat is written. */
  versionText(node: MeshNode): string {
    return node.version && node.version !== '0' ? `Version ${node.version}` : 'Version not reported yet';
  }

  /** Reachability only; a machine skipping new servers says so beside it. */
  connection(node: MeshNode): string {
    return node.connected ? 'Connected' : 'Unreachable';
  }

  connectionTone(node: MeshNode): string {
    return node.connected ? 'tone-success' : 'tone-danger';
  }

  /** The machine whose ARK update is waiting for a yes. */
  confirmingArkUpdate: MeshNode | null = null;

  /** How an ARK update on a machine is going, in a line; empty when none is. */
  arkUpdateText(node: MeshNode): string {
    const update = node.arkUpdate;
    if (!update) return '';
    const percent = typeof update.percent === 'number' ? ` ${update.percent}%` : '';
    switch (update.phase) {
      // The download runs beside the install while the servers keep running.
      case 'copying': return `Updating ARK: copying the install${percent}, servers still up`;
      case 'downloading': return `Updating ARK: downloading${percent}, servers still up`;
      case 'warning': return `Updating ARK: warning players, ${update.minutesLeft ?? '?'} min left`;
      case 'stopping': return 'Updating ARK: stopping servers';
      case 'updating': return typeof update.percent === 'number' ? `Updating ARK: downloading ${update.percent}%` : 'Updating ARK: downloading';
      case 'configuring': return 'Updating ARK: putting the new files in place';
      case 'starting': return 'Updating ARK: starting servers';
      case 'complete': return update.message || 'ARK updated';
      case 'error': return `ARK update failed: ${update.message}`;
      default: return '';
    }
  }

  /** One machine at a time: while one updates, its servers are down and the others carry the players. */
  get arkUpdateRunning(): boolean {
    return this.nodes.some(node => !!node.arkUpdate && node.arkUpdate.phase !== 'complete' && node.arkUpdate.phase !== 'error');
  }

  askArkUpdate(node: MeshNode): void {
    this.confirmingArkUpdate = node;
    this.cdr.markForCheck();
  }

  cancelArkUpdate(): void {
    this.confirmingArkUpdate = null;
    this.cdr.markForCheck();
  }

  confirmArkUpdate(): void {
    const node = this.confirmingArkUpdate;
    this.confirmingArkUpdate = null;
    if (node) this.updateNode(node, 'ark');
    this.cdr.markForCheck();
  }

  /** The machine whose app update is waiting for a yes: the app restarts, and its servers with it. */
  confirmingAppUpdate: MeshNode | null = null;

  askAppUpdate(node: MeshNode): void {
    this.confirmingAppUpdate = node;
    this.cdr.markForCheck();
  }

  cancelAppUpdate(): void {
    this.confirmingAppUpdate = null;
    this.cdr.markForCheck();
  }

  confirmAppUpdate(): void {
    const node = this.confirmingAppUpdate;
    this.confirmingAppUpdate = null;
    if (node) this.updateNode(node, 'app');
    this.cdr.markForCheck();
  }

  updateNode(node: MeshNode, kind: 'ark' | 'app'): void {
    this.updatingKey = `${node.nodeId}:${kind}`;
    this.messaging.sendMessage<{ success?: boolean; error?: string; message?: string }>('mesh-node-update', {
      nodeId: node.nodeId,
      kind
    }).subscribe({
      next: result => {
        this.updatingKey = '';
        if (result.success) this.notification.success(result.message || `Update started on ${node.name}.`);
        else this.notification.error(result.error || 'Update failed.');
        this.refresh();
      },
      error: () => {
        this.updatingKey = '';
        this.notification.error('Update failed.');
        this.cdr.markForCheck();
      }
    });
  }

  get canManageNodes(): boolean {
    return this.auth.can(PERMISSIONS.NODES_MANAGE);
  }

  /** A container goes by its container id until someone names it. */
  startRename(node: MeshNode): void {
    this.renamingNodeId = node.nodeId;
    this.renameText = node.name;
    this.cdr.markForCheck();
  }

  cancelRename(): void {
    this.renamingNodeId = null;
    this.cdr.markForCheck();
  }

  saveRename(node: MeshNode): void {
    this.messaging.sendMessage<{ success?: boolean; error?: string; status?: MeshStatus }>(
      'rename-mesh-node', { nodeId: node.nodeId, name: this.renameText }
    ).subscribe({
      next: result => {
        if (!result?.success) {
          this.notification.error(result?.error || 'Could not rename that machine.');
          return;
        }
        this.renamingNodeId = null;
        this.apply(result.status);
        this.cdr.markForCheck();
      },
      error: () => this.notification.error('Could not rename that machine.')
    });
  }

  /** Skip new servers: Auto-select and moves pass the machine over. Its own servers keep running. */
  setSkipping(node: MeshNode, event: Event): void {
    const maintenance = (event.target as HTMLInputElement).checked;
    this.messaging.sendMessage<{ success?: boolean; error?: string }>('set-node-maintenance', { nodeId: node.nodeId, maintenance }).subscribe({
      next: result => {
        if (result && result.success === false) this.notification.error(result.error || 'Could not change that machine.');
        this.refresh();
      },
      // The switch goes back to what the machine really is.
      error: () => {
        this.notification.error('Could not change that machine.');
        this.refresh();
      }
    });
  }

  /**
   * What the red button on a machine's card does. While the mesh cannot agree, this machine can
   * leave anyway and one that cannot be reached can be forced out; otherwise Remove and Leave.
   */
  /** What the menu offers to take a machine out of the mesh; null for a role that may not. */
  removeAction(node: MeshNode): 'leave-anyway' | 'force-remove' | 'remove' | null {
    if (!this.auth.can(PERMISSIONS.NODES_REMOVE)) return null;
    if (!this.status?.degraded) return 'remove';
    if (node.nodeId === this.status.nodeId) return 'leave-anyway';
    return node.connected ? 'remove' : 'force-remove';
  }

  /** The machines that can be forced out: the ones that cannot be reached, other than this one. */
  get forceRemoveCandidates(): MeshNode[] {
    return this.nodes.filter(node => node.status !== 'removed' && node.nodeId !== this.status?.nodeId && !node.connected);
  }

  /** What the ticked machines would leave: how many stay, how many of those answer, how many must agree. */
  get forceRemovePlan(): { staying: number; reachable: number; needed: number; enough: boolean } {
    const staying = this.nodes.filter(node => node.status !== 'removed' && !this.forceRemoveIds.has(node.nodeId));
    const reachable = staying.filter(node => node.connected).length;
    const needed = Math.floor(staying.length / 2) + 1;
    return { staying: staying.length, reachable, needed, enough: this.forceRemoveIds.size > 0 && reachable >= needed };
  }

  askForceRemove(node: MeshNode): void {
    this.forceRemoveIds = new Set([node.nodeId]);
    this.showForceRemove = true;
    this.cdr.markForCheck();
  }

  toggleForceRemove(nodeId: string, event: Event): void {
    const next = new Set(this.forceRemoveIds);
    if ((event.target as HTMLInputElement).checked) next.add(nodeId);
    else next.delete(nodeId);
    this.forceRemoveIds = next;
    this.cdr.markForCheck();
  }

  cancelForceRemove(): void {
    if (this.forceRemoving) return;
    this.showForceRemove = false;
    this.cdr.markForCheck();
  }

  confirmForceRemove(): void {
    if (!this.forceRemovePlan.enough || this.forceRemoving) return;
    const nodeIds = [...this.forceRemoveIds];
    const names = this.nodes.filter(node => this.forceRemoveIds.has(node.nodeId)).map(node => node.name).join(', ');
    this.forceRemoving = true;
    this.showForceRemove = false;
    this.startWorking(`Forcing out ${names}… The machines that stay restart their part of the mesh, which can take a minute.`);
    this.messaging.sendMessage<{ success?: boolean; error?: string }>('force-remove-mesh-nodes', { nodeIds }, { timeoutMs: MESH_ADDRESS_TIMEOUT_MS }).subscribe({
      next: result => {
        this.forceRemoving = false;
        this.stopWorking();
        if (result?.success) this.notification.success('Removed. The mesh can agree again.');
        else this.notification.error(result?.error || 'Could not force those machines out.');
        this.refresh();
      },
      error: () => {
        this.forceRemoving = false;
        this.stopWorking();
        this.notification.error('Could not force those machines out.');
        this.refresh();
      }
    });
  }

  askLeaveAnyway(): void {
    this.showLeaveAnyway = true;
    this.cdr.markForCheck();
  }

  cancelLeaveAnyway(): void {
    this.showLeaveAnyway = false;
    this.cdr.markForCheck();
  }

  confirmLeaveAnyway(): void {
    this.showLeaveAnyway = false;
    this.startWorking('Leaving the mesh…');
    this.messaging.sendMessage<{ success?: boolean; error?: string }>('leave-mesh-anyway', {}).subscribe({
      next: result => {
        this.stopWorking();
        if (result && result.success === false) this.notification.error(result.error || 'Could not leave the mesh.');
        this.refresh();
        void this.auth.refresh();
      },
      error: () => {
        this.stopWorking();
        this.notification.error('Could not leave the mesh.');
      }
    });
  }

  askRemove(node: MeshNode): void {
    if (node.nodeId === this.status?.nodeId) {
      this.leavingNode = node;
      this.showConfirmLeave = true;
      this.cdr.markForCheck();
      return;
    }
    this.remove(node);
  }

  cancelLeave(): void {
    this.showConfirmLeave = false;
    this.leavingNode = null;
    this.cdr.markForCheck();
  }

  confirmLeave(): void {
    const node = this.leavingNode;
    this.showConfirmLeave = false;
    this.leavingNode = null;
    if (node) this.remove(node);
    this.cdr.markForCheck();
  }

  remove(node: MeshNode): void {
    const leaving = node.nodeId === this.status?.nodeId;
    const failed = leaving ? 'Could not leave the mesh.' : `Could not remove ${node.name}.`;
    this.startWorking(leaving ? 'Leaving the mesh…' : `Removing ${node.name}…`);
    this.messaging.sendMessage<{ success?: boolean; error?: string }>('remove-mesh-node', { nodeId: node.nodeId }, { timeoutMs: MESH_ADDRESS_TIMEOUT_MS }).subscribe({
      next: result => {
        this.stopWorking();
        if (result && result.success === false) this.notification.error(result.error || failed);
        this.refresh();
        if (leaving) void this.auth.refresh();
      },
      error: () => {
        this.stopWorking();
        this.notification.error(failed);
        this.refresh();
      }
    });
  }

  /**
   * Covers the whole app, settings included, with a spinner and `message` until the mesh answers:
   * nothing else may be used while machines are joining it or leaving it.
   */
  private startWorking(message: string): void {
    this.stopWorking();
    this.doneWorking = this.busyOverlay.start(message);
    this.cdr.markForCheck();
  }

  private stopWorking(): void {
    this.doneWorking?.();
    this.doneWorking = null;
    this.cdr.markForCheck();
  }

  diagnostics(): void {
    type Probe = { target?: string; ok?: boolean; rttMs?: number; error?: string };
    this.messaging.sendMessage<{ probes?: Probe[]; skew?: Array<{ nodeId?: string; skewMs?: number }> }>('mesh-diagnostics', {}).subscribe({
      next: result => {
        const probes = (result?.probes || []).map(probe => probe.ok
          ? `${probe.target} answered in ${Math.round(probe.rttMs || 0)} ms.`
          : `${probe.target} did not answer: ${probe.error || 'no reason given'}`);
        // A clock far off spoils sign-ins and the order of changes; a second or two does not matter.
        const clocks = (result?.skew || [])
          .filter(entry => Math.abs(entry.skewMs || 0) >= 2_000)
          .map(entry => {
            const seconds = Math.round(Math.abs(entry.skewMs || 0) / 1000);
            // From two minutes off, in minutes: "237 seconds" does not read at a glance.
            const amount = seconds >= 120 ? `${Math.round(seconds / 60)} minutes` : `${seconds} seconds`;
            const name = this.nodes.find(node => node.nodeId === entry.nodeId)?.name || 'A machine';
            return `${name}'s clock is ${amount} ${(entry.skewMs || 0) > 0 ? 'ahead of' : 'behind'} this machine's.`;
          });
        this.diagnosticLines = probes.length || clocks.length ? [...probes, ...clocks] : ['There are no other machines to check.'];
        this.cdr.markForCheck();
      }
    });
  }

  wireguard(): void {
    this.messaging.sendMessage<{ config?: string }>('mesh-wireguard', {}).subscribe({
      next: result => {
        this.wireguardText = result.config || '';
        this.cdr.markForCheck();
      }
    });
  }

  applyWireguard(): void {
    this.messaging.sendMessage<{ applied?: boolean; error?: string }>('mesh-wireguard-apply', {}).subscribe({
      next: result => {
        this.notification[result.applied ? 'success' : 'error'](result.applied ? 'WireGuard config applied on this host.' : (result.error || 'WireGuard was not applied.'));
        this.cdr.markForCheck();
      }
    });
  }

  /** Where the others reach a machine, in a line. */
  addressText(address: MeshAddress | null | undefined): string {
    if (!address) return 'an address it has not reported';
    return `${address.host}, on TCP ports ${address.peerPort} and ${address.raftPort}`;
  }

  startAddress(node: MeshNode): void {
    const current = node.address ?? (node.nodeId === this.status?.nodeId ? this.status?.advertise : null);
    this.addressNodeId = node.nodeId;
    this.addressForm = {
      host: current?.host ?? '',
      peerPort: current?.peerPort ?? DEFAULT_PEER_PORT,
      raftPort: current?.raftPort ?? DEFAULT_RAFT_PORT
    };
    this.cdr.markForCheck();
  }

  cancelAddress(): void {
    this.addressNodeId = null;
    this.cdr.markForCheck();
  }

  /** Every other machine checks it can reach this one there first, then the mesh database moves: up to a minute or two. */
  saveAddress(node: MeshNode): void {
    this.savingAddress = true;
    this.startWorking(`Checking every machine can reach ${node.name} at the new address… This can take a minute or two.`);
    this.messaging.sendMessage<{ success?: boolean; error?: string; status?: MeshStatus; detail?: { notAsked?: string[] } }>('set-mesh-node-address', {
      nodeId: node.nodeId,
      host: this.addressForm.host,
      peerPort: Number(this.addressForm.peerPort),
      raftPort: Number(this.addressForm.raftPort)
    }, { timeoutMs: MESH_ADDRESS_TIMEOUT_MS }).subscribe({
      next: result => {
        this.savingAddress = false;
        this.stopWorking();
        if (!result?.success) {
          this.notification.error(result?.error || 'Could not change that machine\'s address.');
        } else {
          this.addressNodeId = null;
          const notAsked = result.detail?.notAsked || [];
          this.notification.success(notAsked.length
            ? `${node.name} has its new address. ${notAsked.join(', ')} could not be asked to check it, and will use it once back.`
            : `${node.name} has its new address.`);
        }
        this.apply(result?.status);
        this.cdr.markForCheck();
      },
      error: () => {
        this.savingAddress = false;
        this.stopWorking();
        this.notification.error('Could not change that machine\'s address.');
        this.cdr.markForCheck();
      }
    });
    this.cdr.markForCheck();
  }

  useOtherAddress(): void {
    const own = this.status?.advertise;
    this.ownAddress = { host: own?.host ?? '', peerPort: own?.peerPort ?? DEFAULT_PEER_PORT, raftPort: own?.raftPort ?? DEFAULT_RAFT_PORT };
    this.otherAddress = true;
    this.cdr.markForCheck();
  }

  useOwnAddress(): void {
    this.otherAddress = false;
    this.cdr.markForCheck();
  }

  /** The address typed in for Create or Join, if another than this machine's own was chosen. */
  private typedAddress(): { address?: { host: string; peerPort: number; raftPort: number } } {
    if (!this.otherAddress) return {};
    return { address: { host: this.ownAddress.host, peerPort: Number(this.ownAddress.peerPort), raftPort: Number(this.ownAddress.raftPort) } };
  }

  private apply(status: MeshStatus | null | undefined): void {
    if (!status || typeof status.enabled !== 'boolean') return;
    this.status = status;
    this.cdr.markForCheck();
  }

  private finish(message: string, ok: boolean | undefined): void {
    this.busy = false;
    // The answer comes outside any click: without this, Join stayed disabled until the page redrew.
    this.cdr.markForCheck();
    this.notification[ok ? 'success' : 'error'](message);
    this.refresh();
    void this.auth.refresh();
  }

  /**
   * Not in any mesh. A member reconnecting after a restart is not: creating or joining one there
   * would split it from the mesh it is still in.
   */
  get standalone(): boolean {
    return !!this.status && !this.status.enabled && !this.status.reconnecting;
  }

  /** A machine with no accounts has to choose the mesh admin while creating it. */
  get needsAdminPassword(): boolean {
    return !this.auth.identity.accountsInUse;
  }
}
