import { Component, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EMPTY, Observable, Subject, Subscription, catchError, filter, finalize, interval, switchMap, tap } from 'rxjs';
import { MessagingService } from '../../core/services/messaging/messaging.service';
import { NotificationService } from '../../core/services/notification.service';
import { ServerInstance } from '../../core/models/server-instance.model';
import { isOnlineStatus } from '../../core/utils/server-status';
import { copyToClipboard } from '../../core/utils/clipboard.utils';

const REFRESH_INTERVAL_MS = 30_000;

/** A player by name and the ID ARK knows them by: their EOS ID in ASA. */
interface Player {
  name: string;
  playerId: string;
}

interface OnlinePlayersReply {
  success?: boolean;
  /** An older machine in a mesh sends the ID only as steamId. */
  players?: Array<{ name: string; playerId?: string; steamId?: string }>;
  error?: string;
}

@Component({
  selector: 'app-player-list',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './player-list.component.html'
})
export class PlayerListComponent implements OnChanges, OnDestroy {
  @Input() serverInstance: Pick<ServerInstance, 'state'> & { id?: string } | null = null;

  players: Player[] = [];
  loading = false;
  lastUpdated: Date | null = null;
  error: string | null = null;

  // Each refresh replaces the request in flight, so a reply for the previous server never lands here.
  private readonly refreshes = new Subject<void>();
  private readonly subscriptions = new Subscription();

  constructor(
    private messaging: MessagingService,
    private notificationService: NotificationService
  ) {
    this.subscriptions.add(this.refreshes.pipe(switchMap(() => this.fetchPlayers())).subscribe());
    this.subscriptions.add(interval(REFRESH_INTERVAL_MS).pipe(filter(() => this.isOnline)).subscribe(() => this.refreshPlayers()));
  }

  /** The list only has data while the server is online. */
  get isOnline(): boolean {
    return isOnlineStatus(this.serverInstance?.state);
  }

  ngOnChanges(changes: SimpleChanges): void {
    const change = changes['serverInstance'];
    if (!change || (!change.firstChange && change.previousValue?.id === change.currentValue?.id)) return;
    this.players = [];
    this.lastUpdated = null;
    this.refreshPlayers();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  refreshPlayers(): void {
    this.refreshes.next();
  }

  copyPlayerId(playerId: string): Promise<void> {
    return copyToClipboard(playerId).then(
      () => this.notificationService.success('Player ID copied to clipboard'),
      error => {
        console.error('[player-list] Could not copy the player ID:', error);
        this.notificationService.error('Could not copy the player ID');
      }
    );
  }

  private fetchPlayers(): Observable<unknown> {
    const server = this.serverInstance;
    if (!server?.id || !isOnlineStatus(server.state)) {
      this.players = [];
      this.error = 'Server is offline.';
      return EMPTY;
    }

    this.loading = true;
    this.error = null;
    return this.messaging.sendMessage<OnlinePlayersReply>('get-online-players', { id: server.id }).pipe(
      tap(response => {
        if (response?.success) {
          this.players = (response.players || []).map(player => ({ name: player.name, playerId: player.playerId || player.steamId || '' }));
          this.lastUpdated = new Date();
        } else {
          // Inline only: this also runs on the timer, and a toast every 30 s would be noise.
          this.error = response?.error || 'Failed to retrieve player list.';
        }
        this.loading = false;
      }),
      catchError(error => {
        console.error('[player-list] Could not fetch the player list:', error);
        this.error = 'Communication error.';
        return EMPTY;
      }),
      finalize(() => this.loading = false)
    );
  }
}
