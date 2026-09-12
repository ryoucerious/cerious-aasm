import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MessagingService } from '../../core/services/messaging/messaging.service';
import { NotificationService } from '../../core/services/notification.service';
import { Subscription, interval, firstValueFrom, take } from 'rxjs';
import { isOnlineStatus } from '../../core/utils/server-status';

interface Player {
  name: string;
  steamId: string;
}

@Component({
  selector: 'app-player-list',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './player-list.component.html'
})
export class PlayerListComponent implements OnInit, OnDestroy {
  @Input() serverInstance: any;

  players: Player[] = [];
  loading = false;
  /** The list only has data while the server is online. */
  get isOnline(): boolean {
    return isOnlineStatus(this.serverInstance?.state);
  }
  lastUpdated: Date | null = null;
  autoRefreshSub: Subscription | null = null;
  error: string | null = null;

  constructor(
    private messaging: MessagingService,
    private notificationService: NotificationService
  ) {}

  ngOnInit() {
    this.refreshPlayers();
    
    // Auto refresh every 30 seconds
    this.autoRefreshSub = interval(30000).subscribe(() => {
        if (isOnlineStatus(this.serverInstance?.state)) {
            this.refreshPlayers();
        }
    });
  }

  ngOnDestroy() {
    if (this.autoRefreshSub) {
      this.autoRefreshSub.unsubscribe();
    }
  }

  async refreshPlayers() {
    if (!this.serverInstance || !isOnlineStatus(this.serverInstance.state)) {
        this.players = [];
        this.error = 'Server is offline.';
        return;
    }

    this.loading = true;
    this.error = null;

    try {
      // Messaging works in both the desktop app and the web UI, unlike a raw IPC invoke.
      const response: any = await firstValueFrom(
        this.messaging.sendMessage('get-online-players', { id: this.serverInstance.id }).pipe(take(1))
      );

      if (response.success) {
        this.players = response.players || [];
        this.lastUpdated = new Date();
      } else {
        // Don't show modal error for polling failure, just inline text
        this.error = response.error || 'Failed to retrieve player list.';
      }
    } catch (error) {
      console.error('Error fetching player list:', error);
      this.error = 'Communication error.';
    } finally {
      this.loading = false;
    }
  }

  copySteamId(steamId: string) {
    navigator.clipboard.writeText(steamId).then(() => {
      this.notificationService.success('SteamID copied to clipboard');
    });
  }
}
