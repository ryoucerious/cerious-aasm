import { Component, Input, Output, EventEmitter, OnChanges, OnInit, SimpleChanges, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ServerInstance } from '../../../../core/models/server-instance.model';
import { ClusterOption, ClustersService } from '../../../../core/services/clusters.service';
import { SettingsDrawerService } from '../../../../core/services/settings-drawer.service';
import { FieldMessages, FieldMessagesComponent } from '../../../field-messages/field-messages.component';

/** The dropdown's value for no cluster. */
const NONE = '';
/** The dropdown's value for a cluster ID and folder of the server's own, typed in below it. */
const OWN = '__own__';

@Component({
  selector: 'app-cluster-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, FieldMessagesComponent],
  templateUrl: './cluster-tab.component.html',
  styles: [`
    .cluster-choice-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
    .cluster-choice-row select { flex: 1 1 14rem; min-width: 0; }
  `]
})
export class ClusterTabComponent implements OnInit, OnChanges {
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

  readonly NONE = NONE;
  readonly OWN = OWN;
  clusters: ClusterOption[] = [];
  /** Own folder chosen, before anything is typed into it. */
  private ownChosen = false;

  private readonly clustersService = inject(ClustersService);
  private readonly settingsDrawer = inject(SettingsDrawerService);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    this.clustersService.clusters$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(clusters => this.clusters = clusters);
  }

  ngOnChanges(changes: SimpleChanges): void {
    const server = changes['serverInstance'];
    if (server && server.previousValue?.id !== server.currentValue?.id) this.ownChosen = false;
  }

  /** What the dropdown shows: the server's cluster, its own folder, or none. */
  get choice(): string {
    const server = this.serverInstance || {};
    if (server.clusterRef) return server.clusterRef;
    return this.ownChosen || server.clusterId || server.clusterDirOverride ? OWN : NONE;
  }

  /** The cluster the server is in; null for none, its own folder, or a cluster since removed. */
  get chosen(): ClusterOption | null {
    const ref = this.serverInstance?.clusterRef;
    return (ref && this.clusters.find(cluster => cluster.clusterId === ref)) || null;
  }

  /** The server names a cluster that is no longer in Settings → Clusters. */
  get removed(): boolean {
    return !!this.serverInstance?.clusterRef && !this.chosen;
  }

  /** The ID the server's players uploaded under before it chose a cluster, brought along once. */
  get earlierId(): string {
    return this.chosen ? (this.serverInstance.clusterId || '').trim() : '';
  }

  onChoose(choice: string): void {
    const server = this.serverInstance;
    if (choice === OWN) {
      this.ownChosen = true;
      server.clusterRef = null;
    } else if (choice === NONE) {
      this.ownChosen = false;
      server.clusterRef = null;
      server.clusterId = '';
      server.clusterDirOverride = '';
    } else {
      // The server's own ID and folder stay: what was uploaded under them is brought along at
      // its next start (see carryClusterData).
      this.ownChosen = false;
      server.clusterRef = choice;
    }
    this.saveSettings.emit();
  }

  manageClusters(): void {
    this.settingsDrawer.open('clusters');
  }

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
