import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ServerInstance } from '../../../../core/models/server-instance.model';
import { FieldMessages, FieldMessagesComponent } from '../../../field-messages/field-messages.component';

@Component({
  selector: 'app-cluster-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, FieldMessagesComponent],
  templateUrl: './cluster-tab.component.html'
})
export class ClusterTabComponent {
  @Input() serverInstance: Partial<ServerInstance> = {};
  @Input() isLocked = false;
  /** The backend checks a directory only for the desktop app; a web client could map the host's disks. */
  @Input() isElectron = false;
  @Input() fieldErrors: FieldMessages = {};
  @Input() fieldWarnings: FieldMessages = {};
  /** Shown when mesh transfer storage for this server is degraded. Empty leaves the tab unchanged. */
  @Input() transferNote = '';

  @Output() validateField = new EventEmitter<{key: string, value: unknown}>();
  @Output() saveSettings = new EventEmitter<void>();
  @Output() testConnectivity = new EventEmitter<void>();

  onValidateField(key: string, value: unknown): void {
    this.validateField.emit({key, value});
  }

  onSaveSettings(): void {
    this.saveSettings.emit();
  }

  testClusterConnectivity(): void {
    this.testConnectivity.emit();
  }
}
