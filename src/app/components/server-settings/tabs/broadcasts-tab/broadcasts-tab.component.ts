import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { v4 as uuidv4 } from 'uuid';
import { ServerInstance } from '../../../../core/models/server-instance.model';

type BroadcastSettings = Pick<ServerInstance, 'broadcastConfig'> & { id?: string };
type BroadcastMessage = NonNullable<NonNullable<ServerInstance['broadcastConfig']>['messages']>[number];

@Component({
  selector: 'app-broadcasts-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './broadcasts-tab.component.html'
})
export class BroadcastsTabComponent implements OnChanges {
  @Input() serverInstance: BroadcastSettings | null = null;
  @Input() isLocked = false;
  @Output() saveSettings = new EventEmitter<void>();

  enabled = false;
  messages: BroadcastMessage[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    const change = changes['serverInstance'];
    if (change && (change.firstChange || change.previousValue?.id !== change.currentValue?.id)) {
      this.initForm();
    }
  }

  addMessage() {
    this.messages.push({
      id: uuidv4(),
      message: 'New Announcement',
      interval: 60,
      enabled: true
    });
    this.onSaveSettings();
  }

  removeMessage(index: number) {
    this.messages.splice(index, 1);
    this.onSaveSettings();
  }

  onSaveSettings() {
    if (this.serverInstance) {
      this.serverInstance.broadcastConfig = {
        enabled: this.enabled,
        messages: this.messages
      };
    }
    this.saveSettings.emit();
  }

  private initForm(): void {
    const config = this.serverInstance?.broadcastConfig;
    this.enabled = config?.enabled || false;
    this.messages = config?.messages || [];
  }
}
