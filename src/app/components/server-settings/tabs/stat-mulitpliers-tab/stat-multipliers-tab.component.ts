import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-stat-multipliers-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './stat-multipliers-tab.component.html'
})
export class StatMultipliersTabComponent {
  @Input() serverInstance: any = {};
  @Input() isLocked = false;
  @Input() statList: string[] = [];
  @Input() selectedStatIndex: number | null = null;
  @Input() statSelectorDropdownOpen = false;

  @Output() statMultiplierChanged = new EventEmitter<{type: string, statIndex: number, value: number}>();
  @Output() resetStatToDefaults = new EventEmitter<number>();
  @Output() copyStatToAll = new EventEmitter<number>();
  @Output() toggleStatSelectorDropdown = new EventEmitter<void>();
  @Output() statSelectorSelect = new EventEmitter<number>();

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
    // This should be implemented based on your stat multiplier logic
    return 1.0;
  }

  onStatMultiplierChange(type: string, statIndex: number, value: number): void {
    this.statMultiplierChanged.emit({type, statIndex, value});
  }

  onResetStatToDefaults(statIndex: number): void {
    this.resetStatToDefaults.emit(statIndex);
  }

  onCopyStatToAll(statIndex: number): void {
    this.copyStatToAll.emit(statIndex);
  }
}