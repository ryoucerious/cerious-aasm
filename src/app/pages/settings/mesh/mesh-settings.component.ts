import { Component, OnInit, OnDestroy, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { NgIf, NgFor, NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ModalComponent } from '../../../components/modal/modal.component';
import { MessagingService } from '../../../core/services/messaging/messaging.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { PERMISSIONS } from '../../../core/models/auth.model';

interface MeshNode {
  nodeId: string;
  name: string;
  status: string;
  maintenance: boolean;
  version: string;
  connected?: boolean;
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
}

/**
 * Create or join a mesh, and see the nodes that share it.
 * A standalone install leaves this unused: nothing here starts rqlite until Create or Join.
 */
@Component({
  selector: 'app-mesh-settings',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, FormsModule, ModalComponent],
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
  diagnosticText = '';
  wireguardText = '';
  busy = false;
  updatingKey = '';
  showConfirmLeave = false;
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
      ...(this.needsAdminPassword ? { adminUsername: this.adminUsername, adminPassword: this.adminPassword } : {})
    }).subscribe({
      next: result => this.finish(result.success ? 'Mesh created.' : (result.error || 'Could not create the mesh.'), result.success),
      error: () => this.finish('Could not create the mesh.', false)
    });
  }

  join(): void {
    this.busy = true;
    this.messaging.sendMessage<{ success?: boolean; error?: string; status?: MeshStatus }>('join-mesh', { memberUrl: this.memberUrl, token: this.token }).subscribe({
      next: result => {
        if (result.success && result.status) this.apply(result.status);
        this.finish(result.success ? 'Joined the mesh.' : (result.error || 'Could not join.'), result.success);
      },
      error: () => this.finish('Could not join.', false)
    });
  }

  issueToken(): void {
    this.messaging.sendMessage<{ success?: boolean; token?: string; error?: string }>('create-enrollment-token', {}).subscribe({
      next: result => {
        this.issuedToken = result.token || '';
        this.notification[result.success ? 'success' : 'error'](result.success ? 'Enrollment token created.' : (result.error || 'Could not create a token.'));
        this.cdr.markForCheck();
      }
    });
  }

  get canUpdate(): boolean {
    return this.auth.can(PERMISSIONS.APP_INSTALL);
  }

  get nodes(): MeshNode[] {
    return (this.status?.nodes || []).filter(node => node.status !== 'removed');
  }

  connection(node: MeshNode): string {
    if (node.maintenance) return 'Draining';
    return node.connected ? 'Connected' : 'Unreachable';
  }

  connectionTone(node: MeshNode): string {
    if (node.maintenance) return 'tone-warning';
    return node.connected ? 'tone-success' : 'tone-danger';
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

  private apply(status: MeshStatus | null | undefined): void {
    if (!status || typeof status.enabled !== 'boolean') return;
    this.status = status;
    this.cdr.markForCheck();
  }

  private finish(message: string, ok: boolean | undefined): void {
    this.busy = false;
    this.notification[ok ? 'success' : 'error'](message);
    this.refresh();
    void this.auth.refresh();
  }

  /** A machine with no accounts has to choose the mesh admin while creating it. */
  get needsAdminPassword(): boolean {
    return !this.auth.identity.accountsInUse;
  }
}
