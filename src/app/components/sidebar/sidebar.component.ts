import { Component, EventEmitter, Output, ChangeDetectionStrategy, OnInit, OnDestroy, ChangeDetectorRef, ApplicationRef, NgZone, ViewChild, ElementRef } from '@angular/core';
import { Subscription, take } from 'rxjs';
import { NgFor, NgIf, NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';

import { ServerInstance } from '../../core/models/server-instance.model';
import { ServerInstanceService } from '../../core/services/server-instance.service';
import { ModalComponent } from '../modal/modal.component';
import { NotificationService } from '../../core/services/notification.service';
import { UtilityService } from '../../core/services/utility.service';
import { GlobalConfigService } from '../../core/services/global-config.service';


@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [NgFor, NgIf, NgClass, ModalComponent, FormsModule, DragDropModule],
  templateUrl: './sidebar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,

})

export class SidebarComponent implements OnInit, OnDestroy {
  @ViewChild('serverNameInput') serverNameInput!: ElementRef<HTMLInputElement>;
  @ViewChild('backupFileInput') backupFileInput!: ElementRef<HTMLInputElement>;
  @Output() addServer = new EventEmitter<void>();
  @Output() selectServer = new EventEmitter<ServerInstance>();
  @Output() closeMobileMenu = new EventEmitter<void>();

  servers: ServerInstance[] = [];

  // Listen for state updates for all servers and update sidebar icons
  private stateSub?: Subscription;
  showServers = true;
  private serversSub?: Subscription;
  selectedServerId: string | null = null;
  // installationDir removed; backend now determines it
  showAddModal = false;
  serverName = '';
  
  // Inline editing properties
  editingServerId: string | null = null;
  editingServerName: string = '';
  
  // Import from backup properties
  importMode: 'create' | 'import' | 'clone' = 'create';
  selectedBackupFile: File | null = null;
  selectedBackupFilePath: string = '';
  selectedServerToClone: ServerInstance | null = null;

  // Confirm delete modal state
  showConfirmDeleteModal = false;
  serverToDelete: ServerInstance | null = null;

  // Confirm start/stop all modal state
  showConfirmStartAllModal = false;
  showConfirmStopAllModal = false;

  // Platform detection
  isWebMode = false;
  authenticationEnabled = false;

  constructor(
    private router: Router,
    private serverInstanceService: ServerInstanceService,
    private cdr: ChangeDetectorRef,
    private appRef: ApplicationRef,
    private zone: NgZone,
    private notificationService: NotificationService,
    private utility: UtilityService,
    private globalConfigService: GlobalConfigService
  ) {
    this.isWebMode = this.utility.getPlatform() === 'Web';
  }

  ngOnInit() {
    this.serversSub = this.serverInstanceService.getInstances().subscribe(instances => {
      this.zone.run(() => {
        const raw = Array.isArray(instances) ? instances : [];
        // Sort by sortOrder if available, otherwise keep original order
        this.servers = raw.sort((a, b) => (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity));
        // Auto-select the first server if none is selected
        if (this.servers.length > 0 && !this.selectedServerId) {
          const first = this.servers[0];
          this.selectedServerId = first.id;
          this.selectServer.emit(first);
          this.serverInstanceService.setActiveServer(first);
        }
        this.cdr.markForCheck();
      });
    });

    // Listen for state updates for all servers
    this.stateSub = this.serverInstanceService.messaging.receiveMessage('server-instance-state').subscribe((msg: any) => {
      if (msg && msg.instanceId && msg.state) {
        const idx = this.servers.findIndex(s => s.id === msg.instanceId);
        if (idx !== -1) {
          this.zone.run(() => {
            this.servers[idx].state = msg.state;
            this.cdr.detectChanges();
          });
        }
      }
    });

    // Load authentication configuration
    this.globalConfigService.loadConfig().then(config => {
      this.authenticationEnabled = config.authenticationEnabled;
      this.cdr.markForCheck();
    }).catch(error => {
      console.error('Failed to load global config:', error);
    });
  }

  ngOnDestroy() {
    this.serversSub?.unsubscribe();
    this.stateSub?.unsubscribe();
  }

  onDrop(event: CdkDragDrop<ServerInstance[]>) {
    if (event.previousIndex === event.currentIndex) return;
    moveItemInArray(this.servers, event.previousIndex, event.currentIndex);
    const orderedIds = this.servers.map(s => s.id);
    this.serverInstanceService.reorderServers(orderedIds).pipe(take(1)).subscribe();
    this.cdr.markForCheck();
  }

  onServerClick(server: ServerInstance) {
    this.selectedServerId = server.id;
    this.selectServer.emit(server);
    this.serverInstanceService.setActiveServer(server);
    this.router.navigate(['/server']);
    // Close mobile menu after navigation
    this.closeMobileMenu.emit();
  }

  onServerNameDoubleClick(server: ServerInstance, event: Event) {
    event.stopPropagation(); // Prevent server selection
    
    // Only allow editing if server is not busy (starting, running, or stopping)
    if (this.isServerBusy(server)) {
      return;
    }
    
    this.editingServerId = server.id;
    this.editingServerName = server.name;
    this.cdr.markForCheck();
    
    // Focus the input after it's rendered
    setTimeout(() => {
      const input = document.querySelector('.editing-server-name') as HTMLInputElement;
      if (input) {
        input.focus();
        input.select();
      }
    }, 0);
  }

  onServerNameKeydown(event: KeyboardEvent, server: ServerInstance) {
    if (event.key === 'Enter') {
      this.saveServerName(server);
    } else if (event.key === 'Escape') {
      this.cancelServerNameEdit();
    }
  }

  onServerNameBlur(server: ServerInstance) {
    this.saveServerName(server);
  }

  private saveServerName(server: ServerInstance) {
    const trimmedName = this.editingServerName.trim();
    
    // Don't save if the name is empty
    if (!trimmedName) {
      this.cancelServerNameEdit();
      return;
    }
    
    // Don't save if the name hasn't actually changed
    if (trimmedName === server.name) {
      this.cancelServerNameEdit();
      return;
    }
    
    // Name has changed and is valid, proceed with save
    const updatedServer = { ...server, name: trimmedName };
    
    this.serverInstanceService.save(updatedServer).pipe(take(1)).subscribe((result) => {
      if (result && result.success === false && result.error) {
        this.notificationService.warning(result.error);
        this.cdr.markForCheck();
      } else {
        // Update local server list
        const idx = this.servers.findIndex(s => s.id === server.id);
        if (idx !== -1) {
          this.servers[idx].name = trimmedName;
          this.cdr.markForCheck();
        }
        
        // Backend will handle notifications to other clients
      }
      this.cancelServerNameEdit();
    });
  }

  private cancelServerNameEdit() {
    this.editingServerId = null;
    this.editingServerName = '';
    this.cdr.markForCheck();
  }

  isServerRunning(server: ServerInstance): boolean {
    return server.state?.toLowerCase() === 'running';
  }

  isServerBusy(server: ServerInstance): boolean {
    const state = server.state?.toLowerCase();
    return state === 'queued' || state === 'starting' || state === 'running' || state === 'stopping';
  }


  onAddServerClick() {
    this.showAddModal = true;
    this.serverName = '';
    setTimeout(() => {
      if (this.serverNameInput) {
        this.serverNameInput.nativeElement.focus();
      }
    }, 0);
  }

  onAddServer() {
    if (this.importMode === 'create' && this.serverName) {
      this.createNewServer();
    } else if (this.importMode === 'import' && this.serverName && this.selectedBackupFile) {
      this.importFromBackup();
    } else if (this.importMode === 'clone' && this.serverName && this.selectedServerToClone) {
      this.cloneServer();
    }
  }

  private createNewServer() {
    if (this.serverName) {
      this.serverInstanceService.getDefaultInstanceFromMeta().pipe(take(1)).subscribe(defaults => {
        // Merge user input with all default values
        const newInstance = { ...defaults, name: this.serverName, sessionName: this.serverName };
        this.serverInstanceService.save(newInstance).pipe(take(1)).subscribe((result) => {
          if (result && result.success === false && result.error) {
            this.notificationService.warning(result.error);
            this.cdr.markForCheck();
            return;
          }
          // Select the new server after creation
          if (result && result.instance && result.instance.id) {
            this.selectedServerId = result.instance.id;
            this.selectServer.emit(result.instance);
            this.serverInstanceService.setActiveServer(result.instance);
          }
          this.closeAdd();
        });
      });
    }
  }

  private cloneServer() {
    if (!this.serverName || !this.selectedServerToClone) return;

    // Clone the selected server with a new name, removing the ID so backend generates a new one
    const { id, ...serverToClone } = this.selectedServerToClone;
    const clonedInstance = {
      ...serverToClone,
      name: this.serverName,
      sessionName: this.serverName
    };

    this.serverInstanceService.save(clonedInstance).pipe(take(1)).subscribe((result) => {
      if (result && result.success === false && result.error) {
        this.notificationService.warning(result.error);
        this.cdr.markForCheck();
        return;
      }
      // Select the new cloned server after creation
      if (result && result.instance && result.instance.id) {
        this.selectedServerId = result.instance.id;
        this.selectServer.emit(result.instance);
        this.serverInstanceService.setActiveServer(result.instance);
      }
      this.closeAdd();
    });
  }

  setImportMode(mode: 'create' | 'import' | 'clone') {
    this.importMode = mode;
    this.serverName = '';
    this.selectedBackupFile = null;
    this.selectedBackupFilePath = '';
    this.selectedServerToClone = null;
  }

  onBackupFileSelect(event: any) {
    const file = event.target.files[0];
    if (file && file.name.endsWith('.zip')) {
      this.selectedBackupFile = file;
      
      // Check if we're in Electron and can get the file path
      const isElectron = (window as any).electronAPI !== undefined || 
                        navigator.userAgent.toLowerCase().indexOf('electron') > -1;
      
      if (isElectron && (file as any).path) {
        // Electron environment: use file path
        this.selectedBackupFilePath = (file as any).path;
      } else {
        // Browser environment: show file name in path field
        this.selectedBackupFilePath = file.name;
      }
      
      this.cdr.markForCheck();
    }
  }

  async selectBackupFile() {
    // Try to trigger the hidden file input
    if (this.backupFileInput?.nativeElement) {
      this.backupFileInput.nativeElement.click();
    } else {
      // Fallback to manual path input if file input is not available
      const filePath = prompt('Enter the full path to your backup ZIP file:');
      if (filePath && filePath.trim()) {
        this.selectedBackupFilePath = filePath.trim();
        this.selectedBackupFile = { name: this.selectedBackupFilePath.split(/[/\\]/).pop() || '' } as File;
        this.cdr.markForCheck();
      }
    }
  }

  canAddServer(): boolean {
    if (this.importMode === 'create') {
      return !!this.serverName;
    } else if (this.importMode === 'import') {
      // Check if we have either a file path (Electron) or a file object (browser)
      return !!(this.serverName && (this.selectedBackupFilePath || this.selectedBackupFile));
    } else if (this.importMode === 'clone') {
      return !!(this.serverName && this.selectedServerToClone);
    }
    return false;
  }

  private async importFromBackup() {
    if (!this.serverName) return;

    try {
      // Check if we're in Electron or browser environment
      const isElectron = (window as any).electronAPI !== undefined || 
                        navigator.userAgent.toLowerCase().indexOf('electron') > -1;

      let result;

      if (isElectron && this.selectedBackupFilePath) {
        // Electron environment: use file path
        result = this.serverInstanceService.importServerFromBackup(this.serverName, this.selectedBackupFilePath);
      } else if (this.selectedBackupFile) {
        // Browser environment: upload file data
        // Convert file to base64
        const fileData = await this.fileToBase64(this.selectedBackupFile);
        result = this.serverInstanceService.importServerFromBackup(
          this.serverName, 
          undefined, // no file path
          fileData, 
          this.selectedBackupFile.name
        );
      } else {
        throw new Error('No backup file selected');
      }

      // Handle the response
      result.pipe(take(1)).subscribe({
        next: (response) => {
          if (response.success && response.instance) {
            // Select the new server after import
            this.selectedServerId = response.instance.id;
            this.selectServer.emit(response.instance);
            this.serverInstanceService.setActiveServer(response.instance);
            this.notificationService.success(response.message || 'Server imported successfully');
            this.closeAdd();
            // Force change detection to ensure modal closes
            this.cdr.detectChanges();
          } else {
            this.notificationService.error(response.error || 'Failed to import server from backup');
          }
        },
        error: (error) => {
          console.error('Failed to import backup:', error);
          this.notificationService.error('Failed to import server from backup');
        }
      });

    } catch (error) {
      console.error('Failed to import backup:', error);
      this.notificationService.error('Failed to import server from backup');
    }
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        // Remove the data URL prefix (data:application/zip;base64,)
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = error => reject(error);
    });
  }

  private closeAdd() {
    this.showAddModal = false;
    this.serverName = '';
    this.selectedBackupFile = null;
    this.selectedBackupFilePath = '';
    this.selectedServerToClone = null;
    this.importMode = 'create';
    this.cdr.markForCheck();
  }

  /**
   * Confirms deletion of the selected server.
   * Prevents deleting the last server.
   */
  onConfirmDelete() {
    if (this.serverToDelete && this.servers.length > 1) {
      // Double-check that server is stopped before deletion
      if ((this.serverToDelete.state || '').toLowerCase() !== 'stopped') {
        this.notificationService.error('Cannot Delete Server', 'Server must be stopped before it can be deleted.');
        this.onCancelDelete();
        return;
      }
      
      this.serverInstanceService.delete(this.serverToDelete.id).pipe(take(1)).subscribe(() => {
        if (this.selectedServerId === this.serverToDelete?.id) {
          this.selectedServerId = null;
        }
        this.serverToDelete = null;
        this.showConfirmDeleteModal = false;
        this.cdr.markForCheck();
      });
    } else {
      // Just close modal if only one server left
      this.onCancelDelete();
    }
  }

  /**
   * Cancels the delete operation and closes the modal.
   */
  onCancelDelete() {
    this.serverToDelete = null;
    this.showConfirmDeleteModal = false;
    this.cdr.markForCheck();
  }

    /**
   * Returns the Material icon name for the given server state.
   */
  getServerStatusIcon(server: ServerInstance): string {
    switch ((server.state || '').toLowerCase()) {
      case 'running': return 'play_circle_filled';
      case 'stopped': return 'stop_circle';
      case 'queued': return 'schedule';
      case 'starting': return 'hourglass_empty';
      case 'stopping': return 'pause_circle_filled';
      case 'error': return 'error';
      default: return 'stop_circle';
    }
  }

  /**
   * Returns the CSS class for the given server state.
   */
  getServerStatusClass(server: ServerInstance): string {
    switch ((server.state || '').toLowerCase()) {
      case 'running': return 'status-running';
      case 'stopped': return 'status-stopped';
      case 'queued': return 'status-starting';
      case 'starting': return 'status-starting';
      case 'stopping': return 'status-stopping';
      case 'error': return 'status-error';
      default: return 'status-unknown';
    }
  }

  trackByServerId(index: number, server: ServerInstance) {
    return server.id;
  }

  /**
   * Called when the delete button is clicked for a server.
   */
  onDeleteServer(server: ServerInstance, event: Event) {
    event.stopPropagation();
    
    // Only allow deletion of stopped servers
    if ((server.state || '').toLowerCase() !== 'stopped') {
      this.notificationService.warning('Cannot Delete Server', 'Server must be stopped before it can be deleted.');
      return;
    }
    
    this.serverToDelete = server;
    this.showConfirmDeleteModal = true;
    this.cdr.markForCheck();
  }

  /**
   * Called when the settings button is clicked in the sidebar.
   */
  onSettingsClick() {
    this.router.navigate(['/settings']);
    // Close mobile menu after navigation
    this.closeMobileMenu.emit();
  }

  /**
   * Called when the logout button is clicked in the sidebar.
   */
  async onLogoutClick() {
    if (this.isWebMode) {
      try {
        const response = await fetch('/api/logout', { 
          method: 'POST',
          credentials: 'include'
        });
        
        if (response.ok) {
          // Logout successful, navigate to login page using Angular router
          this.router.navigate(['/login']);
        } else {
          console.error('Logout failed with status:', response.status);
          this.notificationService.error('Failed to logout', 'Authentication');
        }
      } catch (error) {
        console.error('Logout failed:', error);
        this.notificationService.error('Failed to logout', 'Authentication');
      }
    }
  }

  /**
   * Called when the add server modal is closed/cancelled.
   */
  onCancelAdd() {
    this.closeAdd();
  }

  startAllServers() {
    this.showConfirmStartAllModal = true;
    this.cdr.markForCheck();
  }

  onConfirmStartAll() {
    this.showConfirmStartAllModal = false;
    this.serverInstanceService.messaging.sendMessage('start-all-instances', {}).subscribe({
      next: (res: any) => {
        if (res?.success) {
          this.notificationService.success('All servers are starting.', 'Server Control');
        } else {
          this.notificationService.error(res?.error || 'Failed to start all servers.', 'Server Control');
        }
        this.cdr.markForCheck();
      },
      error: () => this.notificationService.error('Failed to start all servers.', 'Server Control')
    });
  }

  stopAllServers() {
    this.showConfirmStopAllModal = true;
    this.cdr.markForCheck();
  }

  onConfirmStopAll() {
    this.showConfirmStopAllModal = false;
    this.serverInstanceService.messaging.sendMessage('stop-all-instances', {}).subscribe({
      next: (res: any) => {
        if (res?.success) {
          this.notificationService.success('All servers are stopping.', 'Server Control');
        } else {
          this.notificationService.error(res?.error || 'Failed to stop all servers.', 'Server Control');
        }
        this.cdr.markForCheck();
      },
      error: () => this.notificationService.error('Failed to stop all servers.', 'Server Control')
    });
  }
}