/**
 * Tests for the ark-server.utils barrel re-export module.
 * Verifies that all sub-module exports are correctly re-exported.
 */

// Mock all dependencies used by sub-modules
jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn().mockReturnValue(''),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  readdirSync: jest.fn().mockReturnValue([]),
  statSync: jest.fn().mockReturnValue({ size: 0, mtime: new Date() }),
  unlinkSync: jest.fn(),
  createReadStream: jest.fn().mockReturnValue({
    on: jest.fn().mockReturnThis(),
    pipe: jest.fn().mockReturnThis(),
    destroy: jest.fn(),
  }),
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
  spawn: jest.fn().mockReturnValue({
    on: jest.fn(),
    stdout: { on: jest.fn() },
    stderr: { on: jest.fn() },
    kill: jest.fn(),
    pid: 1234,
  }),
  execSync: jest.fn().mockReturnValue(Buffer.from('')),
}));

jest.mock('path', () => ({
  ...jest.requireActual('path'),
}));

jest.mock('../../platform.utils', () => ({
  getPlatform: jest.fn().mockReturnValue('windows'),
  getDefaultInstallDir: jest.fn().mockReturnValue('/mock/install'),
}));

jest.mock('../../proton.utils', () => ({
  getProtonBinaryPath: jest.fn().mockReturnValue('/mock/proton'),
  isProtonInstalled: jest.fn().mockReturnValue(false),
  ensureProtonPrefixExists: jest.fn(),
}));

jest.mock('../../steamcmd.utils', () => ({
  getSteamCmdDir: jest.fn().mockReturnValue('/mock/steamcmd'),
}));

jest.mock('../../installer.utils', () => ({
  runInstaller: jest.fn(),
}));

jest.mock('../../global-config.utils', () => ({
  loadGlobalConfig: jest.fn().mockReturnValue({}),
}));

jest.mock('../instance.utils', () => ({
  loadInstanceConfig: jest.fn().mockReturnValue({ instanceDir: '/mock/dir', config: {} }),
  getInstancesBaseDir: jest.fn().mockReturnValue('/mock/instances'),
}));

import * as arkServerUtils from '../ark-server.utils';

describe('ark-server.utils barrel re-exports', () => {
  describe('from ark-server-state.utils', () => {
    it('should export setInstanceState function', () => {
      expect(arkServerUtils.setInstanceState).toBeDefined();
      expect(typeof arkServerUtils.setInstanceState).toBe('function');
    });

    it('should export getInstanceState function', () => {
      expect(arkServerUtils.getInstanceState).toBeDefined();
      expect(typeof arkServerUtils.getInstanceState).toBe('function');
    });

    it('should export getNormalizedInstanceState function', () => {
      expect(arkServerUtils.getNormalizedInstanceState).toBeDefined();
      expect(typeof arkServerUtils.getNormalizedInstanceState).toBe('function');
    });

    it('should export arkServerProcesses object', () => {
      expect(arkServerUtils.arkServerProcesses).toBeDefined();
      expect(typeof arkServerUtils.arkServerProcesses).toBe('object');
    });
  });

  describe('from ark-server-install.utils', () => {
    it('should export getArkServerDir function', () => {
      expect(arkServerUtils.getArkServerDir).toBeDefined();
      expect(typeof arkServerUtils.getArkServerDir).toBe('function');
    });

    it('should export isArkServerInstalled function', () => {
      expect(arkServerUtils.isArkServerInstalled).toBeDefined();
      expect(typeof arkServerUtils.isArkServerInstalled).toBe('function');
    });

    it('should export getCurrentInstalledVersion function', () => {
      expect(arkServerUtils.getCurrentInstalledVersion).toBeDefined();
      expect(typeof arkServerUtils.getCurrentInstalledVersion).toBe('function');
    });

    it('should export installArkServer function', () => {
      expect(arkServerUtils.installArkServer).toBeDefined();
      expect(typeof arkServerUtils.installArkServer).toBe('function');
    });

    it('should export pollArkServerUpdates function', () => {
      expect(arkServerUtils.pollArkServerUpdates).toBeDefined();
      expect(typeof arkServerUtils.pollArkServerUpdates).toBe('function');
    });
  });

  describe('from ark-server-cleanup.utils', () => {
    it('should export cleanupAllArkServers function', () => {
      expect(arkServerUtils.cleanupAllArkServers).toBeDefined();
      expect(typeof arkServerUtils.cleanupAllArkServers).toBe('function');
    });

    it('should export cleanupOrphanedArkProcesses function', () => {
      expect(arkServerUtils.cleanupOrphanedArkProcesses).toBeDefined();
      expect(typeof arkServerUtils.cleanupOrphanedArkProcesses).toBe('function');
    });
  });

  describe('from ark-server-paths.utils', () => {
    it('should export getArkExecutablePath function', () => {
      expect(arkServerUtils.getArkExecutablePath).toBeDefined();
      expect(typeof arkServerUtils.getArkExecutablePath).toBe('function');
    });

    it('should export getArkConfigDir function', () => {
      expect(arkServerUtils.getArkConfigDir).toBeDefined();
      expect(typeof arkServerUtils.getArkConfigDir).toBe('function');
    });

    it('should export prepareArkServerCommand function', () => {
      expect(arkServerUtils.prepareArkServerCommand).toBeDefined();
      expect(typeof arkServerUtils.prepareArkServerCommand).toBe('function');
    });
  });

  describe('from ark-server-logging.utils', () => {
    it('should export snapshotLogFiles function', () => {
      expect(arkServerUtils.snapshotLogFiles).toBeDefined();
      expect(typeof arkServerUtils.snapshotLogFiles).toBe('function');
    });

    it('should export detectAndRegisterLogFile function', () => {
      expect(arkServerUtils.detectAndRegisterLogFile).toBeDefined();
      expect(typeof arkServerUtils.detectAndRegisterLogFile).toBe('function');
    });

    it('should export getRegisteredLogFile function', () => {
      expect(arkServerUtils.getRegisteredLogFile).toBeDefined();
      expect(typeof arkServerUtils.getRegisteredLogFile).toBe('function');
    });

    it('should export unregisterLogFile function', () => {
      expect(arkServerUtils.unregisterLogFile).toBeDefined();
      expect(typeof arkServerUtils.unregisterLogFile).toBe('function');
    });

    it('should export getInstanceLogs function', () => {
      expect(arkServerUtils.getInstanceLogs).toBeDefined();
      expect(typeof arkServerUtils.getInstanceLogs).toBe('function');
    });

    it('should export startArkLogTailing function', () => {
      expect(arkServerUtils.startArkLogTailing).toBeDefined();
      expect(typeof arkServerUtils.startArkLogTailing).toBe('function');
    });

    it('should export cleanupOldLogFiles function', () => {
      expect(arkServerUtils.cleanupOldLogFiles).toBeDefined();
      expect(typeof arkServerUtils.cleanupOldLogFiles).toBe('function');
    });

    it('should export setupLogTailing function', () => {
      expect(arkServerUtils.setupLogTailing).toBeDefined();
      expect(typeof arkServerUtils.setupLogTailing).toBe('function');
    });
  });

  describe('from ark-server-start.utils', () => {
    it('should export startArkServerInstance function', () => {
      expect(arkServerUtils.startArkServerInstance).toBeDefined();
      expect(typeof arkServerUtils.startArkServerInstance).toBe('function');
    });
  });

  describe('state functions are callable', () => {
    it('setInstanceState and getInstanceState round-trip', () => {
      arkServerUtils.setInstanceState('test-inst', 'running');
      expect(arkServerUtils.getInstanceState('test-inst')).toBe('running');
    });

    it('getNormalizedInstanceState returns stopped for unknown instance', () => {
      expect(arkServerUtils.getNormalizedInstanceState('unknown-inst')).toBe('stopped');
    });

    it('getRegisteredLogFile returns null for unknown instance', () => {
      expect(arkServerUtils.getRegisteredLogFile('unknown-inst')).toBeNull();
    });
  });
});
