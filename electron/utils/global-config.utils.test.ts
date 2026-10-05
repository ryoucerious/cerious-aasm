import * as fsUtils from './fs.utils';
import { loadGlobalConfig, saveGlobalConfig, GlobalConfig } from './global-config.utils';

jest.mock('fs');
jest.mock('path');
jest.mock('./platform.utils');

const mockedPath = require('path') as jest.Mocked<typeof import('path')>;
const mockedFs = require('fs') as jest.Mocked<typeof import('fs')>;
const { getDefaultInstallDir } = require('./platform.utils');

const mockDefaultInstallDir = '/mock/install/dir';
const mockConfigFile = '/mock/install/global-config.json';

const mockDefaultConfig: GlobalConfig = {
  startWebServerOnLoad: false,
  webServerPort: 3000,
  authenticationEnabled: false,
  authenticationUsername: '',
  authenticationPassword: '',
  maxBackupDownloadSizeMB: 100,
  serverDataDir: '',
  autoUpdateArkServer: false,
  updateWarningMinutes: 15,
  serverStartDelaySeconds: 60,
  curseForgeApiKey: '',
};

const mockCustomConfig: GlobalConfig = {
  startWebServerOnLoad: true,
  webServerPort: 8080,
  authenticationEnabled: true,
  authenticationUsername: 'admin',
  authenticationPassword: 'password123',
  maxBackupDownloadSizeMB: 200,
  serverDataDir: '',
  autoUpdateArkServer: false,
  updateWarningMinutes: 15,
  serverStartDelaySeconds: 60,
  curseForgeApiKey: '',
};

function errnoError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

function fileIsMissing() {
  mockedFs.readFileSync.mockImplementation(() => { throw errnoError('ENOENT'); });
}

describe('global-config.utils', () => {
  let writeJsonAtomic: jest.SpyInstance;

  beforeEach(() => {
    (getDefaultInstallDir as jest.Mock).mockReturnValue(mockDefaultInstallDir);
    mockedPath.join.mockImplementation((...args) => {
      if (args.length === 2 && args[0] === mockDefaultInstallDir && args[1] === 'global-config.json') {
        return mockConfigFile;
      }
      return args.join('/');
    });
    mockedPath.dirname.mockImplementation((filePath) => {
      if (filePath === mockConfigFile) {
        return '/mock/install';
      }
      return '/default/dir';
    });

    mockedFs.writeFileSync.mockImplementation(() => undefined);
    mockedFs.mkdirSync.mockImplementation(() => undefined);
    mockedFs.renameSync.mockImplementation(() => undefined);
    mockedFs.readFileSync.mockImplementation(() => '{}');
    writeJsonAtomic = jest.spyOn(fsUtils, 'writeJsonAtomic');
  });

  describe('loadGlobalConfig', () => {
    it('should load config from existing file and merge with defaults', () => {
      mockedFs.readFileSync.mockReturnValue(JSON.stringify({
        startWebServerOnLoad: true,
        webServerPort: 8080
      }));

      const result = loadGlobalConfig();

      expect(mockedFs.readFileSync).toHaveBeenCalledWith(mockConfigFile, 'utf8');
      expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
      expect(result).toEqual({
        ...mockDefaultConfig,
        startWebServerOnLoad: true,
        webServerPort: 8080
      });
    });

    it('should create default config file when it does not exist', () => {
      fileIsMissing();

      const result = loadGlobalConfig();

      expect(mockedFs.mkdirSync).toHaveBeenCalledWith('/mock/install', { recursive: true });
      expect(writeJsonAtomic).toHaveBeenCalledWith(mockConfigFile, mockDefaultConfig);
      expect(mockedFs.renameSync).not.toHaveBeenCalledWith(mockConfigFile, expect.stringContaining('.corrupt-'));
      expect(result).toEqual(mockDefaultConfig);
    });

    it('moves a corrupt file aside before writing defaults, and logs where it went', () => {
      jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
      mockedFs.readFileSync.mockReturnValue('{"webServerPort": 80');
      const quarantined = `${mockConfigFile}.corrupt-1700000000000`;

      const result = loadGlobalConfig();

      expect(result).toEqual(mockDefaultConfig);
      expect(mockedFs.renameSync).toHaveBeenNthCalledWith(1, mockConfigFile, quarantined);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining(quarantined));
      expect(writeJsonAtomic).toHaveBeenCalledWith(mockConfigFile, mockDefaultConfig);
      expect(mockedFs.renameSync.mock.invocationCallOrder[0]).toBeLessThan(writeJsonAtomic.mock.invocationCallOrder[0]);
    });

    it('returns defaults without overwriting a file it cannot read', () => {
      mockedFs.readFileSync.mockImplementation(() => {
        throw errnoError('EACCES');
      });

      const result = loadGlobalConfig();

      expect(result).toEqual(mockDefaultConfig);
      expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
      expect(mockedFs.renameSync).not.toHaveBeenCalled();
    });

    it('logs an unreadable file once per distinct error, not on every load', () => {
      loadGlobalConfig();
      mockedFs.readFileSync.mockImplementation(() => { throw errnoError('EACCES'); });

      loadGlobalConfig();
      loadGlobalConfig();
      expect(console.error).toHaveBeenCalledTimes(1);

      mockedFs.readFileSync.mockImplementation(() => { throw errnoError('EBUSY'); });
      loadGlobalConfig();
      expect(console.error).toHaveBeenCalledTimes(2);
    });

    it('logs the same failure again after a successful load', () => {
      mockedFs.readFileSync.mockImplementation(() => { throw errnoError('EPERM'); });
      loadGlobalConfig();
      mockedFs.readFileSync.mockReturnValue('{}');
      loadGlobalConfig();
      mockedFs.readFileSync.mockImplementation(() => { throw errnoError('EPERM'); });
      loadGlobalConfig();

      expect(console.error).toHaveBeenCalledTimes(2);
    });

    it('should return default config when directory creation fails during initial setup', () => {
      fileIsMissing();
      mockedFs.mkdirSync.mockImplementation(() => {
        throw new Error('Mkdir error');
      });

      expect(loadGlobalConfig()).toEqual(mockDefaultConfig);
    });

    it('should return default config when file write fails during initial setup', () => {
      fileIsMissing();
      mockedFs.writeFileSync.mockImplementation(() => {
        throw new Error('Write error');
      });

      expect(loadGlobalConfig()).toEqual(mockDefaultConfig);
    });

    it('should handle empty config file', () => {
      mockedFs.readFileSync.mockReturnValue('');

      expect(loadGlobalConfig()).toEqual(mockDefaultConfig);
    });

    it('should handle config file with partial overrides', () => {
      mockedFs.readFileSync.mockReturnValue(JSON.stringify({
        authenticationEnabled: true,
        authenticationUsername: 'testuser'
      }));

      expect(loadGlobalConfig()).toEqual({
        ...mockDefaultConfig,
        authenticationEnabled: true,
        authenticationUsername: 'testuser'
      });
    });
  });

  describe('saveGlobalConfig', () => {
    it('should save config atomically and return true', () => {
      const configToSave = { ...mockDefaultConfig };

      const result = saveGlobalConfig(configToSave);

      expect(mockedFs.mkdirSync).toHaveBeenCalledWith('/mock/install', { recursive: true });
      expect(writeJsonAtomic).toHaveBeenCalledWith(mockConfigFile, configToSave);
      expect(mockedFs.writeFileSync).not.toHaveBeenCalledWith(mockConfigFile, expect.anything(), expect.anything());
      expect(result).toBe(true);
    });

    it('should return false when directory creation fails', () => {
      mockedFs.mkdirSync.mockImplementation(() => {
        throw new Error('Mkdir error');
      });

      expect(saveGlobalConfig(mockCustomConfig)).toBe(false);
    });

    it('should return false when file write fails', () => {
      mockedFs.writeFileSync.mockImplementation(() => {
        throw new Error('Write error');
      });

      expect(saveGlobalConfig(mockCustomConfig)).toBe(false);
    });

    it('should handle saving empty config object', () => {
      const emptyConfig = {} as GlobalConfig;

      expect(saveGlobalConfig(emptyConfig)).toBe(true);
      expect(writeJsonAtomic).toHaveBeenCalledWith(mockConfigFile, emptyConfig);
    });

    it('should handle saving config with special characters', () => {
      const configWithSpecialChars = {
        ...mockDefaultConfig,
        authenticationUsername: 'user@domain.com',
        authenticationPassword: 'pass!@#$%^&*()'
      };

      expect(saveGlobalConfig(configWithSpecialChars)).toBe(true);
      expect(writeJsonAtomic).toHaveBeenCalledWith(mockConfigFile, configWithSpecialChars);
    });
  });

  describe('integration scenarios', () => {
    it('should handle round-trip save and load', () => {
      const configToSave = { ...mockCustomConfig };

      expect(saveGlobalConfig(configToSave)).toBe(true);

      mockedFs.readFileSync.mockReturnValue(JSON.stringify(configToSave));

      expect(loadGlobalConfig()).toEqual({
        ...mockDefaultConfig,
        ...configToSave
      });
    });

    it('should handle config file in different directory', () => {
      const differentDir = '/different/path';
      const differentConfigFile = '/different/path/global-config.json';

      (getDefaultInstallDir as jest.Mock).mockReturnValue(differentDir);
      mockedPath.join.mockImplementation((...args) => {
        if (args[0] === differentDir && args[1] === 'global-config.json') {
          return differentConfigFile;
        }
        return args.join('/');
      });
      mockedPath.dirname.mockReturnValue('/different');
      fileIsMissing();

      const result = loadGlobalConfig();

      expect(mockedFs.mkdirSync).toHaveBeenCalledWith('/different', { recursive: true });
      expect(writeJsonAtomic).toHaveBeenCalledWith(differentConfigFile, mockDefaultConfig);
      expect(result).toEqual(mockDefaultConfig);
    });
  });
});
