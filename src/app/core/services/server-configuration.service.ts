import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ServerInstanceService } from './server-instance.service';
import { StatMultiplierService } from './stat-multiplier.service';
import { ArkServerValidationService, ValidationResult } from './ark-server-validation.service';
import { SaveInstanceResult, ServerInstanceDraft } from '../models/server-instance.model';

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
    private serverInstanceService: ServerInstanceService,
    private statMultiplierService: StatMultiplierService,
    private validationService: ArkServerValidationService
  ) {}

  /** Fills in defaults and repairs the shapes older configs stored (crossplay as a boolean, missing arrays). */
  initializeServerInstance(server: ServerInstanceDraft | null): ServerInstanceDraft {
    const instance: ServerInstanceDraft = { ...ServerInstanceService.getDefaultInstance(), ...server };

    if (!instance.mapName) {
      instance.mapName = 'TheIsland_WP';
    }

    const crossplay: unknown = instance.crossplay;
    if (typeof crossplay === 'boolean') {
      instance.crossplay = crossplay ? [...this.crossplayPlatforms] : [];
    } else if (!Array.isArray(crossplay)) {
      instance.crossplay = [];
    }

    if (!Array.isArray(instance.mods)) {
      instance.mods = [];
    }

    this.statMultiplierService.initializeStatMultipliers(instance);

    return instance;
  }

  /** Saves `activeInstance` when it differs from `originalInstance`; null when there is nothing to save. */
  saveServerSettings(
    activeInstance: ServerInstanceDraft,
    originalInstance: ServerInstanceDraft | null
  ): Observable<SaveInstanceResult> | null {
    if (!activeInstance?.id || !this.hasServerChanged(activeInstance, originalInstance)) {
      return null;
    }

    return this.serverInstanceService.save(activeInstance);
  }

  hasServerChanged(activeInstance: unknown, originalInstance: unknown): boolean {
    if (!originalInstance || !activeInstance) {
      return false;
    }

    return JSON.stringify(activeInstance) !== JSON.stringify(originalInstance);
  }

  validateServerConfiguration(server: ServerInstanceDraft): ValidationResult {
    return this.validationService.validateServerConfiguration(server);
  }

  /** Adds or removes `option` in the array stored under `fieldKey`, creating the array if needed. */
  toggleMultiOption(instance: Record<string, unknown> | null, fieldKey: string, option: string, checked: boolean): void {
    if (!instance) return;

    const current = instance[fieldKey];
    const values: unknown[] = Array.isArray(current) ? current : (instance[fieldKey] = []);
    const index = values.indexOf(option);
    if (checked && index === -1) {
      values.push(option);
    } else if (!checked && index > -1) {
      values.splice(index, 1);
    }
  }

  createDeepCopy<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }
}
