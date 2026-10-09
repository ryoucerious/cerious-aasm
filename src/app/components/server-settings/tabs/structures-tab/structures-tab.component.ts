import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FieldDefinition } from '../../../../core/services/field-definitions.service';
import { FieldMessages, FieldMessagesComponent } from '../../../field-messages/field-messages.component';

@Component({
  selector: 'app-structures-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, FieldMessagesComponent],
  templateUrl: './structures-tab.component.html'
})
export class StructuresTabComponent {
  // Fields are addressed by key from the settings metadata, so this stays loosely typed.
  @Input() serverInstance: any = {};
  @Input() isLocked = false;
  /** Settings saved since the running server started, marked as waiting for its next restart. */
  @Input() pendingKeys: ReadonlySet<string> = new Set();
  @Input() structuresFields: FieldDefinition[] = [];
  @Input() fieldErrors: FieldMessages = {};
  @Input() fieldWarnings: FieldMessages = {};

  @Output() saveSettings = new EventEmitter<void>();
  @Output() validateField = new EventEmitter<{key: string, value: unknown}>();

  getFieldsByCategory(category: string): FieldDefinition[] {
    const categories: { [key: string]: string[] } = {
      'damage': [
        'structureResistanceMultiplier',
        'structureDamageMultiplier',
        'pvePlatformStructureDamageRatio',
        'autoDestroyOldStructuresMultiplier',
        'maxStructuresInRange',
        'bDisableStructureDecayPvE',
        'pveStructureDecayPeriodMultiplier',
        'pveStructureDecayDelay',
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
      .filter((field): field is FieldDefinition => field !== undefined);
  }

  onSaveSettings(): void {
    this.saveSettings.emit();
  }

  onValidateField(key: string, value: unknown): void {
    this.validateField.emit({key, value});
  }
}