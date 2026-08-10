/// <reference types="jest" />
// @jest-environment node
import { ArkCommandUtils } from './ark-command.utils';

jest.mock('../platform.utils', () => ({
  getPlatform: jest.fn(),
  getDefaultInstallDir: jest.fn(() => '/fake/install/dir')
}));
jest.mock('../proton.utils', () => ({
  getProtonBinaryPath: jest.fn(() => '/fake/proton'),
  isProtonInstalled: jest.fn(() => true),
  ensureProtonPrefixExists: jest.fn(),
  getProtonPrefixDir: jest.fn((id: string) => `/fake/install/dir/proton-prefix/${id}`)
}));
jest.mock('./ark-path.utils', () => ({
  ARK_APP_ID: '123456'
}));

const { getPlatform } = require('../platform.utils');
const { isProtonInstalled, getProtonBinaryPath, ensureProtonPrefixExists, getProtonPrefixDir } = require('../proton.utils');
const { ARK_APP_ID } = require('./ark-path.utils');

describe('ArkCommandUtils', () => {
  describe('prepareArkServerCommand', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should prepare command for Windows', () => {
      getPlatform.mockReturnValue('windows');
      const result = ArkCommandUtils.prepareArkServerCommand('C:/ark/ark.exe', ['-foo', '-bar'], { TEST: '1' });
      expect(result.command).toBe('C:/ark/ark.exe');
      expect(result.args).toEqual(['-foo', '-bar']);
  expect(result.env).toMatchObject({ SteamAppId: ARK_APP_ID, TEST: '1' });
      expect(result.cwd).toBe('C:/ark');
    });

    it('should throw if Proton is not installed on Linux', () => {
      getPlatform.mockReturnValue('linux');
      isProtonInstalled.mockReturnValue(false);
      expect(() => ArkCommandUtils.prepareArkServerCommand('/ark/ark.exe', ['-foo'], undefined, 'inst-1')).toThrow('Proton is required to run ARK server on Linux but is not installed');
    });

    it('should throw if instanceId is missing on Linux', () => {
      getPlatform.mockReturnValue('linux');
      isProtonInstalled.mockReturnValue(true);
      expect(() => ArkCommandUtils.prepareArkServerCommand('/ark/ark.exe', ['-foo'])).toThrow('instanceId is required to isolate the Proton prefix on Linux');
    });

    it('should prepare command for Linux with a per-instance Proton prefix', () => {
      getPlatform.mockReturnValue('linux');
      isProtonInstalled.mockReturnValue(true);
      const result = ArkCommandUtils.prepareArkServerCommand('/ark/ark.exe', ['-foo', '-bar'], { TEST: '2' }, 'inst-1');
      expect(result.command).toBe('xvfb-run');
      expect(result.args[0]).toBe('-a');
      expect(result.args).toContain('/fake/proton');
      expect(result.args).toContain('run');
      expect(result.args).toContain('/ark/ark.exe');
      expect(result.args).toContain('-foo');
      expect(result.args).toContain('-bar');
      expect(result.env).toMatchObject({
        WINEPREFIX: '/fake/install/dir/proton-prefix/inst-1',
        STEAM_COMPAT_DATA_PATH: '/fake/install/dir/proton-prefix/inst-1',
        STEAM_COMPAT_CLIENT_INSTALL_PATH: expect.any(String),
        WINEDLLOVERRIDES: 'mshtml=d',
        SteamAppId: ARK_APP_ID,
        TEST: '2'
      });
      expect(result.cwd).toBe('/ark');
      expect(ensureProtonPrefixExists).toHaveBeenCalledWith('inst-1');
      expect(getProtonPrefixDir).toHaveBeenCalledWith('inst-1');
    });
  });
});
