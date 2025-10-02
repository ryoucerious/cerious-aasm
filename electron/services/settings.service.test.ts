import { SettingsService } from './settings.service';
import * as globalConfigUtils from '../utils/global-config.utils';
import * as validationUtils from '../utils/validation.utils';
import * as path from 'path';
import * as fs from 'fs';
import * as bcrypt from 'bcrypt';
import * as platformUtils from '../utils/platform.utils';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed')
}));

describe('SettingsService', () => {
  let service: SettingsService;

  beforeEach(() => {
    service = new SettingsService();
    jest.spyOn(globalConfigUtils, 'loadGlobalConfig').mockReturnValue({
      startWebServerOnLoad: false,
      webServerPort: 3000,
      authenticationEnabled: false,
      authenticationUsername: '',
      authenticationPassword: '',
      maxBackupDownloadSizeMB: 100
    });
    jest.spyOn(globalConfigUtils, 'saveGlobalConfig').mockReturnValue(true);
    jest.spyOn(validationUtils, 'validatePort').mockReturnValue(true);
    jest.spyOn(validationUtils, 'sanitizeString').mockImplementation((s) => s);
    jest.spyOn(path, 'join').mockImplementation((...args) => args.join('/'));
    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    jest.spyOn(platformUtils, 'getDefaultInstallDir').mockReturnValue('/install');
    // bcrypt.hash is already mocked above
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('getGlobalConfig returns config', () => {
    expect(service.getGlobalConfig()).toEqual({
      startWebServerOnLoad: false,
      webServerPort: 3000,
      authenticationEnabled: false,
      authenticationUsername: '',
      authenticationPassword: '',
      maxBackupDownloadSizeMB: 100
    });
  });

  it('updateGlobalConfig returns success and updated config', async () => {
    const result = await service.updateGlobalConfig({ webServerPort: 3000 });
    expect(result.success).toBe(true);
    expect(result.updatedConfig).toEqual({
      startWebServerOnLoad: false,
      webServerPort: 3000,
      authenticationEnabled: false,
      authenticationUsername: '',
      authenticationPassword: '',
      maxBackupDownloadSizeMB: 100
    });
  });

  it('updateGlobalConfig returns error for invalid config', async () => {
    const result = await service.updateGlobalConfig(null);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid config object');
  });

  it('updateGlobalConfig returns error for invalid port', async () => {
    (validationUtils.validatePort as jest.Mock).mockReturnValue(false);
    const result = await service.updateGlobalConfig({ webServerPort: 1 });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid web server port');
  });

  it('updateGlobalConfig returns error if save fails', async () => {
    (globalConfigUtils.saveGlobalConfig as jest.Mock).mockReturnValue(false);
    const result = await service.updateGlobalConfig({ webServerPort: 3000 });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Failed to save configuration');
  });

  it('getWebServerAuthConfig returns correct config', () => {
    const config = { authenticationEnabled: true, authenticationUsername: 'user', authenticationPassword: 'pass' };
    expect(service.getWebServerAuthConfig(config)).toEqual({ enabled: true, username: 'user', password: 'pass' });
  });

  it('updateWebServerAuth saves config and sends to process', async () => {
    const apiProcess = { killed: false, send: jest.fn() };
    await service.updateWebServerAuth({ authenticationEnabled: true, authenticationUsername: 'user', authenticationPassword: 'pass' }, apiProcess);
    expect(fs.mkdirSync).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(apiProcess.send).toHaveBeenCalledWith({ type: 'update-auth-config', authConfig: { enabled: true, username: 'user', password: 'pass' } });
  });

  it('updateWebServerAuth does not send if process killed', async () => {
    const apiProcess = { killed: true, send: jest.fn() };
    await service.updateWebServerAuth({ authenticationEnabled: true, authenticationUsername: 'user', authenticationPassword: 'pass' }, apiProcess);
    expect(apiProcess.send).not.toHaveBeenCalled();
  });
});
