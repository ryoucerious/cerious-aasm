import { Component, EventEmitter, Input, Output, ViewChild, ElementRef, ChangeDetectorRef, ChangeDetectionStrategy, OnChanges, SimpleChanges } from '@angular/core';
import { NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Observable, switchMap } from 'rxjs';
import { ModalComponent } from '../modal/modal.component';
import { DropdownComponent, DropdownOption } from '../dropdown/dropdown.component';
import { SaveInstanceResult, ServerInstance } from '../../core/models/server-instance.model';
import { ImportServerResult, ServerInstanceService, withoutRuntimeFields } from '../../core/services/server-instance.service';
import { NotificationService } from '../../core/services/notification.service';
import { IpcService } from '../../core/services/ipc.service';
import type { DesktopFile } from '../../core/types/electron-api';

export type ImportMode = 'create' | 'import' | 'clone';

/**
 * "Add Server" dialog: create a blank server, import one from a backup ZIP, or clone an
 * existing one. Used from the sidebar and the dashboard, so the whole flow lives here
 * rather than in either host.
 */
@Component({
  selector: 'app-add-server-modal',
  standalone: true,
  imports: [NgIf, FormsModule, ModalComponent, DropdownComponent],
  templateUrl: './add-server-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AddServerModalComponent implements OnChanges {
  @Input() show = false;
  @Input() servers: ServerInstance[] = [];

  /**
   * The clone source picker lists the existing servers by name. Rebuilt when the list
   * changes rather than on every change detection pass, so the options stay clickable.
   */
  cloneOptions: DropdownOption<ServerInstance>[] = [];
  @Output() closed = new EventEmitter<void>();
  @Output() created = new EventEmitter<ServerInstance>();

  @ViewChild('serverNameInput') serverNameInput?: ElementRef<HTMLInputElement>;
  @ViewChild('backupFileInput') backupFileInput?: ElementRef<HTMLInputElement>;

  serverName = '';
  importMode: ImportMode = 'create';
  selectedBackupFile: File | null = null;
  selectedBackupFilePath = '';
  selectedServerToClone: ServerInstance | null = null;
  busy = false;

  constructor(
    private router: Router,
    private serverInstanceService: ServerInstanceService,
    private notificationService: NotificationService,
    private ipc: IpcService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['servers']) {
      this.cloneOptions = (this.servers || []).map(server => ({ value: server, label: server.name }));
    }
    if (changes['show'] && this.show) {
      this.reset();
      setTimeout(() => this.serverNameInput?.nativeElement.focus(), 0);
    }
  }

  setImportMode(mode: ImportMode): void {
    this.importMode = mode;
    this.serverName = '';
    this.selectedBackupFile = null;
    this.selectedBackupFilePath = '';
    this.selectedServerToClone = null;
  }

  canAddServer(): boolean {
    if (this.busy) return false;
    if (this.importMode === 'create') return !!this.serverName;
    if (this.importMode === 'import') return !!(this.serverName && (this.selectedBackupFilePath || this.selectedBackupFile));
    if (this.importMode === 'clone') return !!(this.serverName && this.selectedServerToClone);
    return false;
  }

  onAddServer(): void {
    if (!this.canAddServer()) return;
    if (this.importMode === 'create') this.createNewServer();
    else if (this.importMode === 'import') this.importFromBackup();
    else this.cloneServer();
  }

  /** Cancel, Escape or the backdrop. Ignored while a server is being added, as the Cancel button is. */
  onCancel(): void {
    if (this.busy) return;
    this.close();
  }

  onBackupFileSelect(event: Event): void {
    const file: DesktopFile | undefined = (event.target as HTMLInputElement | null)?.files?.[0];
    if (file && file.name.endsWith('.zip')) {
      this.selectedBackupFile = file;
      this.selectedBackupFilePath = this.ipc.isElectron && file.path ? file.path : file.name;
      this.cdr.markForCheck();
    }
  }

  selectBackupFile(): void {
    this.backupFileInput?.nativeElement.click();
  }

  private createNewServer(): void {
    this.busy = true;
    this.serverInstanceService.getDefaultInstanceFromMeta().pipe(
      switchMap(defaults => this.serverInstanceService.save({ ...defaults, name: this.serverName, sessionName: this.serverName }))
    ).subscribe({
      next: result => this.handleSaveResult(result, 'Failed to create server'),
      error: () => this.fail('Failed to create server')
    });
  }

  private cloneServer(): void {
    if (!this.selectedServerToClone) return;
    this.busy = true;
    const { id, ...source } = withoutRuntimeFields(this.selectedServerToClone);
    this.serverInstanceService.save({ ...source, name: this.serverName, sessionName: this.serverName }).subscribe({
      next: result => this.handleSaveResult(result, 'Failed to clone server'),
      error: () => this.fail('Failed to clone server')
    });
  }

  private async importFromBackup(): Promise<void> {
    this.busy = true;
    try {
      let result: Observable<ImportServerResult>;
      if (this.ipc.isElectron && this.selectedBackupFilePath) {
        result = this.serverInstanceService.importServerFromBackup(this.serverName, this.selectedBackupFilePath);
      } else if (this.selectedBackupFile) {
        const fileData = await this.fileToBase64(this.selectedBackupFile);
        result = this.serverInstanceService.importServerFromBackup(this.serverName, undefined, fileData, this.selectedBackupFile.name);
      } else {
        throw new Error('No backup file selected');
      }

      result.subscribe({
        next: response => {
          if (response?.success && response.instance) {
            this.notificationService.success(response.message || 'Server imported successfully');
            this.finish(response.instance);
          } else {
            this.fail(response?.error || 'Failed to import server from backup');
          }
        },
        error: error => {
          console.error('[add-server-modal] Failed to import backup:', error);
          this.fail('Failed to import server from backup');
        }
      });
    } catch (error) {
      console.error('[add-server-modal] Failed to import backup:', error);
      this.fail('Failed to import server from backup');
    }
  }

  private handleSaveResult(result: SaveInstanceResult | null, failure: string): void {
    if (result?.success === false) {
      this.notificationService.warning(result.error || failure);
      this.busy = false;
      this.cdr.markForCheck();
      return;
    }
    if (result?.instance?.id) {
      this.finish(result.instance);
    } else {
      this.close();
    }
  }

  private finish(instance: ServerInstance): void {
    this.serverInstanceService.setActiveServer(instance);
    this.created.emit(instance);
    this.close();
    // A new server needs configuring before it can start, so land on its General page.
    this.router.navigate(['/server', 'general']);
  }

  private fail(message: string): void {
    this.notificationService.error(message);
    this.busy = false;
    this.cdr.markForCheck();
  }

  private close(): void {
    this.reset();
    this.closed.emit();
    this.cdr.markForCheck();
  }

  private reset(): void {
    this.serverName = '';
    this.importMode = 'create';
    this.selectedBackupFile = null;
    this.selectedBackupFilePath = '';
    this.selectedServerToClone = null;
    this.busy = false;
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = error => reject(error);
    });
  }
}
