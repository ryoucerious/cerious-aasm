import * as fs from 'fs';
import * as path from 'path';
import { ArkPathUtils } from '../utils/ark.utils';

/**
 * Mapping entry for ARK server settings.
 * - key: property name on the config object (camelCase, must match ServerInstance model)
 * - iniKey: the exact key to write in the INI file (PascalCase ARK format)
 * - destination: which INI file to write to
 * - section: the INI section header
 */
interface SettingsMapping {
  key: string;
  iniKey: string;
  destination: string;
  section: string;
}

export class ArkConfigService {
  
  /**
   * Complete settings mapping for ARK: Survival Ascended.
   * 
   * Each entry maps a config property (camelCase) to its correct ARK INI key (PascalCase).
   * Organized by destination file and section.
   */
  private readonly asaSettingsMapping: SettingsMapping[] = [
    // =====================================================
    // GameUserSettings.ini - [ServerSettings]
    // =====================================================
    { key: "altSaveDirectoryName",                     iniKey: "AltSaveDirectoryName",                      destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "serverPassword",                           iniKey: "ServerPassword",                             destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "serverAdminPassword",                      iniKey: "ServerAdminPassword",                        destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "xpMultiplier",                             iniKey: "XPMultiplier",                               destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "overrideOfficialDifficulty",               iniKey: "OverrideOfficialDifficulty",                 destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "difficultyOffset",                         iniKey: "DifficultyOffset",                           destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "tamingSpeedMultiplier",                    iniKey: "TamingSpeedMultiplier",                      destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "harvestAmountMultiplier",                  iniKey: "HarvestAmountMultiplier",                    destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "dinoHarvestingDamageMultiplier",           iniKey: "DinoHarvestingDamageMultiplier",             destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "playerHarvestingDamageMultiplier",         iniKey: "PlayerHarvestingDamageMultiplier",           destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "resourcesRespawnPeriodMultiplier",         iniKey: "ResourcesRespawnPeriodMultiplier",           destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "cropGrowthSpeedMultiplier",                iniKey: "CropGrowthSpeedMultiplier",                  destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "cropDecaySpeedMultiplier",                 iniKey: "CropDecaySpeedMultiplier",                   destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "playerCharacterFoodDrainMultiplier",       iniKey: "PlayerCharacterFoodDrainMultiplier",         destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "playerCharacterWaterDrainMultiplier",      iniKey: "PlayerCharacterWaterDrainMultiplier",        destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "playerCharacterStaminaDrainMultiplier",    iniKey: "PlayerCharacterStaminaDrainMultiplier",      destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "playerCharacterHealthRecoveryMultiplier",  iniKey: "PlayerCharacterHealthRecoveryMultiplier",    destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "playerCharacterDamageMultiplier",          iniKey: "PlayerCharacterDamageMultiplier",            destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "playerCharacterResistanceMultiplier",      iniKey: "PlayerCharacterResistanceMultiplier",        destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "dinoCharacterFoodDrainMultiplier",         iniKey: "DinoCharacterFoodDrainMultiplier",           destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "dinoCharacterStaminaDrainMultiplier",      iniKey: "DinoCharacterStaminaDrainMultiplier",        destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "dinoCharacterHealthRecoveryMultiplier",    iniKey: "DinoCharacterHealthRecoveryMultiplier",      destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "dinoCharacterDamageMultiplier",            iniKey: "DinoCharacterDamageMultiplier",              destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "dinoCharacterResistanceMultiplier",        iniKey: "DinoCharacterResistanceMultiplier",          destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "tamedDinoCharacterFoodDrainMultiplier",    iniKey: "TamedDinoCharacterFoodDrainMultiplier",      destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "tamedDinoTorporDrainMultiplier",           iniKey: "TamedDinoTorporDrainMultiplier",             destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "dayCycleSpeedScale",                       iniKey: "DayCycleSpeedScale",                         destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "dayTimeSpeedScale",                        iniKey: "DayTimeSpeedScale",                          destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "nightTimeSpeedScale",                      iniKey: "NightTimeSpeedScale",                        destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "bDisableStructurePlacementCollision",      iniKey: "bDisableStructurePlacementCollision",        destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "structureDamageMultiplier",                iniKey: "StructureDamageMultiplier",                  destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "structureResistanceMultiplier",            iniKey: "StructureResistanceMultiplier",              destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "overrideStructurePlatformPrevention",      iniKey: "OverrideStructurePlatformPrevention",        destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "forceAllStructureLocking",                 iniKey: "ForceAllStructureLocking",                   destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "bPvE",                                     iniKey: "bPvE",                                       destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "bPvEDisableFriendlyFire",                  iniKey: "bPvEDisableFriendlyFire",                    destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "bPvEAllowTribeWar",                        iniKey: "bPvEAllowTribeWar",                          destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "bPvEAllowTribeWarCancel",                  iniKey: "bPvEAllowTribeWarCancel",                    destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "allowThirdPersonPlayer",                   iniKey: "AllowThirdPersonPlayer",                     destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "disableImprintDinoBuff",                   iniKey: "DisableImprintDinoBuff",                     destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "allowAnyoneBabyImprintCuddle",             iniKey: "AllowAnyoneBabyImprintCuddle",               destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "useOptimizedHarvestingHealth",             iniKey: "UseOptimizedHarvestingHealth",               destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "allowRaidDinoFeeding",                     iniKey: "AllowRaidDinoFeeding",                       destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "bDisableFriendlyFire",                     iniKey: "bDisableFriendlyFire",                       destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "bIncreasePvPRespawnInterval",              iniKey: "bIncreasePvPRespawnInterval",                destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "allowCustomRecipes",                       iniKey: "AllowCustomRecipes",                         destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "customRecipeEffectivenessMultiplier",      iniKey: "CustomRecipeEffectivenessMultiplier",        destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "customRecipeSkillMultiplier",              iniKey: "CustomRecipeSkillMultiplier",                destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "autoSavePeriodMinutes",                    iniKey: "AutoSavePeriodMinutes",                      destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "showMapPlayerLocation",                    iniKey: "ShowMapPlayerLocation",                      destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "noTributeDownloads",                       iniKey: "NoTributeDownloads",                         destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "proximityRadiusOverride",                  iniKey: "ProximityRadiusOverride",                    destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "proximityRadiusUnclaimed",                 iniKey: "ProximityRadiusUnclaimed",                   destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "structurePickupTimeAfterPlacement",        iniKey: "StructurePickupTimeAfterPlacement",          destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "structurePickupHoldDuration",              iniKey: "StructurePickupHoldDuration",                destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "allowIntegratedSPlusStructures",           iniKey: "AllowIntegratedSPlusStructures",             destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "allowHideDamageSourceFromLogs",            iniKey: "AllowHideDamageSourceFromLogs",              destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "raidDinoCharacterFoodDrainMultiplier",     iniKey: "RaidDinoCharacterFoodDrainMultiplier",       destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "pvePlatformStructureDamageRatio",          iniKey: "PvEPlatformStructureDamageRatio",            destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "allowCaveBuildingPvE",                     iniKey: "AllowCaveBuildingPvE",                       destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "preventOfflinePvP",                        iniKey: "PreventOfflinePvP",                          destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "preventOfflinePvPInterval",                iniKey: "PreventOfflinePvPInterval",                  destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "bShowCreativeMode",                        iniKey: "bShowCreativeMode",                          destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "bAllowUnlimitedRespecs",                   iniKey: "bAllowUnlimitedRespecs",                    destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "bAllowPlatformSaddleMultiFloors",          iniKey: "bAllowPlatformSaddleMultiFloors",            destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "bUseCorpseLocator",                        iniKey: "bUseCorpseLocator",                          destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "bUseSingleplayerSettings",                 iniKey: "bUseSingleplayerSettings",                   destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "useExclusiveList",                         iniKey: "UseExclusiveList",                            destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "serverCrosshair",                          iniKey: "ServerCrosshair",                             destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "showFloatingDamageText",                   iniKey: "ShowFloatingDamageText",                     destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "allowHitMarkers",                          iniKey: "AllowHitMarkers",                            destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "adminLogging",                             iniKey: "AdminLogging",                               destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "clampResourceHarvestDamage",               iniKey: "ClampResourceHarvestDamage",                 destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "kickIdlePlayersPeriod",                    iniKey: "KickIdlePlayersPeriod",                      destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "autoDestroyDecayedDinos",                  iniKey: "AutoDestroyDecayedDinos",                    destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "maxPersonalTamedDinos",                    iniKey: "MaxPersonalTamedDinos",                      destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "preventJoinEvents",                        iniKey: "PreventJoinEvents",                          destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "preventLeaveEvents",                       iniKey: "PreventLeaveEvents",                         destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "autoDestroyOldStructuresMultiplier",       iniKey: "AutoDestroyOldStructuresMultiplier",         destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "bDisableStructureDecayPvE",                iniKey: "bDisableStructureDecayPvE",                  destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "bDisableLootCrates",                       iniKey: "bDisableLootCrates",                         destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "bDisableWeatherFog",                       iniKey: "bDisableWeatherFog",                         destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "bEnableExtraStructurePreventionVolumes",   iniKey: "bEnableExtraStructurePreventionVolumes",     destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "bAllowPlatformSaddleStacking",             iniKey: "bAllowPlatformSaddleStacking",               destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "supplyCrateLootQualityMultiplier",         iniKey: "SupplyCrateLootQualityMultiplier",           destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "fishingLootQualityMultiplier",             iniKey: "FishingLootQualityMultiplier",               destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "dinoCountMultiplier",                      iniKey: "DinoCountMultiplier",                        destination: "GameUserSettings.ini", section: "[ServerSettings]" },

    // =====================================================
    // GameUserSettings.ini - [SessionSettings]
    // =====================================================
    { key: "sessionName",                              iniKey: "SessionName",                                destination: "GameUserSettings.ini", section: "[SessionSettings]" },

    // =====================================================
    // Game.ini - [/script/engine.gamesession]
    // =====================================================
    { key: "maxPlayers",                               iniKey: "MaxPlayers",                                 destination: "Game.ini", section: "[/script/engine.gamesession]" },

    // =====================================================
    // Game.ini - [/script/shootergame.shootergamemode]
    // =====================================================
    { key: "bDisableGenesis",                          iniKey: "bDisableGenesis",                            destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "bAutoUnlockAllEngrams",                    iniKey: "bAutoUnlockAllEngrams",                     destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "globalVoiceChat",                          iniKey: "GlobalVoiceChat",                            destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "proximityChat",                            iniKey: "ProximityChat",                              destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "serverPVE",                                iniKey: "ServerPVE",                                  destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "serverHardcore",                           iniKey: "ServerHardcore",                             destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "serverForceNoHUD",                         iniKey: "ServerForceNoHUD",                           destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "mapPlayerLocation",                        iniKey: "MapPlayerLocation",                          destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "enablePVPGamma",                           iniKey: "EnablePVPGamma",                             destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "disablePvEGamma",                          iniKey: "DisablePvEGamma",                            destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "allowFlyerCarryPvE",                       iniKey: "AllowFlyerCarryPvE",                         destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "bPassiveDefensesDamageRiderlessDinos",     iniKey: "bPassiveDefensesDamageRiderlessDinos",       destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "maxTamedDinos",                            iniKey: "MaxTamedDinos",                              destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "overrideMaxExperiencePointsPlayer",        iniKey: "OverrideMaxExperiencePointsPlayer",         destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "overrideMaxExperiencePointsDino",          iniKey: "OverrideMaxExperiencePointsDino",            destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "maxNumberOfPlayersInTribe",                iniKey: "MaxNumberOfPlayersInTribe",                  destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "preventDownloadSurvivors",                 iniKey: "PreventDownloadSurvivors",                   destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "preventDownloadItems",                     iniKey: "PreventDownloadItems",                       destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "preventDownloadDinos",                     iniKey: "PreventDownloadDinos",                       destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "preventUploadSurvivors",                   iniKey: "PreventUploadSurvivors",                     destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "preventUploadItems",                       iniKey: "PreventUploadItems",                         destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "preventUploadDinos",                       iniKey: "PreventUploadDinos",                         destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "crossArkAllowForeignDinoDownloads",        iniKey: "CrossArkAllowForeignDinoDownloads",          destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "disableImprinting",                        iniKey: "DisableImprinting",                          destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "allowAnyoneBabyImprintCuddle",             iniKey: "AllowAnyoneBabyImprintCuddle",               destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "babyImprintingStatScaleMultiplier",        iniKey: "BabyImprintingStatScaleMultiplier",          destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "babyImprintAmountMultiplier",              iniKey: "BabyImprintAmountMultiplier",                destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "babyCuddleIntervalMultiplier",             iniKey: "BabyCuddleIntervalMultiplier",               destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "babyCuddleGracePeriodMultiplier",          iniKey: "BabyCuddleGracePeriodMultiplier",            destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "babyCuddleLoseImprintQualitySpeedMultiplier", iniKey: "BabyCuddleLoseImprintQualitySpeedMultiplier", destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "babyFoodConsumptionSpeedMultiplier",       iniKey: "BabyFoodConsumptionSpeedMultiplier",         destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "dinoTurretDamageMultiplier",               iniKey: "DinoTurretDamageMultiplier",                 destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "preventMateBoost",                         iniKey: "bPreventMateBoost",                          destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "enableExtraStructurePreventionVolumes",    iniKey: "bEnableExtraStructurePreventionVolumes",     destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "eggHatchSpeedMultiplier",                  iniKey: "EggHatchSpeedMultiplier",                    destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "babyMatureSpeedMultiplier",                iniKey: "BabyMatureSpeedMultiplier",                  destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "matingIntervalMultiplier",                 iniKey: "MatingIntervalMultiplier",                   destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "matingSpeedMultiplier",                    iniKey: "MatingSpeedMultiplier",                      destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "babyMaxIntervalMultiplier",                iniKey: "BabyMaxIntervalMultiplier",                  destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "layEggIntervalMultiplier",                 iniKey: "LayEggIntervalMultiplier",                   destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "globalSpoilingTimeMultiplier",             iniKey: "GlobalSpoilingTimeMultiplier",               destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "globalItemDecompositionTimeMultiplier",    iniKey: "GlobalItemDecompositionTimeMultiplier",      destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "globalCorpseDecompositionTimeMultiplier",  iniKey: "GlobalCorpseDecompositionTimeMultiplier",    destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "fuelConsumptionIntervalMultiplier",        iniKey: "FuelConsumptionIntervalMultiplier",          destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "bAllowFlyerSpeedLeveling",                 iniKey: "bAllowFlyerSpeedLeveling",                   destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "bAllowSpeedLeveling",                      iniKey: "bAllowSpeedLeveling",                        destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "forceAllowCaveFlyers",                     iniKey: "bForceAllowCaveFlyers",                      destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "bDisableDinoRiding",                       iniKey: "bDisableDinoRiding",                         destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "onlyAllowSpecifiedEngrams",                iniKey: "bOnlyAllowSpecifiedEngrams",                 destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "passiveTameIntervalMultiplier",            iniKey: "PassiveTameIntervalMultiplier",              destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "oviraptorEggConsumptionMultiplier",        iniKey: "OviraptorEggConsumptionMultiplier",          destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "maxDifficulty",                            iniKey: "MaxDifficulty",                              destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "bUseDinoLevelToCreateCharacter",           iniKey: "bUseDinoLevelToCreateCharacter",             destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "supplyCrateLootQualityMultiplier",         iniKey: "SupplyCrateLootQualityMultiplier",           destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "fishingLootQualityMultiplier",             iniKey: "FishingLootQualityMultiplier",               destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
  ];

  /**
   * Per-level stat multiplier arrays to write to Game.ini.
   * Maps config property to the ARK INI key prefix.
   */
  private readonly statMultiplierMapping: { key: string; iniKeyPrefix: string }[] = [
    { key: "perLevelStatsMultiplier_Player",              iniKeyPrefix: "PerLevelStatsMultiplier_Player" },
    { key: "perLevelStatsMultiplier_DinoTamed",           iniKeyPrefix: "PerLevelStatsMultiplier_DinoTamed" },
    { key: "perLevelStatsMultiplier_DinoWild",            iniKeyPrefix: "PerLevelStatsMultiplier_DinoWild" },
    { key: "perLevelStatsMultiplier_DinoTamed_Add",       iniKeyPrefix: "PerLevelStatsMultiplier_DinoTamed_Add" },
    { key: "perLevelStatsMultiplier_DinoTamed_Affinity",  iniKeyPrefix: "PerLevelStatsMultiplier_DinoTamed_Affinity" },
    { key: "perLevelStatsMultiplier_DinoTamed_Torpidity",     iniKeyPrefix: "PerLevelStatsMultiplier_DinoTamed_Torpidity" },
    { key: "perLevelStatsMultiplier_DinoTamed_Clamp",     iniKeyPrefix: "PerLevelStatsMultiplier_DinoTamed_Clamp" },
  ];

  /**
   * Write ARK configuration files (moved from ark-ini-utils.ts)
   * 
   * Generates GameUserSettings.ini and Game.ini based on provided config object
   * and writes them to the appropriate ARK server config directory.
   * Also copies them to the main ARK config directory for use by the server.
   * 
   * @param instanceDir - The directory of the server instance where config files will be generated.
   * @param config - The configuration object containing settings to be written.
   */
  writeArkConfigFiles(instanceDir: string, config: any): void {
    try {
      // Create Windows Server config directory if it doesn't exist
      const configDir = path.join(instanceDir, 'Config', 'WindowsServer');
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      // Generate INI files based on mapping
      const iniFiles: { [key: string]: { [section: string]: string[] } } = {};

      this.asaSettingsMapping.forEach(mapping => {
        const configValue = config[mapping.key];
        if (configValue !== undefined && configValue !== null && configValue !== '') {
          if (!iniFiles[mapping.destination]) {
            iniFiles[mapping.destination] = {};
          }
          if (!iniFiles[mapping.destination][mapping.section]) {
            iniFiles[mapping.destination][mapping.section] = [];
          }

          // Use the dedicated iniKey for the ARK INI key name
          iniFiles[mapping.destination][mapping.section].push(`${mapping.iniKey}=${configValue}`);
        }
      });

      // Write stat multiplier arrays to Game.ini [/script/shootergame.shootergamemode]
      const gameIniSection = '[/script/shootergame.shootergamemode]';
      this.statMultiplierMapping.forEach(statMapping => {
        const statArray = config[statMapping.key];
        if (Array.isArray(statArray) && statArray.length === 12) {
          if (!iniFiles['Game.ini']) {
            iniFiles['Game.ini'] = {};
          }
          if (!iniFiles['Game.ini'][gameIniSection]) {
            iniFiles['Game.ini'][gameIniSection] = [];
          }
          // Only write non-default values (not 1.0) to keep INI clean
          for (let i = 0; i < statArray.length; i++) {
            const val = statArray[i];
            if (val !== undefined && val !== null && val !== 1.0) {
              iniFiles['Game.ini'][gameIniSection].push(`${statMapping.iniKeyPrefix}[${i}]=${val}`);
            }
          }
        }
      });

      // Add mod settings to GameUserSettings.ini
      if (config.modSettings) {
        Object.keys(config.modSettings).forEach(modId => {
          const modSettings = config.modSettings[modId];
          if (modSettings && Object.keys(modSettings).length > 0) {
            // Create section name for the mod
            const sectionName = `[Mod_${modId}]`;
            
            if (!iniFiles['GameUserSettings.ini']) {
              iniFiles['GameUserSettings.ini'] = {};
            }
            if (!iniFiles['GameUserSettings.ini'][sectionName]) {
              iniFiles['GameUserSettings.ini'][sectionName] = [];
            }

            // Add each mod setting
            Object.keys(modSettings).forEach(settingKey => {
              // Skip internal keys like _name
              if (settingKey.startsWith('_')) {
                return;
              }
              const settingValue = modSettings[settingKey];
              if (settingValue !== undefined && settingValue !== null && settingValue !== '') {
                iniFiles['GameUserSettings.ini'][sectionName].push(`${settingKey}=${settingValue}`);
              }
            });
          }
        });
      }

      // Write each INI file
      Object.keys(iniFiles).forEach(filename => {
        const filePath = path.join(configDir, filename);
        let content = '';

        Object.keys(iniFiles[filename]).forEach(section => {
          content += `${section}\n`;
          iniFiles[filename][section].forEach(line => {
            content += `${line}\n`;
          });
          content += '\n';
        });

        fs.writeFileSync(filePath, content, 'utf8');
      });

      // Copy config files to main ARK config directory
      const mainConfigDir = this.getArkConfigDir();
      if (!fs.existsSync(mainConfigDir)) {
        fs.mkdirSync(mainConfigDir, { recursive: true });
      }
      const configFiles = ['GameUserSettings.ini', 'Game.ini'];
      for (const file of configFiles) {
        const src = path.join(configDir, file);
        const dest = path.join(mainConfigDir, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
        }
      }
    } catch (error) {
      console.error('[ark-config-service] Error writing ARK config files:', error);
      throw error;
    }
  }

  /**
   * Get ARK launch parameters (moved from ark-ini-utils.ts)
   * @param config - Configuration object
   * @returns Array of launch parameters
   */
  getArkLaunchParameters(config: any): string[] {
    // Extract launch parameters from config
    return config.launchParameters ? config.launchParameters.split(' ').filter((param: string) => param.trim() !== '') : [];
  }

  /**
   * Get ARK map name (moved from ark-ini-utils.ts)
   * @param config - Configuration object
   * @returns ARK map name
   */
  getArkMapName(config: any): string {
    return config.mapName || 'TheIsland_WP';
  }

  /**
   * Convert camelCase config key to ARK INI format
   * @param key - Configuration key in camelCase
   * @returns ARK INI format key
   */
  private convertToArkKey(key: string): string {
    // Convert camelCase to PascalCase for ARK settings
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  /**
   * Get the main ARK config directory
   * @returns Path to the main ARK configuration directory
   * 
   * Note: Always uses WindowsServer since we're running Windows binaries via Proton on Linux
   */
  private getArkConfigDir(): string {
    const arkServerDir = ArkPathUtils.getArkServerDir();
    // Always use WindowsServer since we're running Windows binaries via Proton on Linux
    return path.join(arkServerDir, 'ShooterGame', 'Saved', 'Config', 'WindowsServer');
  }
}

// Export singleton instance
export const arkConfigService = new ArkConfigService();
