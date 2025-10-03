import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface WhitelistPlayer {
  playerId: string;
  playerName?: string;
  dateAdded?: string;
}

@Component({
  selector: 'app-whitelist-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './whitelist-tab.component.html'
})
export class WhitelistTabComponent implements OnChanges {
  @Input() serverInstance: any;
  @Input() isLocked = false;

  @Output() saveSettings = new EventEmitter<void>();
  @Output() validateField = new EventEmitter<{key: string, value: any}>();
  @Output() statusUpdate = new EventEmitter<{message: string, type: 'success' | 'error' | 'warning'}>();

  // Modal states
  showAddPlayerModal = false;
  showBulkAddModal = false;
  showRemoveConfirmModal = false;
  playerToRemove: string = '';
  
  // Form data
  newPlayerId = '';
  newPlayerName = '';
  bulkPlayerIds = '';
  
  // UI state
  statusMessage = '';
  statusType: 'success' | 'error' | 'warning' = 'success';

  constructor() {}

  ngOnChanges(changes: SimpleChanges) {
    // Ensure exclusiveJoinPlayerIds array exists and migrate to new format
    if (changes['serverInstance'] && this.serverInstance) {
      if (!this.serverInstance.exclusiveJoinPlayerIds) {
        this.serverInstance.exclusiveJoinPlayerIds = [];
      }
      
      // Migrate from old string array to new player objects array if needed
      if (!this.serverInstance.exclusiveJoinPlayers && this.serverInstance.exclusiveJoinPlayerIds.length > 0) {
        this.serverInstance.exclusiveJoinPlayers = this.serverInstance.exclusiveJoinPlayerIds.map((id: string) => ({
          playerId: id,
          playerName: undefined,
          dateAdded: new Date().toLocaleDateString()
        }));
      } else if (!this.serverInstance.exclusiveJoinPlayers) {
        this.serverInstance.exclusiveJoinPlayers = [];
      }
    }
  }

  get whitelistEnabled(): boolean {
    return this.serverInstance?.useExclusiveList === true;
  }

  get whitelistedPlayers(): WhitelistPlayer[] {
    if (!this.serverInstance) {
      return [];
    }

    // Migrate from old string array to new player objects array if needed
    if (!this.serverInstance.exclusiveJoinPlayers && this.serverInstance.exclusiveJoinPlayerIds) {
      this.serverInstance.exclusiveJoinPlayers = this.serverInstance.exclusiveJoinPlayerIds.map((id: string) => ({
        playerId: id,
        playerName: undefined,
        dateAdded: new Date().toLocaleDateString()
      }));
    }

    return this.serverInstance.exclusiveJoinPlayers || [];
  }

  trackByPlayerId(index: number, player: WhitelistPlayer): string {
    return player.playerId;
  }

  onUseExclusiveListChange(enabled: boolean) {
    if (this.serverInstance) {
      this.serverInstance.useExclusiveList = enabled;
      
      // Initialize array if it doesn't exist
      if (!this.serverInstance.exclusiveJoinPlayerIds) {
        this.serverInstance.exclusiveJoinPlayerIds = [];
      }
      
      this.validateField.emit({ key: 'useExclusiveList', value: enabled });
      this.saveSettings.emit();
      
      if (!enabled) {
        // Clear whitelist when disabling
        this.serverInstance.exclusiveJoinPlayerIds = [];
      }
    }
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
    if (!this.newPlayerId.trim() || !this.serverInstance) return;

    const playerId = this.newPlayerId.trim();
    const playerName = this.newPlayerName.trim() || undefined;
    
    // Initialize arrays if they don't exist
    if (!this.serverInstance.exclusiveJoinPlayerIds) {
      this.serverInstance.exclusiveJoinPlayerIds = [];
    }
    if (!this.serverInstance.exclusiveJoinPlayers) {
      this.serverInstance.exclusiveJoinPlayers = [];
    }
    
    // Check if player already exists
    if (this.serverInstance.exclusiveJoinPlayers.some((p: any) => p.playerId === playerId)) {
      this.showStatus('Player is already in the whitelist', 'warning');
      return;
    }

    // Add to both arrays (for compatibility)
    const playerObj = {
      playerId,
      playerName,
      dateAdded: new Date().toLocaleDateString()
    };
    
    this.serverInstance.exclusiveJoinPlayers.push(playerObj);
    this.serverInstance.exclusiveJoinPlayerIds.push(playerId);
    
    this.saveSettings.emit();
    this.closeModal();
  }

  openRemoveConfirmModal(playerId: string) {
    this.playerToRemove = playerId;
    this.showRemoveConfirmModal = true;
  }

  removePlayer() {
    if (!this.playerToRemove || !this.serverInstance) return;

    // Remove from both arrays
    if (this.serverInstance.exclusiveJoinPlayers) {
      const index = this.serverInstance.exclusiveJoinPlayers.findIndex((p: any) => p.playerId === this.playerToRemove);
      if (index > -1) {
        this.serverInstance.exclusiveJoinPlayers.splice(index, 1);
      }
    }
    
    if (this.serverInstance.exclusiveJoinPlayerIds) {
      const index = this.serverInstance.exclusiveJoinPlayerIds.indexOf(this.playerToRemove);
      if (index > -1) {
        this.serverInstance.exclusiveJoinPlayerIds.splice(index, 1);
      }
    }

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
    const playerIds = this.bulkPlayerIds.split('\n')
      .map(id => id.trim())
      .filter(id => id.length > 0);

    if (playerIds.length === 0) {
      this.showStatus('No valid player IDs found', 'error');
      return;
    }

    if (!this.serverInstance) return;

    // Initialize arrays if they don't exist
    if (!this.serverInstance.exclusiveJoinPlayerIds) {
      this.serverInstance.exclusiveJoinPlayerIds = [];
    }
    if (!this.serverInstance.exclusiveJoinPlayers) {
      this.serverInstance.exclusiveJoinPlayers = [];
    }

    let addedCount = 0;
    let duplicateCount = 0;

    playerIds.forEach(playerId => {
      if (!this.serverInstance.exclusiveJoinPlayers.some((p: any) => p.playerId === playerId)) {
        const playerObj = {
          playerId,
          playerName: undefined,
          dateAdded: new Date().toLocaleDateString()
        };
        this.serverInstance.exclusiveJoinPlayers.push(playerObj);
        this.serverInstance.exclusiveJoinPlayerIds.push(playerId);
        addedCount++;
      } else {
        duplicateCount++;
      }
    });

    if (addedCount > 0) {
      this.saveSettings.emit();
    }
    this.closeModal();
  }

  private showStatus(message: string, type: 'success' | 'error' | 'warning') {
    this.statusMessage = message;
    this.statusType = type;
    this.statusUpdate.emit({ message, type });
    
    // Clear status after 5 seconds
    setTimeout(() => {
      this.statusMessage = '';
    }, 5000);
  }
}