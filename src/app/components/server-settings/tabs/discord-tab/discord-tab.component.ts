import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ServerInstance } from '../../../../core/models/server-instance.model';

type DiscordSettings = Pick<ServerInstance, 'discordConfig'> & { id?: string };
type DiscordNotifications = Required<NonNullable<NonNullable<ServerInstance['discordConfig']>['notifications']>>;

const DEFAULT_NOTIFICATIONS: DiscordNotifications = {
  serverStart: true,
  serverStop: true,
  serverCrash: true,
  serverUpdate: true,
  serverJoin: false,
  serverLeave: false
};

@Component({
  selector: 'app-discord-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './discord-tab.component.html'
})
export class DiscordTabComponent implements OnChanges {
  @Input() serverInstance: DiscordSettings | null = null;
  @Input() isLocked = false;
  @Output() saveSettings = new EventEmitter<void>();

  webhookUrl = '';
  enabled = false;
  notifications: DiscordNotifications = { ...DEFAULT_NOTIFICATIONS };

  ngOnChanges(changes: SimpleChanges): void {
    const change = changes['serverInstance'];
    if (change && (change.firstChange || change.previousValue?.id !== change.currentValue?.id)) {
      this.initForm();
    }
  }

  onSaveSettings() {
    if (this.serverInstance) {
      this.serverInstance.discordConfig = {
        enabled: this.enabled,
        webhookUrl: this.webhookUrl,
        notifications: this.notifications
      };
    }
    this.saveSettings.emit();
  }

  private initForm(): void {
    const config = this.serverInstance?.discordConfig;
    this.webhookUrl = config?.webhookUrl || '';
    this.enabled = config?.enabled || false;
    this.notifications = { ...DEFAULT_NOTIFICATIONS, ...config?.notifications };
  }
}
