import * as fs from 'fs';
import * as path from 'path';
import { ArkPathUtils } from '../utils/ark.utils';

export class ArkConfigService {
  
  // Settings mapping for ARK Ascended (moved from ark-ini-utils.ts)
  private readonly asaSettingsMapping = [
    // GameUserSettings.ini [ServerSettings] section
    {"key":"altSaveDirectoryName","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":"AltSaveDirectoryName"},
    {"key":"serverPassword","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":"ServerPassword"},
    {"key":"serverAdminPassword","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":"ServerAdminPassword"},
    {"key":"xpMultiplier","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":"XPMultiplier"},
    {"key":"overrideOfficialDifficulty","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":"OverrideOfficialDifficulty"},
    {"key":"difficultyOffset","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":"DifficultyOffset"},
    {"key":"tamingSpeedMultiplier","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":"TamingSpeedMultiplier"},
    {"key":"harvestAmountMultiplier","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":"HarvestAmountMultiplier"},
    {"key":"dinoHarvestingDamageMultiplier","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"playerHarvestingDamageMultiplier","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"resourcesRespawnPeriodMultiplier","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"cropGrowthSpeedMultiplier","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"cropDecaySpeedMultiplier","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"playerCharacterFoodDrainMultiplier","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"playerCharacterWaterDrainMultiplier","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"playerCharacterStaminaDrainMultiplier","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"playerCharacterHealthRecoveryMultiplier","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"playerCharacterDamageMultiplier","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"playerCharacterResistanceMultiplier","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"dinoCharacterFoodDrainMultiplier","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"dinoCharacterStaminaDrainMultiplier","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"dinoCharacterHealthRecoveryMultiplier","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"dinoCharacterDamageMultiplier","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"dinoCharacterResistanceMultiplier","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"dayCycleSpeedScale","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"dayTimeSpeedScale","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"nightTimeSpeedScale","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"bDisableStructurePlacementCollision","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"structureDamageMultiplier","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"structureResistanceMultiplier","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"overrideStructurePlatformPrevention","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"forceAllStructureLocking","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"bPvE","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":"Enable PvE mode"},
    {"key":"bPvEDisableFriendlyFire","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"bPvEAllowTribeWar","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"bPvEAllowTribeWarCancel","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"allowThirdPersonPlayer","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"disableImprintDinoBuff","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"allowAnyoneBabyImprintCuddle","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"useOptimizedHarvestingHealth","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"allowRaidDinoFeeding","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"bDisableFriendlyFire","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"bIncreasePvPRespawnInterval","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"allowCustomRecipes","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"customRecipeEffectivenessMultiplier","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"customRecipeSkillMultiplier","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"autoSavePeriodMinutes","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"showMapPlayerLocation","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"noTributeDownloads","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"proximityRadiusOverride","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"proximityRadiusUnclaimed","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"structurePickupTimeAfterPlacement","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"structurePickupHoldDuration","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"allowIntegratedSPlusStructures","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"allowHideDamageSourceFromLogs","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"raidDinoCharacterFoodDrainMultiplier","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"pvePlatformStructureDamageRatio","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"allowCaveBuildingPvE","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"preventOfflinePvP","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"preventOfflinePvPInterval","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"bShowCreativeMode","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"bAllowUnlimitedRespecs","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"bAllowPlatformSaddleMultiFloors","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"bUseCorpseLocator","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},
    {"key":"bUseSingleplayerSettings","destination":"GameUserSettings.ini","ini_section_or_header":"[ServerSettings]","notes":""},

    // GameUserSettings.ini [SessionSettings] section  
    {"key":"sessionName","destination":"GameUserSettings.ini","ini_section_or_header":"[SessionSettings]","notes":"SessionName - Server display name"},

    // Game.ini [/script/engine.gamesession] section
    {"key":"maxPlayers","destination":"Game.ini","ini_section_or_header":"[/script/engine.gamesession]","notes":"MaxPlayers"},

    // Game.ini [/script/shootergame.shootergamemode] section
    {"key":"bDisableGenesis","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":""},
    {"key":"bAutoUnlockAllEngrams","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":""},
    {"key":"globalVoiceChat","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":""},
    {"key":"proximityChat","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":""},
    {"key":"serverPVE","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":""},
    {"key":"serverHardcore","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":""},
    {"key":"serverForceNoHUD","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":""},
    {"key":"mapPlayerLocation","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":""},
    {"key":"enablePVPGamma","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":""},
    {"key":"disablePvEGamma","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":""},
    {"key":"allowFlyerCarryPvE","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":""},
    {"key":"bPassiveDefensesDamageRiderlessDinos","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":""},
    {"key":"maxTamedDinos","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":"MaxTamedDinos"},
    {"key":"overrideMaxExperiencePointsPlayer","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":"OverrideMaxExperiencePointsPlayer"},
    {"key":"overrideMaxExperiencePointsDino","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":"OverrideMaxExperiencePointsDino"},
    {"key":"maxNumberOfPlayersInTribe","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":"MaxNumberOfPlayersInTribe"},
    {"key":"preventDownloadSurvivors","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":"PreventDownloadSurvivors"},
    {"key":"preventDownloadItems","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":"PreventDownloadItems"},
    {"key":"preventDownloadDinos","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":"PreventDownloadDinos"},
    {"key":"preventUploadSurvivors","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":"PreventUploadSurvivors"},
    {"key":"preventUploadItems","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":"PreventUploadItems"},
    {"key":"preventUploadDinos","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":"PreventUploadDinos"},
    {"key":"crossARKAllowForeignDinosCheat","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":"CrossARKAllowForeignDinosCheat"},
    {"key":"disableImprinting","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":"DisableImprinting"},
    {"key":"allowAnyoneBabyImprintCuddle","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":"AllowAnyoneBabyImprintCuddle"},
    {"key":"babyImprintingStatScaleMultiplier","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":"BabyImprintingStatScaleMultiplier"},
    {"key":"babyImprintAmountMultiplier","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":"BabyImprintAmountMultiplier"},
    {"key":"babyCuddleIntervalMultiplier","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":"BabyCuddleIntervalMultiplier"},
    {"key":"babyCuddleGracePeriodMultiplier","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":"BabyCuddleGracePeriodMultiplier"},
    {"key":"babyCuddleLoseImprintQualitySpeedMultiplier","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":"BabyCuddleLoseImprintQualitySpeedMultiplier"},
    {"key":"babyFoodConsumptionSpeedMultiplier","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":"BabyFoodConsumptionSpeedMultiplier"},
    {"key":"dinoTurretDamageMultiplier","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":"DinoTurretDamageMultiplier"},
    {"key":"preventMateBoost","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":"bPreventMateBoost"},
    {"key":"allowRaidDinoFeeding","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":"bAllowRaidDinoFeeding"},
    {"key":"enableExtraStructurePreventionVolumes","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":"bEnableExtraStructurePreventionVolumes"},
    
    // Missing breeding/imprinting settings from main branch
    {"key":"eggHatchSpeedMultiplier","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":""},
    {"key":"babyMatureSpeedMultiplier","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":""},
    {"key":"matingIntervalMultiplier","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":""},
    {"key":"MatingSpeedMultiplier","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":""},
    {"key":"babyMaxIntervalMultiplier","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":""},
    {"key":"LayEggIntervalMultiplier","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":""},
    {"key":"GlobalSpoilingTimeMultiplier","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":""},
    {"key":"FuelConsumptionIntervalMultiplier","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":"ASA docs specify Game.ini"},
    {"key":"bAllowFlyerSpeedLeveling","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":""},
    {"key":"bAllowSpeedLeveling","destination":"Game.ini","ini_section_or_header":"[/script/shootergame.shootergamemode]","notes":""}
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
          if (!iniFiles[mapping.destination][mapping.ini_section_or_header]) {
            iniFiles[mapping.destination][mapping.ini_section_or_header] = [];
          }

          // Convert key to proper ARK format
          const arkKey = mapping.notes || this.convertToArkKey(mapping.key);
          iniFiles[mapping.destination][mapping.ini_section_or_header].push(`${arkKey}=${configValue}`);
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
