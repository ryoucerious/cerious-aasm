import { Injectable } from '@angular/core';
import { ServerInstance } from '../models/server-instance.model';

export const STAT_MULTIPLIER_TYPES = [
  'Player', 'DinoTamed', 'DinoWild', 'DinoTamed_Add',
  'DinoTamed_Affinity', 'DinoTamed_Torpidity', 'DinoTamed_Clamp'
] as const;

export type StatMultiplierType = typeof STAT_MULTIPLIER_TYPES[number];
export type StatMultiplierKey = `perLevelStatsMultiplier_${StatMultiplierType}`;

/** Anything carrying stat multiplier arrays: a saved server or one still being created. */
export type StatMultipliers = Pick<ServerInstance, StatMultiplierKey>;

const DEFAULT_MULTIPLIER = 1.0;

function isStatMultiplierType(type: string): type is StatMultiplierType {
  return (STAT_MULTIPLIER_TYPES as readonly string[]).includes(type);
}

@Injectable({
  providedIn: 'root'
})
export class StatMultiplierService {

  readonly statList: string[] = [
    'Health', 'Stamina', 'Torpidity', 'Oxygen', 'Food', 'Water',
    'Temperature', 'Weight', 'MeleeDamage', 'MovementSpeed', 'Fortitude', 'CraftingSkill'
  ];

  readonly multiplierTypes: readonly StatMultiplierType[] = STAT_MULTIPLIER_TYPES;

  getStatMultiplier(serverInstance: StatMultipliers, type: string, statIndex: number): number {
    if (!serverInstance || !this.isStatIndex(statIndex) || !isStatMultiplierType(type)) {
      return DEFAULT_MULTIPLIER;
    }
    return serverInstance[`perLevelStatsMultiplier_${type}`]?.[statIndex] ?? DEFAULT_MULTIPLIER;
  }

  setStatMultiplier(serverInstance: StatMultipliers, type: string, statIndex: number, value: number): void {
    if (!serverInstance || !this.isStatIndex(statIndex) || !isStatMultiplierType(type)) {
      return;
    }
    this.statArray(serverInstance, type)[statIndex] = value;
  }

  /** Puts one stat back to 1.0 for every multiplier type. */
  resetStatToDefaults(serverInstance: StatMultipliers, statIndex: number): void {
    if (!serverInstance || !this.isStatIndex(statIndex)) {
      return;
    }
    this.multiplierTypes.forEach(type => {
      this.statArray(serverInstance, type)[statIndex] = DEFAULT_MULTIPLIER;
    });
  }

  /** Copies one stat's multipliers, for every type, onto all the other stats. */
  copyStatToAll(serverInstance: StatMultipliers, sourceStatIndex: number): void {
    if (!serverInstance || !this.isStatIndex(sourceStatIndex)) {
      return;
    }
    this.multiplierTypes.forEach(type => {
      const value = this.getStatMultiplier(serverInstance, type, sourceStatIndex);
      this.statArray(serverInstance, type).fill(value);
    });
  }

  initializeStatMultipliers(serverInstance: StatMultipliers): void {
    if (!serverInstance) return;
    this.multiplierTypes.forEach(type => this.statArray(serverInstance, type));
  }

  private isStatIndex(index: number): boolean {
    return index >= 0 && index < this.statList.length;
  }

  /** The instance's array for `type`, created with defaults if it has none yet. */
  private statArray(serverInstance: StatMultipliers, type: StatMultiplierType): number[] {
    const key: StatMultiplierKey = `perLevelStatsMultiplier_${type}`;
    return serverInstance[key] ??= Array(this.statList.length).fill(DEFAULT_MULTIPLIER);
  }
}
