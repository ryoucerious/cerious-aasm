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
