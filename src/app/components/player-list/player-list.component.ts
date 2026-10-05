import { Component, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EMPTY, Observable, Subject, Subscription, catchError, filter, finalize, interval, switchMap, tap } from 'rxjs';
import { MessagingService } from '../../core/services/messaging/messaging.service';
import { NotificationService } from '../../core/services/notification.service';
import { ServerInstance } from '../../core/models/server-instance.model';
import { isOnlineStatus } from '../../core/utils/server-status';
import { copyToClipboard } from '../../core/utils/clipboard.utils';

const REFRESH_INTERVAL_MS = 30_000;

interface Player {
  name: string;
  steamId: string;
}

interface OnlinePlayersReply {
  success?: boolean;
  players?: Player[];
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

  copySteamId(steamId: string): Promise<void> {
    return copyToClipboard(steamId).then(
      () => this.notificationService.success('SteamID copied to clipboard'),
      error => {
        console.error('[player-list] Could not copy the SteamID:', error);
        this.notificationService.error('Could not copy the SteamID');
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
          this.players = response.players || [];
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
