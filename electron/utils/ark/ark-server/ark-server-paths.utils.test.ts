// ark-server-paths.utils.test.ts
// Unit tests for ARK server paths and cross-platform handling

const normalize = (segments: string[]): string => {
  const out: string[] = [];
  for (const part of segments.join('/').split(/[/\\]/)) {
    if (part === '..') out.pop();
    else if (part !== '.') out.push(part);
  }
  return out.join('/');
};

jest.mock('path', () => ({
  join: jest.fn((...args) => args.join('/')),
  dirname: jest.fn((p) => String(p).split(/[/\\]/).slice(0, -1).join('/')),
  resolve: jest.fn((...args) => normalize(args.map(String)))
}));
jest.mock('../../platform.utils', () => ({
  getPlatform: jest.fn(),
  getDefaultInstallDir: jest.fn()
}));
jest.mock('./ark-server-install.utils', () => ({
  getArkServerDir: jest.fn()
}));
jest.mock('../../proton.utils', () => ({
  isProtonInstalled: jest.fn(),
  getProtonBinaryPath: jest.fn(),
  ensureProtonPrefixExists: jest.fn(),
  getProtonPrefixDir: jest.fn(),
  getProtonDir: jest.fn()
}));
jest.mock('fs', () => ({
  existsSync: jest.fn()
}));
jest.mock('../../ark/instance.utils', () => ({
  getInstancesBaseDir: jest.fn(() => '/instances')
}));

const path = require('path');
const fs = require('fs');
const { getPlatform, getDefaultInstallDir } = require('../../platform.utils');
const { getArkServerDir } = require('./ark-server-install.utils');
const {
  isProtonInstalled,
  getProtonBinaryPath,
  ensureProtonPrefixExists,
  getProtonPrefixDir
} = require('../../proton.utils');
const {
  getArkExecutablePath,
  getArkConfigDir,
  prepareArkServerCommand,
  resolveServerLaunch,
  isAsaApiLoaderInstalled,
  getInstanceRuntimeRoot,
  isInstanceIsolated,
  getInstanceConfigDir,
  getInstanceLogsDir,
  getInstanceWhitelistPath,
  getInstanceAltSaveDirName
} = require('./ark-server-paths.utils');

describe('ark-server-paths.utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    path.join.mockImplementation((...args: string[]) => args.join('/'));
    path.dirname.mockImplementation((p: string) => p.split('/').slice(0, -1).join('/'));
    path.resolve.mockImplementation((...args: string[]) => normalize(args.map(String)));
  });

  // An instance whose Win64 holds its own exe runs from its own tree; one without falls
  // back to the shared install. Every runtime path below follows that distinction.
  describe('runtime path resolution', () => {
    const INSTANCE = '/instances/inst1';

    function useIsolatedInstance() {
      getPlatform.mockReturnValue('windows');
      getArkServerDir.mockReturnValue('/ark');
      fs.existsSync.mockImplementation((p: string) => p === `${INSTANCE}/ShooterGame/Binaries/Win64/ArkAscendedServer.exe`);
    }

    function useSharedInstall() {
      getPlatform.mockReturnValue('windows');
      getArkServerDir.mockReturnValue('/ark');
      fs.existsSync.mockReturnValue(false);
    }

    it('roots an isolated instance in its own folder', () => {
      useIsolatedInstance();
      expect(getInstanceRuntimeRoot('inst1')).toBe(INSTANCE);
      expect(isInstanceIsolated('inst1')).toBe(true);
    });

    it('roots a non-isolated instance in the shared install', () => {
      useSharedInstall();
      expect(getInstanceRuntimeRoot('inst1')).toBe('/ark');
      expect(isInstanceIsolated('inst1')).toBe(false);
    });

    it('points config, logs and whitelist at the isolated tree', () => {
      useIsolatedInstance();
      expect(getInstanceConfigDir('inst1')).toBe(`${INSTANCE}/ShooterGame/Saved/Config/WindowsServer`);
      expect(getInstanceLogsDir('inst1')).toBe(`${INSTANCE}/ShooterGame/Saved/Logs`);
      expect(getInstanceWhitelistPath('inst1')).toBe(`${INSTANCE}/ShooterGame/Binaries/Win64/PlayersExclusiveJoinList.txt`);
    });

    it('points config, logs and whitelist at the shared install otherwise', () => {
      useSharedInstall();
      expect(getInstanceConfigDir('inst1')).toBe('/ark/ShooterGame/Saved/Config/WindowsServer');
      expect(getInstanceLogsDir('inst1')).toBe('/ark/ShooterGame/Saved/Logs');
      expect(getInstanceWhitelistPath('inst1')).toBe('/ark/ShooterGame/Binaries/Win64/PlayersExclusiveJoinList.txt');
    });

    // Both forms must land on <instance>/SavedArks once ARK appends them to
    // <runtimeRoot>/ShooterGame/Saved/ — the isolated instance is already rooted there,
    // so reusing the shared form would nest a second Servers/<id> level inside it.
    it('keeps saves in the instance folder for an isolated instance', () => {
      useIsolatedInstance();
      expect(getInstanceAltSaveDirName('inst1')).toBe('SavedArks');
    });

    it('keeps saves in the instance folder for a shared-install instance', () => {
      useSharedInstall();
      expect(getInstanceAltSaveDirName('inst1')).toBe('Servers/inst1/SavedArks');
    });

    it('resolves the AsaApiLoader tree the same way', () => {
      getPlatform.mockReturnValue('windows');
      getArkServerDir.mockReturnValue('/ark');
      fs.existsSync.mockImplementation((p: string) => p === `${INSTANCE}/ShooterGame/Binaries/Win64/AsaApiLoader.exe`);
      expect(getInstanceRuntimeRoot('inst1')).toBe(INSTANCE);
      expect(getInstanceConfigDir('inst1')).toBe(`${INSTANCE}/ShooterGame/Saved/Config/WindowsServer`);
    });
  });

  describe('getArkExecutablePath', () => {
    it('returns Windows exe path on Windows', () => {
      getPlatform.mockReturnValue('windows');
      getArkServerDir.mockReturnValue('/ark');
      expect(getArkExecutablePath()).toBe('/ark/ShooterGame/Binaries/Win64/ArkAscendedServer.exe');
    });
    it('returns Windows exe path on Linux', () => {
      getPlatform.mockReturnValue('linux');
      getArkServerDir.mockReturnValue('/ark');
      expect(getArkExecutablePath()).toBe('/ark/ShooterGame/Binaries/Win64/ArkAscendedServer.exe');
    });
  });

  describe('getArkConfigDir', () => {
    it('returns WindowsServer config path', () => {
      getArkServerDir.mockReturnValue('/ark');
      expect(getArkConfigDir()).toBe('/ark/ShooterGame/Saved/Config/WindowsServer');
    });
  });

  describe('resolveServerLaunch', () => {
    it('prefers AsaApiLoader.exe when present on Windows', () => {
      getPlatform.mockReturnValue('windows');
      getArkServerDir.mockReturnValue('/ark');
      fs.existsSync.mockImplementation((p: string) =>
        String(p).endsWith('AsaApiLoader.exe') || String(p).endsWith('ArkAscendedServer.exe')
      );

      const launch = resolveServerLaunch('inst-1');

      expect(launch.usesAsaApiLoader).toBe(true);
      expect(launch.executable).toBe('/instances/inst-1/ShooterGame/Binaries/Win64/AsaApiLoader.exe');
      expect(launch.cwd).toBe('/instances/inst-1/ShooterGame/Binaries/Win64');
    });

    it('uses instance ArkAscendedServer.exe when loader is missing', () => {
      getPlatform.mockReturnValue('windows');
      getArkServerDir.mockReturnValue('/ark');
      fs.existsSync.mockImplementation((p: string) => String(p).endsWith('ArkAscendedServer.exe'));

      const launch = resolveServerLaunch('inst-1');

      expect(launch.usesAsaApiLoader).toBe(false);
      expect(launch.executable).toBe('/instances/inst-1/ShooterGame/Binaries/Win64/ArkAscendedServer.exe');
      expect(launch.cwd).toBe('/instances/inst-1/ShooterGame/Binaries/Win64');
    });

    it('falls back to shared install when instance binaries are missing', () => {
      getPlatform.mockReturnValue('windows');
      getArkServerDir.mockReturnValue('/ark');
      fs.existsSync.mockReturnValue(false);

      const launch = resolveServerLaunch('inst-1');

      expect(launch.usesAsaApiLoader).toBe(false);
      expect(launch.executable).toBe('/ark/ShooterGame/Binaries/Win64/ArkAscendedServer.exe');
    });
  });

  describe('isAsaApiLoaderInstalled', () => {
    it('returns true when loader exists', () => {
      fs.existsSync.mockReturnValue(true);
      expect(isAsaApiLoaderInstalled('inst-1')).toBe(true);
    });

    it('returns false when loader is missing', () => {
      fs.existsSync.mockReturnValue(false);
      expect(isAsaApiLoaderInstalled('inst-1')).toBe(false);
    });
  });

  describe('prepareArkServerCommand', () => {
    it('returns command and args for Windows', () => {
      getPlatform.mockReturnValue('windows');
      expect(prepareArkServerCommand('exe', ['-arg'])).toEqual({ command: 'exe', args: ['-arg'] });
    });
    it('throws if Proton not installed on Linux', () => {
      getPlatform.mockReturnValue('linux');
      isProtonInstalled.mockReturnValue(false);
      expect(() => prepareArkServerCommand('exe', ['-arg'], 'inst-1')).toThrow('Proton is required but not installed. Please install Proton first.');
    });
    it('throws if instanceId is missing on Linux', () => {
      getPlatform.mockReturnValue('linux');
      isProtonInstalled.mockReturnValue(true);
      expect(() => prepareArkServerCommand('exe', ['-arg'])).toThrow('instanceId is required to isolate the Proton prefix on Linux');
    });
    it('returns xvfb-run command for Linux with a per-instance Proton prefix', () => {
      getPlatform.mockReturnValue('linux');
      isProtonInstalled.mockReturnValue(true);
      ensureProtonPrefixExists.mockImplementation(() => {});
      getProtonBinaryPath.mockReturnValue('/proton');
      getDefaultInstallDir.mockReturnValue('/default');
      getProtonPrefixDir.mockReturnValue('/default/proton-prefix/inst-1');
      const result = prepareArkServerCommand('exe', ['-arg'], 'inst-1');
      expect(result.command).toBe('xvfb-run');
      expect(result.args).toContain('/proton');
      expect(result.args).toContain('exe');
      expect(result.env.WINEDLLOVERRIDES).toBe('mshtml=d;winhttp=n,b;bcrypt=n,b;crypt32=n,b');
      expect(result.env.WINEPREFIX).toBe('/default/proton-prefix/inst-1');
      expect(result.env.STEAM_COMPAT_DATA_PATH).toBe('/default/proton-prefix/inst-1');
      expect(ensureProtonPrefixExists).toHaveBeenCalledWith('inst-1');
      expect(getProtonPrefixDir).toHaveBeenCalledWith('inst-1');
    });
  });
});
