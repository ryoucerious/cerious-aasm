import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { take } from 'rxjs/operators';
import { MessagingService } from './messaging/messaging.service';
import { ServerInstanceService } from './server-instance.service';
import { StatMultiplierService } from './stat-multiplier.service';
import { ArkServerValidationService, ValidationResult } from './ark-server-validation.service';

@Injectable({
  providedIn: 'root'
})
export class ServerConfigurationService {

  readonly crossplayPlatforms: string[] = [
    'Steam (PC)',
    'Xbox (XSX)',
    'PlayStation (PS5)',
    'Windows Store (WINGDK)'
  ];

  constructor(
    private messaging: MessagingService,
    private serverInstanceService: ServerInstanceService,
    private statMultiplierService: StatMultiplierService,
    private validationService: ArkServerValidationService
  ) {}

  /**
   * Initialize server instance with defaults and normalize data
   */
  initializeServerInstance(server: any): any {
    const defaults = ServerInstanceService.getDefaultInstance();
    const activeServerInstance = { ...defaults, ...server };

    // Normalize mapName
    if (!activeServerInstance.mapName) {
      activeServerInstance.mapName = 'TheIsland_WP';
    }

    // Normalize crossplay array
    if (typeof activeServerInstance.crossplay === 'boolean') {
      activeServerInstance.crossplay = activeServerInstance.crossplay ? [...this.crossplayPlatforms] : [];
    } else if (!Array.isArray(activeServerInstance.crossplay)) {
      activeServerInstance.crossplay = [];
    }

    // Normalize mods array
    if (!Array.isArray(activeServerInstance.mods)) {
      activeServerInstance.mods = [];
    }

    // Initialize stat multiplier arrays to ensure they exist
    this.statMultiplierService.initializeStatMultipliers(activeServerInstance);

    return activeServerInstance;
  }

  /**
   * Request current server state from backend
   */
  requestServerState(serverId: string): Observable<any> {
    return this.messaging.sendMessage('get-server-instance-state', { id: serverId }).pipe(take(1));
  }

  /**
   * Request current server logs from backend
   */
  requestServerLogs(serverId: string, maxLines: number = 200): Observable<any> {
    return this.messaging.sendMessage('get-server-instance-logs', { id: serverId, maxLines }).pipe(take(1));
  }

  /**
   * Request current player count from backend
   */
  requestPlayerCount(serverId: string): Observable<any> {
    return this.messaging.sendMessage('get-server-instance-players', { id: serverId }).pipe(take(1));
  }

  /**
   * Save server settings if changes detected
   */
  saveServerSettings(activeInstance: any, originalInstance: any): Observable<any> | null {
    if (!activeInstance?.id || !this.hasServerChanged(activeInstance, originalInstance)) {
      return null;
    }

    return this.serverInstanceService.save(activeInstance);
  }

  /**
   * Check if server configuration has changed
   */
  hasServerChanged(activeInstance: any, originalInstance: any): boolean {
    if (!originalInstance || !activeInstance) {
      return false;
    }
    
    return JSON.stringify(activeInstance) !== JSON.stringify(originalInstance);
  }

  /**
   * Process mods input string into array
   */
  processModsInput(modsInput: string): string[] {
    if (!modsInput) return [];
    return modsInput.split(',').map(x => x.trim()).filter(Boolean);
  }

  /**
   * Validate server configuration
   */
  validateServerConfiguration(server: any): ValidationResult {
    return this.validationService.validateServerConfiguration(server);
  }

  /**
   * Validate a single field
   */
  validateField(fieldName: string, value: any, server?: any): any {
    return this.validationService.validateField(fieldName, value, server);
  }

  /**
   * Save server settings with validation
   */
  saveServerSettingsWithValidation(activeInstance: any, originalInstance: any): { valid: boolean, errors: string[], warnings: string[], observable?: Observable<any> | null } {
    // Validate the configuration
    const validation = this.validateServerConfiguration(activeInstance);

    if (!validation.isValid) {
      return {
        valid: false,
        errors: validation.errors,
        warnings: validation.warnings
      };
    }

    // If valid, proceed with save
    const saveObservable = this.saveServerSettings(activeInstance, originalInstance);

    return {
      valid: true,
      errors: validation.errors,
      warnings: validation.warnings,
      observable: saveObservable
    };
  }

  /**
   * Convert mods array to input string
   */
  modsArrayToString(mods: string[]): string {
    if (!Array.isArray(mods)) return '';
    return mods.join(',');
  }

  /**
   * Handle multi-option toggle for array fields
   */
  toggleMultiOption(instance: any, fieldKey: string, option: string, checked: boolean): void {
    if (!instance) return;
    
    if (!Array.isArray(instance[fieldKey])) {
      instance[fieldKey] = [];
    }
    
    const arr = instance[fieldKey];
    if (checked) {
      if (!arr.includes(option)) {
        arr.push(option);
      }
    } else {
      const index = arr.indexOf(option);
      if (index > -1) {
        arr.splice(index, 1);
      }
    }
  }

  /**
   * Handle crossplay platform changes
   */
  handleCrossplayChange(instance: any, platform: string, checked: boolean): void {
    if (!instance.crossplay) {
      instance.crossplay = [];
    }
    
    if (checked) {
      if (!instance.crossplay.includes(platform)) {
        instance.crossplay.push(platform);
      }
    } else {
      const index = instance.crossplay.indexOf(platform);
      if (index > -1) {
        instance.crossplay.splice(index, 1);
      }
    }
  }

  /**
   * Validate server configuration
   */
  validateServerConfig(instance: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!instance.sessionName?.trim()) {
      errors.push('Session name is required');
    }

    if (instance.maxPlayers && (instance.maxPlayers < 1 || instance.maxPlayers > 100)) {
      errors.push('Max players must be between 1 and 100');
    }

    if (instance.serverPassword && instance.serverPassword.length < 4) {
      errors.push('Server password must be at least 4 characters');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Create a deep copy for change detection
   */
  createDeepCopy(obj: any): any {
    return JSON.parse(JSON.stringify(obj));
  }
}