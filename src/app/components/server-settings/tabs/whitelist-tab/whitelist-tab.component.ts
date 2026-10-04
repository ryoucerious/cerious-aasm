import { Component, Input, Output, EventEmitter, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ServerInstance } from '../../../../core/models/server-instance.model';

type WhitelistSettings = Pick<ServerInstance, 'useExclusiveList' | 'exclusiveJoinPlayerIds' | 'exclusiveJoinPlayers'> & { id?: string };
type WhitelistPlayer = NonNullable<ServerInstance['exclusiveJoinPlayers']>[number];
type StatusType = 'success' | 'error' | 'warning';

const STATUS_DISPLAY_MS = 5000;

@Component({
  selector: 'app-whitelist-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './whitelist-tab.component.html'
})
export class WhitelistTabComponent implements OnChanges, OnDestroy {
  @Input() serverInstance: WhitelistSettings | null = null;
  @Input() isLocked = false;

  @Output() saveSettings = new EventEmitter<void>();
  @Output() validateField = new EventEmitter<{key: string, value: unknown}>();

  showAddPlayerModal = false;
  showBulkAddModal = false;
  showRemoveConfirmModal = false;
  playerToRemove = '';

  newPlayerId = '';
  newPlayerName = '';
  bulkPlayerIds = '';

  statusMessage = '';
  statusType: StatusType = 'success';
  private statusTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    const change = changes['serverInstance'];
    if (!change) return;
    if (change.previousValue?.id !== change.currentValue?.id) {
      this.closeModal();
      this.clearStatus();
    }
    // Older configs kept bare ids; the list shows player entries.
    const server = this.serverInstance;
    if (server?.exclusiveJoinPlayerIds?.length && !server.exclusiveJoinPlayers) {
      server.exclusiveJoinPlayers = server.exclusiveJoinPlayerIds.map(playerId => this.newEntry(playerId));
    }
  }

  ngOnDestroy(): void {
    this.clearStatus();
  }

  get whitelistEnabled(): boolean {
    return this.serverInstance?.useExclusiveList === true;
  }

  get whitelistedPlayers(): WhitelistPlayer[] {
    return this.serverInstance?.exclusiveJoinPlayers ?? [];
  }

  trackByPlayerId(_index: number, player: WhitelistPlayer): string {
    return player.playerId;
  }

  /** Turning the whitelist off keeps the list, so turning it back on restores it. */
  onUseExclusiveListChange(enabled: boolean) {
    if (!this.serverInstance) return;
    this.serverInstance.useExclusiveList = enabled;
    this.validateField.emit({ key: 'useExclusiveList', value: enabled });
    this.saveSettings.emit();
  }

  openAddPlayerModal() {
    this.newPlayerId = '';
    this.newPlayerName = '';
    this.showAddPlayerModal = true;
  }

  openBulkAddModal() {
    this.bulkPlayerIds = '';
    this.showBulkAddModal = true;
  }

  closeModal() {
    this.showAddPlayerModal = false;
    this.showBulkAddModal = false;
    this.showRemoveConfirmModal = false;
    this.newPlayerId = '';
    this.newPlayerName = '';
    this.bulkPlayerIds = '';
    this.playerToRemove = '';
  }

  addPlayer() {
    const playerId = this.newPlayerId.trim();
    if (!playerId || !this.serverInstance) return;

    if (this.whitelistedPlayers.some(player => player.playerId === playerId)) {
      this.showStatus('Player is already in the whitelist', 'warning');
      return;
    }

    this.addEntries([this.newEntry(playerId, this.newPlayerName.trim() || undefined)]);
    this.saveSettings.emit();
    this.closeModal();
  }

  openRemoveConfirmModal(playerId: string) {
    this.playerToRemove = playerId;
    this.showRemoveConfirmModal = true;
  }

  removePlayer() {
    const server = this.serverInstance;
    if (!this.playerToRemove || !server) return;

    server.exclusiveJoinPlayers = this.whitelistedPlayers.filter(player => player.playerId !== this.playerToRemove);
    server.exclusiveJoinPlayerIds = (server.exclusiveJoinPlayerIds ?? []).filter(id => id !== this.playerToRemove);

    this.showStatus('Player removed from whitelist', 'success');
    this.saveSettings.emit();
    this.closeModal();
  }

  clearWhitelist() {
    if (!confirm('Are you sure you want to clear the entire whitelist? This action cannot be undone.')) {
      return;
    }

    if (this.serverInstance) {
      this.serverInstance.exclusiveJoinPlayerIds = [];
      this.serverInstance.exclusiveJoinPlayers = [];
      this.showStatus('Whitelist cleared successfully', 'success');
      this.saveSettings.emit();
    }
  }

  bulkAddPlayers() {
    const playerIds = this.bulkPlayerIds.split('\n').map(id => id.trim()).filter(id => id.length > 0);

    if (playerIds.length === 0) {
      this.showStatus('No valid player IDs found', 'error');
      return;
    }

    if (!this.serverInstance) return;

    const listed = new Set(this.whitelistedPlayers.map(player => player.playerId));
    const added: string[] = [];
    for (const playerId of playerIds) {
      if (listed.has(playerId)) continue;
      listed.add(playerId);
      added.push(playerId);
    }
    const duplicates = playerIds.length - added.length;

    if (added.length > 0) {
      this.addEntries(added.map(playerId => this.newEntry(playerId)));
      this.saveSettings.emit();
      const skipped = duplicates > 0 ? `; ${duplicates} already on the whitelist` : '';
      this.showStatus(`Added ${added.length} player(s) to the whitelist${skipped}`, 'success');
    } else {
      this.showStatus(`All ${duplicates} player(s) are already on the whitelist`, 'warning');
    }
    this.closeModal();
  }

  private addEntries(entries: WhitelistPlayer[]): void {
    const server = this.serverInstance;
    if (!server) return;
    server.exclusiveJoinPlayers = [...this.whitelistedPlayers, ...entries];
    server.exclusiveJoinPlayerIds = [...(server.exclusiveJoinPlayerIds ?? []), ...entries.map(entry => entry.playerId)];
  }

  private newEntry(playerId: string, playerName?: string): WhitelistPlayer {
    return { playerId, playerName, dateAdded: new Date().toLocaleDateString() };
  }

  private showStatus(message: string, type: StatusType) {
    this.clearStatus();
    this.statusMessage = message;
    this.statusType = type;
    this.statusTimer = setTimeout(() => {
      this.statusTimer = null;
      this.statusMessage = '';
    }, STATUS_DISPLAY_MS);
  }

  private clearStatus(): void {
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }
    this.statusMessage = '';
  }
}
