import { Component, EventEmitter, Input, Output, ViewChild, ElementRef, ChangeDetectorRef, ChangeDetectionStrategy, OnChanges, SimpleChanges, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Observable, switchMap, firstValueFrom } from 'rxjs';
import { ModalComponent } from '../modal/modal.component';
import { DropdownComponent, DropdownOption } from '../dropdown/dropdown.component';
import { SaveInstanceResult, ServerInstance } from '../../core/models/server-instance.model';
import { ImportServerResult, ServerInstanceService, withoutRuntimeFields } from '../../core/services/server-instance.service';
import { NotificationService } from '../../core/services/notification.service';
import { IpcService } from '../../core/services/ipc.service';
import { MeshNodesService } from '../../core/services/mesh-nodes.service';
import { MessagingService, MOVE_TIMEOUT_MS } from '../../core/services/messaging/messaging.service';
import type { DesktopFile } from '../../core/types/electron-api';
import { fileToBase64, desktopFilePath } from '../../core/utils/file.utils';

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
  /** Mesh nodes the operator may place a new server on. Empty on a standalone install. */
    /** The machines of the mesh, from MeshNodesService: the same wherever the dialog is opened from. */
  selectedNodeId = '';
  placementOptions: DropdownOption<string>[] = [];
  /** For an import: this machine, where the backup is restored, then the others it can move to. */
  importOptions: DropdownOption<string>[] = [];
  private readonly messaging = inject(MessagingService);

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
    private cdr: ChangeDetectorRef,
    private meshNodes: MeshNodesService,
    private destroyRef: DestroyRef
  ) {
    // Built when the machines change, not on every check: options rebuilt each check stopped clicks registering.
    this.meshNodes.changed$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.buildPlacementOptions());
  }

  private buildPlacementOptions(): void {
    const choices = this.meshNodes.placementChoices();
    this.placementOptions = choices.length
      ? [{ value: '', label: 'Auto-select' }, ...choices.map(node => ({ value: node.nodeId, label: node.skipping ? `${node.name} (skipping new servers)` : node.name }))]
      : [];
    this.importOptions = choices.length
      // A move refuses a machine skipping new servers, so an import could only fail there.
      ? [{ value: '', label: 'This machine' }, ...choices.filter(node => !this.meshNodes.isHere(node.nodeId) && !node.skipping).map(node => ({ value: node.nodeId, label: node.name }))]
      : [];
    this.cdr.markForCheck();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['servers']) {
      this.cloneOptions = (this.servers || []).map(server => ({ value: server, label: server.name }));
    }
    if (changes['show'] && this.show) {
      this.reset();
      this.buildPlacementOptions();
      setTimeout(() => this.serverNameInput?.nativeElement.focus(), 0);
    }
  }

  /** Where the server goes, in a mesh: Auto-select or a machine for a new server or a clone; for an import, see importOptions. */
  get machineOptions(): DropdownOption<string>[] {
    return this.importMode === 'import' ? this.importOptions : this.placementOptions;
  }

  setImportMode(mode: ImportMode): void {
    this.importMode = mode;
    this.selectedNodeId = '';
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

  onAddServer(): void | Promise<void> {
    if (!this.canAddServer()) return;
    if (this.importMode === 'create') this.createNewServer();
    else if (this.importMode === 'import') return this.importFromBackup();
    else return this.cloneServer();
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
      this.selectedBackupFilePath = this.ipc.isElectron ? desktopFilePath(file) : '';
      this.cdr.markForCheck();
    }
  }

  selectBackupFile(): void {
    this.backupFileInput?.nativeElement.click();
  }

  private placementFields(): { nodeId?: string } {
    return this.selectedNodeId ? { nodeId: this.selectedNodeId } : {};
  }

  private createNewServer(): void {
    this.busy = true;
    this.serverInstanceService.getDefaultInstanceFromMeta().pipe(
      switchMap(defaults => this.serverInstanceService.save({ ...defaults, name: this.serverName, sessionName: this.serverName, ...this.placementFields() }))
    ).subscribe({
      next: result => this.handleSaveResult(result, 'Failed to create server'),
      error: () => this.fail('Failed to create server')
    });
  }

  private async cloneServer(): Promise<void> {
    if (!this.selectedServerToClone) return;
    this.busy = true;
    let created: ServerInstance | undefined;
    try {
      const reply = await firstValueFrom(this.messaging.sendMessage<{ instance?: ServerInstance }>('get-server-instance', { id: this.selectedServerToClone.id }));
      if (!reply?.instance) throw new Error('Source server is unavailable');
      const files = await firstValueFrom(this.messaging.sendMessage<{ success?: boolean; zipData?: string; error?: string }>('export-ark-api-clone', { instanceId: reply.instance.id }, { timeoutMs: MOVE_TIMEOUT_MS }));
      if (!files?.success || !files.zipData) throw new Error(files?.error || 'Could not read the source API plugins');
      const { id, nodeId, ...source } = withoutRuntimeFields(reply.instance);
      const useExclusiveList = source.useExclusiveList === true || String(source.useExclusiveList) === 'true' || /(?:^|\s)-exclusivejoin(?:\s|$)/i.test(String(source.launchParameters || ''));
      const result = await firstValueFrom(this.serverInstanceService.save({ ...source, useExclusiveList, name: this.serverName, sessionName: this.serverName, ...this.placementFields() }));
      if (!result.success || !result.instance) throw new Error(result.error || 'Could not create the clone');
      created = result.instance;
      const installed = await firstValueFrom(this.messaging.sendMessage<{ success?: boolean; error?: string }>('import-ark-api-clone', { instanceId: created.id, zipData: files.zipData }, { timeoutMs: MOVE_TIMEOUT_MS }));
      if (!installed?.success) throw new Error(installed?.error || 'Could not copy API plugins');
      this.handleSaveResult(result, 'Failed to clone server');
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Failed to clone server';
      if (created) {
        this.notificationService.warning(`Server created, but plugin copy failed: ${reason}`);
        this.finish(created);
      } else this.fail(reason);
    }
  }

  private async importFromBackup(): Promise<void> {
    this.busy = true;
    try {
      let result: Observable<ImportServerResult>;
      if (this.ipc.isElectron && this.selectedBackupFilePath) {
        result = this.serverInstanceService.importServerFromBackup(this.serverName, this.selectedBackupFilePath);
      } else if (this.selectedBackupFile) {
        const fileData = await fileToBase64(this.selectedBackupFile);
        result = this.serverInstanceService.importServerFromBackup(this.serverName, undefined, fileData, this.selectedBackupFile.name);
      } else {
        throw new Error('No backup file selected');
      }

      result.subscribe({
        next: response => {
          if (response?.success && response.instance && this.selectedNodeId) {
            this.moveImported(response.instance);
          } else if (response?.success && response.instance) {
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

  /** Restored here, then moved to the machine chosen; if the move fails it stays here, and says why. */
  private moveImported(instance: ServerInstance): void {
    const target = this.importOptions.find(option => option.value === this.selectedNodeId)?.label || 'that machine';
    const stayed = (reason?: string) => this.notificationService.warning(
      `Imported on this machine. It could not be moved to ${target}${reason ? `: ${reason}` : '.'}`
    );
    this.messaging.sendMessage<{ success?: boolean; error?: string }>('move-server', { serverId: instance.id, nodeId: this.selectedNodeId }, { timeoutMs: MOVE_TIMEOUT_MS })
      .subscribe({
        next: reply => {
          if (reply?.success) this.notificationService.success(`Imported and moved to ${target}.`);
          else stayed(reply?.error);
          this.finish(instance);
        },
        error: () => {
          stayed();
          this.finish(instance);
        }
      });
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
    this.selectedNodeId = '';
    this.busy = false;
  }

}
