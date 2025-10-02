import { Injectable } from '@angular/core';
import { ServerInstance } from '../models/server-instance.model';

@Injectable({
  providedIn: 'root'
})
export class StatMultiplierService {
  
  // Stat list for validation and UI purposes
  readonly statList: string[] = [
    'Health', 'Stamina', 'Torpidity', 'Oxygen', 'Food', 'Water', 
    'Temperature', 'Weight', 'MeleeDamage', 'MovementSpeed', 'Fortitude', 'CraftingSkill'
  ];

  // Multiplier types available in ARK
  readonly multiplierTypes: string[] = [
    'Player', 'DinoTamed', 'DinoWild', 'DinoTamed_Add', 
    'DinoTamed_Affinity', 'DinoTamed_Torpidity', 'DinoTamed_Clamp'
  ];

  constructor() {}

  /**
   * Get stat multiplier value for a specific type and stat index
   */
  getStatMultiplier(serverInstance: ServerInstance, type: string, statIndex: number): number {
    if (!serverInstance || statIndex < 0 || statIndex >= this.statList.length) {
      return 1.0;
    }

    const propertyName = `perLevelStatsMultiplier_${type}`;
    const array = (serverInstance as any)[propertyName];
    return array?.[statIndex] || 1.0;
  }

  /**
   * Set stat multiplier value for a specific type and stat index
   */
  setStatMultiplier(serverInstance: ServerInstance, type: string, statIndex: number, value: number): void {
    if (!serverInstance || statIndex < 0 || statIndex >= this.statList.length) {
      return;
    }

    const propertyName = `perLevelStatsMultiplier_${type}`;
    if (!(serverInstance as any)[propertyName]) {
      (serverInstance as any)[propertyName] = Array(12).fill(1.0);
    }
    (serverInstance as any)[propertyName][statIndex] = value;
  }

  /**
   * Reset a specific stat index to default values (1.0) for all multiplier types
   */
  resetStatToDefaults(serverInstance: ServerInstance, statIndex: number): void {
    if (!serverInstance || statIndex < 0 || statIndex >= this.statList.length) {
      return;
    }

    this.multiplierTypes.forEach(type => {
      const propertyName = `perLevelStatsMultiplier_${type}`;
      if (!(serverInstance as any)[propertyName]) {
        (serverInstance as any)[propertyName] = Array(12).fill(1.0);
      }
      (serverInstance as any)[propertyName][statIndex] = 1.0;
    });
  }

  /**
   * Copy multiplier values from one stat index to all other stat indices
   */
  copyStatToAll(serverInstance: ServerInstance, sourceStatIndex: number): void {
    if (!serverInstance || sourceStatIndex < 0 || sourceStatIndex >= this.statList.length) {
      return;
    }

    const sourceValues: { [key: string]: number } = {};
    
    // Get current values for the selected stat
    this.multiplierTypes.forEach(type => {
      sourceValues[type] = this.getStatMultiplier(serverInstance, type, sourceStatIndex);
    });
    
    // Apply these values to all stats
    for (let i = 0; i < this.statList.length; i++) {
      this.multiplierTypes.forEach(type => {
        const propertyName = `perLevelStatsMultiplier_${type}`;
        if (!(serverInstance as any)[propertyName]) {
          (serverInstance as any)[propertyName] = Array(12).fill(1.0);
        }
        (serverInstance as any)[propertyName][i] = sourceValues[type];
      });
    }
  }

  /**
   * Initialize stat multiplier arrays to default values if they don't exist
   */
  initializeStatMultipliers(serverInstance: ServerInstance): void {
    if (!serverInstance) return;

    this.multiplierTypes.forEach(type => {
      const propertyName = `perLevelStatsMultiplier_${type}`;
      if (!(serverInstance as any)[propertyName]) {
        (serverInstance as any)[propertyName] = Array(12).fill(1.0);
      }
    });
  }
}