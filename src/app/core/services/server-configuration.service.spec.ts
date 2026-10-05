import { ServerConfigurationService } from './server-configuration.service';
import { ServerInstanceService } from './server-instance.service';
import { StatMultiplierService } from './stat-multiplier.service';
import { ArkServerValidationService } from './ark-server-validation.service';
import { of } from 'rxjs';

describe('ServerConfigurationService', () => {
  let service: ServerConfigurationService;
  let instanceMock: jasmine.SpyObj<ServerInstanceService>;
  let statMultiplierMock: jasmine.SpyObj<StatMultiplierService>;
  let validationMock: jasmine.SpyObj<ArkServerValidationService>;

  beforeEach(() => {
    instanceMock = jasmine.createSpyObj('ServerInstanceService', ['save']);
    statMultiplierMock = jasmine.createSpyObj('StatMultiplierService', ['initializeStatMultipliers']);
    validationMock = jasmine.createSpyObj('ArkServerValidationService', ['validateServerConfiguration']);
    instanceMock.save.and.returnValue(of({ success: true }));
    validationMock.validateServerConfiguration.and.returnValue({ isValid: true, errors: [], warnings: [] });
    service = new ServerConfigurationService(instanceMock, statMultiplierMock, validationMock);
  });

  it('should initialize server instance with defaults', () => {
    spyOn(ServerInstanceService, 'getDefaultInstance').and.returnValue({ name: 'Default', crossplay: [], mods: [] });
    const result = service.initializeServerInstance({ name: 'Mine' });
    expect(result.name).toBe('Mine');
    expect(result.crossplay).toEqual([]);
    expect(result.mods).toEqual([]);
    expect(result.mapName).toBe('TheIsland_WP');
    expect(statMultiplierMock.initializeStatMultipliers).toHaveBeenCalledWith(result);
  });

  it('turns the old boolean crossplay setting into the list of platforms', () => {
    const result = service.initializeServerInstance({ name: 'Mine', crossplay: true as unknown as string[] });
    expect(result.crossplay).toEqual(service.crossplayPlatforms);
    expect(service.initializeServerInstance({ name: 'Mine', crossplay: false as unknown as string[] }).crossplay).toEqual([]);
  });

  it('gives an empty page for no server', () => {
    const result = service.initializeServerInstance(null);
    expect(result.id).toBeUndefined();
    expect(result.mods).toEqual([]);
  });

  it('should save server settings if changed', () => {
    spyOn(service, 'hasServerChanged').and.returnValue(true);
    const active = { id: 'id4', name: 'A' };
    const result = service.saveServerSettings(active, { id: 'id4', name: 'B' });
    expect(instanceMock.save).toHaveBeenCalledWith(active);
    expect(result).toBeTruthy();
  });

  it('should not save server settings if not changed', () => {
    spyOn(service, 'hasServerChanged').and.returnValue(false);
    const result = service.saveServerSettings({ id: 'id5', name: 'A' }, { id: 'id5', name: 'A' });
    expect(result).toBeNull();
  });

  it('should detect server changes', () => {
    expect(service.hasServerChanged({ a: 1 }, { a: 2 })).toBeTrue();
    expect(service.hasServerChanged({ a: 1 }, { a: 1 })).toBeFalse();
    expect(service.hasServerChanged(null, { a: 1 })).toBeFalse();
  });

  it('should validate server configuration', () => {
    const server = { id: 'x', name: 'A' };
    expect(service.validateServerConfiguration(server).isValid).toBeTrue();
    expect(validationMock.validateServerConfiguration).toHaveBeenCalledWith(server);
  });

  it('should toggle multi option', () => {
    const instance: Record<string, unknown> = {};
    service.toggleMultiOption(instance, 'arr', 'opt', true);
    service.toggleMultiOption(instance, 'arr', 'opt', true);
    expect(instance['arr']).toEqual(['opt']);
    service.toggleMultiOption(instance, 'arr', 'opt', false);
    expect(instance['arr']).toEqual([]);
  });

  it('should create deep copy', () => {
    const obj = { a: 1 };
    const copy = service.createDeepCopy(obj);
    expect(copy).toEqual(obj);
    expect(copy).not.toBe(obj);
  });
});
