import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';

/**
 * Reverse mapping: maps ARK INI key (case-insensitive) -> config property name (camelCase).
 * Used for importing INI files into server config format.
 */
const INI_KEY_TO_CONFIG: { [iniKeyLower: string]: string } = {
  // GameUserSettings.ini [ServerSettings]
  'altsavedirectoryname': 'altSaveDirectoryName',
  'serverpassword': 'serverPassword',
  'serveradminpassword': 'serverAdminPassword',
  'xpmultiplier': 'xpMultiplier',
  'overrideofficaldifficulty': 'overrideOfficialDifficulty',
  'overrideofficialdifficulty': 'overrideOfficialDifficulty',
  'difficultyoffset': 'difficultyOffset',
  'tamingspeedmultiplier': 'tamingSpeedMultiplier',
  'harvestamountmultiplier': 'harvestAmountMultiplier',
  'dinoharvestingdamagemultiplier': 'dinoHarvestingDamageMultiplier',
  'playerharvestingdamagemultiplier': 'playerHarvestingDamageMultiplier',
  'resourcesrespawnperiodmultiplier': 'resourcesRespawnPeriodMultiplier',
  'cropgrowthspeedmultiplier': 'cropGrowthSpeedMultiplier',
  'cropdecayspeedmultiplier': 'cropDecaySpeedMultiplier',
  'playercharacterfooddrainmultiplier': 'playerCharacterFoodDrainMultiplier',
  'playercharacterwaterdrainmultiplier': 'playerCharacterWaterDrainMultiplier',
  'playercharacterstaminadrainmultiplier': 'playerCharacterStaminaDrainMultiplier',
  'playercharacterhealthrecoverymultiplier': 'playerCharacterHealthRecoveryMultiplier',
  'playercharacterdamagemultiplier': 'playerCharacterDamageMultiplier',
  'playercharacterresistancemultiplier': 'playerCharacterResistanceMultiplier',
  'dinocharacterfooddrainmultiplier': 'dinoCharacterFoodDrainMultiplier',
  'dinocharacterstaminadrainmultiplier': 'dinoCharacterStaminaDrainMultiplier',
  'dinocharacterhealthrecoverymultiplier': 'dinoCharacterHealthRecoveryMultiplier',
  'dinocharacterdamagemultiplier': 'dinoCharacterDamageMultiplier',
  'dinocharacterresistancemultiplier': 'dinoCharacterResistanceMultiplier',
  'tameddinocharacterfooddrainmultiplier': 'tamedDinoCharacterFoodDrainMultiplier',
  'tameddino torpordrainmultiplier': 'tamedDinoTorporDrainMultiplier',
  'tamedinotorpordrainmultiplier': 'tamedDinoTorporDrainMultiplier',
  'daycyclespeedscale': 'dayCycleSpeedScale',
  'daytimespeedscale': 'dayTimeSpeedScale',
  'nighttimespeedscale': 'nightTimeSpeedScale',
  'bdisablestructureplacementcollision': 'bDisableStructurePlacementCollision',
  'structuredamagemultiplier': 'structureDamageMultiplier',
  'structureresistancemultiplier': 'structureResistanceMultiplier',
  'overridestructureplatformprevention': 'overrideStructurePlatformPrevention',
  'forceallstructurelocking': 'forceAllStructureLocking',
  'bpve': 'bPvE',
  'bpvedisablefriendlyfire': 'bPvEDisableFriendlyFire',
  'bpveallowtribewar': 'bPvEAllowTribeWar',
  'bpveallowtribewarcancel': 'bPvEAllowTribeWarCancel',
  'allowthirdpersonplayer': 'allowThirdPersonPlayer',
  'disableimprintdinobuff': 'disableImprintDinoBuff',
  'allowanyone babyimprintcuddle': 'allowAnyoneBabyImprintCuddle',
  'allowanyonebabyimprintcuddle': 'allowAnyoneBabyImprintCuddle',
  'useoptimizedharvestinghealth': 'useOptimizedHarvestingHealth',
  'allowraiddinofeeding': 'allowRaidDinoFeeding',
  'bdisablefriendlyfire': 'bDisableFriendlyFire',
  'bincreasepvprespawninterval': 'bIncreasePvPRespawnInterval',
  'allowcustomrecipes': 'allowCustomRecipes',
  'customrecipeeffectivenessmultiplier': 'customRecipeEffectivenessMultiplier',
  'customrecipeskillmultiplier': 'customRecipeSkillMultiplier',
  'autosaveperiodminutes': 'autoSavePeriodMinutes',
  'showmapplayerlocation': 'showMapPlayerLocation',
  'notributedownloads': 'noTributeDownloads',
  'structurepickuptimeafterplacement': 'structurePickupTimeAfterPlacement',
  'structurepickupholdduration': 'structurePickupHoldDuration',
  'allowintegratedsplusstructures': 'allowIntegratedSPlusStructures',
  'allowhidedamagesourcefromlogs': 'allowHideDamageSourceFromLogs',
  'raiddinocharacterfooddrainmultiplier': 'raidDinoCharacterFoodDrainMultiplier',
  'pveplatformstructuredamageratio': 'pvePlatformStructureDamageRatio',
  'allowcavebuildingpve': 'allowCaveBuildingPvE',
  'preventofflinepvp': 'preventOfflinePvP',
  'preventofflinepvpinterval': 'preventOfflinePvPInterval',
  'bshowcreativemode': 'bShowCreativeMode',
  'ballowunlimitedrespecs': 'bAllowUnlimitedRespecs',
  'ballowplatformsaddlemultifloors': 'bAllowPlatformSaddleMultiFloors',
  'busecorpselocator': 'bUseCorpseLocator',
  'busesingplayersettings': 'bUseSingleplayerSettings',
  'busesingleplayersettings': 'bUseSingleplayerSettings',
  'useexclusivelist': 'useExclusiveList',
  'servercrosshair': 'serverCrosshair',
  'showfloatingdamagetext': 'showFloatingDamageText',
  'allowhitmarkers': 'allowHitMarkers',
  'adminlogging': 'adminLogging',
  'clampresourceharvestdamage': 'clampResourceHarvestDamage',
  'kickidleplayersperiod': 'kickIdlePlayersPeriod',
  'autodestroydecayeddinos': 'autoDestroyDecayedDinos',
  'maxpersonaltameddinos': 'maxPersonalTamedDinos',
  'preventjoinevents': 'preventJoinEvents',
  'preventleaveevents': 'preventLeaveEvents',
  'autodestroyoldstructuresmultiplier': 'autoDestroyOldStructuresMultiplier',
  'bdisablestructuredecaypve': 'bDisableStructureDecayPvE',
  'bdisablelootcrates': 'bDisableLootCrates',
  'bdisableweatherfog': 'bDisableWeatherFog',
  'benableextrastructurepreventionvolumes': 'bEnableExtraStructurePreventionVolumes',
  'ballowplatformsaddlestacking': 'bAllowPlatformSaddleStacking',
  'supplycratelootqualitymultiplier': 'supplyCrateLootQualityMultiplier',
  'fishinglootqualitymultiplier': 'fishingLootQualityMultiplier',
  'dinocountmultiplier': 'dinoCountMultiplier',

  // GameUserSettings.ini [SessionSettings]
  'sessionname': 'sessionName',

  // Game.ini [/script/engine.gamesession]
  'maxplayers': 'maxPlayers',

  // Game.ini [/script/shootergame.shootergamemode]
  'bdisablegenesis': 'bDisableGenesis',
  'bautounlockallengrams': 'bAutoUnlockAllEngrams',
  'globalvoicechat': 'globalVoiceChat',
  'proximitychat': 'proximityChat',
  'serverpve': 'serverPVE',
  'serverhardcore': 'serverHardcore',
  'serverforcenohud': 'serverForceNoHUD',
  'mapplayerlocation': 'mapPlayerLocation',
  'enablepvpgamma': 'enablePVPGamma',
  'disablepvegamma': 'disablePvEGamma',
  'allowflyercarrypve': 'allowFlyerCarryPvE',
  'bpassivedefensesdamageriderlessdinos': 'bPassiveDefensesDamageRiderlessDinos',
  'maxtameddinos': 'maxTamedDinos',
  'overridemaxexperiencepointsplayer': 'overrideMaxExperiencePointsPlayer',
  'overridemaxexperiencepointsdino': 'overrideMaxExperiencePointsDino',
  'maxnumberofplayersintribe': 'maxNumberOfPlayersInTribe',
  'preventdownloadsurvivors': 'preventDownloadSurvivors',
  'preventdownloaditems': 'preventDownloadItems',
  'preventdownloaddinos': 'preventDownloadDinos',
  'preventuploadsurvivors': 'preventUploadSurvivors',
  'preventuploaditems': 'preventUploadItems',
  'preventuploaddinos': 'preventUploadDinos',
  'crossarkallowforeigndinodownloads': 'crossArkAllowForeignDinoDownloads',
  'disableimprinting': 'disableImprinting',
  'babyimprintingstatscalemultiplier': 'babyImprintingStatScaleMultiplier',
  'babyimprintamountmultiplier': 'babyImprintAmountMultiplier',
  'babycuddleintervalmultiplier': 'babyCuddleIntervalMultiplier',
  'babycuddlegraceperiodmultiplier': 'babyCuddleGracePeriodMultiplier',
  'babycuddleloseimprintqualityspeedmultiplier': 'babyCuddleLoseImprintQualitySpeedMultiplier',
  'babyfoodconsumptionspeedmultiplier': 'babyFoodConsumptionSpeedMultiplier',
  'dinoturretdamagemultiplier': 'dinoTurretDamageMultiplier',
  'bpreventmateboost': 'preventMateBoost',
  'egghatchspeedmultiplier': 'eggHatchSpeedMultiplier',
  'babymaturespeedmultiplier': 'babyMatureSpeedMultiplier',
  'matingintervalmultiplier': 'matingIntervalMultiplier',
  'matingspeedmultiplier': 'matingSpeedMultiplier',
  'babymaxintervalmultiplier': 'babyMaxIntervalMultiplier',
  'layeggintervalmultiplier': 'layEggIntervalMultiplier',
  'globalspoilingtimemultiplier': 'globalSpoilingTimeMultiplier',
  'globalitemdecompositiontimemultiplier': 'globalItemDecompositionTimeMultiplier',
  'globalcorpsedecompositiontimemultiplier': 'globalCorpseDecompositionTimeMultiplier',
  'fuelconsumptionintervalmultiplier': 'fuelConsumptionIntervalMultiplier',
  'ballowflyerspeedleveling': 'bAllowFlyerSpeedLeveling',
  'ballowspeedleveling': 'bAllowSpeedLeveling',
  'bforceallowcaveflyers': 'forceAllowCaveFlyers',
  'bdisabledino riding': 'bDisableDinoRiding',
  'bdisabledinoride': 'bDisableDinoRiding',
  'bdisabledinorides': 'bDisableDinoRiding',
  'bdisableriding': 'bDisableDinoRiding',
  'bdisabledinonriding': 'bDisableDinoRiding',
  'bonlyallowspecifiedengrams': 'onlyAllowSpecifiedEngrams',
  'passivetameintervalmultiplier': 'passiveTameIntervalMultiplier',
  'oviraptoreggconsumptionmultiplier': 'oviraptorEggConsumptionMultiplier',
  'maxdifficulty': 'maxDifficulty',
  'busedinoleveltocreatecharacter': 'bUseDinoLevelToCreateCharacter',
};

/** Stat multiplier INI key prefixes (lowercase) -> config property */
const STAT_MULTIPLIER_PREFIXES: { [prefix: string]: string } = {
  'perlevelstatsmultiplier_player': 'perLevelStatsMultiplier_Player',
  'perlevelstatsmultiplier_dinotamed': 'perLevelStatsMultiplier_DinoTamed',
  'perlevelstatsmultiplier_dinowild': 'perLevelStatsMultiplier_DinoWild',
  'perlevelstatsmultiplier_dinotamed_add': 'perLevelStatsMultiplier_DinoTamed_Add',
  'perlevelstatsmultiplier_dinotamed_affinity': 'perLevelStatsMultiplier_DinoTamed_Affinity',
  'perlevelstatsmultiplier_dinotamed_torpidity': 'perLevelStatsMultiplier_DinoTamed_Torpidity',
  'perlevelstatsmultiplier_dinotamed_clamp': 'perLevelStatsMultiplier_DinoTamed_Clamp',
};

/**
 * Boolean settings that should be parsed as true/false instead of numbers
 */
const BOOLEAN_SETTINGS = new Set([
  'bPvE', 'bPvEDisableFriendlyFire', 'bPvEAllowTribeWar', 'bPvEAllowTribeWarCancel',
  'allowThirdPersonPlayer', 'disableImprintDinoBuff', 'allowAnyoneBabyImprintCuddle',
  'useOptimizedHarvestingHealth', 'allowRaidDinoFeeding', 'bDisableFriendlyFire',
  'bIncreasePvPRespawnInterval', 'allowCustomRecipes', 'showMapPlayerLocation',
  'noTributeDownloads', 'allowIntegratedSPlusStructures', 'allowHideDamageSourceFromLogs',
  'allowCaveBuildingPvE', 'preventOfflinePvP', 'bShowCreativeMode', 'bAllowUnlimitedRespecs',
  'bAllowPlatformSaddleMultiFloors', 'bUseCorpseLocator', 'bUseSingleplayerSettings',
  'useExclusiveList', 'bDisableStructurePlacementCollision', 'overrideStructurePlatformPrevention',
  'forceAllStructureLocking', 'serverCrosshair', 'showFloatingDamageText', 'allowHitMarkers',
  'adminLogging', 'clampResourceHarvestDamage', 'autoDestroyDecayedDinos',
  'preventJoinEvents', 'preventLeaveEvents', 'bDisableStructureDecayPvE', 'bDisableLootCrates',
  'bDisableWeatherFog', 'bEnableExtraStructurePreventionVolumes', 'bAllowPlatformSaddleStacking',
  'bDisableGenesis', 'bAutoUnlockAllEngrams', 'globalVoiceChat', 'proximityChat',
  'serverPVE', 'serverHardcore', 'serverForceNoHUD', 'mapPlayerLocation',
  'enablePVPGamma', 'disablePvEGamma', 'allowFlyerCarryPvE', 'bPassiveDefensesDamageRiderlessDinos',
  'preventDownloadSurvivors', 'preventDownloadItems', 'preventDownloadDinos',
  'preventUploadSurvivors', 'preventUploadItems', 'preventUploadDinos',
  'crossArkAllowForeignDinoDownloads', 'disableImprinting', 'preventMateBoost',
  'bAllowFlyerSpeedLeveling', 'bAllowSpeedLeveling', 'forceAllowCaveFlyers',
  'bDisableDinoRiding', 'onlyAllowSpecifiedEngrams', 'bUseDinoLevelToCreateCharacter',
]);

/**
 * Parse INI file content into a structured object.
 * Returns { sections: { sectionName: { key: value } } }
 */
function parseIniContent(content: string): { [section: string]: { [key: string]: string } } {
  const result: { [section: string]: { [key: string]: string } } = {};
  let currentSection = '';

  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue;

    // Section header
    const sectionMatch = trimmed.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      if (!result[currentSection]) {
        result[currentSection] = {};
      }
      continue;
    }

    // Key=Value pair
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > 0) {
      const key = trimmed.substring(0, eqIndex).trim();
      const value = trimmed.substring(eqIndex + 1).trim();
      if (!result[currentSection]) {
        result[currentSection] = {};
      }
      result[currentSection][key] = value;
    }
  }

  return result;
}

/**
 * Convert an INI value string to a typed JavaScript value.
 */
function parseIniValue(configKey: string, rawValue: string): any {
  if (BOOLEAN_SETTINGS.has(configKey)) {
    const lower = rawValue.toLowerCase();
    return lower === 'true' || lower === '1';
  }

  // Try number
  const num = Number(rawValue);
  if (!isNaN(num) && rawValue !== '') {
    return num;
  }

  return rawValue;
}

export class ConfigImportExportService {

  /**
   * Export a server config to a JSON file that can be shared.
   * Strips runtime-only fields (players, memory, state, etc).
   */
  exportConfigAsJson(config: any): string {
    const exportable = { ...config };
    // Remove runtime-only fields 
    delete exportable.players;
    delete exportable.memory;
    delete exportable.message;
    delete exportable.state;
    delete exportable.status;
    // Keep the id so it can be matched on re-import if desired
    return JSON.stringify(exportable, null, 2);
  }

  /**
   * Export a server config as GameUserSettings.ini + Game.ini content.
   * Returns an object with the content of each file.
   */
  exportConfigAsIni(config: any): { gameUserSettings: string; gameIni: string } {
    // Use the ArkConfigService mapping to generate proper INI content
    const { arkConfigService } = require('./ark-config.service');
    
    // Create temp dir to capture output
    const os = require('os');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-export-'));
    const instanceDir = path.join(tmpDir, 'instance');
    fs.mkdirSync(instanceDir, { recursive: true });

    try {
      arkConfigService.writeArkConfigFiles(instanceDir, config);

      const gusPath = path.join(instanceDir, 'Config', 'WindowsServer', 'GameUserSettings.ini');
      const giPath = path.join(instanceDir, 'Config', 'WindowsServer', 'Game.ini');

      const gameUserSettings = fs.existsSync(gusPath) ? fs.readFileSync(gusPath, 'utf-8') : '';
      const gameIni = fs.existsSync(giPath) ? fs.readFileSync(giPath, 'utf-8') : '';

      return { gameUserSettings, gameIni };
    } finally {
      // Cleanup temp files
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  /**
   * Export a server config as a ZIP file containing GameUserSettings.ini and Game.ini.
   * Returns a base64-encoded ZIP buffer.
   */
  exportConfigAsZip(config: any): { success: boolean; base64?: string; error?: string } {
    try {
      const iniResult = this.exportConfigAsIni(config);
      const zip = new AdmZip();

      if (iniResult.gameUserSettings) {
        zip.addFile('GameUserSettings.ini', Buffer.from(iniResult.gameUserSettings, 'utf-8'));
      }
      if (iniResult.gameIni) {
        zip.addFile('Game.ini', Buffer.from(iniResult.gameIni, 'utf-8'));
      }

      const zipBuffer = zip.toBuffer();
      return { success: true, base64: zipBuffer.toString('base64') };
    } catch (err: any) {
      return { success: false, error: `Failed to create ZIP: ${err.message}` };
    }
  }

  /**
   * Import settings from a JSON config file (AASM format or compatible).
   * Returns the parsed config object.
   */
  importFromJson(filePath: string): { success: boolean; config?: any; error?: string } {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const config = JSON.parse(content);

      if (!config || typeof config !== 'object') {
        return { success: false, error: 'Invalid JSON: expected an object' };
      }

      // Strip runtime fields if present
      delete config.players;
      delete config.memory;
      delete config.message;
      delete config.state;
      delete config.status;

      return { success: true, config };
    } catch (err: any) {
      return { success: false, error: `Failed to parse JSON: ${err.message}` };
    }
  }

  /**
   * Import settings from INI files (GameUserSettings.ini and/or Game.ini).
   * Parses the INI content and maps to the AASM config format.
   * 
   * @param files Array of { fileName, content } objects
   * @returns Merged config object
   */
  importFromIni(files: Array<{ fileName: string; content: string }>): { success: boolean; config?: any; error?: string; warnings?: string[] } {
    try {
      const config: any = {};
      const warnings: string[] = [];
      const unmappedKeys: string[] = [];

      for (const file of files) {
        const sections = parseIniContent(file.content);

        for (const [sectionName, entries] of Object.entries(sections)) {
          for (const [iniKey, rawValue] of Object.entries(entries)) {
            // Check for stat multiplier arrays (e.g., PerLevelStatsMultiplier_Player[0]=1.0)
            const statMatch = iniKey.match(/^(.+)\[(\d+)\]$/);
            if (statMatch) {
              const prefix = statMatch[1].toLowerCase();
              const index = parseInt(statMatch[2], 10);
              const configKey = STAT_MULTIPLIER_PREFIXES[prefix];
              if (configKey && index >= 0 && index < 12) {
                if (!config[configKey]) {
                  config[configKey] = Array(12).fill(1.0);
                }
                config[configKey][index] = parseFloat(rawValue) || 1.0;
                continue;
              }
            }

            // Regular key lookup
            const configKey = INI_KEY_TO_CONFIG[iniKey.toLowerCase()];
            if (configKey) {
              config[configKey] = parseIniValue(configKey, rawValue);
            } else {
              // Track unmapped keys for warnings
              unmappedKeys.push(`${sectionName}: ${iniKey}`);
            }
          }
        }
      }

      if (unmappedKeys.length > 0) {
        warnings.push(`${unmappedKeys.length} settings were not recognized and skipped: ${unmappedKeys.slice(0, 10).join(', ')}${unmappedKeys.length > 10 ? '...' : ''}`);
      }

      return { success: true, config, warnings };
    } catch (err: any) {
      return { success: false, error: `Failed to parse INI: ${err.message}` };
    }
  }

  /**
   * Read an INI file from disk and return its content.
   */
  readIniFile(filePath: string): { success: boolean; content?: string; error?: string } {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: `File not found: ${filePath}` };
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      return { success: true, content };
    } catch (err: any) {
      return { success: false, error: `Failed to read file: ${err.message}` };
    }
  }

  /**
   * Save exported content to a file.
   */
  saveToFile(filePath: string, content: string): { success: boolean; error?: string } {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, content, 'utf-8');
      return { success: true };
    } catch (err: any) {
      return { success: false, error: `Failed to write file: ${err.message}` };
    }
  }
}

export const configImportExportService = new ConfigImportExportService();
