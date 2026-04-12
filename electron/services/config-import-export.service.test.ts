import { jest } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// We'll test ConfigImportExportService directly since it has pure logic
jest.mock('./ark-config.service', () => ({
  arkConfigService: {
    writeArkConfigFiles: jest.fn(),
  },
}));

describe('ConfigImportExportService', () => {
  let ConfigImportExportService: any;
  let service: any;
  let tmpDir: string;

  beforeAll(() => {
    const mod = require('./config-import-export.service');
    ConfigImportExportService = mod.ConfigImportExportService;
    service = new ConfigImportExportService();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-import-export-test-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('exportConfigAsJson', () => {
    it('should export config as formatted JSON', () => {
      const config = { id: 'inst1', name: 'TestServer', maxPlayers: 10, state: 'running', players: [] };
      const result = service.exportConfigAsJson(config);
      const parsed = JSON.parse(result);

      expect(parsed.id).toBe('inst1');
      expect(parsed.name).toBe('TestServer');
      expect(parsed.maxPlayers).toBe(10);
      // Runtime-only fields should be stripped
      expect(parsed.state).toBeUndefined();
      expect(parsed.players).toBeUndefined();
    });

    it('should strip memory and status fields', () => {
      const config = { id: 'x', memory: 1024, message: 'test', status: 'ok' };
      const result = JSON.parse(service.exportConfigAsJson(config));

      expect(result.memory).toBeUndefined();
      expect(result.message).toBeUndefined();
      expect(result.status).toBeUndefined();
    });
  });

  describe('importFromJson', () => {
    it('should import valid JSON config', () => {
      const filePath = path.join(tmpDir, 'config.json');
      fs.writeFileSync(filePath, JSON.stringify({ maxPlayers: 20, name: 'Server' }), 'utf-8');

      const result = service.importFromJson(filePath);

      expect(result.success).toBe(true);
      expect(result.config.maxPlayers).toBe(20);
      expect(result.config.name).toBe('Server');
    });

    it('should strip runtime fields from imported JSON', () => {
      const filePath = path.join(tmpDir, 'config.json');
      fs.writeFileSync(filePath, JSON.stringify({ name: 'S', players: ['a'], state: 'running' }), 'utf-8');

      const result = service.importFromJson(filePath);

      expect(result.success).toBe(true);
      expect(result.config.players).toBeUndefined();
      expect(result.config.state).toBeUndefined();
    });

    it('should fail on invalid JSON', () => {
      const filePath = path.join(tmpDir, 'bad.json');
      fs.writeFileSync(filePath, '{invalid json', 'utf-8');

      const result = service.importFromJson(filePath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to parse JSON');
    });

    it('should fail on non-object JSON', () => {
      const filePath = path.join(tmpDir, 'array.json');
      fs.writeFileSync(filePath, '"string"', 'utf-8');

      const result = service.importFromJson(filePath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid JSON');
    });

    it('should fail on non-existent file', () => {
      const result = service.importFromJson(path.join(tmpDir, 'missing.json'));

      expect(result.success).toBe(false);
    });
  });

  describe('importFromIni', () => {
    it('should parse GameUserSettings.ini correctly', () => {
      const content = [
        '[ServerSettings]',
        'ServerPassword=test123',
        'MaxPlayers=32',
        'XPMultiplier=2.5',
        'bPvE=True',
        '',
        '[SessionSettings]',
        'SessionName=My ARK Server',
      ].join('\n');

      const result = service.importFromIni([{ fileName: 'GameUserSettings.ini', content }]);

      expect(result.success).toBe(true);
      expect(result.config.serverPassword).toBe('test123');
      expect(result.config.maxPlayers).toBe(32);
      expect(result.config.xpMultiplier).toBe(2.5);
      expect(result.config.bPvE).toBe(true);
      expect(result.config.sessionName).toBe('My ARK Server');
    });

    it('should parse Game.ini settings', () => {
      const content = [
        '[/script/engine.gamesession]',
        'MaxPlayers=50',
        '',
        '[/script/shootergame.shootergamemode]',
        'bAutoUnlockAllEngrams=True',
        'EggHatchSpeedMultiplier=3.0',
        'BabyMatureSpeedMultiplier=5.0',
      ].join('\n');

      const result = service.importFromIni([{ fileName: 'Game.ini', content }]);

      expect(result.success).toBe(true);
      expect(result.config.maxPlayers).toBe(50);
      expect(result.config.bAutoUnlockAllEngrams).toBe(true);
      expect(result.config.eggHatchSpeedMultiplier).toBe(3.0);
      expect(result.config.babyMatureSpeedMultiplier).toBe(5.0);
    });

    it('should parse boolean values correctly', () => {
      const content = [
        '[ServerSettings]',
        'bPvE=True',
        'bDisableFriendlyFire=1',
        'showMapPlayerLocation=false',
        'adminLogging=0',
      ].join('\n');

      const result = service.importFromIni([{ fileName: 'GameUserSettings.ini', content }]);

      expect(result.success).toBe(true);
      expect(result.config.bPvE).toBe(true);
      expect(result.config.bDisableFriendlyFire).toBe(true);
      expect(result.config.showMapPlayerLocation).toBe(false);
      expect(result.config.adminLogging).toBe(false);
    });

    it('should parse stat multiplier arrays', () => {
      const content = [
        '[/script/shootergame.shootergamemode]',
        'PerLevelStatsMultiplier_Player[0]=2.0',
        'PerLevelStatsMultiplier_Player[1]=3.0',
        'PerLevelStatsMultiplier_Player[7]=1.5',
      ].join('\n');

      const result = service.importFromIni([{ fileName: 'Game.ini', content }]);

      expect(result.success).toBe(true);
      expect(result.config.perLevelStatsMultiplier_Player).toBeDefined();
      expect(result.config.perLevelStatsMultiplier_Player[0]).toBe(2.0);
      expect(result.config.perLevelStatsMultiplier_Player[1]).toBe(3.0);
      expect(result.config.perLevelStatsMultiplier_Player[7]).toBe(1.5);
      // Unset indices should default to 1.0
      expect(result.config.perLevelStatsMultiplier_Player[2]).toBe(1.0);
    });

    it('should generate warnings for unmapped keys', () => {
      const content = [
        '[ServerSettings]',
        'SomeUnknownSetting=123',
        'AnotherWeirdKey=abc',
      ].join('\n');

      const result = service.importFromIni([{ fileName: 'GameUserSettings.ini', content }]);

      expect(result.success).toBe(true);
      expect(result.warnings!.length).toBeGreaterThan(0);
      expect(result.warnings![0]).toContain('not recognized');
    });

    it('should skip comments and blank lines', () => {
      const content = [
        '; This is a comment',
        '# Another comment',
        '',
        '[ServerSettings]',
        'XPMultiplier=1.5',
      ].join('\n');

      const result = service.importFromIni([{ fileName: 'GameUserSettings.ini', content }]);

      expect(result.success).toBe(true);
      expect(result.config.xpMultiplier).toBe(1.5);
    });

    it('should handle multiple files', () => {
      const files = [
        { fileName: 'GameUserSettings.ini', content: '[ServerSettings]\nXPMultiplier=2.0' },
        { fileName: 'Game.ini', content: '[/script/shootergame.shootergamemode]\nBabyMatureSpeedMultiplier=10.0' },
      ];

      const result = service.importFromIni(files);

      expect(result.success).toBe(true);
      expect(result.config.xpMultiplier).toBe(2.0);
      expect(result.config.babyMatureSpeedMultiplier).toBe(10.0);
    });

    it('should handle empty content', () => {
      const result = service.importFromIni([{ fileName: 'test.ini', content: '' }]);

      expect(result.success).toBe(true);
      expect(Object.keys(result.config)).toHaveLength(0);
    });

    it('should handle case-insensitive INI key matching', () => {
      const content = [
        '[ServerSettings]',
        'XPMULTIPLIER=3.0',
        'tamingspeedmultiplier=5.0',
      ].join('\n');

      const result = service.importFromIni([{ fileName: 'GameUserSettings.ini', content }]);

      expect(result.success).toBe(true);
      expect(result.config.xpMultiplier).toBe(3.0);
      expect(result.config.tamingSpeedMultiplier).toBe(5.0);
    });
  });

  describe('readIniFile', () => {
    it('should read existing file', () => {
      const filePath = path.join(tmpDir, 'test.ini');
      fs.writeFileSync(filePath, '[Section]\nKey=Value', 'utf-8');

      const result = service.readIniFile(filePath);

      expect(result.success).toBe(true);
      expect(result.content).toContain('[Section]');
    });

    it('should fail on non-existent file', () => {
      const result = service.readIniFile(path.join(tmpDir, 'missing.ini'));

      expect(result.success).toBe(false);
      expect(result.error).toContain('File not found');
    });
  });

  describe('saveToFile', () => {
    it('should save content to file', () => {
      const filePath = path.join(tmpDir, 'output.txt');
      const result = service.saveToFile(filePath, 'Hello World');

      expect(result.success).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('Hello World');
    });

    it('should create directories if needed', () => {
      const filePath = path.join(tmpDir, 'sub', 'dir', 'output.txt');
      const result = service.saveToFile(filePath, 'content');

      expect(result.success).toBe(true);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  describe('exportConfigAsZip', () => {
    it('should return success with base64 zip content', () => {
      const { arkConfigService } = require('./ark-config.service');

      // Mock writeArkConfigFiles to create actual INI files
      (arkConfigService.writeArkConfigFiles as jest.Mock).mockImplementation((dir: string) => {
        const configDir = path.join(dir, 'Config', 'WindowsServer');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(path.join(configDir, 'GameUserSettings.ini'), '[ServerSettings]\nTest=1', 'utf-8');
        fs.writeFileSync(path.join(configDir, 'Game.ini'), '[/script/shootergame.shootergamemode]', 'utf-8');
      });

      const result = service.exportConfigAsZip({ id: 'test', name: 'Test' });

      expect(result.success).toBe(true);
      expect(result.base64).toBeDefined();
      expect(result.base64!.length).toBeGreaterThan(0);
    });
  });
});
