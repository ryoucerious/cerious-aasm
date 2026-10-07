import { Component, OnInit, OnDestroy, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { NgIf, NgFor, NgClass, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ModalComponent } from '../../../components/modal/modal.component';
import { MESH_ADDRESS_TIMEOUT_MS, MessagingService } from '../../../core/services/messaging/messaging.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { PERMISSIONS } from '../../../core/models/auth.model';
import { copyToClipboard } from '../../../core/utils/clipboard.utils';

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
  /** How an ARK update on it is going, from its heartbeat. */
  arkUpdate?: { phase: string; message: string; minutesLeft?: number; percent?: number; at: number } | null;
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
  /** Where other machines reach this one, or would if it created or joined a mesh now. */
  advertise?: MeshAddress;
  /** Just after a join: the machine admin this machine's own admin password now signs in as. */
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
  diagnosticText = '';
  wireguardText = '';
  busy = false;
  updatingKey = '';
  showConfirmLeave = false;
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

  get canUpdate(): boolean {
    return this.auth.can(PERMISSIONS.APP_INSTALL);
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

  maintenance(node: MeshNode): void {
    this.messaging.sendMessage('set-node-maintenance', { nodeId: node.nodeId, maintenance: !node.maintenance }).subscribe({
      next: () => this.refresh()
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
    this.messaging.sendMessage('remove-mesh-node', { nodeId: node.nodeId }).subscribe({
      next: () => this.refresh()
    });
  }

  diagnostics(): void {
    this.messaging.sendMessage<Record<string, unknown>>('mesh-diagnostics', {}).subscribe({
      next: result => {
        this.diagnosticText = JSON.stringify(result, null, 2);
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
    this.messaging.sendMessage<{ success?: boolean; error?: string; status?: MeshStatus; detail?: { notAsked?: string[] } }>('set-mesh-node-address', {
      nodeId: node.nodeId,
      host: this.addressForm.host,
      peerPort: Number(this.addressForm.peerPort),
      raftPort: Number(this.addressForm.raftPort)
    }, { timeoutMs: MESH_ADDRESS_TIMEOUT_MS }).subscribe({
      next: result => {
        this.savingAddress = false;
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
