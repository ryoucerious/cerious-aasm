import { ServerConfigurationService } from './server-configuration.service';
import { MessagingService } from './messaging/messaging.service';
import { ServerInstanceService } from './server-instance.service';
import { StatMultiplierService } from './stat-multiplier.service';
import { ArkServerValidationService } from './ark-server-validation.service';
import { of } from 'rxjs';

describe('ServerConfigurationService', () => {
  let service: ServerConfigurationService;
  let messagingMock: jasmine.SpyObj<MessagingService>;
  let instanceMock: jasmine.SpyObj<ServerInstanceService>;
  let statMultiplierMock: jasmine.SpyObj<StatMultiplierService>;
  let validationMock: jasmine.SpyObj<ArkServerValidationService>;

  beforeEach(() => {
    messagingMock = jasmine.createSpyObj('MessagingService', ['sendMessage']);
    instanceMock = jasmine.createSpyObj('ServerInstanceService', ['save']);
    statMultiplierMock = jasmine.createSpyObj('StatMultiplierService', ['initializeStatMultipliers']);
    validationMock = jasmine.createSpyObj('ArkServerValidationService', ['validateServerConfiguration', 'validateField']);
    messagingMock.sendMessage.and.returnValue(of({}));
    instanceMock.save.and.returnValue(of({}));
    validationMock.validateServerConfiguration.and.returnValue({ isValid: true, errors: [], warnings: [] });
  validationMock.validateField.and.returnValue({ isValid: true, error: '', field: 'field' });
    service = new ServerConfigurationService(messagingMock, instanceMock, statMultiplierMock, validationMock);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should initialize server instance with defaults', () => {
    spyOn(ServerInstanceService, 'getDefaultInstance').and.returnValue({ foo: 'bar', crossplay: [], mods: [] });
    const result = service.initializeServerInstance({ foo: 'baz' });
    expect(result.foo).toBe('baz');
    expect(result.crossplay).toEqual([]);
    expect(result.mods).toEqual([]);
    expect(result.mapName).toBeDefined();
    expect(statMultiplierMock.initializeStatMultipliers).toHaveBeenCalledWith(result);
  });

  it('should request server state', () => {
    service.requestServerState('id1').subscribe();
    expect(messagingMock.sendMessage).toHaveBeenCalledWith('get-server-instance-state', { id: 'id1' });
  });

  it('should request server logs', () => {
    service.requestServerLogs('id2', 123).subscribe();
    expect(messagingMock.sendMessage).toHaveBeenCalledWith('get-server-instance-logs', { id: 'id2', maxLines: 123 });
  });

  it('should request player count', () => {
    service.requestPlayerCount('id3').subscribe();
    expect(messagingMock.sendMessage).toHaveBeenCalledWith('get-server-instance-players', { id: 'id3' });
  });

  it('should save server settings if changed', () => {
    spyOn(service, 'hasServerChanged').and.returnValue(true);
    const active = { id: 'id4' };
    const original = { id: 'id4' };
    const result = service.saveServerSettings(active, original);
    expect(instanceMock.save).toHaveBeenCalledWith(active);
    expect(result).toBeTruthy();
  });

  it('should not save server settings if not changed', () => {
    spyOn(service, 'hasServerChanged').and.returnValue(false);
    const result = service.saveServerSettings({ id: 'id5' }, { id: 'id5' });
    expect(result).toBeNull();
  });

  it('should detect server changes', () => {
    expect(service.hasServerChanged({ a: 1 }, { a: 2 })).toBeTrue();
    expect(service.hasServerChanged({ a: 1 }, { a: 1 })).toBeFalse();
    expect(service.hasServerChanged(null, { a: 1 })).toBeFalse();
  });

  it('should process mods input', () => {
    expect(service.processModsInput('mod1, mod2')).toEqual(['mod1', 'mod2']);
    expect(service.processModsInput('')).toEqual([]);
  });

  it('should validate server configuration', () => {
    service.validateServerConfiguration({}).isValid;
    expect(validationMock.validateServerConfiguration).toHaveBeenCalled();
  });

  it('should validate field', () => {
    service.validateField('field', 'value', {}).valid;
    expect(validationMock.validateField).toHaveBeenCalledWith('field', 'value', {});
  });

  it('should save server settings with validation', () => {
    spyOn(service, 'saveServerSettings').and.returnValue(of({}));
    validationMock.validateServerConfiguration.and.returnValue({ isValid: true, errors: [], warnings: [] });
    const result = service.saveServerSettingsWithValidation({ id: 'id6' }, { id: 'id6' });
    expect(result.valid).toBeTrue();
    expect(result.observable).toBeTruthy();
  });

  it('should not save server settings with validation if invalid', () => {
    validationMock.validateServerConfiguration.and.returnValue({ isValid: false, errors: ['err'], warnings: [] });
    const result = service.saveServerSettingsWithValidation({ id: 'id7' }, { id: 'id7' });
    expect(result.valid).toBeFalse();
    expect(result.errors).toEqual(['err']);
    expect(result.observable).toBeUndefined();
  });

  it('should convert mods array to string', () => {
    expect(service.modsArrayToString(['a', 'b'])).toBe('a,b');
    expect(service.modsArrayToString([])).toBe('');
  });

  it('should toggle multi option', () => {
    const instance: any = { arr: [] };
    service.toggleMultiOption(instance, 'arr', 'opt', true);
    expect(instance.arr).toContain('opt');
    service.toggleMultiOption(instance, 'arr', 'opt', false);
    expect(instance.arr).not.toContain('opt');
  });

  it('should handle crossplay change', () => {
    const instance: any = { crossplay: [] };
    service.handleCrossplayChange(instance, 'Steam (PC)', true);
    expect(instance.crossplay).toContain('Steam (PC)');
    service.handleCrossplayChange(instance, 'Steam (PC)', false);
    expect(instance.crossplay).not.toContain('Steam (PC)');
  });

  it('should validate server config', () => {
    expect(service.validateServerConfig({ sessionName: '', maxPlayers: 101, serverPassword: '123' }).valid).toBeFalse();
    expect(service.validateServerConfig({ sessionName: 'foo', maxPlayers: 10, serverPassword: '1234' }).valid).toBeTrue();
  });

  it('should create deep copy', () => {
    const obj = { a: 1 };
    const copy = service.createDeepCopy(obj);
    expect(copy).toEqual(obj);
    expect(copy).not.toBe(obj);
  });
});
