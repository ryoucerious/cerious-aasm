import { Injectable } from '@angular/core';
import { ServerInstance } from '../models/server-instance.model';
import { FieldDefinition, FieldDefinitionsService } from './field-definitions.service';
import { STAT_MULTIPLIER_TYPES, StatMultiplierKey } from './stat-multiplier.service';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface FieldValidation {
  field: string;
  isValid: boolean;
  error?: string;
  warning?: string;
  label?: string;
}

/** Settings as the forms hold them: any field may be missing or of the wrong type. */
type ServerSettingsInput = { [K in keyof ServerInstance]?: unknown } & { maxBackupsToKeep?: unknown };

const MULTIPLIER_FIELDS = [
  'xpMultiplier',
  'tamingSpeedMultiplier',
  'harvestAmountMultiplier',
  'dinoCharacterFoodDrainMultiplier',
  'dinoCharacterStaminaDrainMultiplier',
  'dinoCharacterHealthRecoveryMultiplier',
  'dinoCountMultiplier',
  'playerCharacterFoodDrainMultiplier',
  'playerCharacterStaminaDrainMultiplier',
  'playerCharacterHealthRecoveryMultiplier',
  'playerCharacterWaterDrainMultiplier',
  'playerCharacterDamageMultiplier',
  'playerCharacterResistanceMultiplier',
  'dinoCharacterDamageMultiplier',
  'dinoCharacterResistanceMultiplier',
  'structureResistanceMultiplier',
  'structureDamageMultiplier',
  'dayCycleSpeedScale',
  'dayTimeSpeedScale',
  'nightTimeSpeedScale',
  'dinoHarvestingDamageMultiplier',
  'playerHarvestingDamageMultiplier',
  'resourcesRespawnPeriodMultiplier',
  'raidDinoCharacterFoodDrainMultiplier',
  'passiveTameIntervalMultiplier',
  'globalSpoilingTimeMultiplier',
  'globalItemDecompositionTimeMultiplier',
  'globalCorpseDecompositionTimeMultiplier',
  'cropGrowthSpeedMultiplier',
  'cropDecaySpeedMultiplier',
  'matingIntervalMultiplier',
  'matingSpeedMultiplier',
  'eggHatchSpeedMultiplier',
  'babyMatureSpeedMultiplier',
  'babyFoodConsumptionSpeedMultiplier',
  'babyCuddleIntervalMultiplier',
  'babyImprintingStatScaleMultiplier',
  'babyCuddleGracePeriodMultiplier',
  'babyCuddleLoseImprintQualitySpeedMultiplier',
  'babyImprintAmountMultiplier',
  'babyMaxIntervalMultiplier',
  'fuelConsumptionIntervalMultiplier',
  'autoDestroyOldStructuresMultiplier',
  'oviraptorEggConsumptionMultiplier',
  'supplyCrateLootQualityMultiplier',
  'fishingLootQualityMultiplier',
  'layEggIntervalMultiplier',
  'tamedDinoCharacterFoodDrainMultiplier',
  'tamedDinoTorporDrainMultiplier'
] as const satisfies readonly (keyof ServerInstance)[];

const PASSWORD_FIELDS = ['serverPassword', 'serverAdminPassword', 'rconPassword'] as const;

@Injectable({
  providedIn: 'root'
})
export class ArkServerValidationService {
  private fieldDefinitions: FieldDefinition[] = [];

  constructor(fieldDefinitionsService: FieldDefinitionsService) {
    // Labels are looked up synchronously while validating; until the file arrives, keys stand in.
    fieldDefinitionsService.getFieldDefinitions().subscribe({
      next: definitions => this.fieldDefinitions = definitions,
      error: () => { /* keep using keys as labels */ }
    });
  }

  private getFieldLabel(key: string): string {
    const field = this.fieldDefinitions.find(f => f.key === key);
    return field ? field.label : key;
  }

  validateServerConfiguration(server: ServerSettingsInput): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const fieldValidations: FieldValidation[] = [
      this.validateServerName(server.name),
      this.validateSessionName(server.sessionName),
      this.validatePorts(server),
      this.validateMultiHome(server.multiHome),
      this.validatePlayerLimits(server),
      ...this.validateMultipliers(server),
      this.validateStatArrays(server),
      this.validatePasswords(server),
      this.validateAutomationSettings(server),
      this.validateBackupSettings(server),
      this.validateClusterSettings(server)
    ];

    fieldValidations.forEach(validation => {
      if (!validation.isValid && validation.error) {
        const fieldLabel = validation.label || this.getFieldLabel(validation.field) || validation.field;
        errors.push(validation.error.replace(validation.field, fieldLabel));
      }
      if (validation.warning) {
        const fieldLabel = validation.label || this.getFieldLabel(validation.field) || validation.field;
        warnings.push(validation.warning.replace(validation.field, fieldLabel));
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  validateServerName(name: unknown, label?: string): FieldValidation {
    const fieldLabel = label || this.getFieldLabel('name') || 'Server name';

    if (!name || typeof name !== 'string') {
      return { field: 'name', isValid: false, error: `${fieldLabel} is required`, label };
    }

    if (name.trim().length === 0) {
      return { field: 'name', isValid: false, error: `${fieldLabel} cannot be empty`, label };
    }

    if (name.length > 100) {
      return { field: 'name', isValid: false, error: `${fieldLabel} cannot exceed 100 characters`, label };
    }

    const invalidChars = /[<>:"/\\|?*]/;
    if (invalidChars.test(name)) {
      return { field: 'name', isValid: false, error: `${fieldLabel} contains invalid characters`, label };
    }

    return { field: 'name', isValid: true, label };
  }

  validateSessionName(sessionName: unknown, label?: string): FieldValidation {
    const fieldLabel = label || this.getFieldLabel('sessionName') || 'Session name';

    if (!sessionName || typeof sessionName !== 'string') {
      return { field: 'sessionName', isValid: false, error: `${fieldLabel} is required`, label };
    }

    if (sessionName.trim().length === 0) {
      return { field: 'sessionName', isValid: false, error: `${fieldLabel} cannot be empty`, label };
    }

    if (sessionName.length > 100) {
      return { field: 'sessionName', isValid: false, error: `${fieldLabel} cannot exceed 100 characters`, label };
    }

    return { field: 'sessionName', isValid: true, label };
  }

  validateMapName(mapName: unknown, label?: string): FieldValidation {
    const fieldLabel = label || this.getFieldLabel('mapName') || 'Server Map';

    if (!mapName || typeof mapName !== 'string') {
      return { field: 'mapName', isValid: false, error: `${fieldLabel} is required`, label };
    }

    const trimmedName = mapName.trim();
    if (trimmedName.length === 0) {
      return { field: 'mapName', isValid: false, error: `${fieldLabel} cannot be empty`, label };
    }

    const invalidChars = /[<>:"/\\|?*]/;
    if (invalidChars.test(trimmedName)) {
      return { field: 'mapName', isValid: false, error: `${fieldLabel} contains invalid characters`, label };
    }

    const mapField = this.fieldDefinitions.find(field => field.key === 'mapName');
    const knownMaps = mapField?.options?.map(option => typeof option === 'string' ? option : option.value) ?? [];
    if (knownMaps.includes(mapName)) {
      return { field: 'mapName', isValid: true, label };
    }

    if (trimmedName.length > 100) {
      return { field: 'mapName', isValid: false, error: `${fieldLabel} cannot exceed 100 characters`, label };
    }

    return { field: 'mapName', isValid: true, label };
  }

  /**
   * Validate the MultiHome bind address.
   *
   * Empty means "bind all interfaces" (0.0.0.0) and is always valid. A value must be a
   * dotted-quad IPv4 address: it is interpolated into the server's launch URL, and ARK's
   * MultiHome parameter does not handle IPv6 literals reliably.
   */
  validateMultiHome(value: unknown, label?: string): FieldValidation {
    // multiHome has no advanced-settings-meta.json entry, so both label lookups fall back
    // to the raw key; show a readable name instead of "multiHome".
    const fieldLabel = label && label !== 'multiHome' ? label : 'MultiHome IP';

    if (value === undefined || value === null || String(value).trim() === '') {
      return { field: 'multiHome', isValid: true, label };
    }

    const trimmed = String(value).trim();
    const octets = trimmed.split('.');
    const isIpv4 = octets.length === 4 && octets.every(octet =>
      /^\d{1,3}$/.test(octet) &&
      !(octet.length > 1 && octet.startsWith('0')) &&
      Number(octet) <= 255
    );

    if (!isIpv4) {
      return {
        field: 'multiHome',
        isValid: false,
        error: `${fieldLabel} must be a valid IPv4 address (e.g. 10.147.20.5), or empty to bind all interfaces`,
        label
      };
    }

    return { field: 'multiHome', isValid: true, label };
  }

  validatePorts(server: ServerSettingsInput): FieldValidation {
    const ports = [
      { field: 'gamePort', value: server.gamePort, default: 7777, required: true },
      { field: 'queryPort', value: server.queryPort, default: 27015, required: false },
      { field: 'rconPort', value: server.rconPort, default: 27020, required: true }
    ];
    // QueryPort is optional: ASA may not use it. 0 or unset means "not used".
    const isUnset = (port: typeof ports[number]) =>
      !port.required && (port.value === 0 || port.value === null || port.value === undefined);

    for (const port of ports) {
      if (isUnset(port)) continue;
      const portValue = port.value !== undefined ? port.value : port.default;
      const fieldLabel = this.getFieldLabel(port.field) || port.field;

      if (typeof portValue !== 'number' || !Number.isInteger(portValue)) {
        return { field: port.field, isValid: false, error: `${fieldLabel} must be a valid integer` };
      }

      if (portValue < 1 || portValue > 65535) {
        return { field: port.field, isValid: false, error: `${fieldLabel} must be between 1 and 65535` };
      }
    }

    const usedPorts = new Set<unknown>();
    for (const port of ports) {
      if (isUnset(port)) continue;
      const portValue = port.value !== undefined ? port.value : port.default;
      if (usedPorts.has(portValue)) {
        return { field: 'ports', isValid: false, error: 'Port numbers must be unique' };
      }
      usedPorts.add(portValue);
    }

    return { field: 'ports', isValid: true };
  }

  validatePlayerLimits(server: ServerSettingsInput): FieldValidation {
    const maxPlayers = server.maxPlayers;
    const fieldLabel = this.getFieldLabel('maxPlayers') || 'Max players';

    if (maxPlayers === undefined || maxPlayers === null) {
      return { field: 'maxPlayers', isValid: true };
    }

    if (typeof maxPlayers !== 'number' || !Number.isInteger(maxPlayers)) {
      return { field: 'maxPlayers', isValid: false, error: `${fieldLabel} must be a valid integer` };
    }

    if (maxPlayers < 1 || maxPlayers > 1000) {
      return { field: 'maxPlayers', isValid: false, error: `${fieldLabel} must be between 1 and 1000` };
    }

    return { field: 'maxPlayers', isValid: true };
  }

  /** One entry per multiplier that is invalid or suspiciously high; empty when all are fine. */
  validateMultipliers(server: ServerSettingsInput): FieldValidation[] {
    const problems: FieldValidation[] = [];

    for (const field of MULTIPLIER_FIELDS) {
      const value = server[field];
      const fieldLabel = this.getFieldLabel(field) || field;

      if (value === undefined || value === null) continue;

      if (typeof value !== 'number') {
        problems.push({ field, isValid: false, error: `${fieldLabel} must be a valid number` });
      } else if (value < 0) {
        problems.push({ field, isValid: false, error: `${fieldLabel} cannot be negative` });
      } else if (value >= 100) {
        problems.push({
          field,
          isValid: true,
          warning: `${fieldLabel} is set to a very high value (${value}). This may cause performance issues.`
        });
      }
    }

    return problems;
  }

  validateStatArrays(server: ServerSettingsInput): FieldValidation {
    for (const type of STAT_MULTIPLIER_TYPES) {
      const field: StatMultiplierKey = `perLevelStatsMultiplier_${type}`;
      const value = server[field];
      const fieldLabel = this.getFieldLabel(field) || field;

      if (value === undefined || value === null) continue;

      if (!Array.isArray(value)) {
        return { field, isValid: false, error: `${fieldLabel} must be an array` };
      }

      if (value.length !== 12) {
        return { field, isValid: false, error: `${fieldLabel} must contain exactly 12 values` };
      }

      for (let i = 0; i < value.length; i++) {
        const statValue: unknown = value[i];
        if (typeof statValue !== 'number') {
          return { field, isValid: false, error: `${fieldLabel}[${i}] must be a valid number` };
        }

        if (statValue < 0) {
          return { field, isValid: false, error: `${fieldLabel}[${i}] cannot be negative` };
        }
      }
    }

    return { field: 'statArrays', isValid: true };
  }

  validatePasswords(server: ServerSettingsInput): FieldValidation {
    for (const field of PASSWORD_FIELDS) {
      const value = server[field];

      if (value === undefined || value === null || value === '') continue;

      if (typeof value !== 'string') {
        return { field, isValid: false, error: `${field} must be a string` };
      }

      if (value.length > 100) {
        return { field, isValid: false, error: `${field} cannot exceed 100 characters` };
      }

      // '?' is the ARK travel-URL parameter separator: in a password it would break
      // command-line parsing and corrupt the configuration.
      const problematicChars = /[<>"'?]/;
      if (problematicChars.test(value)) {
        return { field, isValid: false, error: `${field} contains invalid characters (< > " ' ? are not allowed)` };
      }
    }

    return { field: 'passwords', isValid: true };
  }

  validateAutomationSettings(server: ServerSettingsInput): FieldValidation {
    const { crashDetectionInterval, maxRestartAttempts, restartWarningMinutes } = server;

    if (crashDetectionInterval !== undefined) {
      if (typeof crashDetectionInterval !== 'number' || crashDetectionInterval < 30 || crashDetectionInterval > 300) {
        return { field: 'crashDetectionInterval', isValid: false, error: 'Crash detection interval must be between 30 and 300 seconds' };
      }
    }

    if (maxRestartAttempts !== undefined) {
      if (typeof maxRestartAttempts !== 'number' || maxRestartAttempts < 1 || maxRestartAttempts > 10) {
        return { field: 'maxRestartAttempts', isValid: false, error: 'Max restart attempts must be between 1 and 10' };
      }
    }

    if (restartWarningMinutes !== undefined) {
      if (typeof restartWarningMinutes !== 'number' || restartWarningMinutes < 1 || restartWarningMinutes > 60) {
        return { field: 'restartWarningMinutes', isValid: false, error: 'Restart warning must be between 1 and 60 minutes' };
      }
    }

    return { field: 'automation', isValid: true };
  }

  validateBackupSettings(server: ServerSettingsInput): FieldValidation {
    const { maxBackupsToKeep } = server;
    if (maxBackupsToKeep !== undefined) {
      if (typeof maxBackupsToKeep !== 'number' || maxBackupsToKeep < 1 || maxBackupsToKeep > 1000) {
        return { field: 'maxBackupsToKeep', isValid: false, error: 'Max backups to keep must be between 1 and 1000' };
      }
    }

    return { field: 'backup', isValid: true };
  }

  validateClusterSettings(server: ServerSettingsInput): FieldValidation {
    const { clusterDirOverride, clusterId, clusterName } = server;

    if (clusterDirOverride !== undefined && clusterDirOverride !== '') {
      if (typeof clusterDirOverride !== 'string') {
        return { field: 'clusterDirOverride', isValid: false, error: 'Cluster directory must be a string' };
      }
      if (clusterDirOverride.length > 255) {
        return { field: 'clusterDirOverride', isValid: false, error: 'Cluster directory path cannot exceed 255 characters' };
      }
      // A Windows drive prefix ("C:") is the one place ':' is allowed, so strip it before
      // checking for invalid characters.
      const pathToCheck = /^[a-zA-Z]:/.test(clusterDirOverride) ? clusterDirOverride.substring(2) : clusterDirOverride;
      if (/[<>:"|?*]/.test(pathToCheck)) {
        return { field: 'clusterDirOverride', isValid: false, error: 'Cluster directory contains invalid characters' };
      }
    }

    if (clusterId !== undefined && clusterId !== '') {
      if (typeof clusterId !== 'string') {
        return { field: 'clusterId', isValid: false, error: 'Cluster ID must be a string' };
      }
      if (clusterId.length > 100) {
        return { field: 'clusterId', isValid: false, error: 'Cluster ID cannot exceed 100 characters' };
      }
      if (/[<>:"/\\|?*]/.test(clusterId)) {
        return { field: 'clusterId', isValid: false, error: 'Cluster ID contains invalid characters' };
      }
    }

    if (clusterName !== undefined && clusterName !== '') {
      if (typeof clusterName !== 'string') {
        return { field: 'clusterName', isValid: false, error: 'Cluster name must be a string' };
      }
      if (clusterName.length > 100) {
        return { field: 'clusterName', isValid: false, error: 'Cluster name cannot exceed 100 characters' };
      }
    }

    return { field: 'cluster', isValid: true };
  }

  validateField(fieldName: string, value: unknown, server?: ServerSettingsInput, label?: string): FieldValidation {
    const fieldLabel = label || fieldName;

    switch (fieldName) {
      case 'name':
        return this.validateServerName(value);
      case 'sessionName':
        return this.validateSessionName(value);
      case 'mapName':
        return this.validateMapName(value, label);
      case 'gamePort':
      case 'queryPort':
      case 'rconPort':
        return this.validatePorts(server || {});
      case 'multiHome':
        return this.validateMultiHome(value, label);
      case 'maxPlayers':
        return this.validatePlayerLimits({ maxPlayers: value });
      case 'maxBackupsToKeep':
        return this.validateBackupSettings({ maxBackupsToKeep: value });
      case 'clusterDirOverride':
      case 'clusterId':
      case 'clusterName':
        return this.validateClusterSettings({ [fieldName]: value });
      case 'crashDetectionInterval':
        if (typeof value !== 'number' || value < 30 || value > 300) {
          return { field: fieldName, isValid: false, error: `${fieldLabel} must be between 30 and 300 seconds`, label };
        }
        return { field: fieldName, isValid: true, label };
      case 'maxRestartAttempts':
        if (typeof value !== 'number' || value < 1 || value > 10) {
          return { field: fieldName, isValid: false, error: `${fieldLabel} must be between 1 and 10`, label };
        }
        return { field: fieldName, isValid: true, label };
      case 'restartWarningMinutes':
        if (typeof value !== 'number' || value < 1 || value > 60) {
          return { field: fieldName, isValid: false, error: `${fieldLabel} must be between 1 and 60 minutes`, label };
        }
        return { field: fieldName, isValid: true, label };
      default:
        if (fieldName.includes('Multiplier') || fieldName.includes('Scale')) {
          if (typeof value !== 'number' || value < 0) {
            return { field: fieldName, isValid: false, error: `${fieldLabel} must be a positive number`, label };
          }
          return { field: fieldName, isValid: true, label };
        }
        if (fieldName.startsWith('perLevelStatsMultiplier_')) {
          if (!Array.isArray(value) || value.length !== 12) {
            return { field: fieldName, isValid: false, error: `${fieldLabel} must be an array of 12 numbers`, label };
          }
          return { field: fieldName, isValid: true, label };
        }
        return { field: fieldName, isValid: true, label };
    }
  }
}
