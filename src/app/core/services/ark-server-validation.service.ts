import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, shareReplay } from 'rxjs';

interface FieldDefinition {
  tab: string;
  label: string;
  key: string;
  type: string;
  default?: any;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: any[];
  placeholder?: string;
}

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

@Injectable({
  providedIn: 'root'
})
export class ArkServerValidationService {
  private fieldDefinitions$: Observable<FieldDefinition[]> | null = null;
  private fieldDefinitions: FieldDefinition[] = [];

  constructor(private http: HttpClient) {
    // Load field definitions on service creation
    this.loadFieldDefinitions();
  }

  private loadFieldDefinitions() {
    this.fieldDefinitions$ = this.http.get<FieldDefinition[]>('assets/advanced-settings-meta.json').pipe(
      shareReplay(1)
    );
    // Load synchronously for immediate access
    this.http.get<FieldDefinition[]>('assets/advanced-settings-meta.json').subscribe(definitions => {
      this.fieldDefinitions = definitions;
    });
  }

  private getFieldLabel(key: string): string {
    const field = this.fieldDefinitions.find(f => f.key === key);
    return field ? field.label : key; // Fallback to key if not found
  }
  validateServerConfiguration(server: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate individual fields
    const fieldValidations = [
      this.validateServerName(server.name),
      this.validateSessionName(server.sessionName),
      this.validatePorts(server),
      this.validatePlayerLimits(server),
      this.validateMultipliers(server),
      this.validateStatArrays(server),
      this.validatePasswords(server),
      this.validateAutomationSettings(server),
      this.validateBackupSettings(server),
      this.validateClusterSettings(server)
    ];

    // Collect errors and warnings
    fieldValidations.forEach(validation => {
      if (!validation.isValid && validation.error) {
        const fieldLabel = validation.label || this.getFieldLabel(validation.field) || validation.field;
        const errorWithLabel = validation.error.replace(validation.field, fieldLabel);
        errors.push(errorWithLabel);
      }
      if (validation.warning) {
        const fieldLabel = validation.label || this.getFieldLabel(validation.field) || validation.field;
        const warningWithLabel = validation.warning.replace(validation.field, fieldLabel);
        warnings.push(warningWithLabel);
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate server name
   */
  validateServerName(name: string, label?: string): FieldValidation {
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

    // Check for invalid characters
    const invalidChars = /[<>:"/\\|?*]/;
    if (invalidChars.test(name)) {
      return { field: 'name', isValid: false, error: `${fieldLabel} contains invalid characters`, label };
    }

    return { field: 'name', isValid: true, label };
  }

  /**
   * Validate session name
   */
  validateSessionName(sessionName: string, label?: string): FieldValidation {
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

  /**
   * Validate map name
   */
  validateMapName(mapName: string, label?: string): FieldValidation {
    const fieldLabel = label || this.getFieldLabel('mapName') || 'Server Map';

    if (!mapName || typeof mapName !== 'string') {
      return { field: 'mapName', isValid: false, error: `${fieldLabel} is required`, label };
    }

    const trimmedName = mapName.trim();
    if (trimmedName.length === 0) {
      return { field: 'mapName', isValid: false, error: `${fieldLabel} cannot be empty`, label };
    }

    // Check for invalid characters (basic validation)
    const invalidChars = /[<>:"/\\|?*]/;
    if (invalidChars.test(trimmedName)) {
      return { field: 'mapName', isValid: false, error: `${fieldLabel} contains invalid characters`, label };
    }

    // For predefined maps, validate against options
    const mapField = this.fieldDefinitions?.find(field => field.key === 'mapName');
    if (mapField?.options) {
      const validMaps = mapField.options.map((opt: any) => opt.value);
      // If it's a predefined map, ensure it matches exactly
      if (validMaps.includes(mapName)) {
        return { field: 'mapName', isValid: true, label };
      }
    }

    // For custom maps, just ensure it's a reasonable length and format
    if (trimmedName.length > 100) {
      return { field: 'mapName', isValid: false, error: `${fieldLabel} cannot exceed 100 characters`, label };
    }

    return { field: 'mapName', isValid: true, label };
  }

  /**
   * Validate port numbers
   */
  validatePorts(server: any): FieldValidation {
    const ports = [
      { field: 'gamePort', value: server.gamePort, default: 7777 },
      { field: 'queryPort', value: server.queryPort, default: 27015 },
      { field: 'rconPort', value: server.rconPort, default: 27020 }
    ];

    for (const port of ports) {
      const portValue = port.value !== undefined ? port.value : port.default;
      const fieldLabel = this.getFieldLabel(port.field) || port.field;

      if (typeof portValue !== 'number' || !Number.isInteger(portValue)) {
        return { field: port.field, isValid: false, error: `${fieldLabel} must be a valid integer` };
      }

      if (portValue < 1 || portValue > 65535) {
        return { field: port.field, isValid: false, error: `${fieldLabel} must be between 1 and 65535` };
      }
    }

    // Check for port conflicts
    const usedPorts = new Set();
    for (const port of ports) {
      const portValue = port.value !== undefined ? port.value : port.default;
      if (usedPorts.has(portValue)) {
        return { field: 'ports', isValid: false, error: 'Port numbers must be unique' };
      }
      usedPorts.add(portValue);
    }

    return { field: 'ports', isValid: true };
  }

  /**
   * Validate player limits
   */
  validatePlayerLimits(server: any): FieldValidation {
    const maxPlayers = server.maxPlayers;
    const fieldLabel = this.getFieldLabel('maxPlayers') || 'Max players';

    if (maxPlayers === undefined || maxPlayers === null) {
      return { field: 'maxPlayers', isValid: true }; // Optional field
    }

    if (typeof maxPlayers !== 'number' || !Number.isInteger(maxPlayers)) {
      return { field: 'maxPlayers', isValid: false, error: `${fieldLabel} must be a valid integer` };
    }

    if (maxPlayers < 1 || maxPlayers > 1000) {
      return { field: 'maxPlayers', isValid: false, error: `${fieldLabel} must be between 1 and 1000` };
    }

    return { field: 'maxPlayers', isValid: true };
  }

  /**
   * Validate multiplier values
   */
  validateMultipliers(server: any): FieldValidation {
    const multiplierFields = [
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
      'tamedDinoTorporDrainMultiplier',
      'dinoCountMultiplier'
    ];

    for (const field of multiplierFields) {
      const value = server[field];
      const fieldLabel = this.getFieldLabel(field) || field;

      if (value === undefined || value === null) {
        continue; // Optional field
      }

      if (typeof value !== 'number') {
        return { field, isValid: false, error: `${fieldLabel} must be a valid number` };
      }

      if (value < 0) {
        return { field, isValid: false, error: `${fieldLabel} cannot be negative` };
      }

      // Warn about extreme values
      if (value >= 100) {
        return { field, isValid: true, warning: `${fieldLabel} is set to a very high value (${value}). This may cause performance issues.` };
      }
    }

    return { field: 'multipliers', isValid: true };
  }

  /**
   * Validate stat multiplier arrays
   */
  validateStatArrays(server: any): FieldValidation {
    const statArrayFields = [
      'perLevelStatsMultiplier_Player',
      'perLevelStatsMultiplier_DinoTamed',
      'perLevelStatsMultiplier_DinoWild',
      'perLevelStatsMultiplier_DinoTamed_Add',
      'perLevelStatsMultiplier_DinoTamed_Affinity',
      'perLevelStatsMultiplier_DinoTamed_Torpidity',
      'perLevelStatsMultiplier_DinoTamed_Clamp'
    ];

    for (const field of statArrayFields) {
      const value = server[field];
      const fieldLabel = this.getFieldLabel(field) || field;

      if (value === undefined || value === null) {
        continue; // Optional field
      }

      if (!Array.isArray(value)) {
        return { field, isValid: false, error: `${fieldLabel} must be an array` };
      }

      if (value.length !== 12) {
        return { field, isValid: false, error: `${fieldLabel} must contain exactly 12 values` };
      }

      for (let i = 0; i < value.length; i++) {
        const statValue = value[i];
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

  /**
   * Validate passwords
   */
  validatePasswords(server: any): FieldValidation {
    const passwordFields = ['serverPassword', 'serverAdminPassword', 'rconPassword'];

    for (const field of passwordFields) {
      const value = server[field];

      if (value === undefined || value === null || value === '') {
        continue; // Optional field
      }

      if (typeof value !== 'string') {
        return { field, isValid: false, error: `${field} must be a string` };
      }

      if (value.length > 100) {
        return { field, isValid: false, error: `${field} cannot exceed 100 characters` };
      }

      // Check for potentially problematic characters
      const problematicChars = /[<>"']/;
      if (problematicChars.test(value)) {
        return { field, isValid: false, error: `${field} contains invalid characters` };
      }
    }

    return { field: 'passwords', isValid: true };
  }

  /**
   * Validate automation settings
   */
  validateAutomationSettings(server: any): FieldValidation {
    // Crash detection interval
    if (server.crashDetectionInterval !== undefined) {
      if (typeof server.crashDetectionInterval !== 'number' || server.crashDetectionInterval < 30 || server.crashDetectionInterval > 300) {
        return { field: 'crashDetectionInterval', isValid: false, error: 'Crash detection interval must be between 30 and 300 seconds' };
      }
    }

    // Max restart attempts
    if (server.maxRestartAttempts !== undefined) {
      if (typeof server.maxRestartAttempts !== 'number' || server.maxRestartAttempts < 1 || server.maxRestartAttempts > 10) {
        return { field: 'maxRestartAttempts', isValid: false, error: 'Max restart attempts must be between 1 and 10' };
      }
    }

    // Restart warning minutes
    if (server.restartWarningMinutes !== undefined) {
      if (typeof server.restartWarningMinutes !== 'number' || server.restartWarningMinutes < 1 || server.restartWarningMinutes > 60) {
        return { field: 'restartWarningMinutes', isValid: false, error: 'Restart warning must be between 1 and 60 minutes' };
      }
    }

    return { field: 'automation', isValid: true };
  }

  /**
   * Validate backup settings
   */
  validateBackupSettings(server: any): FieldValidation {
    // Max backups to keep
    if (server.maxBackupsToKeep !== undefined) {
      if (typeof server.maxBackupsToKeep !== 'number' || server.maxBackupsToKeep < 1 || server.maxBackupsToKeep > 1000) {
        return { field: 'maxBackupsToKeep', isValid: false, error: 'Max backups to keep must be between 1 and 1000' };
      }
    }

    return { field: 'backup', isValid: true };
  }

  /**
   * Validate cluster settings
   */
  validateClusterSettings(server: any): FieldValidation {
    // Cluster directory override
    if (server.clusterDirOverride !== undefined && server.clusterDirOverride !== '') {
      if (typeof server.clusterDirOverride !== 'string') {
        return { field: 'clusterDirOverride', isValid: false, error: 'Cluster directory must be a string' };
      }
      if (server.clusterDirOverride.length > 255) {
        return { field: 'clusterDirOverride', isValid: false, error: 'Cluster directory path cannot exceed 255 characters' };
      }
      // Check for invalid path characters (allow : after drive letter for Windows paths like C:\ARK)
      // Strip the drive letter prefix (e.g., "C:") before checking for invalid chars
      let pathToCheck = server.clusterDirOverride;
      if (/^[a-zA-Z]:/.test(pathToCheck)) {
        pathToCheck = pathToCheck.substring(2);
      }
      const invalidPathChars = /[<>:"|?*]/;
      if (invalidPathChars.test(pathToCheck)) {
        return { field: 'clusterDirOverride', isValid: false, error: 'Cluster directory contains invalid characters' };
      }
    }

    // Cluster ID
    if (server.clusterId !== undefined && server.clusterId !== '') {
      if (typeof server.clusterId !== 'string') {
        return { field: 'clusterId', isValid: false, error: 'Cluster ID must be a string' };
      }
      if (server.clusterId.length > 100) {
        return { field: 'clusterId', isValid: false, error: 'Cluster ID cannot exceed 100 characters' };
      }
      // Check for invalid characters
      const invalidChars = /[<>:"/\\|?*]/;
      if (invalidChars.test(server.clusterId)) {
        return { field: 'clusterId', isValid: false, error: 'Cluster ID contains invalid characters' };
      }
    }

    // Cluster name
    if (server.clusterName !== undefined && server.clusterName !== '') {
      if (typeof server.clusterName !== 'string') {
        return { field: 'clusterName', isValid: false, error: 'Cluster name must be a string' };
      }
      if (server.clusterName.length > 100) {
        return { field: 'clusterName', isValid: false, error: 'Cluster name cannot exceed 100 characters' };
      }
    }

    return { field: 'cluster', isValid: true };
  }

  /**
   * Validate a single field
   */
  validateField(fieldName: string, value: any, server?: any, label?: string): FieldValidation {
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
        // For multiplier fields
        if (fieldName.includes('Multiplier') || fieldName.includes('Scale')) {
          if (typeof value !== 'number' || value < 0) {
            return { field: fieldName, isValid: false, error: `${fieldLabel} must be a positive number`, label };
          }
          return { field: fieldName, isValid: true, label };
        }
        // For stat arrays
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