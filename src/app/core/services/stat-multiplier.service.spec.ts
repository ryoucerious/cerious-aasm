import { StatMultiplierService } from './stat-multiplier.service';

describe('StatMultiplierService', () => {
  let service: StatMultiplierService;
  let instance: any;

  beforeEach(() => {
    service = new StatMultiplierService();
    instance = {};
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should get stat multiplier (default)', () => {
    expect(service.getStatMultiplier(instance, 'Player', 0)).toBe(1.0);
  });

  it('should set stat multiplier and get it', () => {
    service.setStatMultiplier(instance, 'Player', 0, 2.5);
    expect(service.getStatMultiplier(instance, 'Player', 0)).toBe(2.5);
  });

  it('should reset stat to defaults', () => {
    service.setStatMultiplier(instance, 'Player', 1, 3.0);
    service.resetStatToDefaults(instance, 1);
    expect(service.getStatMultiplier(instance, 'Player', 1)).toBe(1.0);
  });

  it('should copy stat to all', () => {
    service.setStatMultiplier(instance, 'Player', 2, 4.0);
    service.copyStatToAll(instance, 2);
    for (let i = 0; i < service.statList.length; i++) {
      expect(service.getStatMultiplier(instance, 'Player', i)).toBe(4.0);
    }
  });

  it('should initialize stat multipliers', () => {
    instance = {};
    service.initializeStatMultipliers(instance);
    for (const type of service.multiplierTypes) {
      expect(instance[`perLevelStatsMultiplier_${type}`].length).toBe(12);
      expect(instance[`perLevelStatsMultiplier_${type}`][0]).toBe(1.0);
    }
  });

  it('should handle invalid stat index and instance', () => {
    const minimalInstance = { id: '', name: '' };
    expect(service.getStatMultiplier(minimalInstance, 'Player', 0)).toBe(1.0);
    expect(service.getStatMultiplier(instance, 'Player', -1)).toBe(1.0);
    expect(service.getStatMultiplier(instance, 'Player', 999)).toBe(1.0);
    service.setStatMultiplier(minimalInstance, 'Player', 0, 2.0);
    service.setStatMultiplier(instance, 'Player', -1, 2.0);
    service.setStatMultiplier(instance, 'Player', 999, 2.0);
    service.resetStatToDefaults(minimalInstance, 0);
    service.resetStatToDefaults(instance, -1);
    service.resetStatToDefaults(instance, 999);
    service.copyStatToAll(minimalInstance, 0);
    service.copyStatToAll(instance, -1);
    service.copyStatToAll(instance, 999);
    service.initializeStatMultipliers(minimalInstance);
  });

  it('should set stat multiplier and initialize array if missing', () => {
    const inst: any = {};
    service.setStatMultiplier(inst, 'Player', 5, 7.7);
    expect(inst.perLevelStatsMultiplier_Player[5]).toBe(7.7);
  });

  it('should copy stat to all and initialize arrays if missing', () => {
    const inst: any = {};
    // Set source value for all types
    for (const type of service.multiplierTypes) {
      inst[`perLevelStatsMultiplier_${type}`] = Array(12).fill(2.2);
    }
    // Remove one type to force initialization
    delete inst.perLevelStatsMultiplier_DinoTamed;
    service.copyStatToAll(inst, 0);
  expect(inst.perLevelStatsMultiplier_DinoTamed[0]).toBe(1.0);
  expect(inst.perLevelStatsMultiplier_DinoTamed[5]).toBe(1.0);
  });

  it('should not overwrite arrays that already exist in initializeStatMultipliers', () => {
    const inst: any = { perLevelStatsMultiplier_Player: Array(12).fill(9.9) };
    service.initializeStatMultipliers(inst);
    expect(inst.perLevelStatsMultiplier_Player[0]).toBe(9.9);
  });
});
