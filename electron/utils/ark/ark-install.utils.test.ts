/// <reference types="jest" />
import * as fs from 'fs';
import * as path from 'path';
import { ArkPathUtils, ARK_APP_ID } from './ark-path.utils';
import * as steamcmdUtils from '../steamcmd.utils';
import * as installerUtils from '../installer.utils';
import {
  getArkServerDir,
  isArkServerInstalled,
  getCurrentInstalledVersion,
  installArkServer
} from './ark-install.utils';

jest.mock('node-pty', () => ({
  spawn: jest.fn(),
}));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

jest.mock('path', () => ({
  ...jest.requireActual('path'),
  join: jest.fn((...args: string[]) => args.join('/')),
}));

const steamcmdExe = process.platform === 'win32' ? 'steamcmd.exe' : 'steamcmd.sh';

describe('ark-install.utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getArkServerDir', () => {
    it('should return server dir from ArkPathUtils', () => {
      jest.spyOn(ArkPathUtils, 'getArkServerDir').mockReturnValue('/ark/server');
      expect(getArkServerDir()).toBe('/ark/server');
    });
  });

  describe('isArkServerInstalled', () => {
    it('should return true if executable exists', () => {
      jest.spyOn(ArkPathUtils, 'getArkExecutablePath').mockReturnValue('/ark/server/ark.exe');
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      expect(isArkServerInstalled()).toBe(true);
    });
    it('should return false if executable does not exist', () => {
      jest.spyOn(ArkPathUtils, 'getArkExecutablePath').mockReturnValue('/ark/server/ark.exe');
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      expect(isArkServerInstalled()).toBe(false);
    });
  });

  describe('getCurrentInstalledVersion', () => {
    it('should return version from version.txt', async () => {
      jest.spyOn(ArkPathUtils, 'getArkServerDir').mockReturnValue('/ark/server');
      (fs.existsSync as jest.Mock).mockImplementation((file: string) => file === '/ark/server/version.txt');
      (fs.readFileSync as jest.Mock).mockReturnValue('1.2.3\n');
      await expect(getCurrentInstalledVersion()).resolves.toBe('1.2.3');
    });
    
    it('should return null if no version found', async () => {
      jest.spyOn(ArkPathUtils, 'getArkServerDir').mockReturnValue('/ark/server');
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      await expect(getCurrentInstalledVersion()).resolves.toBeNull();
    });
    it('should return null on error', async () => {
      jest.spyOn(ArkPathUtils, 'getArkServerDir').mockImplementation(() => { throw new Error('fail'); });
      await expect(getCurrentInstalledVersion()).resolves.toBeNull();
    });
  });

  describe('installArkServer', () => {
    it('should callback error if steamcmd not found', () => {
      jest.spyOn(steamcmdUtils, 'getSteamCmdDir').mockReturnValue('/steamcmd');
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const cb = jest.fn();
      installArkServer(cb);
      expect(cb).toHaveBeenCalledWith(expect.any(Error));
    });
    it('should call runInstaller with correct options if steamcmd exists', () => {
      jest.spyOn(steamcmdUtils, 'getSteamCmdDir').mockReturnValue('/steamcmd');
      (fs.existsSync as jest.Mock).mockImplementation((file: string) => file === `/steamcmd/${steamcmdExe}` || file === '/ark/server');
      jest.spyOn(installerUtils, 'runInstaller').mockImplementation((opts, onProgress, onDone) => {
        onProgress({ percent: 50, step: 'downloading', message: 'Mock progress' });
        onDone(null, 'done');
      });
      jest.spyOn(ArkPathUtils, 'getArkServerDir').mockReturnValue('/ark/server');
      const cb = jest.fn();
      const onData = jest.fn();
      installArkServer(cb, onData);
      expect(installerUtils.runInstaller).toHaveBeenCalled();
      expect(cb).toHaveBeenCalledWith(null, 'done');
  expect(onData).toHaveBeenCalledWith({ percent: 50, step: 'downloading', message: 'Mock progress' });
    });
  });
});
