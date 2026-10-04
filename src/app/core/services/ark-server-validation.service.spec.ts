import { ArkServerValidationService, ValidationResult } from './ark-server-validation.service';
import { FieldDefinition, FieldDefinitionsService } from './field-definitions.service';
import { of } from 'rxjs';

describe('ArkServerValidationService', () => {
  const validServer = { name: 'Test', sessionName: 'Session', mapName: 'TheIsland_WP' };
  const definitions: FieldDefinition[] = [
    { tab: 'General', label: 'Server Name', key: 'name', type: 'string' },
    { tab: 'General', label: 'Session Name', key: 'sessionName', type: 'string' },
    { tab: 'General', label: 'Server Map', key: 'mapName', type: 'string', options: [{ value: 'TheIsland_WP', display: 'The Island' }] }
  ];
  let service: ArkServerValidationService;

  beforeEach(() => {
    const fieldDefinitions = jasmine.createSpyObj<FieldDefinitionsService>('FieldDefinitionsService', ['getFieldDefinitions']);
    fieldDefinitions.getFieldDefinitions.and.returnValue(of(definitions));
    service = new ArkServerValidationService(fieldDefinitions);
  });

  it('labels errors with the field definitions', () => {
    expect(service.validateServerName('').error).toBe('Server Name is required');
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should validate server configuration', () => {
    const result: ValidationResult = service.validateServerConfiguration({ name: 'Test', sessionName: 'Session', mapName: 'TheIsland_WP' });
    expect(result.isValid).toBeTrue();
    expect(result.errors.length).toBe(0);
  });

  describe('validateMultiHome', () => {
    it('should accept an empty value (bind all interfaces)', () => {
      for (const empty of [undefined, null, '', '   ']) {
        expect(service.validateMultiHome(empty).isValid).toBeTrue();
      }
    });

    it('should accept a valid IPv4 address', () => {
      expect(service.validateMultiHome('10.147.20.5').isValid).toBeTrue();
      expect(service.validateMultiHome('0.0.0.0').isValid).toBeTrue();
      expect(service.validateMultiHome('255.255.255.255').isValid).toBeTrue();
      expect(service.validateMultiHome('  192.168.1.50  ').isValid).toBeTrue();
    });

    it('should reject anything that is not a dotted-quad IPv4 address', () => {
      for (const bad of ['not-an-ip', '999.1.1.1', '10.0.0', '10.0.0.1.1', '10.0.001.1', '::1']) {
        const result = service.validateMultiHome(bad);
        expect(result.isValid).withContext(bad).toBeFalse();
        expect(result.error).withContext(bad).toContain('MultiHome IP');
      }
    });

    it('should surface an invalid multiHome through validateField', () => {
      expect(service.validateField('multiHome', 'nope').isValid).toBeFalse();
      expect(service.validateField('multiHome', '10.147.20.5').isValid).toBeTrue();
    });

    it('should fail whole-config validation when multiHome is invalid', () => {
      const result = service.validateServerConfiguration({
        name: 'Test', sessionName: 'Session', mapName: 'TheIsland_WP', multiHome: 'nope'
      });
      expect(result.isValid).toBeFalse();
    });
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
    const result = service.validateServerConfiguration({ ...validServer, xpMultiplier: -1 });
    expect(result.isValid).toBeFalse();
    expect(result.errors).toEqual([jasmine.stringContaining('cannot be negative')]);
  });

  it('reports every multiplier problem, not just the first warning', () => {
    const result = service.validateServerConfiguration({ ...validServer, xpMultiplier: 200, tamingSpeedMultiplier: -1 });
    expect(result.isValid).toBeFalse();
    expect(result.errors).toEqual([jasmine.stringContaining('tamingSpeedMultiplier cannot be negative')]);
    expect(result.warnings).toEqual([jasmine.stringContaining('xpMultiplier is set to a very high value')]);
  });

  it('reports a bad multiplier once', () => {
    const result = service.validateServerConfiguration({ ...validServer, dinoCountMultiplier: -1 });
    expect(result.errors.length).toBe(1);
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
