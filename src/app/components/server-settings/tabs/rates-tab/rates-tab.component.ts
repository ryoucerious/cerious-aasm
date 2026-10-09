import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FieldDefinition } from '../../../../core/services/field-definitions.service';
import { FieldMessages, FieldMessagesComponent } from '../../../field-messages/field-messages.component';

@Component({
  selector: 'app-rates-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, FieldMessagesComponent],
  templateUrl: './rates-tab.component.html'
})
export class RatesTabComponent {
  // Fields are addressed by key from the settings metadata, so this stays loosely typed.
  @Input() serverInstance: any = {};
  @Input() isLocked = false;
  /** Settings saved since the running server started, marked as waiting for its next restart. */
  @Input() pendingKeys: ReadonlySet<string> = new Set();
  @Input() ratesFields: FieldDefinition[] = [];
  @Input() fieldErrors: FieldMessages = {};
  @Input() fieldWarnings: FieldMessages = {};

  @Output() saveSettings = new EventEmitter<void>();
  @Output() validateField = new EventEmitter<{key: string, value: unknown}>();

  getFieldsByCategory(category: string): FieldDefinition[] {
    const categories: { [key: string]: string[] } = {
      'experience': [
        'xpMultiplier',
        'overrideOfficialDifficulty',
        'difficultyOffset'
      ],
      'taming': [
        'tamingSpeedMultiplier',
        'eggHatchSpeedMultiplier',
        'babyMatureSpeedMultiplier',
        'matingIntervalMultiplier',
        'layEggIntervalMultiplier',
        'matingSpeedMultiplier',
        'babyFoodConsumptionSpeedMultiplier',
        'babyCuddleIntervalMultiplier',
        'babyImprintingStatScaleMultiplier',
        'babyCuddleGracePeriodMultiplier',
        'babyCuddleLoseImprintQualitySpeedMultiplier',
        'babyImprintAmountMultiplier',
        'babyMaxIntervalMultiplier',
        'passiveTameIntervalMultiplier',
        'oviraptorEggConsumptionMultiplier'
      ],
      'harvesting': [
        'harvestAmountMultiplier',
        'dinoHarvestingDamageMultiplier',
        'playerHarvestingDamageMultiplier',
        'resourcesRespawnPeriodMultiplier',
        'cropGrowthSpeedMultiplier',
        'cropDecaySpeedMultiplier'
      ],
      'stats': [
        'playerCharacterFoodDrainMultiplier',
        'playerCharacterStaminaDrainMultiplier',
        'playerCharacterHealthRecoveryMultiplier',
        'playerCharacterWaterDrainMultiplier',
        'playerCharacterDamageMultiplier',
        'playerCharacterResistanceMultiplier',
        'dinoCharacterFoodDrainMultiplier',
        'dinoCharacterStaminaDrainMultiplier',
        'dinoCharacterHealthRecoveryMultiplier',
        'dinoCharacterDamageMultiplier',
        'dinoCharacterResistanceMultiplier',
        'tamedDinoCharacterFoodDrainMultiplier',
        'tamedDinoTorporDrainMultiplier',
        'dinoCountMultiplier'
      ],
      'world': [
        'dayCycleSpeedScale',
        'dayTimeSpeedScale',
        'nightTimeSpeedScale',
        'fuelConsumptionIntervalMultiplier',
        'globalSpoilingTimeMultiplier',
        'globalItemDecompositionTimeMultiplier',
        'globalCorpseDecompositionTimeMultiplier'
      ],
      'loot': [
        'supplyCrateLootQualityMultiplier',
        'fishingLootQualityMultiplier'
      ]
    };

    const categoryKeys = categories[category] || [];
    return categoryKeys
      .map(key => this.ratesFields.find(field => field.key === key))
      .filter((field): field is FieldDefinition => field !== undefined);
  }

  onSaveSettings(): void {
    this.saveSettings.emit();
  }

  onValidateField(key: string, value: unknown): void {
    this.validateField.emit({key, value});
  }
}