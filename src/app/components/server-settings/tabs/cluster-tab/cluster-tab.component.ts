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
    // This would be implemented based on your validation logic
    return false;
  }

  getFieldError(key: string): string {
    return '';
  }

  hasFieldWarning(key: string): boolean {
    return false;
  }

  getFieldWarning(key: string): string {
    return '';
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