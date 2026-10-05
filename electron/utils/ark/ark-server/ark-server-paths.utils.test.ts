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
// The shared install resolves to <serverDataDir>/AASMServer, so '/data' puts it at ARK.
jest.mock('../../global-config.utils', () => ({
  loadGlobalConfig: jest.fn(() => ({ serverDataDir: '/data' }))
}));
jest.mock('../../proton.utils', () => ({
  isProtonInstalled: jest.fn(),
  getProtonBinaryPath: jest.fn(),
  ensureProtonPrefixExists: jest.fn(),
  getProtonPrefixDir: jest.fn(),
  getProtonDir: jest.fn()
}));
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  statSync: jest.fn(),
  readdirSync: jest.fn()
}));
jest.mock('../instance.utils', () => ({
  getInstanceDir: jest.fn((id: string) => `/instances/${id}`)
}));

const path = require('path');
const fs = require('fs');
const { getPlatform, getDefaultInstallDir } = require('../../platform.utils');
const ARK = '/data/AASMServer';
const {
  isProtonInstalled,
  getProtonBinaryPath,
  ensureProtonPrefixExists,
  getProtonPrefixDir
} = require('../../proton.utils');
const {
  getArkExecutablePath,
  prepareArkServerCommand,
  resolveServerLaunch,
  isAsaApiLoaderInstalled,
  getInstanceRuntimeRoot,
  isInstanceIsolated,
  getInstanceConfigDir,
  getInstanceLogsDir,
  getInstanceWhitelistPath,
  getInstanceAltSaveDirName,
  getInstanceProcessMarker,
  getInstallProcessMarker,
  toProtonPath,
  validateInstanceRuntimeTree
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
      fs.existsSync.mockImplementation((p: string) => p === `${INSTANCE}/ShooterGame/Binaries/Win64/ArkAscendedServer.exe`);
    }

    function useSharedInstall() {
      getPlatform.mockReturnValue('windows');
      fs.existsSync.mockReturnValue(false);
    }

    it('roots an isolated instance in its own folder', () => {
      useIsolatedInstance();
      expect(getInstanceRuntimeRoot('inst1')).toBe(INSTANCE);
      expect(isInstanceIsolated('inst1')).toBe(true);
    });

    it('roots a non-isolated instance in the shared install', () => {
      useSharedInstall();
      expect(getInstanceRuntimeRoot('inst1')).toBe(ARK);
      expect(isInstanceIsolated('inst1')).toBe(false);
    });

    it('points config, logs and whitelist at the isolated tree', () => {
      useIsolatedInstance();
      expect(getInstanceConfigDir('inst1')).toBe(`${INSTANCE}/ShooterGame/Saved/Config/WindowsServer`);
      expect(getInstanceLogsDir('inst1')).toBe(`${INSTANCE}/ShooterGame/Saved/Logs`);
      expect(getInstanceWhitelistPath('inst1')).toBe(`${INSTANCE}/ShooterGame/Binaries/Win64/PlayersJoinNoCheckList.txt`);
    });

    it('points config, logs and whitelist at the shared install otherwise', () => {
      useSharedInstall();
      expect(getInstanceConfigDir('inst1')).toBe(`${ARK}/ShooterGame/Saved/Config/WindowsServer`);
      expect(getInstanceLogsDir('inst1')).toBe(`${ARK}/ShooterGame/Saved/Logs`);
      expect(getInstanceWhitelistPath('inst1')).toBe(`${ARK}/ShooterGame/Binaries/Win64/PlayersJoinNoCheckList.txt`);
    });

    // Both forms must land on <instance>/SavedArks once ARK appends them to
    // <runtimeRoot>/ShooterGame/Saved/: the isolated instance is already rooted there,
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
      fs.existsSync.mockImplementation((p: string) => p === `${INSTANCE}/ShooterGame/Binaries/Win64/AsaApiLoader.exe`);
      expect(getInstanceRuntimeRoot('inst1')).toBe(INSTANCE);
      expect(getInstanceConfigDir('inst1')).toBe(`${INSTANCE}/ShooterGame/Saved/Config/WindowsServer`);
    });
  });

  // Leftover server processes are found by command line, so each marker must be something only
  // that instance (or only this app's install) puts there.
  describe('process markers', () => {
    const isolated = () => fs.existsSync.mockImplementation(
      (p: string) => p === '/instances/inst1/ShooterGame/Binaries/Win64/ArkAscendedServer.exe'
    );

    it('marks an isolated instance by its own folder on Windows', () => {
      getPlatform.mockReturnValue('windows');
      isolated();
      expect(getInstanceProcessMarker('inst1')).toBe('/instances/inst1\\');
    });

    it('marks an isolated instance by the Z: path Proton is given on Linux', () => {
      getPlatform.mockReturnValue('linux');
      fs.existsSync.mockReturnValue(true);
      expect(getInstanceProcessMarker('inst1')).toBe('Z:\\instances\\inst1\\');
    });

    it('marks a shared-install instance by its save directory argument', () => {
      getPlatform.mockReturnValue('windows');
      fs.existsSync.mockReturnValue(false);
      expect(getInstanceProcessMarker('inst1')).toBe('AltSaveDirectoryName=Servers/inst1/SavedArks');
    });

    it('marks the install by its root folder', () => {
      getPlatform.mockReturnValue('windows');
      expect(getInstallProcessMarker()).toBe(`${ARK}\\`);
      getPlatform.mockReturnValue('linux');
      expect(getInstallProcessMarker()).toBe('Z:\\data\\AASMServer\\');
    });

    it('converts a Linux path to the Z: drive path Wine sees', () => {
      expect(toProtonPath('/home/me/ark.exe')).toBe('Z:\\home\\me\\ark.exe');
    });
  });

  describe('getArkExecutablePath', () => {
    it('returns Windows exe path on Windows', () => {
      getPlatform.mockReturnValue('windows');
      expect(getArkExecutablePath()).toBe(`${ARK}/ShooterGame/Binaries/Win64/ArkAscendedServer.exe`);
    });
    it('returns Windows exe path on Linux', () => {
      getPlatform.mockReturnValue('linux');
      expect(getArkExecutablePath()).toBe(`${ARK}/ShooterGame/Binaries/Win64/ArkAscendedServer.exe`);
    });
  });

  describe('resolveServerLaunch', () => {
    it('prefers AsaApiLoader.exe when present on Windows', () => {
      getPlatform.mockReturnValue('windows');
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
      fs.existsSync.mockImplementation((p: string) => String(p).endsWith('ArkAscendedServer.exe'));

      const launch = resolveServerLaunch('inst-1');

      expect(launch.usesAsaApiLoader).toBe(false);
      expect(launch.executable).toBe('/instances/inst-1/ShooterGame/Binaries/Win64/ArkAscendedServer.exe');
      expect(launch.cwd).toBe('/instances/inst-1/ShooterGame/Binaries/Win64');
    });

    it('falls back to shared install when instance binaries are missing', () => {
      getPlatform.mockReturnValue('windows');
      fs.existsSync.mockReturnValue(false);

      const launch = resolveServerLaunch('inst-1');

      expect(launch.usesAsaApiLoader).toBe(false);
      expect(launch.executable).toBe(`${ARK}/ShooterGame/Binaries/Win64/ArkAscendedServer.exe`);
    });

    // ARK reads the whitelist, config and logs from the tree that owns the executable, so a Linux
    // instance that ran the shared executable shared its PlayersJoinNoCheckList.txt with every
    // other instance. Each instance has its own copy of the binaries; Proton runs that one.
    it('runs the instance ArkAscendedServer.exe under Proton when the loader is missing', () => {
      getPlatform.mockReturnValue('linux');
      fs.existsSync.mockImplementation((p: string) => String(p).endsWith('ArkAscendedServer.exe'));

      const launch = resolveServerLaunch('inst-1');

      expect(launch.usesAsaApiLoader).toBe(false);
      expect(launch.executable).toBe('/instances/inst-1/ShooterGame/Binaries/Win64/ArkAscendedServer.exe');
      expect(launch.cwd).toBe(ARK);
    });

    it('prefers AsaApiLoader.exe under Proton when the instance has the full layout', () => {
      getPlatform.mockReturnValue('linux');
      fs.existsSync.mockImplementation((p: string) =>
        String(p).endsWith('AsaApiLoader.exe') || String(p).endsWith('ArkAscendedServer.exe')
      );

      const launch = resolveServerLaunch('inst-1');

      expect(launch.usesAsaApiLoader).toBe(true);
      expect(launch.executable).toBe('/instances/inst-1/ShooterGame/Binaries/Win64/AsaApiLoader.exe');
    });

    it('falls back to the shared install under Proton when the instance has no binaries', () => {
      getPlatform.mockReturnValue('linux');
      fs.existsSync.mockReturnValue(false);

      const launch = resolveServerLaunch('inst-1');

      expect(launch.usesAsaApiLoader).toBe(false);
      expect(launch.executable).toBe(`${ARK}/ShooterGame/Binaries/Win64/ArkAscendedServer.exe`);
      expect(launch.cwd).toBe(ARK);
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
      const previousDisplay = process.env.DISPLAY;
      delete process.env.DISPLAY;
      getPlatform.mockReturnValue('linux');
      isProtonInstalled.mockReturnValue(true);
      ensureProtonPrefixExists.mockImplementation(() => {});
      getProtonBinaryPath.mockReturnValue('/proton');
      getDefaultInstallDir.mockReturnValue('/default');
      getProtonPrefixDir.mockReturnValue('/default/proton-prefix/inst-1');
      const result = prepareArkServerCommand('/srv/exe', ['-arg'], 'inst-1');
      if (previousDisplay === undefined) delete process.env.DISPLAY;
      else process.env.DISPLAY = previousDisplay;
      expect(result.command).toBe('xvfb-run');
      expect(result.args).toContain('/proton');
      expect(result.args).toContain('waitforexitandrun');
      expect(result.args).toContain('Z:\\srv\\exe');
      expect(result.env.WINEDLLOVERRIDES).toBe('mshtml=d;winhttp=n,b;bcrypt=n,b;crypt32=n,b');
      expect(result.env.UMU_ID).toBe('2430930');
      expect(result.env.WINEPREFIX).toBe('/default/proton-prefix/inst-1');
      expect(result.env.STEAM_COMPAT_DATA_PATH).toBe('/default/proton-prefix/inst-1');
      expect(ensureProtonPrefixExists).toHaveBeenCalledWith('inst-1');
      expect(getProtonPrefixDir).toHaveBeenCalledWith('inst-1');
    });
    it('uses the existing display instead of a second xvfb-run', () => {
      const previousDisplay = process.env.DISPLAY;
      process.env.DISPLAY = ':99';
      getPlatform.mockReturnValue('linux');
      isProtonInstalled.mockReturnValue(true);
      ensureProtonPrefixExists.mockImplementation(() => {});
      getProtonBinaryPath.mockReturnValue('/proton');
      getDefaultInstallDir.mockReturnValue('/default');
      getProtonPrefixDir.mockReturnValue('/default/proton-prefix/inst-1');
      const result = prepareArkServerCommand('/srv/exe', ['-arg'], 'inst-1');
      if (previousDisplay === undefined) delete process.env.DISPLAY;
      else process.env.DISPLAY = previousDisplay;
      expect(result.command).toBe('/proton');
      expect(result.args[0]).toBe('waitforexitandrun');
      expect(result.args).toContain('Z:\\srv\\exe');
      expect(result.env.UMU_ID).toBe('2430930');
    });
  });
  // A restore that walked junctions used to delete the shared install's game folders.
  // The instance still looked startable (ArkAscendedServer.exe is a real file that
  // survives), so ARK was launched, aborted before writing a log, and the user saw only
  // "Could not detect log file". This check turns that into an actionable message.
  describe('validateInstanceRuntimeTree', () => {
    const SHARED = ARK;
    const INSTANCE = '/instances/inst1';

    // Directories that exist and have contents; everything else reads as missing/empty
    const present = (dirs: string[]) => {
      const set = new Set(dirs);
      fs.statSync.mockImplementation((p: string) => {
        if (!set.has(p)) throw new Error('ENOENT');
        return { isDirectory: () => true };
      });
      fs.readdirSync.mockImplementation((p: string) => (set.has(p) ? ['a-file'] : []));
    };

    const required = (root: string) => [
      `${root}/ShooterGame/Content`,
      `${root}/ShooterGame/Binaries/Win64/RedpointEOS`,
      `${root}/Engine`
    ];

    beforeEach(() => {
      getPlatform.mockReturnValue('windows');
    });

    // Isolated instance: its own exe exists, so it runs from its own tree
    const makeIsolated = () => fs.existsSync.mockImplementation(
      (p: string) => p === `${INSTANCE}/ShooterGame/Binaries/Win64/ArkAscendedServer.exe`
    );
    // Shared-install instance: no instance exe, falls back to the shared tree
    const makeShared = () => fs.existsSync.mockReturnValue(false);

    it('passes when an isolated instance has every required folder', () => {
      makeIsolated();
      present([...required(SHARED), ...required(INSTANCE)]);
      expect(validateInstanceRuntimeTree('inst1')).toEqual({
        valid: true,
        missing: [],
        sharedInstallBroken: false
      });
    });

    it('reports the instance when its junctions are missing but the install is fine', () => {
      makeIsolated();
      present(required(SHARED));
      const result = validateInstanceRuntimeTree('inst1');
      expect(result.valid).toBe(false);
      expect(result.sharedInstallBroken).toBe(false);
      expect(result.missing).toHaveLength(3);
    });

    // The exact aftermath of the destructive restore: junctions were followed and the
    // shared game folders were emptied, breaking every instance on the machine.
    it('blames the shared install when its folders were emptied', () => {
      makeIsolated();
      present([]);
      const result = validateInstanceRuntimeTree('inst1');
      expect(result.valid).toBe(false);
      expect(result.sharedInstallBroken).toBe(true);
      expect(result.missing).toContain('ShooterGame/Content');
      expect(result.missing).toContain('Engine');
    });

    it('treats an existing-but-empty folder as missing', () => {
      makeIsolated();
      fs.statSync.mockReturnValue({ isDirectory: () => true });
      fs.readdirSync.mockReturnValue([]); // present, but nothing inside
      const result = validateInstanceRuntimeTree('inst1');
      expect(result.valid).toBe(false);
      expect(result.sharedInstallBroken).toBe(true);
    });

    it('does not double-check a shared-install instance against itself', () => {
      makeShared();
      present(required(SHARED));
      expect(validateInstanceRuntimeTree('inst1').valid).toBe(true);
    });

    it('reports a partial break rather than everything', () => {
      makeIsolated();
      present([...required(SHARED), `${INSTANCE}/ShooterGame/Content`, `${INSTANCE}/Engine`]);
      const result = validateInstanceRuntimeTree('inst1');
      expect(result.valid).toBe(false);
      expect(result.missing).toEqual(['ShooterGame/Binaries/Win64/RedpointEOS']);
      expect(result.sharedInstallBroken).toBe(false);
    });
  });
});
