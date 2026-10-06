import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { NgIf } from '@angular/common';
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
export class MoveServerDialogComponent implements OnChanges {
  @Input() server: ServerInstance | null = null;
  @Output() closed = new EventEmitter<void>();

  destinations: MoveDestination[] = [];
  destinationOptions: DropdownOption<string>[] = [];
  destinationId = '';
  moving = false;
  error = '';

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
    this.messaging.sendMessage<MoveReply>('move-server', { serverId: server.id, nodeId: this.destinationId }, { timeoutMs: MOVE_TIMEOUT_MS })
      .subscribe({
        next: reply => {
          this.moving = false;
          if (!reply?.success) {
            this.error = reply?.error || 'The move did not finish. The server is still where it was.';
            return;
          }
          this.notification.success(`${server.name} is now on ${destinationName}. It arrived stopped.`);
          if (reply.detail?.warning) this.notification.warning(reply.detail.warning);
          this.closed.emit();
        },
        error: () => {
          this.moving = false;
          this.error = 'No answer in time. The move may still be running: check which machine the server is on before trying again.';
        }
      });
  }

  /** Closing mid-copy would hide a move that is still running. */
  cancel(): void {
    if (!this.moving) this.closed.emit();
  }
}
