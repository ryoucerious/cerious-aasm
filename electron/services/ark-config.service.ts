import * as fs from 'fs';
import * as path from 'path';
import { getArkServerDir, getInstanceConfigDir, isInstanceIsolated } from '../utils/ark/ark-server/ark-server-paths.utils';
import { getInstanceDir } from '../utils/ark/instance.utils';
import { validateInstanceId } from '../utils/validation.utils';
import type { InstanceConfig } from '../types/server-instance.types';

export type IniFileName = 'GameUserSettings.ini' | 'Game.ini';
export type IniFiles = Record<IniFileName, string>;

/** Lines of an existing INI file that the app does not manage, by lowercased section header. */
export type PreservedSections = Map<string, { header: string; lines: string[] }>;

export interface ParsedIniSettings {
  config: Record<string, unknown>;
  /** `section: key` for each line no mapping covers. */
  unmapped: string[];
}

interface SettingsMapping {
  /** Property on the instance config. */
  key: string;
  /** The key as ARK spells it. */
  iniKey: string;
  destination: IniFileName;
  section: string;
}

type IniSections = Map<string, string[]>;

/** The config directory ARK reads, and whether it is the instance's own rather than the shared install's. */
interface RuntimeConfigDir {
  dir: string;
  own: boolean;
}

const INI_FILES: IniFileName[] = ['GameUserSettings.ini', 'Game.ini'];
const SERVER_SETTINGS = '[ServerSettings]';
const GAME_MODE = '[/script/shootergame.shootergamemode]';
const STAT_COUNT = 12;
// Mod ids end up in section headers ([Mod_<id>]); ARK and CurseForge ids are plain tokens.
const MOD_ID = /^[A-Za-z0-9_.-]+$/;

const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;

// A line break in a value would start a new key or section in the file ARK reads, and UE stops
// reading a line at a NUL.
function iniValue(value: unknown): string {
  return String(value).replace(CONTROL_CHARS, '');
}

// Mod setting keys are typed by users: each must stay one key on one line.
function isUsableIniKey(key: string): boolean {
  return key.trim() !== '' && !/[\x00-\x1f\x7f=]/.test(key) && !/^\s*[\[;#]/.test(key);
}

// ARK ends a line at a lone CR as well.
const LINE_BREAK = /\r\n|\r|\n/;

function isTrue(value: unknown): boolean {
  return value === true || value === 'true';
}

function coerceIniValue(value: string): string | number | boolean {
  const lower = value.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  const number = Number(value);
  return value !== '' && !isNaN(number) ? number : value;
}

function renderIni(managed: IniSections, preserved: PreservedSections = new Map()): string {
  let content = '';
  const append = (header: string, lines: string[]) => {
    content += [header, ...lines].join('\n') + '\n\n';
  };
  for (const [header, lines] of managed) {
    append(header, [...lines, ...(preserved.get(header.toLowerCase())?.lines ?? [])]);
  }
  const managedHeaders = new Set([...managed.keys()].map(header => header.toLowerCase()));
  for (const [section, { header, lines }] of preserved) {
    if (!managedHeaders.has(section) && lines.length > 0) append(header, lines);
  }
  return content;
}

export class ArkConfigService {
  /**
   * ARK only reads a key from the file and section it belongs to and ignores it anywhere else:
   * [ServerSettings] keys go in GameUserSettings.ini, ShooterGameMode properties (breeding, crops,
   * spoiling, custom recipes, the b* PvE flags) in Game.ini. See ark.wiki.gg/wiki/Server_configuration.
   */
  private readonly asaSettingsMapping: SettingsMapping[] = [
    { key: "altSaveDirectoryName",                     iniKey: "AltSaveDirectoryName",                      destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "serverPassword",                           iniKey: "ServerPassword",                             destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "serverAdminPassword",                      iniKey: "ServerAdminPassword",                        destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "rconPort",                                 iniKey: "RCONPort",                                   destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "xpMultiplier",                             iniKey: "XPMultiplier",                               destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "overrideOfficialDifficulty",               iniKey: "OverrideOfficialDifficulty",                 destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "difficultyOffset",                         iniKey: "DifficultyOffset",                           destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "tamingSpeedMultiplier",                    iniKey: "TamingSpeedMultiplier",                      destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "harvestAmountMultiplier",                  iniKey: "HarvestAmountMultiplier",                    destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "dinoHarvestingDamageMultiplier",           iniKey: "DinoHarvestingDamageMultiplier",             destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "playerHarvestingDamageMultiplier",         iniKey: "PlayerHarvestingDamageMultiplier",           destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "resourcesRespawnPeriodMultiplier",         iniKey: "ResourcesRespawnPeriodMultiplier",           destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "cropGrowthSpeedMultiplier",                iniKey: "CropGrowthSpeedMultiplier",                  destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "cropDecaySpeedMultiplier",                 iniKey: "CropDecaySpeedMultiplier",                   destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "playerCharacterFoodDrainMultiplier",       iniKey: "PlayerCharacterFoodDrainMultiplier",         destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "playerCharacterWaterDrainMultiplier",      iniKey: "PlayerCharacterWaterDrainMultiplier",        destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "playerCharacterStaminaDrainMultiplier",    iniKey: "PlayerCharacterStaminaDrainMultiplier",      destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "playerCharacterHealthRecoveryMultiplier",  iniKey: "PlayerCharacterHealthRecoveryMultiplier",    destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "playerCharacterDamageMultiplier",          iniKey: "PlayerDamageMultiplier",            destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "playerCharacterResistanceMultiplier",      iniKey: "PlayerResistanceMultiplier",        destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "dinoCharacterFoodDrainMultiplier",         iniKey: "DinoCharacterFoodDrainMultiplier",           destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "dinoCharacterStaminaDrainMultiplier",      iniKey: "DinoCharacterStaminaDrainMultiplier",        destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "dinoCharacterHealthRecoveryMultiplier",    iniKey: "DinoCharacterHealthRecoveryMultiplier",      destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "dinoCharacterDamageMultiplier",            iniKey: "DinoDamageMultiplier",              destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "dinoCharacterResistanceMultiplier",        iniKey: "DinoResistanceMultiplier",          destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "tamedDinoCharacterFoodDrainMultiplier",    iniKey: "TamedDinoCharacterFoodDrainMultiplier",      destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "tamedDinoTorporDrainMultiplier",           iniKey: "TamedDinoTorporDrainMultiplier",             destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "dayCycleSpeedScale",                       iniKey: "DayCycleSpeedScale",                         destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "dayTimeSpeedScale",                        iniKey: "DayTimeSpeedScale",                          destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "nightTimeSpeedScale",                      iniKey: "NightTimeSpeedScale",                        destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "structureDamageMultiplier",                iniKey: "StructureDamageMultiplier",                  destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "structureResistanceMultiplier",            iniKey: "StructureResistanceMultiplier",              destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "overrideStructurePlatformPrevention",      iniKey: "OverrideStructurePlatformPrevention",        destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "forceAllStructureLocking",                 iniKey: "ForceAllStructureLocking",                   destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "bPvEDisableFriendlyFire",                  iniKey: "bPvEDisableFriendlyFire",                    destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "bPvEAllowTribeWar",                        iniKey: "bPvEAllowTribeWar",                          destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "bPvEAllowTribeWarCancel",                  iniKey: "bPvEAllowTribeWarCancel",                    destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "allowThirdPersonPlayer",                   iniKey: "AllowThirdPersonPlayer",                     destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "disableImprintDinoBuff",                   iniKey: "DisableImprintDinoBuff",                     destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "allowAnyoneBabyImprintCuddle",             iniKey: "AllowAnyoneBabyImprintCuddle",               destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "useOptimizedHarvestingHealth",             iniKey: "UseOptimizedHarvestingHealth",               destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "allowRaidDinoFeeding",                     iniKey: "AllowRaidDinoFeeding",                       destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "bDisableFriendlyFire",                     iniKey: "bDisableFriendlyFire",                       destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "bIncreasePvPRespawnInterval",              iniKey: "bIncreasePvPRespawnInterval",                destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "allowCustomRecipes",                       iniKey: "bAllowCustomRecipes",                         destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "customRecipeEffectivenessMultiplier",      iniKey: "CustomRecipeEffectivenessMultiplier",        destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "customRecipeSkillMultiplier",              iniKey: "CustomRecipeSkillMultiplier",                destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
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
    { key: "bShowCreativeMode",                        iniKey: "bShowCreativeMode",                          destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "bAllowUnlimitedRespecs",                   iniKey: "bAllowUnlimitedRespecs",                    destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "bAllowPlatformSaddleMultiFloors",          iniKey: "bAllowPlatformSaddleMultiFloors",            destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "bUseCorpseLocator",                        iniKey: "bUseCorpseLocator",                          destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "bUseSingleplayerSettings",                 iniKey: "bUseSingleplayerSettings",                   destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
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
    { key: "bDisableStructureDecayPvE",                iniKey: "DisableStructureDecayPvE",                  destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "pveStructureDecayPeriodMultiplier",        iniKey: "PvEStructureDecayPeriodMultiplier",          destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "pveStructureDecayDelay",                   iniKey: "PvEStructureDecayDelay",                     destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "bDisableLootCrates",                       iniKey: "bDisableLootCrates",                         destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "bDisableWeatherFog",                       iniKey: "DisableWeatherFog",                         destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "bEnableExtraStructurePreventionVolumes",   iniKey: "EnableExtraStructurePreventionVolumes",     destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "bAllowPlatformSaddleStacking",             iniKey: "bAllowPlatformSaddleStacking",               destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "dinoCountMultiplier",                      iniKey: "DinoCountMultiplier",                        destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "perPlatformMaxStructuresMultiplier",       iniKey: "PerPlatformMaxStructuresMultiplier",         destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "platformSaddleBuildAreaBoundsMultiplier",   iniKey: "PlatformSaddleBuildAreaBoundsMultiplier",    destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "maxPlatformSaddleStructureLimit",          iniKey: "MaxPlatformSaddleStructureLimit",            destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "maxGateFrameOnSaddles",                    iniKey: "MaxGateFrameOnSaddles",                      destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "structurePreventResourceRadiusMultiplier",  iniKey: "StructurePreventResourceRadiusMultiplier",   destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "itemStackSizeMultiplier",                  iniKey: "ItemStackSizeMultiplier",                    destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "maxStructuresInRange",                     iniKey: "TheMaxStructuresInRange",                       destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "disableCryopodFridgeRequirement",          iniKey: "DisableCryopodFridgeRequirement",            destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "disableCryopodEnemyCheck",                 iniKey: "DisableCryopodEnemyCheck",                   destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "allowCryoFridgeOnSaddle",                  iniKey: "AllowCryoFridgeOnSaddle",                    destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "sessionName",                              iniKey: "SessionName",                                destination: "GameUserSettings.ini", section: "[SessionSettings]" },
    // MaxPlayers is left out: ARK:SA ignores it in the INI and takes its cap from -WinLiveMaxPlayers.

    // A ShooterGameMode setting: ARK ignores it in GameUserSettings.ini [ServerSettings].
    { key: "bDisableStructurePlacementCollision",      iniKey: "bDisableStructurePlacementCollision",        destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "bDisableGenesis",                          iniKey: "bDisableGenesis",                            destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "bAutoUnlockAllEngrams",                    iniKey: "bAutoUnlockAllEngrams",                     destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "globalVoiceChat",                          iniKey: "GlobalVoiceChat",                            destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "proximityChat",                            iniKey: "ProximityChat",                              destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "serverPVE",                                iniKey: "ServerPVE",                                  destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "serverHardcore",                           iniKey: "ServerHardcore",                             destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "serverForceNoHUD",                         iniKey: "ServerForceNoHUD",                           destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "mapPlayerLocation",                        iniKey: "MapPlayerLocation",                          destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "enablePVPGamma",                           iniKey: "EnablePVPGamma",                             destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "disablePvEGamma",                          iniKey: "DisablePvEGamma",                            destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "allowFlyerCarryPvE",                       iniKey: "AllowFlyerCarryPvE",                         destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "passiveDefensesDamageRiderlessDinos",      iniKey: "bPassiveDefensesDamageRiderlessDinos",       destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "maxTamedDinos",                            iniKey: "MaxTamedDinos",                              destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "overrideMaxExperiencePointsPlayer",        iniKey: "OverrideMaxExperiencePointsPlayer",         destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "overrideMaxExperiencePointsDino",          iniKey: "OverrideMaxExperiencePointsDino",            destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "maxNumberOfPlayersInTribe",                iniKey: "MaxNumberOfPlayersInTribe",                  destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "preventDownloadSurvivors",                 iniKey: "PreventDownloadSurvivors",                   destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "preventDownloadItems",                     iniKey: "PreventDownloadItems",                       destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "preventDownloadDinos",                     iniKey: "PreventDownloadDinos",                       destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "preventUploadSurvivors",                   iniKey: "PreventUploadSurvivors",                     destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "preventUploadItems",                       iniKey: "PreventUploadItems",                         destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "preventUploadDinos",                       iniKey: "PreventUploadDinos",                         destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "crossArkAllowForeignDinoDownloads",        iniKey: "CrossARKAllowForeignDinoDownloads",          destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "disableImprinting",                        iniKey: "DisableImprinting",                          destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "babyImprintingStatScaleMultiplier",        iniKey: "BabyImprintingStatScaleMultiplier",          destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "babyImprintAmountMultiplier",              iniKey: "BabyImprintAmountMultiplier",                destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "babyCuddleIntervalMultiplier",             iniKey: "BabyCuddleIntervalMultiplier",               destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "babyCuddleGracePeriodMultiplier",          iniKey: "BabyCuddleGracePeriodMultiplier",            destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "babyCuddleLoseImprintQualitySpeedMultiplier", iniKey: "BabyCuddleLoseImprintQualitySpeedMultiplier", destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "babyFoodConsumptionSpeedMultiplier",       iniKey: "BabyFoodConsumptionSpeedMultiplier",         destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "dinoTurretDamageMultiplier",               iniKey: "DinoTurretDamageMultiplier",                 destination: "Game.ini", section: "[/script/shootergame.shootergamemode]" },
    { key: "preventMateBoost",                         iniKey: "PreventMateBoost",                          destination: "GameUserSettings.ini", section: "[ServerSettings]" },
    { key: "enableExtraStructurePreventionVolumes",    iniKey: "EnableExtraStructurePreventionVolumes",     destination: "GameUserSettings.ini", section: "[ServerSettings]" },
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
   * Keys earlier versions wrote under a wrong name or file, or that are not ARK keys at all, and the
   * property each held. A rewrite drops them instead of keeping them as custom lines, and reading an
   * INI still understands them.
   */
  private readonly legacyIniKeys: Record<string, string> = {
    PlayerCharacterDamageMultiplier: 'playerCharacterDamageMultiplier',
    PlayerCharacterResistanceMultiplier: 'playerCharacterResistanceMultiplier',
    DinoCharacterDamageMultiplier: 'dinoCharacterDamageMultiplier',
    DinoCharacterResistanceMultiplier: 'dinoCharacterResistanceMultiplier',
    bDisableWeatherFog: 'bDisableWeatherFog',
    bDisableStructureDecayPvE: 'bDisableStructureDecayPvE',
    bEnableExtraStructurePreventionVolumes: 'bEnableExtraStructurePreventionVolumes',
    MaxStructuresInRange: 'maxStructuresInRange',
    bForceAllowCaveFlyers: 'forceAllowCaveFlyers',
    bPreventMateBoost: 'preventMateBoost',
    AllowCustomRecipes: 'allowCustomRecipes',
    bPvE: 'bPvE',
    // Not a key ARK reads: the whitelist is enabled by the -exclusivejoin launch flag alone, and
    // with this key written the server refused even listed players. Dropped from existing files.
    UseExclusiveList: 'useExclusiveList',
  };

  /** Twelve-entry per-level stat arrays, written to Game.ini as `<prefix>[i]=value`. */
  private readonly statMultiplierMapping: { key: string; iniKeyPrefix: string }[] = [
    { key: "perLevelStatsMultiplier_Player",              iniKeyPrefix: "PerLevelStatsMultiplier_Player" },
    { key: "perLevelStatsMultiplier_DinoTamed",           iniKeyPrefix: "PerLevelStatsMultiplier_DinoTamed" },
    { key: "perLevelStatsMultiplier_DinoWild",            iniKeyPrefix: "PerLevelStatsMultiplier_DinoWild" },
    { key: "perLevelStatsMultiplier_DinoTamed_Add",       iniKeyPrefix: "PerLevelStatsMultiplier_DinoTamed_Add" },
    { key: "perLevelStatsMultiplier_DinoTamed_Affinity",  iniKeyPrefix: "PerLevelStatsMultiplier_DinoTamed_Affinity" },
    { key: "perLevelStatsMultiplier_DinoTamed_Torpidity", iniKeyPrefix: "PerLevelStatsMultiplier_DinoTamed_Torpidity" },
    { key: "perLevelStatsMultiplier_DinoTamed_Clamp",     iniKeyPrefix: "PerLevelStatsMultiplier_DinoTamed_Clamp" },
  ];

  /**
   * Writes both INI files to the instance's Config/WindowsServer and to the directory ARK reads.
   * Lines the app does not manage are kept from the instance copy, and from the copy ARK reads when
   * that is the instance's own (users edit it too). Throws, before writing anything, when an
   * existing file cannot be read.
   */
  writeArkConfigFiles(instanceDir: string, config: Partial<InstanceConfig>, instanceId?: string): void {
    try {
      const configDir = path.join(instanceDir, 'Config', 'WindowsServer');
      const runtime = this.getRuntimeConfigDir(instanceDir, config, instanceId);
      const files = this.buildIniFiles(config, this.collectPreservedFiles(this.preservedSources(configDir, runtime), config));

      // Written even when empty, so a setting that was cleared does not live on in the old file.
      for (const dir of new Set([configDir, runtime.dir])) {
        fs.mkdirSync(dir, { recursive: true });
        for (const file of INI_FILES) {
          fs.writeFileSync(path.join(dir, file), files[file], 'utf8');
        }
      }
    } catch (error) {
      console.error('[ark-config] Failed to write the ARK config files:', error);
      throw error;
    }
  }

  /**
   * The custom lines writeArkConfigFiles would keep, for buildIniFiles. Only reads. Throws when a
   * file exists but cannot be read.
   */
  readPreservedLines(instanceDir: string, config: Partial<InstanceConfig>, instanceId?: string): Record<IniFileName, PreservedSections> {
    const configDir = path.join(instanceDir, 'Config', 'WindowsServer');
    return this.collectPreservedFiles(this.preservedSources(configDir, this.getRuntimeConfigDir(instanceDir, config, instanceId)), config);
  }

  // Every instance on the shared install writes the shared copy, so its custom lines may be another
  // instance's.
  private preservedSources(configDir: string, runtime: RuntimeConfigDir): string[] {
    return runtime.own ? [configDir, runtime.dir] : [configDir];
  }

  /**
   * The text of both INI files for `config`, with `preserved` custom lines merged into their
   * sections. Reads and writes nothing; a file with nothing to say is ''.
   */
  buildIniFiles(config: Partial<InstanceConfig>, preserved: Partial<Record<IniFileName, PreservedSections>> = {}): IniFiles {
    const managed = this.managedSections(config);
    return {
      'GameUserSettings.ini': renderIni(managed['GameUserSettings.ini'], preserved['GameUserSettings.ini']),
      'Game.ini': renderIni(managed['Game.ini'], preserved['Game.ini']),
    };
  }

  private managedSections(config: Partial<InstanceConfig>): Record<IniFileName, IniSections> {
    const files: Record<IniFileName, IniSections> = { 'GameUserSettings.ini': new Map(), 'Game.ini': new Map() };
    const add = (file: IniFileName, section: string, line: string) => {
      const lines = files[file].get(section);
      if (lines) lines.push(line);
      else files[file].set(section, [line]);
    };

    for (const { key, iniKey, destination, section } of this.asaSettingsMapping) {
      const value = config[key];
      if (value !== undefined && value !== null && value !== '') {
        add(destination, section, `${iniKey}=${iniValue(value)}`);
      }
    }

    // bPvE ("PvE Mode") is not an ARK key; ARK reads ServerPVE. Honour it as the launch args do,
    // without a second ServerPVE line when serverPVE already set one.
    if (isTrue(config.bPvE) && !isTrue(config.serverPVE)) {
      const serverSettings = files['GameUserSettings.ini'].get(SERVER_SETTINGS) ?? [];
      const serverPve = serverSettings.findIndex(line => line.toLowerCase().startsWith('serverpve='));
      if (serverPve >= 0) serverSettings[serverPve] = 'ServerPVE=True';
      else add('GameUserSettings.ini', SERVER_SETTINGS, 'ServerPVE=True');
    }

    // Without it ARK derives RCONEnabled from the ?-params and appends it to the
    // ServerAdminPassword line in the INI.
    if (config.rconPort) {
      add('GameUserSettings.ini', SERVER_SETTINGS, 'RCONEnabled=True');
    }

    for (const { key, iniKeyPrefix } of this.statMultiplierMapping) {
      const values = config[key];
      if (!Array.isArray(values) || values.length !== STAT_COUNT) continue;
      values.forEach((value, i) => {
        // 1.0 is ARK's default, so it is left out.
        if (value !== undefined && value !== null && value !== 1.0) {
          add('Game.ini', GAME_MODE, `${iniKeyPrefix}[${i}]=${iniValue(value)}`);
        }
      });
    }

    for (const [modId, settings] of Object.entries(config.modSettings ?? {})) {
      if (!settings || typeof settings !== 'object') continue;
      if (!MOD_ID.test(modId)) {
        console.warn(`[ark-config] Skipping the settings of mod "${iniValue(modId)}": not a usable section name`);
        continue;
      }
      for (const [settingKey, value] of Object.entries(settings)) {
        // Keys starting with _ are the app's own, such as the mod's display name.
        if (settingKey.startsWith('_') || value === undefined || value === null || value === '') continue;
        if (!isUsableIniKey(settingKey)) {
          console.warn(`[ark-config] Skipping a setting of mod ${modId}: "${iniValue(settingKey)}" is not a usable INI key`);
          continue;
        }
        add('GameUserSettings.ini', `[Mod_${modId}]`, `${settingKey.trim()}=${iniValue(value)}`);
      }
    }

    return files;
  }

  /** Lowercased keys the app writes, so every other line in an existing file counts as custom. */
  private buildManagedKeySet(config: Partial<InstanceConfig>): Set<string> {
    const keys = new Set<string>();
    for (const m of this.asaSettingsMapping) {
      keys.add(m.iniKey.toLowerCase());
    }
    for (const iniKey of Object.keys(this.legacyIniKeys)) {
      keys.add(iniKey.toLowerCase());
    }
    for (const m of this.statMultiplierMapping) {
      for (let i = 0; i < STAT_COUNT; i++) {
        keys.add(`${m.iniKeyPrefix}[${i}]`.toLowerCase());
      }
    }
    if (config.rconPort) {
      keys.add('rconenabled');
    }
    return keys;
  }

  private collectPreservedFiles(dirs: string[], config: Partial<InstanceConfig>): Record<IniFileName, PreservedSections> {
    const managedKeys = this.buildManagedKeySet(config);
    const preserved = {} as Record<IniFileName, PreservedSections>;
    for (const file of INI_FILES) {
      preserved[file] = this.collectPreservedLines(dirs.map(dir => path.join(dir, file)), managedKeys);
    }
    return preserved;
  }

  /** Custom lines from each file in turn, skipping lines an earlier file already had. */
  private collectPreservedLines(filePaths: string[], managedKeys: Set<string>): PreservedSections {
    const merged: PreservedSections = new Map();
    for (const filePath of new Set(filePaths)) {
      for (const [section, entry] of this.collectUnmappedLines(filePath, managedKeys)) {
        const existing = merged.get(section);
        if (!existing) {
          merged.set(section, entry);
          continue;
        }
        const seen = new Set(existing.lines.map(line => line.toLowerCase()));
        existing.lines.push(...entry.lines.filter(line => !seen.has(line.toLowerCase())));
      }
    }
    return merged;
  }

  /** The `key=value` lines of an existing file whose keys are not managed, by lowercased section. */
  private collectUnmappedLines(filePath: string, managedKeys: Set<string>): PreservedSections {
    const result: PreservedSections = new Map();

    let existingContent: string;
    try {
      existingContent = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      // Anything but a missing file is thrown: the writer would replace a file it could not read.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return result;
      throw error;
    }
    if (!existingContent) return result;

    let currentSection = '';
    let currentSectionHeader = '';

    for (const rawLine of existingContent.split(LINE_BREAK)) {
      const line = rawLine.trim();
      if (!line || line.startsWith(';') || line.startsWith('#')) continue;

      if (line.startsWith('[')) {
        currentSection = line.toLowerCase();
        currentSectionHeader = line;
        continue;
      }

      // [Mod_*] sections are rebuilt from modSettings on every write.
      if (!currentSection || currentSection.startsWith('[mod_')) continue;

      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) continue;

      if (!managedKeys.has(line.substring(0, eqIdx).trim().toLowerCase())) {
        if (!result.has(currentSection)) {
          result.set(currentSection, { header: currentSectionHeader, lines: [] });
        }
        result.get(currentSection)!.lines.push(line);
      }
    }

    return result;
  }

  /**
   * The config directory the running server reads. ARK resolves Saved/Config against the tree that
   * owns the executable it launched, so an isolated instance reads its own copy and would otherwise
   * run on ARK's defaults (a random "ARK #12345" session name). Falls back to the shared install's.
   */
  private getRuntimeConfigDir(instanceDir: string, config: Partial<InstanceConfig>, instanceId?: string): RuntimeConfigDir {
    const id = instanceId || config.id || path.basename(instanceDir);
    if (id) {
      try {
        return { dir: getInstanceConfigDir(id), own: isInstanceIsolated(id) };
      } catch (error) {
        console.warn(`[ark-config] Could not resolve the runtime config dir for ${id}; using the shared one:`, error);
      }
    }
    // WindowsServer on both platforms: Linux runs the Windows binaries through Proton.
    return { dir: path.join(getArkServerDir(), 'ShooterGame', 'Saved', 'Config', 'WindowsServer'), own: false };
  }

  /** Raw text of one of an instance's own INI files, or '' when it does not exist. */
  readIniFile(instanceId: string, filename: string): string {
    if (!validateInstanceId(instanceId)) {
      throw new Error('Invalid instance ID');
    }
    if (typeof filename !== 'string' || /[\\/]/.test(filename)) {
      throw new Error('Invalid filename');
    }
    const filePath = path.join(getInstanceDir(instanceId), 'Config', 'WindowsServer', filename);
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  }

  writeIniFile(instanceId: string, filename: string, content: string): void {
    if (!validateInstanceId(instanceId)) {
      throw new Error('Invalid instance ID');
    }
    if (typeof filename !== 'string' || /[\\/]/.test(filename) || !filename.toLowerCase().endsWith('.ini')) {
      throw new Error('Invalid filename. Must be a .ini file.');
    }
    const instanceDir = getInstanceDir(instanceId);
    const configDir = path.join(instanceDir, 'Config', 'WindowsServer');
    // The next start merges custom lines from the instance's own runtime copy too, which would
    // otherwise bring back the old value of a line edited here. The editor is locked while the
    // server runs, so nothing else is writing that copy.
    const runtime = this.getRuntimeConfigDir(instanceDir, {}, instanceId);
    for (const dir of runtime.own ? [configDir, runtime.dir] : [configDir]) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, filename), content, 'utf8');
    }
  }

  /** The config properties set in one INI file, as the raw INI editor saves it. See readIniSettings. */
  parseIniToConfig(filename: string, content: string): Record<string, unknown> {
    return this.readIniSettings(content, { filename }).config;
  }

  /**
   * Reads INI text back into config properties. Keys match case-insensitively, and the spellings
   * earlier versions wrote are read unless the current one is present too. `filename` limits the
   * match to keys ARK reads from that file; `extraKeys` maps more lowercased INI keys.
   */
  readIniSettings(content: string, options: { filename?: string; extraKeys?: Record<string, string> } = {}): ParsedIniSettings {
    const { filename, extraKeys = {} } = options;
    const keys = new Map<string, string>();
    for (const m of this.asaSettingsMapping) {
      const iniKey = m.iniKey.toLowerCase();
      // EnableExtraStructurePreventionVolumes is mapped twice; the first is the property the UI edits.
      if ((!filename || m.destination === filename) && !keys.has(iniKey)) keys.set(iniKey, m.key);
    }
    for (const [iniKey, key] of Object.entries(extraKeys)) {
      if (!keys.has(iniKey)) keys.set(iniKey, key);
    }
    const legacyKeys = new Map(Object.entries(this.legacyIniKeys).map(([iniKey, key]) => [iniKey.toLowerCase(), key]));
    const statKeys = new Map(!filename || filename === 'Game.ini'
      ? this.statMultiplierMapping.map(m => [m.iniKeyPrefix.toLowerCase(), m.key])
      : []);

    const config: Record<string, unknown> = {};
    const fromLegacy: Record<string, unknown> = {};
    const stats: Record<string, number[]> = {};
    const unmapped: string[] = [];
    let section = '';

    for (const rawLine of content.split(LINE_BREAK)) {
      const line = rawLine.trim();
      if (!line || line.startsWith(';') || line.startsWith('#')) continue;

      const header = /^\[(.*)\]$/.exec(line);
      if (header) {
        section = header[1].trim();
        continue;
      }

      const eqIdx = line.indexOf('=');
      if (eqIdx <= 0) continue;
      const rawKey = line.substring(0, eqIdx).trim();
      const rawValue = line.substring(eqIdx + 1).trim();
      const iniKey = rawKey.toLowerCase();

      const statEntry = /^(.+)\[(\d+)\]$/.exec(iniKey);
      const statKey = statEntry ? statKeys.get(statEntry[1]) : undefined;
      if (statEntry && statKey) {
        const index = Number(statEntry[2]);
        const value = Number(rawValue);
        if (index < STAT_COUNT && rawValue !== '' && Number.isFinite(value)) {
          // All twelve entries: the writer leaves out 1.0, and save-ini-file merges this over the
          // stored array, which the writer skips unless it has exactly twelve.
          (stats[statKey] ??= new Array(STAT_COUNT).fill(1.0))[index] = value;
          continue;
        }
      }

      const configKey = keys.get(iniKey);
      const legacyKey = legacyKeys.get(iniKey);
      if (configKey) {
        config[configKey] = coerceIniValue(rawValue);
      } else if (legacyKey) {
        fromLegacy[legacyKey] = coerceIniValue(rawValue);
      } else {
        unmapped.push(`${section}: ${rawKey}`);
      }
    }

    return { config: { ...fromLegacy, ...stats, ...config }, unmapped };
  }
}

export const arkConfigService = new ArkConfigService();
