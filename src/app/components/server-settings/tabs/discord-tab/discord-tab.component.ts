import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IpcService } from '../../../../core/services/ipc.service';
import { NotificationService } from '../../../../core/services/notification.service';

@Component({
  selector: 'app-discord-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './discord-tab.component.html'
})
export class DiscordTabComponent implements OnInit {
  @Input() serverInstance: any;
  @Input() isLocked = false;
  @Output() saveSettings = new EventEmitter<void>();

  webhookUrl = '';
  enabled = false;
  
  notifications = {
    serverStart: true,
    serverStop: true,
    serverCrash: true,
    serverUpdate: true,
    serverJoin: false,
    serverLeave: false
  };

  constructor(
    private ipcService: IpcService,
    private notificationService: NotificationService
  ) {}

  ngOnInit() {
    this.initForm();
  }

  private initForm() {
    if (this.serverInstance?.discordConfig) {
      const config = this.serverInstance.discordConfig;
      this.webhookUrl = config.webhookUrl || '';
      this.enabled = config.enabled || false;
      
      if (config.notifications) {
        this.notifications = { ...this.notifications, ...config.notifications };
      }
    }
  }

  onSaveSettings() {
    // Update the server instance with current values
    if (this.serverInstance) {
      this.serverInstance.discordConfig = {
        enabled: this.enabled,
        webhookUrl: this.webhookUrl,
        notifications: this.notifications
      };
    }
    
    // Emit to parent component to trigger save
    this.saveSettings.emit();
  }
}
