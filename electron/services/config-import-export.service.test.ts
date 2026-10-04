import { jest } from '@jest/globals';

// This suite exercises real filesystem behaviour in a temp directory, so it opts out of
// the global fs/path mocks in test/setup.ts, both here and inside the services under test.
jest.unmock('fs');
jest.unmock('path');

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import AdmZip from 'adm-zip';
import { getArkServerDir, getInstanceConfigDir, isInstanceIsolated } from '../utils/ark/ark-server/ark-server-paths.utils';
import { getInstanceDir } from '../utils/ark/instance.utils';
import { ConfigImportExportService } from './config-import-export.service';

jest.mock('../utils/ark/instance.utils', () => ({ getInstanceDir: jest.fn() }));
jest.mock('../utils/ark/ark-server/ark-server-paths.utils', () => ({
  getArkServerDir: jest.fn(),
  getInstanceConfigDir: jest.fn(),
  isInstanceIsolated: jest.fn()
}));

// Every file in a directory, as bytes.
function snapshot(dir: string): Record<string, Buffer> {
  return Object.fromEntries(fs.readdirSync(dir).map(name => [name, fs.readFileSync(path.join(dir, name))]));
}

function unzip(base64: string): Record<string, string> {
  const zip = new AdmZip(Buffer.from(base64, 'base64'));
  return Object.fromEntries(zip.getEntries().map(entry => [entry.entryName, entry.getData().toString('utf8')]));
}

describe('ConfigImportExportService', () => {
  let service: ConfigImportExportService;
  let tmpDir: string;

  beforeEach(() => {
    service = new ConfigImportExportService();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-import-export-test-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
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
      expect(result.config!.serverPassword).toBe('test123');
      expect(result.config!.maxPlayers).toBe(32);
      expect(result.config!.xpMultiplier).toBe(2.5);
      expect(result.config!.bPvE).toBe(true);
      expect(result.config!.sessionName).toBe('My ARK Server');
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
      expect(result.config!.maxPlayers).toBe(50);
      expect(result.config!.bAutoUnlockAllEngrams).toBe(true);
      expect(result.config!.eggHatchSpeedMultiplier).toBe(3.0);
      expect(result.config!.babyMatureSpeedMultiplier).toBe(5.0);
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
      expect(result.config!.bPvE).toBe(true);
      expect(result.config!.bDisableFriendlyFire).toBe(true);
      expect(result.config!.showMapPlayerLocation).toBe(false);
      expect(result.config!.adminLogging).toBe(false);
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
      const stats = result.config!.perLevelStatsMultiplier_Player as number[];
      expect(stats[0]).toBe(2.0);
      expect(stats[1]).toBe(3.0);
      expect(stats[7]).toBe(1.5);
      expect(stats[2]).toBe(1.0);
    });

    it('keeps a stat multiplier of zero', () => {
      const result = service.importFromIni([
        { fileName: 'Game.ini', content: '[/script/shootergame.shootergamemode]\nPerLevelStatsMultiplier_DinoWild[3]=0' }
      ]);

      expect((result.config!.perLevelStatsMultiplier_DinoWild as number[])[3]).toBe(0);
    });

    it('should generate warnings for unmapped keys', () => {
      const content = [
        '[ServerSettings]',
        'SomeUnknownSetting=123',
        'AnotherWeirdKey=abc',
      ].join('\n');

      const result = service.importFromIni([{ fileName: 'GameUserSettings.ini', content }]);

      expect(result.success).toBe(true);
      expect(result.warnings).toEqual([
        '2 settings were not recognized and skipped: ServerSettings: SomeUnknownSetting, ServerSettings: AnotherWeirdKey'
      ]);
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
      expect(result.config!.xpMultiplier).toBe(1.5);
    });

    it('should handle multiple files', () => {
      const files = [
        { fileName: 'GameUserSettings.ini', content: '[ServerSettings]\nXPMultiplier=2.0' },
        { fileName: 'Game.ini', content: '[/script/shootergame.shootergamemode]\nBabyMatureSpeedMultiplier=10.0' },
      ];

      const result = service.importFromIni(files);

      expect(result.success).toBe(true);
      expect(result.config!.xpMultiplier).toBe(2.0);
      expect(result.config!.babyMatureSpeedMultiplier).toBe(10.0);
    });

    it('should handle empty content', () => {
      const result = service.importFromIni([{ fileName: 'test.ini', content: '' }]);

      expect(result.success).toBe(true);
      expect(Object.keys(result.config!)).toHaveLength(0);
    });

    it('should handle case-insensitive INI key matching', () => {
      const content = [
        '[ServerSettings]',
        'XPMULTIPLIER=3.0',
        'tamingspeedmultiplier=5.0',
      ].join('\n');

      const result = service.importFromIni([{ fileName: 'GameUserSettings.ini', content }]);

      expect(result.success).toBe(true);
      expect(result.config!.xpMultiplier).toBe(3.0);
      expect(result.config!.tamingSpeedMultiplier).toBe(5.0);
    });

    it('reads every key the INI writer knows, whichever file it is in', () => {
      const result = service.importFromIni([{
        fileName: 'GameUserSettings.ini',
        content: '[ServerSettings]\nProximityRadiusOverride=5\nMaxPlatformSaddleStructureLimit=120\nCropGrowthSpeedMultiplier=2'
      }]);

      expect(result.config).toEqual({ proximityRadiusOverride: 5, maxPlatformSaddleStructureLimit: 120, cropGrowthSpeedMultiplier: 2 });
      expect(result.warnings).toEqual([]);
    });

    it('reads the spellings of older versions and launch-argument settings', () => {
      const result = service.importFromIni([{
        fileName: 'Game.ini',
        content: [
          '[/script/shootergame.shootergamemode]',
          'PlayerCharacterDamageMultiplier=2', 'bForceAllowCaveFlyers=True', 'bPreventMateBoost=True',
          '[/script/engine.gamesession]', 'MaxPlayers=70'
        ].join('\n')
      }]);

      expect(result.config).toEqual({
        playerCharacterDamageMultiplier: 2, forceAllowCaveFlyers: true, preventMateBoost: true, maxPlayers: 70
      });
    });

    it('reports a misspelled key rather than guessing', () => {
      const result = service.importFromIni([{ fileName: 'GameUserSettings.ini', content: '[ServerSettings]\nOverrideOfficalDifficulty=5' }]);

      expect(result.config).toEqual({});
      expect(result.warnings![0]).toContain('OverrideOfficalDifficulty');
    });

    it('lists at most ten unrecognized keys', () => {
      const content = ['[ServerSettings]', ...Array.from({ length: 12 }, (_, i) => `Unknown${i}=1`)].join('\n');

      const result = service.importFromIni([{ fileName: 'GameUserSettings.ini', content }]);

      expect(result.warnings![0]).toMatch(/^12 settings were not recognized and skipped: .*Unknown9\.\.\.$/);
      expect(result.warnings![0]).not.toContain('Unknown10');
    });

    it('fails content that is not text', () => {
      const result = service.importFromIni([{ fileName: 'Game.ini', content: 42 as unknown as string }]);

      expect(result).toEqual({ success: false, error: 'Failed to parse INI: the file content is not text' });
    });
  });

  describe('exportConfigAsZip', () => {
    beforeEach(() => {
      jest.mocked(getInstanceDir).mockImplementation(id => path.join(tmpDir, 'Servers', id));
      jest.mocked(getInstanceConfigDir).mockReturnValue(path.join(tmpDir, 'runtime'));
      jest.mocked(getArkServerDir).mockReturnValue(path.join(tmpDir, 'shared'));
    });

    it('zips the INI files built from the config', () => {
      const result = service.exportConfigAsZip({ id: 'a1', name: 'Test', sessionName: 'Exported', eggHatchSpeedMultiplier: 3 });

      expect(result.success).toBe(true);
      expect(unzip(result.base64!)).toEqual({
        'GameUserSettings.ini': '[SessionSettings]\nSessionName=Exported\n\n',
        'Game.ini': '[/script/shootergame.shootergamemode]\nEggHatchSpeedMultiplier=3\n\n'
      });
    });

    it('leaves out a file with nothing in it', () => {
      const result = service.exportConfigAsZip({ id: 'a1', sessionName: 'Exported' });

      expect(Object.keys(unzip(result.base64!))).toEqual(['GameUserSettings.ini']);
    });

    it("keeps the custom lines of the server's INI files, and only reads them", () => {
      const instanceConfigDir = path.join(tmpDir, 'Servers', 'a1', 'Config', 'WindowsServer');
      const runtimeDir = path.join(tmpDir, 'runtime');
      const override = 'ConfigOverrideItemMaxQuantity=(ItemClassString="PrimalItemResource_Stone_C",Quantity=(MaxItemQuantity=500))';
      fs.mkdirSync(instanceConfigDir, { recursive: true });
      fs.mkdirSync(runtimeDir, { recursive: true });
      fs.writeFileSync(path.join(instanceConfigDir, 'Game.ini'), `[/script/shootergame.shootergamemode]\n${override}\nEggHatchSpeedMultiplier=9\n`, 'utf8');
      fs.writeFileSync(path.join(runtimeDir, 'GameUserSettings.ini'), '[ServerSettings]\nLive=1\n', 'utf8');
      const instanceBefore = snapshot(instanceConfigDir);
      const runtimeBefore = snapshot(runtimeDir);
      jest.mocked(isInstanceIsolated).mockReturnValue(true);

      const result = service.exportConfigAsZip({ id: 'a1', sessionName: 'Exported', eggHatchSpeedMultiplier: 3 });

      expect(getInstanceDir).toHaveBeenCalledWith('a1');
      expect(unzip(result.base64!)).toEqual({
        'GameUserSettings.ini': '[SessionSettings]\nSessionName=Exported\n\n[ServerSettings]\nLive=1\n\n',
        'Game.ini': `[/script/shootergame.shootergamemode]\nEggHatchSpeedMultiplier=3\n${override}\n\n`
      });
      expect(snapshot(instanceConfigDir)).toEqual(instanceBefore);
      expect(snapshot(runtimeDir)).toEqual(runtimeBefore);
    });

    it('leaves out the custom lines of a runtime copy that other servers share', () => {
      const runtimeDir = path.join(tmpDir, 'runtime');
      fs.mkdirSync(runtimeDir, { recursive: true });
      fs.writeFileSync(path.join(runtimeDir, 'GameUserSettings.ini'), '[ServerSettings]\nAnotherServers=1\n', 'utf8');
      jest.mocked(isInstanceIsolated).mockReturnValue(false);

      const result = service.exportConfigAsZip({ id: 'a1', sessionName: 'Exported' });

      expect(unzip(result.base64!)).toEqual({ 'GameUserSettings.ini': '[SessionSettings]\nSessionName=Exported\n\n' });
    });

    // Export used to render through writeArkConfigFiles, which copies its output into the config
    // directory the instance's running server reads.
    it('leaves the config directory the running server reads untouched', () => {
      const runtimeDir = path.join(tmpDir, 'runtime');
      fs.mkdirSync(runtimeDir, { recursive: true });
      fs.writeFileSync(path.join(runtimeDir, 'GameUserSettings.ini'), '[ServerSettings]\nLive=1\n', 'utf8');

      const result = service.exportConfigAsZip({ id: 'a1', sessionName: 'Exported', cropGrowthSpeedMultiplier: 2 });

      expect(result.success).toBe(true);
      expect(fs.readdirSync(runtimeDir)).toEqual(['GameUserSettings.ini']);
      expect(fs.readFileSync(path.join(runtimeDir, 'GameUserSettings.ini'), 'utf8')).toBe('[ServerSettings]\nLive=1\n');
      expect(fs.existsSync(path.join(tmpDir, 'shared'))).toBe(false);
    });
  });
});
