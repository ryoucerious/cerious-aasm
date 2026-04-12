/**
 * Tests for the ark.utils barrel re-export module.
 * Verifies that all sub-module exports are correctly re-exported.
 */

// Mock dependencies used by sub-modules so they can be imported without side effects
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
  unlinkSync: jest.fn(),
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    readdir: jest.fn(),
    stat: jest.fn(),
    lstat: jest.fn(),
  },
}));

jest.mock('child_process', () => ({
  spawn: jest.fn(),
  execSync: jest.fn(),
}));

jest.mock('../platform.utils', () => ({
  getPlatform: jest.fn().mockReturnValue('windows'),
  getDefaultInstallDir: jest.fn().mockReturnValue('/mock/install'),
}));

jest.mock('../proton.utils', () => ({
  getProtonBinaryPath: jest.fn().mockReturnValue('/mock/proton'),
  isProtonInstalled: jest.fn().mockReturnValue(false),
  ensureProtonPrefixExists: jest.fn(),
}));

jest.mock('../steamcmd.utils', () => ({
  getSteamCmdDir: jest.fn().mockReturnValue('/mock/steamcmd'),
}));

jest.mock('../installer.utils', () => ({
  runInstaller: jest.fn(),
}));

jest.mock('../global-config.utils', () => ({
  loadGlobalConfig: jest.fn().mockReturnValue({}),
}));

import * as arkUtils from '../ark.utils';

describe('ark.utils barrel re-exports', () => {
  describe('from ark-path.utils', () => {
    it('should export ArkPathUtils class', () => {
      expect(arkUtils.ArkPathUtils).toBeDefined();
      expect(typeof arkUtils.ArkPathUtils).toBe('function');
    });

    it('should export ARK_APP_ID constant', () => {
      expect(arkUtils.ARK_APP_ID).toBeDefined();
      expect(typeof arkUtils.ARK_APP_ID).toBe('string');
    });

    it('should export POLL_INTERVAL_MS constant', () => {
      expect(arkUtils.POLL_INTERVAL_MS).toBeDefined();
      expect(typeof arkUtils.POLL_INTERVAL_MS).toBe('number');
    });
  });

  describe('from ark-command.utils', () => {
    it('should export ArkCommandUtils class', () => {
      expect(arkUtils.ArkCommandUtils).toBeDefined();
      expect(typeof arkUtils.ArkCommandUtils).toBe('function');
    });
  });

  describe('from ark-log.utils', () => {
    it('should export ArkLogUtils class', () => {
      expect(arkUtils.ArkLogUtils).toBeDefined();
      expect(typeof arkUtils.ArkLogUtils).toBe('function');
    });
  });

  describe('from ark-args.utils', () => {
    it('should export buildArkServerArgs function', () => {
      expect(arkUtils.buildArkServerArgs).toBeDefined();
      expect(typeof arkUtils.buildArkServerArgs).toBe('function');
    });

    it('should export getArkMapName function', () => {
      expect(arkUtils.getArkMapName).toBeDefined();
      expect(typeof arkUtils.getArkMapName).toBe('function');
    });

    it('should export getArkLaunchParameters function', () => {
      expect(arkUtils.getArkLaunchParameters).toBeDefined();
      expect(typeof arkUtils.getArkLaunchParameters).toBe('function');
    });
  });

  describe('from ark-install.utils', () => {
    it('should export getArkServerDir function', () => {
      expect(arkUtils.getArkServerDir).toBeDefined();
      expect(typeof arkUtils.getArkServerDir).toBe('function');
    });

    it('should export isArkServerInstalled function', () => {
      expect(arkUtils.isArkServerInstalled).toBeDefined();
      expect(typeof arkUtils.isArkServerInstalled).toBe('function');
    });

    it('should export getCurrentInstalledVersion function', () => {
      expect(arkUtils.getCurrentInstalledVersion).toBeDefined();
      expect(typeof arkUtils.getCurrentInstalledVersion).toBe('function');
    });

    it('should export installArkServer function', () => {
      expect(arkUtils.installArkServer).toBeDefined();
      expect(typeof arkUtils.installArkServer).toBe('function');
    });
  });

  describe('re-exported functions are callable', () => {
    it('ArkPathUtils.getArkServerDir returns a string', () => {
      const result = arkUtils.ArkPathUtils.getArkServerDir();
      expect(typeof result).toBe('string');
    });

    it('ArkPathUtils.getArkExecutablePath returns a string', () => {
      const result = arkUtils.ArkPathUtils.getArkExecutablePath();
      expect(typeof result).toBe('string');
    });

    it('buildArkServerArgs returns an array', () => {
      const result = arkUtils.buildArkServerArgs({ map: 'TheIsland' });
      expect(Array.isArray(result)).toBe(true);
    });

    it('getArkMapName returns a string', () => {
      const result = arkUtils.getArkMapName({ map: 'TheIsland' });
      expect(typeof result).toBe('string');
    });

    it('isArkServerInstalled returns a boolean', () => {
      const fs = require('fs');
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const result = arkUtils.isArkServerInstalled();
      expect(typeof result).toBe('boolean');
    });
  });
});
