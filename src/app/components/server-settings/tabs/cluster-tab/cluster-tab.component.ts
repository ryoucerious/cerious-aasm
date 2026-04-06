import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-cluster-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cluster-tab.component.html'
})
export class ClusterTabComponent {
  @Input() serverInstance: any = {};
  @Input() isLocked = false;
  @Input() fieldErrors: { [key: string]: string } = {};
  @Input() fieldWarnings: { [key: string]: string } = {};

  @Output() validateField = new EventEmitter<{key: string, value: any}>();
  @Output() saveSettings = new EventEmitter<void>();

  // Multi-machine clustering properties
  clusterStorageTypes = [
    { value: 'local', label: 'Local Directory (Single Machine)' },
    { value: 'nfs', label: 'NFS Mount' },
    { value: 'smb', label: 'SMB/CIFS Share' },
    { value: 'cloud', label: 'Cloud Storage (AWS S3, etc.)' },
    { value: 'custom', label: 'Custom Path' }
  ];

  hasFieldError(key: string): boolean {
    return !!this.fieldErrors[key];
  }

  getFieldError(key: string): string {
    return this.fieldErrors[key] || '';
  }

  hasFieldWarning(key: string): boolean {
    return !!this.fieldWarnings[key];
  }

  getFieldWarning(key: string): string {
    return this.fieldWarnings[key] || '';
  }

  onValidateField(key: string, value: any): void {
    this.validateField.emit({key, value});
  }

  onSaveSettings(): void {
    this.saveSettings.emit();
  }

  // Multi-machine clustering helpers
  getStorageTypeLabel(storageType: string): string {
    const type = this.clusterStorageTypes.find(t => t.value === storageType);
    return type ? type.label : storageType;
  }

  testClusterConnectivity(): void {
    // Emit event to parent to test cluster connectivity
    this.validateField.emit({key: 'testConnectivity', value: true});
  }
}