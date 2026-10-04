import { ArkConfigService } from './ark-config.service';
import * as fs from 'fs';
import * as path from 'path';
import { getArkServerDir, getInstanceConfigDir, isInstanceIsolated } from '../utils/ark/ark-server/ark-server-paths.utils';

jest.mock('fs');
jest.mock('path');
// An unresolvable instance falls back to the shared install's config dir.
jest.mock('../utils/ark/ark-server/ark-server-paths.utils', () => ({
  getArkServerDir: jest.fn(),
  getInstanceConfigDir: jest.fn(() => { throw new Error('Invalid instance ID format'); }),
  isInstanceIsolated: jest.fn(() => false)
}));
jest.mock('../utils/ark/instance.utils', () => ({
  getInstanceDir: jest.fn((id: string) => `/servers/${id}`)
}));

describe('ArkConfigService', () => {
  let service: ArkConfigService;
  beforeEach(() => {
    service = new ArkConfigService();
    jest.clearAllMocks();
  });

  // bDisableStructurePlacementCollision is read from Game.ini [/script/shootergame.shootergamemode].
  // It used to be written to GameUserSettings.ini [ServerSettings], where ARK ignores it, and
  // because the key is app-managed, a hand-edited Game.ini entry was stripped on launch.
  it('writeArkConfigFiles writes bDisableStructurePlacementCollision to Game.ini', () => {
    const writes: { [filePath: string]: string } = {};
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    jest.spyOn(fs, 'writeFileSync').mockImplementation(((filePath: any, content: any) => {
      writes[String(filePath)] = String(content);
    }) as any);
    (getArkServerDir as jest.Mock).mockReturnValue('ARK_SERVER_DIR');
    (path.join as jest.Mock).mockImplementation((...args) => args.join('/'));

    // sessionName gives GameUserSettings.ini content, so the negative assertion below is checked
    // against a real file rather than an empty one.
    service.writeArkConfigFiles('INSTANCE_DIR', { bDisableStructurePlacementCollision: true, sessionName: 'Test' });

    const gameIni = writes['INSTANCE_DIR/Config/WindowsServer/Game.ini'] || '';
    const gameUserSettings = writes['INSTANCE_DIR/Config/WindowsServer/GameUserSettings.ini'] || '';

    expect(gameIni).toContain('[/script/shootergame.shootergamemode]');
    expect(gameIni).toContain('bDisableStructurePlacementCollision=true');
    expect(gameUserSettings).not.toContain('bDisableStructurePlacementCollision');
  });

  describe('INI key placement', () => {
    let writes: { [filePath: string]: string };
    let existing: { [filePath: string]: string };

    beforeEach(() => {
      writes = {};
      existing = {};
      (fs.existsSync as jest.Mock).mockImplementation((p: any) => String(p) in existing);
      (fs.readFileSync as jest.Mock).mockImplementation((p: any) => existing[String(p)]);
      jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
      jest.spyOn(fs, 'writeFileSync').mockImplementation(((filePath: any, content: any) => {
        writes[String(filePath)] = String(content);
      }) as any);
      (getArkServerDir as jest.Mock).mockReturnValue('ARK_SERVER_DIR');
      (path.join as jest.Mock).mockImplementation((...args) => args.join('/'));
    });

    const GUS = 'INSTANCE_DIR/Config/WindowsServer/GameUserSettings.ini';
    const GAME = 'INSTANCE_DIR/Config/WindowsServer/Game.ini';

    // These are ShooterGameMode properties. Written to GameUserSettings.ini [ServerSettings]
    // ARK silently ignored them, which is why crop growth never changed for users.
    it('writes crop, harvest-damage and breeding-adjacent rates to Game.ini, not GameUserSettings.ini', () => {
      service.writeArkConfigFiles('INSTANCE_DIR', {
        sessionName: 'Test',
        cropGrowthSpeedMultiplier: 5,
        cropDecaySpeedMultiplier: 0.5,
        dinoHarvestingDamageMultiplier: 2,
        playerHarvestingDamageMultiplier: 3,
        tamedDinoCharacterFoodDrainMultiplier: 4,
        tamedDinoTorporDrainMultiplier: 6,
        customRecipeEffectivenessMultiplier: 7,
        allowCustomRecipes: true,
        bShowCreativeMode: true,
        bUseSingleplayerSettings: true,
        bPvEDisableFriendlyFire: true,
      });

      const gameIni = writes[GAME] || '';
      const gus = writes[GUS] || '';
      for (const line of [
        'CropGrowthSpeedMultiplier=5', 'CropDecaySpeedMultiplier=0.5',
        'DinoHarvestingDamageMultiplier=2', 'PlayerHarvestingDamageMultiplier=3',
        'TamedDinoCharacterFoodDrainMultiplier=4', 'TamedDinoTorporDrainMultiplier=6',
        'CustomRecipeEffectivenessMultiplier=7', 'bAllowCustomRecipes=true',
        'bShowCreativeMode=true', 'bUseSingleplayerSettings=true', 'bPvEDisableFriendlyFire=true',
      ]) {
        expect(gameIni).toContain(line);
        expect(gus).not.toContain(line.split('=')[0]);
      }
      // All of them belong to the single ShooterGameMode section
      expect(gameIni.indexOf('[/script/shootergame.shootergamemode]')).toBe(0);
      expect(gameIni.match(/^\[/gm)).toHaveLength(1);
    });

    it('writes [ServerSettings] keys that were misfiled in Game.ini to GameUserSettings.ini', () => {
      service.writeArkConfigFiles('INSTANCE_DIR', {
        sessionName: 'Test',
        serverPVE: true,
        serverHardcore: true,
        globalVoiceChat: false,
        maxTamedDinos: 5000,
        preventDownloadDinos: true,
        crossArkAllowForeignDinoDownloads: true,
        preventMateBoost: true,
        allowFlyerCarryPvE: true,
        // Gives Game.ini content, so the negative assertions below mean something.
        eggHatchSpeedMultiplier: 2,
      });

      const gus = writes[GUS] || '';
      const gameIni = writes[GAME] || '';
      for (const line of [
        'ServerPVE=true', 'ServerHardcore=true', 'GlobalVoiceChat=false', 'MaxTamedDinos=5000',
        'PreventDownloadDinos=true', 'CrossARKAllowForeignDinoDownloads=true', 'PreventMateBoost=true',
        'AllowFlyerCarryPvE=true',
      ]) {
        expect(gus).toContain(line);
        expect(gameIni.toLowerCase()).not.toContain(line.split('=')[0].toLowerCase());
      }
      expect(gameIni).toContain('EggHatchSpeedMultiplier=2');
    });

    it('uses the ARK spelling for damage/resistance, decay, fog, prevention-volume and structure-range keys', () => {
      service.writeArkConfigFiles('INSTANCE_DIR', {
        playerCharacterDamageMultiplier: 1.5,
        playerCharacterResistanceMultiplier: 0.5,
        dinoCharacterDamageMultiplier: 2,
        dinoCharacterResistanceMultiplier: 0.25,
        bDisableStructureDecayPvE: true,
        bDisableWeatherFog: true,
        bEnableExtraStructurePreventionVolumes: true,
        maxStructuresInRange: 12000,
      });

      const gus = writes[GUS] || '';
      expect(gus).toContain('PlayerDamageMultiplier=1.5');
      expect(gus).toContain('PlayerResistanceMultiplier=0.5');
      expect(gus).toContain('DinoDamageMultiplier=2');
      expect(gus).toContain('DinoResistanceMultiplier=0.25');
      expect(gus).toContain('DisableStructureDecayPvE=true');
      expect(gus).toContain('DisableWeatherFog=true');
      expect(gus).toContain('EnableExtraStructurePreventionVolumes=true');
      expect(gus).toContain('TheMaxStructuresInRange=12000');
      // The old, ignored spellings must be gone
      expect(gus).not.toContain('PlayerCharacterDamageMultiplier');
      expect(gus).not.toContain('DinoCharacterResistanceMultiplier');
      expect(gus).not.toContain('bDisableWeatherFog');
      expect(gus).not.toMatch(/^MaxStructuresInRange=/m);
    });

    it('drops stale lines written by earlier versions instead of preserving them as custom', () => {
      existing[GUS] = [
        '[ServerSettings]',
        'PlayerCharacterDamageMultiplier=9',
        'CropGrowthSpeedMultiplier=9',
        'bPvE=true',
        'MyCustomKey=keepme',
        '',
      ].join('\n');

      service.writeArkConfigFiles('INSTANCE_DIR', { playerCharacterDamageMultiplier: 2, cropGrowthSpeedMultiplier: 3 });

      const gus = writes[GUS] || '';
      expect(gus).toContain('PlayerDamageMultiplier=2');
      expect(gus).toContain('MyCustomKey=keepme');
      expect(gus).not.toContain('PlayerCharacterDamageMultiplier');
      expect(gus).not.toContain('CropGrowthSpeedMultiplier');
      expect(gus).not.toContain('bPvE=');
      expect(writes[GAME]).toContain('CropGrowthSpeedMultiplier=3');
    });

    it('maps the bPvE toggle to a single ServerPVE=True line', () => {
      service.writeArkConfigFiles('INSTANCE_DIR', { bPvE: true });
      expect(writes[GUS]).toContain('ServerPVE=True');
      expect(writes[GUS]).not.toContain('bPvE');

      writes = {};
      service.writeArkConfigFiles('INSTANCE_DIR', { bPvE: true, serverPVE: false });
      expect(writes[GUS].match(/^ServerPVE=/gim)).toHaveLength(1);
      expect(writes[GUS]).toContain('ServerPVE=True');

      writes = {};
      service.writeArkConfigFiles('INSTANCE_DIR', { bPvE: true, serverPVE: true });
      expect(writes[GUS].match(/^ServerPVE=/gim)).toHaveLength(1);
    });

    it('keeps custom lines from the instance copy and its own copy ARK reads, once each', () => {
      jest.mocked(getInstanceConfigDir).mockReturnValueOnce('RUNTIME');
      jest.mocked(isInstanceIsolated).mockReturnValueOnce(true);
      existing[GUS] = '[ServerSettings]\nMyKey=1\n[Custom]\nA=1\n';
      existing['RUNTIME/GameUserSettings.ini'] = '[ServerSettings]\nmykey=1\nEditedInPlace=2\n[Custom]\nB=2\n[Other]\nC=3\n';

      service.writeArkConfigFiles('INSTANCE_DIR', { sessionName: 'Test', xpMultiplier: 2 }, 'a1');

      expect(getInstanceConfigDir).toHaveBeenCalledWith('a1');
      expect(writes[GUS]).toBe([
        '[ServerSettings]', 'XPMultiplier=2', 'MyKey=1', 'EditedInPlace=2', '',
        '[SessionSettings]', 'SessionName=Test', '',
        '[Custom]', 'A=1', 'B=2', '',
        '[Other]', 'C=3', '', ''
      ].join('\n'));
      expect(writes['RUNTIME/GameUserSettings.ini']).toBe(writes[GUS]);
    });

    // Every instance on the shared install writes that copy, so its custom lines may be another
    // instance's; merging them leaked one server's settings into the next.
    it('keeps no custom lines from a copy ARK reads that the instance shares', () => {
      jest.mocked(getInstanceConfigDir).mockReturnValueOnce('SHARED');
      existing[GUS] = '[ServerSettings]\nMine=1\n';
      existing['SHARED/GameUserSettings.ini'] = '[ServerSettings]\nOtherServers=2\n';

      service.writeArkConfigFiles('INSTANCE_DIR', { sessionName: 'Test' }, 'a1');

      expect(isInstanceIsolated).toHaveBeenCalledWith('a1');
      expect(writes[GUS]).toBe('[SessionSettings]\nSessionName=Test\n\n[ServerSettings]\nMine=1\n\n');
      expect(writes['SHARED/GameUserSettings.ini']).toBe(writes[GUS]);
    });

    // ARK ends a line at a lone CR too, so a "custom" line could carry a managed key past the filter.
    it('treats a lone CR in an existing file as a line break', () => {
      existing[GUS] = '[ServerSettings]\nMyKey=1\rServerAdminPassword=owned\n';

      service.writeArkConfigFiles('INSTANCE_DIR', { serverAdminPassword: 'real' }, 'bad id');

      expect(writes[GUS]).toBe('[ServerSettings]\nServerAdminPassword=real\nMyKey=1\n\n');
    });

    // Both files are rewritten, so one that could not be read must not be taken for an empty one.
    it('writes nothing when an existing file cannot be read', () => {
      (fs.readFileSync as jest.Mock).mockImplementation((p: any) => {
        if (String(p) === GUS) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
        return existing[String(p)];
      });

      expect(() => service.writeArkConfigFiles('INSTANCE_DIR', { sessionName: 'Test' }, 'bad id')).toThrow('EBUSY');
      expect(writes).toEqual({});
    });

    it('treats a file that does not exist as empty', () => {
      (fs.readFileSync as jest.Mock).mockImplementation((p: any) => {
        if (!(String(p) in existing)) throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
        return existing[String(p)];
      });

      service.writeArkConfigFiles('INSTANCE_DIR', { sessionName: 'Test' }, 'bad id');

      expect(writes[GUS]).toBe('[SessionSettings]\nSessionName=Test\n\n');
    });

    it('reads the custom lines of both copies for buildIniFiles, writing nothing', () => {
      jest.mocked(getInstanceConfigDir).mockReturnValueOnce('RUNTIME');
      jest.mocked(isInstanceIsolated).mockReturnValueOnce(true);
      existing[GAME] = '[/script/shootergame.shootergamemode]\nConfigOverrideItemMaxQuantity=(Quantity=500)\nEggHatchSpeedMultiplier=9\n';
      existing['RUNTIME/GameUserSettings.ini'] = '[ServerSettings]\nLive=1\n';
      const config = { eggHatchSpeedMultiplier: 2 };

      const files = service.buildIniFiles(config, service.readPreservedLines('INSTANCE_DIR', config, 'a1'));

      expect(getInstanceConfigDir).toHaveBeenCalledWith('a1');
      expect(files).toEqual({
        'GameUserSettings.ini': '[ServerSettings]\nLive=1\n\n',
        'Game.ini': '[/script/shootergame.shootergamemode]\nEggHatchSpeedMultiplier=2\nConfigOverrideItemMaxQuantity=(Quantity=500)\n\n'
      });
      expect(writes).toEqual({});
      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    it('reads no custom lines for buildIniFiles from a copy ARK reads that the instance shares', () => {
      jest.mocked(getInstanceConfigDir).mockReturnValueOnce('SHARED');
      existing['SHARED/GameUserSettings.ini'] = '[ServerSettings]\nOtherServers=2\n';

      const files = service.buildIniFiles({}, service.readPreservedLines('INSTANCE_DIR', {}, 'a1'));

      expect(files['GameUserSettings.ini']).toBe('');
    });

    it('writes a file that holds only custom lines', () => {
      existing[GAME] = '[/script/shootergame.shootergamemode]\nMyGameKey=1\n';

      service.writeArkConfigFiles('INSTANCE_DIR', {}, 'bad id');

      expect(writes[GAME]).toBe('[/script/shootergame.shootergamemode]\nMyGameKey=1\n\n');
    });

    // A file with nothing left to write used to be skipped, so the old file, setting and all,
    // went on being copied to the server.
    it('empties a file whose last setting was cleared', () => {
      const runtimeGame = 'ARK_SERVER_DIR/ShooterGame/Saved/Config/WindowsServer/Game.ini';
      existing[GAME] = '[/script/shootergame.shootergamemode]\nEggHatchSpeedMultiplier=3\n';
      existing[runtimeGame] = existing[GAME];

      service.writeArkConfigFiles('INSTANCE_DIR', { sessionName: 'Test' }, 'bad id');

      expect(writes[GAME]).toBe('');
      expect(writes[runtimeGame]).toBe('');
    });
  });

  it('writeArkConfigFiles writes both files to the instance and to the directory ARK reads', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    (getArkServerDir as jest.Mock).mockReturnValue('ARK_SERVER_DIR');
    (path.join as jest.Mock).mockImplementation((...args) => args.join('/'));

    service.writeArkConfigFiles('INSTANCE_DIR', { altSaveDirectoryName: 'AltDir', modSettings: { '123': { foo: 'bar' } } });

    expect(fs.mkdirSync).toHaveBeenCalledWith('INSTANCE_DIR/Config/WindowsServer', { recursive: true });
    expect(fs.mkdirSync).toHaveBeenCalledWith('ARK_SERVER_DIR/ShooterGame/Saved/Config/WindowsServer', { recursive: true });
    expect(jest.mocked(fs.writeFileSync).mock.calls.map(([file]) => file)).toEqual([
      'INSTANCE_DIR/Config/WindowsServer/GameUserSettings.ini',
      'INSTANCE_DIR/Config/WindowsServer/Game.ini',
      'ARK_SERVER_DIR/ShooterGame/Saved/Config/WindowsServer/GameUserSettings.ini',
      'ARK_SERVER_DIR/ShooterGame/Saved/Config/WindowsServer/Game.ini'
    ]);
  });

  it('writeArkConfigFiles reports and rethrows a write failure', () => {
    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => { throw new Error('EACCES'); });
    (path.join as jest.Mock).mockImplementation((...args) => args.join('/'));

    expect(() => service.writeArkConfigFiles('INSTANCE_DIR', { sessionName: 'Test' })).toThrow('EACCES');
    expect(console.error).toHaveBeenCalledWith('[ark-config] Failed to write the ARK config files:', expect.any(Error));
  });

  describe('buildIniFiles', () => {
    it('renders both files from the config alone, without touching any file', () => {
      const files = service.buildIniFiles({
        id: 'a1', sessionName: 'Test', xpMultiplier: 2, rconPort: 27020, cropGrowthSpeedMultiplier: 3,
        perLevelStatsMultiplier_Player: [2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5]
      });

      expect(files['GameUserSettings.ini']).toBe(
        '[ServerSettings]\nRCONPort=27020\nXPMultiplier=2\nRCONEnabled=True\n\n[SessionSettings]\nSessionName=Test\n\n'
      );
      expect(files['Game.ini']).toBe([
        '[/script/shootergame.shootergamemode]', 'CropGrowthSpeedMultiplier=3',
        'PerLevelStatsMultiplier_Player[0]=2', 'PerLevelStatsMultiplier_Player[11]=1.5', '', ''
      ].join('\n'));
      for (const touch of [fs.existsSync, fs.readFileSync, fs.writeFileSync, fs.mkdirSync]) {
        expect(touch).not.toHaveBeenCalled();
      }
    });

    it('returns an empty string for a file with nothing to write', () => {
      expect(service.buildIniFiles({ sessionName: 'Test' })['Game.ini']).toBe('');
    });

    it('writes each mod\'s settings to its own section, without the internal keys', () => {
      const gus = service.buildIniFiles({ modSettings: { '928': { _name: 'Mod', Rate: 5, Empty: '' }, '929': { _name: 'Only' } } })['GameUserSettings.ini'];

      expect(gus).toBe('[Mod_928]\nRate=5\n\n');
    });

    // A value with a line break would start a new key or section in the file ARK reads, so a
    // session name could set the admin password.
    it('strips CR and LF from every value it writes', () => {
      const files = service.buildIniFiles({
        sessionName: 'My Server\r\n[ServerSettings]\nServerAdminPassword=owned',
        perLevelStatsMultiplier_Player: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, '3\nRCONEnabled=False'],
        modSettings: { '928': { Rate: '5\r\n[ServerSettings]' } }
      });

      const gusLines = files['GameUserSettings.ini'].split('\n');
      expect(gusLines).toContain('SessionName=My Server[ServerSettings]ServerAdminPassword=owned');
      expect(gusLines).toContain('Rate=5[ServerSettings]');
      expect(gusLines).not.toContain('[ServerSettings]');
      expect(gusLines.some(line => line.startsWith('ServerAdminPassword='))).toBe(false);
      const gameLines = files['Game.ini'].split('\n');
      expect(gameLines).toContain('PerLevelStatsMultiplier_Player[11]=3RCONEnabled=False');
      expect(gameLines.some(line => line.startsWith('RCONEnabled'))).toBe(false);
    });

    // UE stops reading a line at a NUL; no control character belongs in a value.
    it('strips every control character from the values it writes', () => {
      const gus = service.buildIniFiles({
        sessionName: 'My\u0000Server\tOne\u001f\u007f',
        modSettings: { '928': { Rate: '5\u0000' } }
      })['GameUserSettings.ini'];

      expect(gus.split('\n')).toEqual(expect.arrayContaining(['SessionName=MyServerOne', 'Rate=5']));
    });

    it('skips mod setting keys with control characters in them', () => {
      const gus = service.buildIniFiles({ modSettings: { '928': { 'Bad\u0000Key': 1, 'Tab\tKey': 2, 'Bell\u0007': 3, Good: 4 } } })['GameUserSettings.ini'];

      expect(gus).toBe('[Mod_928]\nGood=4\n\n');
    });

    it('skips mod settings whose section name or key would not stay on one INI line', () => {
      const gus = service.buildIniFiles({
        modSettings: {
          '928': { Good: 1, 'Bad\nKey': 2, 'A=B': 3, '[Section]': 4, ';Comment': 5, ' ': 6 },
          '929]\n[ServerSettings': { ServerAdminPassword: 'owned' }
        }
      })['GameUserSettings.ini'];

      expect(gus).toBe('[Mod_928]\nGood=1\n\n');
      expect(console.warn).toHaveBeenCalled();
    });
  });

  describe('parseIniToConfig', () => {
    it('maps the keys ARK reads from that file back to config properties', () => {
      const config = service.parseIniToConfig('GameUserSettings.ini', [
        '[ServerSettings]', 'XPMultiplier=2.5', 'ServerPVE=True', 'CropGrowthSpeedMultiplier=4', '',
        '[SessionSettings]', 'SessionName=My Server'
      ].join('\r\n'));

      // CropGrowthSpeedMultiplier belongs to Game.ini, so it is not read from here.
      expect(config).toEqual({ xpMultiplier: 2.5, serverPVE: true, sessionName: 'My Server' });
    });

    it('fills stat arrays to twelve entries, ignoring indices and values that cannot be used', () => {
      const config = service.parseIniToConfig('Game.ini', [
        '[/script/shootergame.shootergamemode]',
        'PerLevelStatsMultiplier_Player[0]=2', 'PerLevelStatsMultiplier_Player[3]=0',
        'PerLevelStatsMultiplier_Player[12]=9', 'PerLevelStatsMultiplier_Player[4]=fast'
      ].join('\n'));

      expect(config.perLevelStatsMultiplier_Player).toEqual([2, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1]);
    });

    it('reads the settings toggle the UI shows for a key mapped twice', () => {
      const config = service.parseIniToConfig('GameUserSettings.ini', '[ServerSettings]\nEnableExtraStructurePreventionVolumes=True');

      expect(config).toEqual({ bEnableExtraStructurePreventionVolumes: true });
    });
  });

  describe('readIniSettings', () => {
    it('reads keys from any file when no file is named, and reports the rest', () => {
      const { config, unmapped } = service.readIniSettings([
        '[ServerSettings]', 'XPMultiplier=2', 'CropGrowthSpeedMultiplier=3', 'Mystery=1',
        '[Mod_928]', 'Rate=5'
      ].join('\n'));

      expect(config).toEqual({ xpMultiplier: 2, cropGrowthSpeedMultiplier: 3 });
      expect(unmapped).toEqual(['ServerSettings: Mystery', 'Mod_928: Rate']);
    });

    it('reads the spellings earlier versions wrote, unless the current spelling is also there', () => {
      expect(service.readIniSettings('[ServerSettings]\nPlayerCharacterDamageMultiplier=2\nbPvE=True').config)
        .toEqual({ playerCharacterDamageMultiplier: 2, bPvE: true });
      expect(service.readIniSettings('[ServerSettings]\nPlayerDamageMultiplier=3\nPlayerCharacterDamageMultiplier=2').config)
        .toEqual({ playerCharacterDamageMultiplier: 3 });
    });

    it('takes extra key mappings from the caller', () => {
      const { config, unmapped } = service.readIniSettings('[ServerSettings]\nMaxPlayers=40', { extraKeys: { maxplayers: 'maxPlayers' } });

      expect(config).toEqual({ maxPlayers: 40 });
      expect(unmapped).toEqual([]);
    });
  });

  describe('raw INI files', () => {
    beforeEach(() => {
      (path.join as jest.Mock).mockImplementation((...args) => args.join('/'));
      jest.mocked(fs.mkdirSync).mockImplementation(() => undefined);
      jest.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    });

    // Otherwise an edited custom line comes back with its old value from the copy ARK reads at the
    // next start, which merges both copies.
    it('saves an edited file to the copy ARK reads too, when that copy is the instance\'s own', () => {
      jest.mocked(getInstanceConfigDir).mockReturnValueOnce('/servers/a1/ShooterGame/Saved/Config/WindowsServer');
      jest.mocked(isInstanceIsolated).mockReturnValueOnce(true);

      service.writeIniFile('a1', 'Game.ini', '[Custom]\nA=2\n');

      expect(jest.mocked(fs.writeFileSync).mock.calls).toEqual([
        ['/servers/a1/Config/WindowsServer/Game.ini', '[Custom]\nA=2\n', 'utf8'],
        ['/servers/a1/ShooterGame/Saved/Config/WindowsServer/Game.ini', '[Custom]\nA=2\n', 'utf8']
      ]);
    });

    it('leaves a copy ARK reads that the instance shares alone', () => {
      jest.mocked(getInstanceConfigDir).mockReturnValueOnce('SHARED');

      service.writeIniFile('a1', 'Game.ini', '[Custom]\nA=2\n');

      expect(jest.mocked(fs.writeFileSync).mock.calls).toEqual([
        ['/servers/a1/Config/WindowsServer/Game.ini', '[Custom]\nA=2\n', 'utf8']
      ]);
    });

    it('reads a file from the instance config directory', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('[ServerSettings]\n');
      (path.join as jest.Mock).mockImplementation((...args) => args.join('/'));

      expect(service.readIniFile('a1', 'Game.ini')).toBe('[ServerSettings]\n');
      expect(fs.readFileSync).toHaveBeenCalledWith('/servers/a1/Config/WindowsServer/Game.ini', 'utf8');
    });

    it.each([
      ['an invalid instance id', '../a1', 'Game.ini', 'Invalid instance ID'],
      ['a path for a filename', 'a1', '../config.json', 'Invalid filename'],
      ['a file that is not an INI', 'a1', 'config.json', 'Invalid filename']
    ])('refuses to write %s', (_label, id, filename, error) => {
      expect(() => service.writeIniFile(id, filename, 'x')).toThrow(error);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });
});
