import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy } from '@angular/core';
import { NgIf, NgClass } from '@angular/common';
import { ServerInstance } from '../../core/models/server-instance.model';
import { getMapVisual, MapVisual } from '../../core/utils/map-visuals';
import { formatUptime, formatMegabytes, formatPercent } from '../../core/utils/format.utils';
import {
  serverStatusKey, serverStatusLabel, serverStatusClass,
  isOnlineStatus, canStartStatus
} from '../../core/utils/server-status';

/**
 * The strip at the top of every server page: identity, status, live stats and the
 * start / stop / force controls. The page below it changes with the sidebar; this does not.
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
  @Input() server: ServerInstance | null = null;
  @Input() live: ServerInstance | null = null;
  @Input() pageTitle = '';
  @Input() now = Date.now();
  @Input() rconConnected = false;

  @Output() startServer = new EventEmitter<void>();
  @Output() stopServer = new EventEmitter<void>();
  @Output() forceStopServer = new EventEmitter<void>();

  get visual(): MapVisual {
    return getMapVisual(this.server?.mapName || this.live?.mapName);
  }

  /** Normalised key: 'running', 'starting', 'queued', 'stopping', 'stopped', 'crashed', 'error'. */
  get stateKey(): string {
    return serverStatusKey(this.server?.state || this.live?.state);
  }

  get statusText(): string {
    return serverStatusLabel(this.server?.state || this.live?.state);
  }

  get statusClass(): string {
    return serverStatusClass(this.server?.state || this.live?.state);
  }

  get isRunning(): boolean {
    return isOnlineStatus(this.server?.state || this.live?.state);
  }

  get canStart(): boolean {
    return canStartStatus(this.server?.state || this.live?.state);
  }

  get canStop(): boolean {
    return this.stateKey === 'running';
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

  get ports(): string {
    const game = this.server?.gamePort;
    const query = this.server?.queryPort;
    if (!game && !query) return '';
    return `Game ${game ?? '--'} · Query ${query ?? '--'}`;
  }
}
