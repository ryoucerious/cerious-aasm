import AdmZip from 'adm-zip';
import { arkConfigService } from './ark-config.service';
import { getInstanceDir } from '../utils/ark/instance.utils';
import type { InstanceConfig } from '../types/server-instance.types';

// Settings the app passes to ARK as launch arguments rather than writing to an INI, but which INI
// files from other tools carry.
const IMPORT_ONLY_KEYS: Record<string, string> = {
  maxplayers: 'maxPlayers',
  forceallowcaveflyers: 'forceAllowCaveFlyers',
};

// Read as true/false, where INI files also write 1 and 0.
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
  'enablePVPGamma', 'disablePvEGamma', 'allowFlyerCarryPvE', 'passiveDefensesDamageRiderlessDinos',
  'preventDownloadSurvivors', 'preventDownloadItems', 'preventDownloadDinos',
  'preventUploadSurvivors', 'preventUploadItems', 'preventUploadDinos',
  'crossArkAllowForeignDinoDownloads', 'disableImprinting', 'preventMateBoost',
  'bAllowFlyerSpeedLeveling', 'bAllowSpeedLeveling', 'forceAllowCaveFlyers',
  'bDisableDinoRiding', 'onlyAllowSpecifiedEngrams', 'bUseDinoLevelToCreateCharacter',
]);

const LISTED_UNMAPPED_KEYS = 10;

export interface IniImportResult {
  success: boolean;
  config?: Record<string, unknown>;
  error?: string;
  warnings?: string[];
}

export class ConfigImportExportService {
  /**
   * Base64 ZIP of the INI files the server's next start would write, custom lines included. Only
   * reads the server's own files.
   */
  exportConfigAsZip(config: Partial<InstanceConfig>): { success: boolean; base64?: string; error?: string } {
    try {
      const id = config.id;
      const preserved = id ? arkConfigService.readPreservedLines(getInstanceDir(id), config, id) : {};
      const files = arkConfigService.buildIniFiles(config, preserved);
      const zip = new AdmZip();
      for (const [fileName, content] of Object.entries(files)) {
        if (content) zip.addFile(fileName, Buffer.from(content, 'utf-8'));
      }
      return { success: true, base64: zip.toBuffer().toString('base64') };
    } catch (error) {
      return { success: false, error: `Failed to create ZIP: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /**
   * Settings from INI files, whatever their names: keys are matched against every INI file ARK
   * reads. Keys that match nothing are skipped and listed in a warning.
   */
  importFromIni(files: Array<{ fileName: string; content: string }>): IniImportResult {
    try {
      const config: Record<string, unknown> = {};
      const unmapped: string[] = [];
      for (const { content } of files) {
        if (typeof content !== 'string') {
          throw new Error('the file content is not text');
        }
        const parsed = arkConfigService.readIniSettings(content, { extraKeys: IMPORT_ONLY_KEYS });
        Object.assign(config, parsed.config);
        unmapped.push(...parsed.unmapped);
      }
      for (const key of Object.keys(config)) {
        if (BOOLEAN_SETTINGS.has(key)) config[key] = config[key] === true || config[key] === 1;
      }

      const warnings: string[] = [];
      if (unmapped.length > 0) {
        const listed = unmapped.slice(0, LISTED_UNMAPPED_KEYS).join(', ');
        const more = unmapped.length > LISTED_UNMAPPED_KEYS ? '...' : '';
        warnings.push(`${unmapped.length} settings were not recognized and skipped: ${listed}${more}`);
      }
      return { success: true, config, warnings };
    } catch (error) {
      return { success: false, error: `Failed to parse INI: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
}

export const configImportExportService = new ConfigImportExportService();
