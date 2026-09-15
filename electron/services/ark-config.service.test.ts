jest.mock('node-pty', () => ({
  spawn: jest.fn(),
}));

import { ArkConfigService } from './ark-config.service';
import * as fs from 'fs';

jest.spyOn(fs, 'copyFileSync').mockImplementation(() => {});
import * as path from 'path';
import { ArkPathUtils } from '../utils/ark.utils';

jest.mock('fs');
jest.mock('path');
jest.mock('../utils/ark.utils');

describe('ArkConfigService', () => {
  let service: ArkConfigService;
  beforeEach(() => {
    service = new ArkConfigService();
    jest.clearAllMocks();
  });

  it('getArkLaunchParameters returns array from config', () => {
    const config = { launchParameters: '--foo --bar' };
    expect(service.getArkLaunchParameters(config)).toEqual(['--foo', '--bar']);
  });

  it('getArkLaunchParameters returns empty array if not set', () => {
    expect(service.getArkLaunchParameters({})).toEqual([]);
  });

  it('getArkMapName returns mapName from config', () => {
    expect(service.getArkMapName({ mapName: 'TestMap' })).toBe('TestMap');
  });

  it('getArkMapName returns default if not set', () => {
    expect(service.getArkMapName({})).toBe('TheIsland_WP');
  });

  // bDisableStructurePlacementCollision is read from Game.ini [/script/shootergame.shootergamemode].
  // It used to be written to GameUserSettings.ini [ServerSettings], where ARK ignores it —
  // and because the key is app-managed, a hand-edited Game.ini entry was stripped on launch.
  it('writeArkConfigFiles writes bDisableStructurePlacementCollision to Game.ini', () => {
    const writes: { [filePath: string]: string } = {};
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    jest.spyOn(fs, 'writeFileSync').mockImplementation(((filePath: any, content: any) => {
      writes[String(filePath)] = String(content);
    }) as any);
    jest.spyOn(fs, 'copyFileSync').mockImplementation(() => {});
    (ArkPathUtils.getArkServerDir as jest.Mock).mockReturnValue('ARK_SERVER_DIR');
    (path.join as jest.Mock).mockImplementation((...args) => args.join('/'));

    // sessionName forces GameUserSettings.ini to be written too, so the negative
    // assertion below is checked against real content rather than an absent file.
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
      jest.spyOn(fs, 'copyFileSync').mockImplementation(() => {});
      (ArkPathUtils.getArkServerDir as jest.Mock).mockReturnValue('ARK_SERVER_DIR');
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
        // still needed so Game.ini is written and the negative assertions are meaningful
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
  });

  it('writeArkConfigFiles writes files and copies them', () => {
    // Simulate that source files exist so copyFileSync is called for both
    (fs.existsSync as jest.Mock).mockImplementation((filePath) => {
      if (filePath.includes('Config/WindowsServer/GameUserSettings.ini') || filePath.includes('Config/WindowsServer/Game.ini')) {
        return true;
      }
      return false;
    });
    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    jest.spyOn(fs, 'copyFileSync').mockImplementation(() => {});
    (ArkPathUtils.getArkServerDir as jest.Mock).mockReturnValue('ARK_SERVER_DIR');
    (path.join as jest.Mock).mockImplementation((...args) => args.join('/'));
    // Provide a config that triggers copying
    const configWithCopy = { altSaveDirectoryName: 'AltDir', modSettings: { '123': { foo: 'bar' } }, copyFiles: true };
    expect(() => service.writeArkConfigFiles('INSTANCE_DIR', configWithCopy)).not.toThrow();
    expect(fs.mkdirSync).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(fs.copyFileSync).toHaveBeenCalled();
  });
});
