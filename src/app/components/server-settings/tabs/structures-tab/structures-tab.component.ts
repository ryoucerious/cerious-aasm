import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface Field {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'dropdown' | 'combo' | 'multi-toggle';
  description: string;
  options?: any[];
  step?: number;
  min?: number;
  max?: number;
}

@Component({
  selector: 'app-structures-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './structures-tab.component.html'
})
export class StructuresTabComponent {
  @Input() serverInstance: any = {};
  @Input() isLocked = false;
  @Input() structuresFields: Field[] = [];

  @Output() saveSettings = new EventEmitter<void>();
  @Output() validateField = new EventEmitter<{key: string, value: any}>();

  getFieldsByCategory(category: string): Field[] {
    const categories: { [key: string]: string[] } = {
      'damage': [
        'structureResistanceMultiplier',
        'structureDamageMultiplier',
        'pvePlatformStructureDamageRatio',
        'autoDestroyOldStructuresMultiplier',
        'maxStructuresInRange',
        'bDisableStructureDecayPvE',
        'pvpStructureDecay'
      ],
      'platform': [
        'perPlatformMaxStructuresMultiplier',
        'platformSaddleBuildAreaBoundsMultiplier',
        'maxPlatformSaddleStructureLimit',
        'maxGateFrameOnSaddles',
        'bAllowPlatformSaddleStacking',
        'bAllowPlatformSaddleMultiFloors',
        'overrideStructurePlatformPrevention'
      ],
      'building': [
        'structurePreventResourceRadiusMultiplier',
        'structurePickupTimeAfterPlacement',
        'structurePickupHoldDuration',
        'allowIntegratedSPlusStructures',
        'allowCaveBuildingPvE',
        'bDisableStructurePlacementCollision',
        'bEnableExtraStructurePreventionVolumes',
        'forceAllStructureLocking',
        'allowCrateSpawnsOnTopOfStructures'
      ]
    };

    const categoryKeys = categories[category] || [];
    return categoryKeys
      .map(key => this.structuresFields.find(field => field.key === key))
      .filter((field): field is Field => field !== undefined);
  }

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

  onSaveSettings(): void {
    this.saveSettings.emit();
  }

  onValidateField(key: string, value: any): void {
    this.validateField.emit({key, value});
  }
}