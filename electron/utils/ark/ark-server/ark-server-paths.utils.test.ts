// ark-server-paths.utils.test.ts
// Unit tests for ARK server paths and cross-platform handling

jest.mock('path', () => ({
  join: jest.fn((...args) => args.join('/'))
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
  getProtonDir: jest.fn()
}));

const path = require('path');
const { getPlatform, getDefaultInstallDir } = require('../../platform.utils');
const { getArkServerDir } = require('./ark-server-install.utils');
const {
  isProtonInstalled,
  getProtonBinaryPath,
  ensureProtonPrefixExists
} = require('../../proton.utils');
const { getArkExecutablePath, getArkConfigDir, prepareArkServerCommand } = require('./ark-server-paths.utils');

describe('ark-server-paths.utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getArkExecutablePath', () => {
    it('returns Windows exe path on Windows', () => {
      getPlatform.mockReturnValue('windows');
      getArkServerDir.mockReturnValue('/ark');
  path.join.mockImplementation((...args: string[]) => args.join('/'));
      expect(getArkExecutablePath()).toBe('/ark/ShooterGame/Binaries/Win64/ArkAscendedServer.exe');
    });
    it('returns Windows exe path on Linux', () => {
      getPlatform.mockReturnValue('linux');
      getArkServerDir.mockReturnValue('/ark');
  path.join.mockImplementation((...args: string[]) => args.join('/'));
      expect(getArkExecutablePath()).toBe('/ark/ShooterGame/Binaries/Win64/ArkAscendedServer.exe');
    });
  });

  describe('getArkConfigDir', () => {
    it('returns WindowsServer config path', () => {
      getArkServerDir.mockReturnValue('/ark');
  path.join.mockImplementation((...args: string[]) => args.join('/'));
      expect(getArkConfigDir()).toBe('/ark/ShooterGame/Saved/Config/WindowsServer');
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
      expect(() => prepareArkServerCommand('exe', ['-arg'])).toThrow('Proton is required but not installed. Please install Proton first.');
    });
    it('returns xvfb-run command for Linux with Proton', () => {
  getPlatform.mockReturnValue('linux');
  isProtonInstalled.mockReturnValue(true);
  ensureProtonPrefixExists.mockImplementation(() => {});
  getProtonBinaryPath.mockReturnValue('/proton');
  getDefaultInstallDir.mockReturnValue('/default');
  const result = prepareArkServerCommand('exe', ['-arg']);
  expect(result.command).toBe('xvfb-run');
  expect(result.args).toContain('/proton');
  expect(result.args).toContain('exe');
  expect(result.env.WINEDLLOVERRIDES).toBe('mshtml=d');
  expect(result.env.WINEPREFIX).toBe('/default/.wine-ark');
    });
  });
});
