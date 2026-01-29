import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IpcService } from '../../core/services/ipc.service';
import { NotificationService } from '../../core/services/notification.service';
import { Subscription, interval } from 'rxjs';

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
  lastUpdated: Date | null = null;
  autoRefreshSub: Subscription | null = null;
  error: string | null = null;

  constructor(
    private ipcService: IpcService,
    private notificationService: NotificationService
  ) {}

  ngOnInit() {
    this.refreshPlayers();
    
    // Auto refresh every 30 seconds
    this.autoRefreshSub = interval(30000).subscribe(() => {
        if (this.serverInstance?.state === 'Running') {
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
    if (!this.serverInstance || this.serverInstance.state !== 'Running') {
        this.players = [];
        this.error = 'Server is not running.';
        return;
    }

    this.loading = true;
    this.error = null;

    try {
      const response = await this.ipcService.invoke('get-online-players', {
        id: this.serverInstance.id
      });

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
