import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { take } from 'rxjs';
import { ModalComponent } from '../../modal/modal.component';
import { NotificationService } from '../../../core/services/notification.service';
import { ServerInstanceService } from '../../../core/services/server-instance.service';
import { ServerInstance, ServerInstanceDraft } from '../../../core/models/server-instance.model';
import { mapDisplayName } from '../../../core/utils/map-visuals';

interface ConfigCategory {
  key: string;
  label: string;
  icon: string;
}

const CONFIG_CATEGORY_GROUPS: { label: string; categories: ConfigCategory[] }[] = [
  {
    label: 'Game Settings',
    categories: [
      { key: 'general', label: 'General', icon: 'tune' },
      { key: 'rates', label: 'Rates', icon: 'speed' },
      { key: 'structures', label: 'Structures', icon: 'home' },
      { key: 'stats', label: 'Stat Multipliers', icon: 'bar_chart' },
      { key: 'misc', label: 'Miscellaneous', icon: 'settings' },
    ]
  },
  {
    label: 'Server Configuration',
    categories: [
      { key: 'mods', label: 'Mods', icon: 'extension' },
      { key: 'cluster', label: 'Cluster', icon: 'group_work' },
      { key: 'customIni', label: 'Custom INI', icon: 'code' },
    ]
  },
  {
    label: 'Features & Integrations',
    categories: [
      { key: 'automation', label: 'Automation', icon: 'schedule' },
      { key: 'discord', label: 'Discord', icon: 'chat' },
      { key: 'broadcasts', label: 'Broadcasts', icon: 'campaign' },
      { key: 'whitelist', label: 'Whitelist', icon: 'people' },
    ]
  }
];

const CATEGORY_KEYS: Record<string, string[]> = {
  general: ['sessionName', 'mapName', 'maxPlayers', 'serverPassword', 'serverAdminPassword', 'crossplay', 'launchParameters'],
  rates: [
    'xpMultiplier', 'tamingSpeedMultiplier', 'harvestAmountMultiplier',
    'dinoCharacterFoodDrainMultiplier', 'dinoCharacterStaminaDrainMultiplier', 'dinoCharacterHealthRecoveryMultiplier',
    'dinoCountMultiplier', 'playerCharacterFoodDrainMultiplier', 'playerCharacterStaminaDrainMultiplier',
    'playerCharacterHealthRecoveryMultiplier', 'playerCharacterWaterDrainMultiplier',
    'playerCharacterDamageMultiplier', 'playerCharacterResistanceMultiplier',
    'dinoCharacterDamageMultiplier', 'dinoCharacterResistanceMultiplier',
    'difficultyOffset', 'overrideOfficialDifficulty', 'maxDifficulty',
    'dayCycleSpeedScale', 'dayTimeSpeedScale', 'nightTimeSpeedScale',
    'dinoHarvestingDamageMultiplier', 'playerHarvestingDamageMultiplier',
    'resourcesRespawnPeriodMultiplier', 'globalSpoilingTimeMultiplier',
    'globalItemDecompositionTimeMultiplier', 'globalCorpseDecompositionTimeMultiplier',
    'cropGrowthSpeedMultiplier', 'cropDecaySpeedMultiplier',
    'matingIntervalMultiplier', 'matingSpeedMultiplier', 'eggHatchSpeedMultiplier',
    'babyMatureSpeedMultiplier', 'babyFoodConsumptionSpeedMultiplier', 'babyCuddleIntervalMultiplier',
    'babyImprintingStatScaleMultiplier', 'babyCuddleGracePeriodMultiplier',
    'babyCuddleLoseImprintQualitySpeedMultiplier', 'babyImprintAmountMultiplier', 'babyMaxIntervalMultiplier',
    'supplyCrateLootQualityMultiplier', 'fishingLootQualityMultiplier',
    'layEggIntervalMultiplier', 'fuelConsumptionIntervalMultiplier',
    'raidDinoCharacterFoodDrainMultiplier', 'passiveTameIntervalMultiplier',
    'tamedDinoCharacterFoodDrainMultiplier', 'tamedDinoTorporDrainMultiplier',
    'wildDinoCharacterFoodDrainMultiplier', 'wildDinoTorporDrainMultiplier',
    'oviraptorEggConsumptionMultiplier', 'useCorpseLifeSpanMultiplier',
    'overrideMaxExperiencePointsPlayer', 'overrideMaxExperiencePointsDino',
  ],
  structures: [
    'structureResistanceMultiplier', 'structureDamageMultiplier',
    'perPlatformMaxStructuresMultiplier', 'platformSaddleBuildAreaBoundsMultiplier',
    'maxPlatformSaddleStructureLimit', 'maxGateFrameOnSaddles',
    'structurePreventResourceRadiusMultiplier', 'structurePickupTimeAfterPlacement',
    'structurePickupHoldDuration', 'allowIntegratedSPlusStructures',
    'bAllowPlatformSaddleStacking', 'bAllowPlatformSaddleMultiFloors',
    'allowCaveBuildingPvE', 'autoDestroyOldStructuresMultiplier',
    'maxStructuresInRange', 'pvePlatformStructureDamageRatio',
    'enableExtraStructurePreventionVolumes', 'bEnableExtraStructurePreventionVolumes',
    'pvpStructureDecay', 'disableStructureDecayPvE', 'bDisableStructureDecayPvE',
    'pveStructureDecayPeriodMultiplier', 'pveStructureDecayDelay',
    'bDisableStructurePlacementCollision', 'allowCrateSpawnsOnTopOfStructures',
    'overrideStructurePlatformPrevention', 'forceAllStructureLocking',
  ],
  stats: [
    'perLevelStatsMultiplier_Player', 'perLevelStatsMultiplier_DinoTamed',
    'perLevelStatsMultiplier_DinoWild', 'perLevelStatsMultiplier_DinoTamed_Add',
    'perLevelStatsMultiplier_DinoTamed_Affinity', 'perLevelStatsMultiplier_DinoTamed_Torpidity',
    'perLevelStatsMultiplier_DinoTamed_Clamp',
  ],
  misc: [
    'bPvE', 'serverPVE', 'allowThirdPersonPlayer', 'allowThirdPerson',
    'showMapPlayerLocation', 'serverCrosshair', 'serverForceNoHUD',
    'showFloatingDamageText', 'bAutoUnlockAllEngrams', 'bAllowUnlimitedRespecs',
    'serverHardcore', 'globalVoiceChat', 'proximityChat',
    'adminLogging', 'allowHitMarkers', 'enablePVPGamma', 'disablePvEGamma',
    'allowFlyerCarryPvE', 'forceAllowCaveFlyers',
    'bDisableDinoRiding', 'bAllowFlyerSpeedLeveling', 'bAllowSpeedLeveling',
    'alwaysNotifyPlayerLeft', 'alwaysNotifyPlayerJoined',
    'noTributeDownloads', 'preventDownloadDinos', 'preventDownloadItems', 'preventDownloadSurvivors',
    'preventUploadDinos', 'preventUploadItems', 'preventUploadSurvivors',
    'crossArkAllowForeignDinoDownloads',
    'allowAnyoneBabyImprintCuddle', 'disableImprintDinoBuff', 'disableImprinting',
    'allowRaidDinoFeeding', 'onlyAllowSpecifiedEngrams',
    'preventOfflinePvP', 'preventOfflinePvPInterval',
    'maxTamedDinos', 'maxPersonalTamedDinos', 'personalTamedDinosSaddleStructureCost',
    'useOptimizedHarvestingHealth', 'allowMultipleAttachedC4',
    'enableCryoSicknessPVE', 'itemStackSizeMultiplier',
    'disableCryopodFridgeRequirement', 'disableCryopodEnemyCheck', 'allowCryoFridgeOnSaddle',
    'maxNumberOfPlayersInTribe', 'kickIdlePlayersPeriod', 'autoSavePeriodMinutes',
    'allowCustomRecipes', 'customRecipeEffectivenessMultiplier', 'customRecipeSkillMultiplier',
    'dinoTurretDamageMultiplier', 'clampResourceHarvestDamage',
    'autoDestroyDecayedDinos', 'preventMateBoost',
    'passiveDefensesDamageRiderlessDinos', 'tribeNameChangeCooldown',
    'bDisableFriendlyFire', 'bDisableLootCrates', 'bDisableWeatherFog',
    'bIncreasePvPRespawnInterval', 'bPvEDisableFriendlyFire',
    'bPvEAllowTribeWar', 'bPvEAllowTribeWarCancel',
    'bServerGameLogEnabled', 'bShowCreativeMode', 'bUseCorpseLocator', 'bUseSingleplayerSettings',
  ],
  cluster: [
    'clusterRef', 'clusterId', 'clusterName', 'clusterOrder', 'clusterRole',
    'clusterDirOverride', 'noTransferFromFiltering',
  ],
  mods: ['mods', 'enabledMods', 'modSettings'],
  automation: [
    'autoStartOnAppLaunch', 'crashDetectionEnabled', 'crashDetectionInterval',
    'maxRestartAttempts', 'scheduledRestartEnabled', 'restartFrequency',
    'restartTime', 'restartTimes', 'restartDays', 'restartWarningMinutes',
  ],
  whitelist: [
    'useExclusiveList', 'exclusiveJoinPlayerIds', 'exclusiveJoinPlayers', 'whitelistKickMessage',
  ],
  discord: ['discordConfig'],
  broadcasts: ['broadcastConfig'],
  customIni: ['customGameIni', 'customGameUserSettingsIni'],
};

function modIds(source: ServerInstance): string[] {
  return Array.isArray(source.mods) ? source.mods : [];
}

/**
 * The mod settings are copied as one set, even where the source lacks one of them: keeping the
 * target's own would pair the source's mods with the target's enabled list and names. No list
 * means no mods; no enabled list means all of them, as in older configs.
 */
const MOD_VALUES: Record<string, (source: ServerInstance) => unknown> = {
  mods: modIds,
  enabledMods: source => Array.isArray(source.enabledMods) ? source.enabledMods : modIds(source),
  modSettings: source => source.modSettings && typeof source.modSettings === 'object' && !Array.isArray(source.modSettings)
    ? source.modSettings
    : {}
};

@Component({
  selector: 'app-copy-config-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ModalComponent],
  templateUrl: './copy-config-dialog.component.html'
})
export class CopyConfigDialogComponent implements OnChanges {
  @Input() show = false;
  /** The page's copy of the server; the chosen settings are written into it. */
  @Input() target: ServerInstanceDraft | null = null;
  @Output() close = new EventEmitter<void>();
  /** Settings were copied into `target`; the host saves them. */
  @Output() applied = new EventEmitter<void>();

  readonly categoryGroups = CONFIG_CATEGORY_GROUPS;
  readonly categories = CONFIG_CATEGORY_GROUPS.flatMap(group => group.categories);

  servers: ServerInstance[] = [];
  source: ServerInstance | null = null;
  sourceDropdownOpen = false;
  selected: Record<string, boolean> = {};

  constructor(
    private serverInstanceService: ServerInstanceService,
    private notificationService: NotificationService
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['show']?.currentValue) this.reset();
  }

  get hasAnyCategorySelected(): boolean {
    return Object.values(this.selected).some(Boolean);
  }

  get sourceDisplayName(): string {
    return this.source ? this.serverLabel(this.source) : '';
  }

  serverLabel(server: ServerInstance): string {
    return `${server.sessionName || server.name || 'Unnamed'} (${mapDisplayName(server.mapName)})`;
  }

  toggleSourceDropdown(): void {
    this.sourceDropdownOpen = !this.sourceDropdownOpen;
  }

  selectSource(server: ServerInstance): void {
    this.source = server;
    this.sourceDropdownOpen = false;
  }

  selectAll(checked: boolean): void {
    this.categories.forEach(category => this.selected[category.key] = checked);
  }

  apply(): void {
    const source = this.source;
    const target = this.target as Record<string, unknown> | null;
    if (!source || !target) return;

    const chosen = this.categories.filter(category => this.selected[category.key]);
    const keys = chosen.flatMap(category => CATEGORY_KEYS[category.key] ?? []);
    if (keys.length === 0) {
      this.notificationService.warning('Please select at least one category to copy.', 'No Categories Selected');
      return;
    }

    const values = source as unknown as Record<string, unknown>;
    let copied = 0;
    for (const key of keys) {
      const readModValue = MOD_VALUES[key];
      const value = readModValue ? readModValue(source) : values[key];
      if (value === undefined) continue;
      target[key] = structuredClone(value);
      copied++;
    }

    this.applied.emit();
    this.notificationService.success(
      `Copied ${copied} settings from "${source.sessionName || source.name}" (${chosen.map(category => category.label).join(', ')})`,
      'Config Copied'
    );
  }

  private reset(): void {
    this.source = null;
    this.sourceDropdownOpen = false;
    this.selectAll(false);
    this.serverInstanceService.getInstances().pipe(take(1)).subscribe(servers => {
      this.servers = (servers || []).filter(server => server.id !== this.target?.id);
    });
  }
}
