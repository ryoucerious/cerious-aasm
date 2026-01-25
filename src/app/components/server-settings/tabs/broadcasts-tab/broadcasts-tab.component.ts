import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IpcService } from '../../../../core/services/ipc.service';
import { NotificationService } from '../../../../core/services/notification.service';
import { v4 as uuidv4 } from 'uuid';

interface BroadcastMessage {
  id: string;
  message: string;
  interval: number; // in minutes
  enabled: boolean;
  nextRun?: number; // timestamp
}

@Component({
  selector: 'app-broadcasts-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './broadcasts-tab.component.html'
})
export class BroadcastsTabComponent implements OnInit {
  @Input() serverInstance: any;
  @Input() isLocked = false;
  @Output() saveSettings = new EventEmitter<void>();

  enabled = false;
  messages: BroadcastMessage[] = [];

  constructor(
    private ipcService: IpcService,
    private notificationService: NotificationService
  ) {}

  ngOnInit() {
    this.initForm();
  }

  private initForm() {
    if (this.serverInstance?.broadcastConfig) {
      const config = this.serverInstance.broadcastConfig;
      this.enabled = config.enabled || false;
      this.messages = config.messages || [];
    }
  }

  addMessage() {
    this.messages.push({
      id: uuidv4(),
      message: 'New Announcement',
      interval: 60,
      enabled: true
    });
    this.onSaveSettings(); // Save after adding a message
  }

  removeMessage(index: number) {
    this.messages.splice(index, 1);
    this.onSaveSettings(); // Save after removing a message
  }

  onSaveSettings() {
    // Update the server instance with current values
    if (this.serverInstance) {
      this.serverInstance.broadcastConfig = {
        enabled: this.enabled,
        messages: this.messages
      };
    }
    
    // Emit to parent component to trigger save
    this.saveSettings.emit();
  }
}
