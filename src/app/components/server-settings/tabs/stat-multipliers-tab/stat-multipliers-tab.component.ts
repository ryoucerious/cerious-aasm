import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StatMultiplierService, StatMultipliers } from '../../../../core/services/stat-multiplier.service';

export interface StatMultiplierChange {
  type: string;
  statIndex: number;
  value: number;
}

@Component({
  selector: 'app-stat-multipliers-tab',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './stat-multipliers-tab.component.html'
})
export class StatMultipliersTabComponent {
  @Input() serverInstance: StatMultipliers | null = null;
  @Input() isLocked = false;
  @Input() statList: string[] = [];
  @Input() selectedStatIndex: number | null = null;
  @Input() statSelectorDropdownOpen = false;

  @Output() statMultiplierChanged = new EventEmitter<StatMultiplierChange>();
  @Output() resetStatToDefaults = new EventEmitter<number>();
  @Output() copyStatToAll = new EventEmitter<number>();
  @Output() toggleStatSelectorDropdown = new EventEmitter<void>();
  @Output() statSelectorSelect = new EventEmitter<number>();

  constructor(private statMultiplierService: StatMultiplierService) {}

  getStatSelectorDisplayName(index: number | null): string {
    if (index === null || !this.statList[index]) {
      return 'Select Stat...';
    }
    return this.statList[index];
  }

  onToggleStatSelectorDropdown(): void {
    this.toggleStatSelectorDropdown.emit();
  }

  onStatSelectorSelect(index: number): void {
    this.statSelectorSelect.emit(index);
  }

  getStatMultiplier(type: string, statIndex: number): number {
    if (!this.serverInstance || statIndex < 0) {
      return 1.0;
    }
    return this.statMultiplierService.getStatMultiplier(this.serverInstance, type, statIndex);
  }

  /** Sends a committed value of 0 or more; anything else, an empty field included, shows the stored value again. */
  onStatMultiplierCommit(type: string, statIndex: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = input.value.trim() === '' ? NaN : Number(input.value);
    if (!Number.isFinite(value) || value < 0) {
      input.value = String(this.getStatMultiplier(type, statIndex));
      return;
    }
    this.statMultiplierChanged.emit({ type, statIndex, value });
  }

  onResetStatToDefaults(statIndex: number): void {
    this.resetStatToDefaults.emit(statIndex);
  }

  onCopyStatToAll(statIndex: number): void {
    this.copyStatToAll.emit(statIndex);
  }
}
