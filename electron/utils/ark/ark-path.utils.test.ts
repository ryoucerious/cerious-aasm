import * as path from 'path';
import { ArkPathUtils, ARK_APP_ID, POLL_INTERVAL_MS } from './ark-path.utils';
import * as platformUtils from '../platform.utils';

describe('ArkPathUtils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getArkServerDir', () => {
    it('returns default install dir + AASMServer', () => {
      jest.spyOn(platformUtils, 'getDefaultInstallDir').mockReturnValue('/base');
      expect(ArkPathUtils.getArkServerDir()).toBe(path.join('/base', 'AASMServer'));
    });
  });

  describe('getArkExecutablePath', () => {
    it('returns Windows exe path on windows', () => {
      jest.spyOn(platformUtils, 'getDefaultInstallDir').mockReturnValue('/base');
      jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('windows');
      const expected = path.join('/base', 'AASMServer', 'ShooterGame', 'Binaries', 'Win64', 'ArkAscendedServer.exe');
      expect(ArkPathUtils.getArkExecutablePath()).toBe(expected);
    });
    it('returns Windows exe path on linux (for Proton)', () => {
      jest.spyOn(platformUtils, 'getDefaultInstallDir').mockReturnValue('/base');
      jest.spyOn(platformUtils, 'getPlatform').mockReturnValue('linux');
      const expected = path.join('/base', 'AASMServer', 'ShooterGame', 'Binaries', 'Win64', 'ArkAscendedServer.exe');
      expect(ArkPathUtils.getArkExecutablePath()).toBe(expected);
    });
  });

  describe('getArkConfigDir', () => {
    it('returns config dir path', () => {
      jest.spyOn(platformUtils, 'getDefaultInstallDir').mockReturnValue('/base');
      const expected = path.join('/base', 'AASMServer', 'ShooterGame', 'Saved', 'Config', 'WindowsServer');
      expect(ArkPathUtils.getArkConfigDir()).toBe(expected);
    });
  });

  describe('getArkSavedDir', () => {
    it('returns saved dir path', () => {
      jest.spyOn(platformUtils, 'getDefaultInstallDir').mockReturnValue('/base');
      const expected = path.join('/base', 'AASMServer', 'ShooterGame', 'Saved');
      expect(ArkPathUtils.getArkSavedDir()).toBe(expected);
    });
  });

  describe('getArkLogsDir', () => {
    it('returns logs dir path', () => {
      jest.spyOn(platformUtils, 'getDefaultInstallDir').mockReturnValue('/base');
      const expected = path.join('/base', 'AASMServer', 'ShooterGame', 'Saved', 'Logs');
      expect(ArkPathUtils.getArkLogsDir()).toBe(expected);
    });
  });
});

describe('ARK_PATH constants', () => {
  it('ARK_APP_ID is correct', () => {
    expect(ARK_APP_ID).toBe('2430930');
  });
  it('POLL_INTERVAL_MS is 30min', () => {
    expect(POLL_INTERVAL_MS).toBe(30 * 60 * 1000);
  });
});
