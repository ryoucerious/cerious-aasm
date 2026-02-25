import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface Field {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'dropdown' | 'combo' | 'multi-toggle';
  description: string;
  category?: string;
  options?: any[];
  step?: number;
  min?: number;
  max?: number;
}

@Component({
  selector: 'app-rates-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './rates-tab.component.html'
})
export class RatesTabComponent {
  @Input() serverInstance: any = {};
  @Input() isLocked = false;
  @Input() ratesFields: Field[] = [];

  @Output() saveSettings = new EventEmitter<void>();
  @Output() validateField = new EventEmitter<{key: string, value: any}>();

  getFieldsByCategory(category: string): Field[] {
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