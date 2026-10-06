import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output } from '@angular/core';
import { NgIf } from '@angular/common';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { formatBytes } from '../../core/utils/format.utils';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../modal/modal.component';
import { DropdownComponent, DropdownOption } from '../dropdown/dropdown.component';
import { MessagingService, MOVE_TIMEOUT_MS } from '../../core/services/messaging/messaging.service';
import { NotificationService } from '../../core/services/notification.service';
import { MeshNodesService, MoveDestination } from '../../core/services/mesh-nodes.service';
import { ServerInstance } from '../../core/models/server-instance.model';

interface MoveReply {
  success?: boolean;
  error?: string;
  detail?: { warning?: string };
}

/** How far a move has got, from the machine running it. */
export interface MoveProgressEvent {
  instanceId?: string;
  destinationName?: string;
  phase?: 'preparing' | 'checking' | 'copying' | 'verifying';
  bytesDone?: number;
  bytesTotal?: number;
  /** What the destination already held from an earlier attempt. */
  resumedBytes?: number;
}

/**
 * Moves a server that is off to another machine in the mesh. The machine hosting it copies its
 * settings and saves across; it arrives stopped. Open while `server` is set.
 */
@Component({
  selector: 'app-move-server-dialog',
  standalone: true,
  imports: [NgIf, FormsModule, ModalComponent, DropdownComponent],
  templateUrl: './move-server-dialog.component.html',
  styleUrls: ['./move-server-dialog.component.scss']
})
export class MoveServerDialogComponent implements OnChanges, OnDestroy {
  @Input() server: ServerInstance | null = null;
  @Output() closed = new EventEmitter<void>();

  destinations: MoveDestination[] = [];
  destinationOptions: DropdownOption<string>[] = [];
  destinationId = '';
  moving = false;
  error = '';
  /** How far the move has got; null until the machine running it first says. */
  progress: MoveProgressEvent | null = null;
  /** Files had started to arrive when the move failed, so moving again carries it on. */
  canCarryOn = false;
  private progressSub: Subscription | null = null;

  constructor(
    private meshNodes: MeshNodesService,
    private messaging: MessagingService,
    private notification: NotificationService
  ) {}

  ngOnChanges(): void {
    this.destinations = this.server ? this.meshNodes.destinationsFor(this.server) : [];
    this.destinationOptions = this.destinations.map(destination => ({ value: destination.nodeId, label: destination.name }));
    this.destinationId = this.destinations.length === 1 ? this.destinations[0].nodeId : '';
    this.moving = false;
    this.error = '';
    this.canCarryOn = false;
    this.stopFollowing();
  }

  ngOnDestroy(): void {
    this.stopFollowing();
  }

  /** What the machine running the move is doing now, in words; empty while copying, which shows a meter. */
  get status(): string {
    const name = this.server?.name || 'the server';
    switch (this.progress?.phase) {
      case 'checking': return `Checking what ${this.destinationName} already has…`;
      case 'copying': return '';
      case 'verifying': return `Checking the copy on ${this.destinationName}…`;
      default: return `Preparing ${name}'s files…`;
    }
  }

  get copying(): boolean {
    return this.progress?.phase === 'copying';
  }

  get percent(): number {
    const total = this.progress?.bytesTotal || 0;
    return total > 0 ? Math.min(100, Math.floor(((this.progress?.bytesDone || 0) / total) * 100)) : 0;
  }

  get copiedLabel(): string {
    return `${formatBytes(this.progress?.bytesDone || 0)} of ${formatBytes(this.progress?.bytesTotal || 0)} (${this.percent}%)`;
  }

  get resumedLabel(): string {
    const resumed = this.progress?.resumedBytes || 0;
    return resumed > 0 ? `Carrying on: ${formatBytes(resumed)} was already on ${this.destinationName}.` : '';
  }

  get title(): string {
    return this.server ? `Move ${this.server.name}` : 'Move server';
  }

  get destinationName(): string {
    return this.destinations.find(destination => destination.nodeId === this.destinationId)?.name || 'the other machine';
  }

  move(): void {
    const server = this.server;
    if (!server || !this.destinationId || this.moving) return;
    const destinationName = this.destinationName;
    this.moving = true;
    this.error = '';
    this.canCarryOn = false;
    this.progress = null;
    this.follow(server.id);
    this.messaging.sendMessage<MoveReply>('move-server', { serverId: server.id, nodeId: this.destinationId }, { timeoutMs: MOVE_TIMEOUT_MS })
      .subscribe({
        next: reply => {
          this.moving = false;
          this.stopFollowing();
          if (!reply?.success) {
            this.error = reply?.error || 'The move did not finish. The server is still where it was.';
            this.canCarryOn = this.progress?.phase === 'copying' || this.progress?.phase === 'verifying';
            return;
          }
          this.notification.success(`${server.name} is now on ${destinationName}. It arrived stopped.`);
          if (reply.detail?.warning) this.notification.warning(reply.detail.warning);
          this.closed.emit();
        },
        error: () => {
          this.moving = false;
          this.stopFollowing();
          this.error = 'No answer in time. The move may still be running: check which machine the server is on before trying again.';
        }
      });
  }

  /** Hears how far this server's move has got, from the machine running it. */
  private follow(serverId: string): void {
    this.stopFollowing();
    this.progressSub = this.messaging.receiveMessage<MoveProgressEvent>('server-move-progress')
      .pipe(filter(progress => progress?.instanceId === serverId))
      .subscribe(progress => { this.progress = progress; });
  }

  private stopFollowing(): void {
    this.progressSub?.unsubscribe();
    this.progressSub = null;
  }

  /** Closing mid-copy would hide a move that is still running. */
  cancel(): void {
    if (!this.moving) this.closed.emit();
  }
}
