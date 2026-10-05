import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FieldDefinition } from '../../../../core/services/field-definitions.service';
import { FieldMessages, FieldMessagesComponent } from '../../../field-messages/field-messages.component';

@Component({
  selector: 'app-misc-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, FieldMessagesComponent],
  templateUrl: './misc-tab.component.html'
})
export class MiscTabComponent {
  // Fields are addressed by key from the settings metadata, so this stays loosely typed.
  @Input() serverInstance: any = {};
  @Input() isLocked = false;
  @Input() miscFields: FieldDefinition[] = [];
  @Input() fieldErrors: FieldMessages = {};
  @Input() fieldWarnings: FieldMessages = {};

  @Output() saveSettings = new EventEmitter<void>();
  @Output() validateField = new EventEmitter<{key: string, value: unknown}>();

  getFieldsByCategory(category: string): FieldDefinition[] {
    const categories: { [key: string]: string[] } = {
      'gamemode': [
        'bPvE',
        'serverPVE',
        'serverHardcore',
        'bShowCreativeMode',
        'bUseSingleplayerSettings'
      ],
      'pvp': [
        'preventOfflinePvPInterval',
        'dinoTurretDamageMultiplier',
        'preventOfflinePvP',
        'bIncreasePvPRespawnInterval',
        'bDisableFriendlyFire',
        'bPvEDisableFriendlyFire',
        'bPvEAllowTribeWar',
        'bPvEAllowTribeWarCancel',
        'allowMultipleAttachedC4',
        'allowRaidDinoFeeding',
        'passiveDefensesDamageRiderlessDinos',
        'enablePVPGamma',
        'disablePvEGamma'
      ],
      'hud': [
        'showFloatingDamageText',
        'allowThirdPersonPlayer',
        'serverForceNoHUD',
        'showMapPlayerLocation',
        'serverCrosshair',
        'allowHitMarkers',
        'bUseCorpseLocator',
        'bDisableWeatherFog'
      ],
      'chat': [
        'globalVoiceChat',
        'proximityChat'
      ],
      'creatures': [
        'maxTamedDinos',
        'maxPersonalTamedDinos',
        'bDisableDinoRiding',
        'forceAllowCaveFlyers',
        'allowFlyerCarryPvE',
        'bAllowFlyerSpeedLeveling',
        'bAllowSpeedLeveling',
        'preventMateBoost',
        'disableImprinting',
        'disableImprintDinoBuff',
        'allowAnyoneBabyImprintCuddle',
        'autoDestroyDecayedDinos'
      ],
      'engrams': [
        'itemStackSizeMultiplier',
        'customRecipeEffectivenessMultiplier',
        'customRecipeSkillMultiplier',
        'bAutoUnlockAllEngrams',
        'onlyAllowSpecifiedEngrams',
        'bAllowUnlimitedRespecs',
        'allowCustomRecipes',
        'disableCryopodFridgeRequirement',
        'disableCryopodEnemyCheck',
        'allowCryoFridgeOnSaddle'
      ],
      'admin': [
        'autoSavePeriodMinutes',
        'kickIdlePlayersPeriod',
        'maxNumberOfPlayersInTribe',
        'adminLogging',
        'bServerGameLogEnabled',
        'useOptimizedHarvestingHealth',
        'clampResourceHarvestDamage',
        'bDisableLootCrates'
      ]
    };

    const categoryKeys = categories[category] || [];
    return categoryKeys
      .map(key => this.miscFields.find(field => field.key === key))
      .filter((field): field is FieldDefinition => field !== undefined);
  }

  onSaveSettings(): void {
    this.saveSettings.emit();
  }

  onValidateField(key: string, value: unknown): void {
    this.validateField.emit({key, value});
  }
}