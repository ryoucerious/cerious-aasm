import { Component, EventEmitter, HostListener, Input, Output, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { NgIf, NgClass } from '@angular/common';
import { ServerInstance, ServerInstanceDraft } from '../../core/models/server-instance.model';
import { getMapVisual, MapVisual } from '../../core/utils/map-visuals';
import { formatUptime, formatMegabytes, formatPercent, joinAddress } from '../../core/utils/format.utils';
import { copyToClipboard } from '../../core/utils/clipboard.utils';
import { MeshNodesService } from '../../core/services/mesh-nodes.service';
import {
  serverStatusKey, serverStatusLabel, serverStatusClass,
  isOnlineStatus, canStartStatus
} from '../../core/utils/server-status';

/**
 * The strip at the top of every server page: identity, status, live stats and the
 * start / stop / force controls, with occasional actions such as a move under More actions.
 * The page below it changes with the sidebar; this does not.
 *
 * `server` is the page's working copy (its state is the mapped display string such as
 * "Running"); `live` is the roster entry with runtime numbers. Either may be missing briefly
 * during a switch, so every getter tolerates null.
 */
@Component({
  selector: 'app-server-header',
  standalone: true,
  imports: [NgIf, NgClass],
  templateUrl: './server-header.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ServerHeaderComponent {
  @Input() server: ServerInstanceDraft | null = null;
  @Input() live: ServerInstance | null = null;
  @Input() pageTitle = '';
  @Input() now = Date.now();
  @Input() rconConnected = false;
  /** The user may move servers and another machine in the mesh can take this one. */
  @Input() canMove = false;
  /** When a restart asked for from the app is due; null when none is counting down. */
  @Input() restartDueAt: number | null = null;

  @Output() startServer = new EventEmitter<void>();
  @Output() stopServer = new EventEmitter<void>();
  @Output() forceStopServer = new EventEmitter<void>();
  @Output() restartServer = new EventEmitter<void>();
  @Output() cancelRestart = new EventEmitter<void>();
  @Output() moveServer = new EventEmitter<void>();

  private readonly meshNodes = inject(MeshNodesService);
  private readonly cdr = inject(ChangeDetectorRef);
  /** Just copied: the button says so for a moment. */
  copied = false;

  /**
   * What a player types into the game to connect: the host of the machine running the server,
   * a stable name when one was set in Change address, and the game port.
   */
  get connectAddress(): string {
    const pageHost = typeof window !== 'undefined' ? window.location.hostname : '';
    return joinAddress(this.server, this.meshNodes.joinHostFor(this.server ?? {}, pageHost) ?? pageHost);
  }

  async copyConnectAddress(): Promise<void> {
    try {
      await copyToClipboard(this.connectAddress);
      this.copied = true;
      this.cdr.markForCheck();
      setTimeout(() => { this.copied = false; this.cdr.markForCheck(); }, 2000);
    } catch {
      /* the address stays on show to select by hand */
    }
  }

  /** More actions is open. */
  menuOpen = false;

  toggleMenu(event: Event): void {
    event.stopPropagation();
    this.menuOpen = !this.menuOpen;
  }

  @HostListener('document:click')
  @HostListener('document:keydown.escape')
  closeMenu(): void {
    this.menuOpen = false;
  }

  onMove(): void {
    if (!this.canMoveNow) return;
    this.menuOpen = false;
    this.moveServer.emit();
  }

  get visual(): MapVisual {
    return getMapVisual(this.server?.mapName || this.live?.mapName);
  }

  /** Normalised key: 'running', 'starting', 'queued', 'stopping', 'stopped', 'crashed', 'error'. */
  get stateKey(): string {
    return serverStatusKey(this.shownState);
  }

  get statusText(): string {
    return serverStatusLabel(this.shownState);
  }

  get statusClass(): string {
    return serverStatusClass(this.shownState);
  }

  /**
   * On a mesh machine that cannot be reached: nothing here can act on it. The live list says so
   * first; the page's own copy follows state events, which a machine that has gone quiet never sends.
   */
  get unreachable(): boolean {
    return serverStatusKey(this.live?.state) === 'unreachable' || serverStatusKey(this.server?.state) === 'unreachable';
  }

  private get shownState(): string | null | undefined {
    return this.unreachable ? 'unreachable' : this.server?.state || this.live?.state;
  }

  get isRunning(): boolean {
    return isOnlineStatus(this.server?.state || this.live?.state);
  }

  get canStart(): boolean {
    return canStartStatus(this.shownState);
  }

  get canStop(): boolean {
    return this.stateKey === 'running';
  }

  /** "Restarting in 12 min", counting down with the page's clock; "Restarting now" once it is due. */
  get restartText(): string {
    if (this.restartDueAt === null) return '';
    const minutes = Math.ceil((this.restartDueAt - this.now) / 60_000);
    return minutes > 0 ? `Restarting in ${minutes} min` : 'Restarting now';
  }

  /** Only a server that is off moves; the machine hosting it refuses one that is not. */
  get canMoveNow(): boolean {
    // Off: stopped, or crashed or errored, which the machine hosting it accepts as well.
    return this.canMove && (this.stateKey === 'stopped' || this.stateKey === 'crashed' || this.stateKey === 'error');
  }

  get canForceStop(): boolean {
    const key = this.stateKey;
    return key === 'running' || key === 'starting' || key === 'stopping' || key === 'queued';
  }

  get players(): string {
    const count = this.live?.players ?? this.server?.players ?? 0;
    const max = this.server?.maxPlayers ?? this.live?.maxPlayers ?? 70;
    return `${this.isRunning ? count : 0} / ${max}`;
  }

  get memory(): string {
    return this.isRunning ? formatMegabytes(this.live?.memory ?? this.server?.memory) : '--';
  }

  get cpu(): string {
    return this.isRunning ? formatPercent(this.live?.cpu) : '--';
  }

  get uptime(): string {
    return this.isRunning ? formatUptime(this.live?.startedAt, this.now) : '--';
  }
}
