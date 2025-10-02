import { ArkServerValidationService, ValidationResult, FieldValidation } from './ark-server-validation.service';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';

describe('ArkServerValidationService', () => {
  let service: ArkServerValidationService;
  let httpMock: jasmine.SpyObj<HttpClient>;

  beforeEach(() => {
    httpMock = jasmine.createSpyObj('HttpClient', ['get']);
    httpMock.get.and.returnValue(of([]));
    service = new ArkServerValidationService(httpMock);
    (service as any).fieldDefinitions = [
      { tab: 'General', label: 'Server Name', key: 'name', type: 'string' },
      { tab: 'General', label: 'Session Name', key: 'sessionName', type: 'string' },
      { tab: 'General', label: 'Server Map', key: 'mapName', type: 'string', options: [{ value: 'TheIsland_WP' }] }
    ];
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should validate server configuration', () => {
    const result: ValidationResult = service.validateServerConfiguration({ name: 'Test', sessionName: 'Session', mapName: 'TheIsland_WP' });
    expect(result.isValid).toBeTrue();
    expect(result.errors.length).toBe(0);
  });

  it('should validate server name', () => {
    expect(service.validateServerName('ValidName').isValid).toBeTrue();
    expect(service.validateServerName('').isValid).toBeFalse();
    expect(service.validateServerName('A'.repeat(101)).isValid).toBeFalse();
    expect(service.validateServerName('Invalid<Name>').isValid).toBeFalse();
  });

  it('should validate session name', () => {
    expect(service.validateSessionName('ValidSession').isValid).toBeTrue();
    expect(service.validateSessionName('').isValid).toBeFalse();
    expect(service.validateSessionName('A'.repeat(101)).isValid).toBeFalse();
  });

  it('should validate map name', () => {
    expect(service.validateMapName('TheIsland_WP').isValid).toBeTrue();
    expect(service.validateMapName('').isValid).toBeFalse();
    expect(service.validateMapName('Invalid<Map>').isValid).toBeFalse();
    expect(service.validateMapName('A'.repeat(101)).isValid).toBeFalse();
  });

  it('should invalidate empty server name', () => {
  const result = service.validateServerName('');
  expect(result.isValid).toBeFalse();
  expect(result.error).toContain('is required');
  });

  it('should invalidate server name with invalid characters', () => {
    const result = service.validateServerName('Invalid<Name>');
    expect(result.isValid).toBeFalse();
    expect(result.error).toContain('invalid characters');
  });

  it('should invalidate session name over 100 chars', () => {
    const result = service.validateSessionName('A'.repeat(101));
    expect(result.isValid).toBeFalse();
    expect(result.error).toContain('exceed 100 characters');
  });

  it('should invalidate map name with invalid characters', () => {
    const result = service.validateMapName('Invalid<Map>');
    expect(result.isValid).toBeFalse();
    expect(result.error).toContain('invalid characters');
  });

  it('should invalidate port conflicts', () => {
    const server = { gamePort: 7777, queryPort: 7777, rconPort: 7777 };
    const result = service.validatePorts(server);
    expect(result.isValid).toBeFalse();
    expect(result.error).toContain('unique');
  });

  it('should invalidate negative multiplier', () => {
    const server = { xpMultiplier: -1 };
    const result = service.validateMultipliers(server);
    expect(result.isValid).toBeFalse();
    expect(result.error).toContain('cannot be negative');
  });

  it('should invalidate stat array with wrong length', () => {
    const server = { perLevelStatsMultiplier_Player: [1,2,3] };
    const result = service.validateStatArrays(server);
    expect(result.isValid).toBeFalse();
    expect(result.error).toContain('exactly 12 values');
  });

  it('should invalidate password with invalid characters', () => {
    const server = { serverPassword: 'bad<pass>' };
    const result = service.validatePasswords(server);
    expect(result.isValid).toBeFalse();
    expect(result.error).toContain('invalid characters');
  });

  it('should invalidate automation settings out of range', () => {
    const server = { crashDetectionInterval: 10 };
    const result = service.validateAutomationSettings(server);
    expect(result.isValid).toBeFalse();
    expect(result.error).toContain('between 30 and 300');
  });

  it('should invalidate backup settings out of range', () => {
    const server = { maxBackupsToKeep: 0 };
    const result = service.validateBackupSettings(server);
    expect(result.isValid).toBeFalse();
    expect(result.error).toContain('between 1 and 1000');
  });

  it('should invalidate cluster settings with invalid path', () => {
    const server = { clusterDirOverride: 'bad|path' };
    const result = service.validateClusterSettings(server);
    expect(result.isValid).toBeFalse();
    expect(result.error).toContain('invalid characters');
  });
});
