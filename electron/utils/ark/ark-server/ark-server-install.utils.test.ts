
import * as installUtils from './ark-server-install.utils';
import * as fs from 'fs';
import { runInstaller } from '../../installer.utils';

jest.mock('fs');
jest.mock('../../installer.utils');

describe('ark-server-install.utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getArkServerDir', () => {
    it('should return a path string', () => {
      const dir = installUtils.getArkServerDir();
      expect(typeof dir).toBe('string');
      expect(dir).toContain('AASMServer');
    });
  });

  describe('isArkServerInstalled', () => {
    it('should return true if executable exists', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      expect(installUtils.isArkServerInstalled()).toBe(true);
    });
    it('should return false if executable does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      expect(installUtils.isArkServerInstalled()).toBe(false);
    });
  });

  describe('getCurrentInstalledVersion', () => {
    it('should return version from version.txt', async () => {
      (fs.existsSync as jest.Mock).mockImplementation((file) => file.includes('version.txt'));
      (fs.readFileSync as jest.Mock).mockReturnValue('1.2.3');
      const version = await installUtils.getCurrentInstalledVersion();
      expect(version).toBe('1.2.3');
    });
    it('should return buildid from manifest if version.txt missing', async () => {
      // Simulate version.txt missing, steamapps and manifest present
      (fs.existsSync as jest.Mock).mockImplementation((file) => {
        if (typeof file === 'string') {
          if (file.endsWith('version.txt')) return false;
          if (file.endsWith('steamapps')) return true;
          if (file.includes('appmanifest')) return true;
        }
        return false;
      });
      (fs.readFileSync as jest.Mock).mockReturnValue('"buildid" "456789"');
      const version = await installUtils.getCurrentInstalledVersion();
      expect(version).toBe('456789');
    });
    it('should return null if no version found', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const version = await installUtils.getCurrentInstalledVersion();
      expect(version).toBeNull();
    });
    it('should handle errors gracefully', async () => {
      (fs.existsSync as jest.Mock).mockImplementation(() => { throw new Error('fail'); });
      const version = await installUtils.getCurrentInstalledVersion();
      expect(version).toBeNull();
    });
  });

  describe('installArkServer', () => {
    it('should call runInstaller with correct options', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      const callback = jest.fn();
      installUtils.installArkServer(callback);
      expect(runInstaller).toHaveBeenCalled();
    });
    it('should call callback with error if SteamCMD missing', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const callback = jest.fn();
      installUtils.installArkServer(callback);
      expect(callback).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('pollArkServerUpdates', () => {
    it('should return null if getLatestServerVersion returns null', async () => {
      // Patch getLatestServerVersion to return null
      const orig = (installUtils as any).getLatestServerVersion;
      (installUtils as any).getLatestServerVersion = async () => null;
      const result = await installUtils.pollArkServerUpdates();
      expect(result).toBeNull();
      (installUtils as any).getLatestServerVersion = orig;
    });
  });
});
