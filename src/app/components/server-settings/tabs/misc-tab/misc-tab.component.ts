import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-misc-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './misc-tab.component.html'
})
export class MiscTabComponent {
  @Input() serverInstance: any = {};
  @Input() isLocked = false;
  @Input() miscFields: any[] = [];

  @Output() saveSettings = new EventEmitter<void>();
  @Output() validateField = new EventEmitter<{key: string, value: any}>();

  getFieldsByCategory(category: string): any[] {
    const categories: { [key: string]: string[] } = {
      'gamemode': [
        'bPvE',
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
        'allowCustomRecipes'
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
      .filter((field): field is any => field !== undefined);
  }

  hasFieldError(key: string): boolean {
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