import * as fs from 'fs';
import * as bcrypt from 'bcrypt';
import { SettingsService, toPublicGlobalConfig } from './settings.service';
import * as globalConfigUtils from '../utils/global-config.utils';
import * as validationUtils from '../utils/validation.utils';
import * as fsUtils from '../utils/fs.utils';
import type { GlobalConfig } from '../utils/global-config.utils';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed'),
  compare: jest.fn((password: string, hash: string) => Promise.resolve(hash === `saved-hash-of-${password}`))
}));
jest.mock('../utils/platform.utils', () => ({ getDefaultInstallDir: () => '/install' }));
jest.mock('fs', () => ({
  mkdirSync: jest.fn(),
  existsSync: jest.fn().mockReturnValue(false),
  accessSync: jest.fn(),
  constants: { W_OK: 2 },
}));

const stored: GlobalConfig = {
  startWebServerOnLoad: false,
  webServerPort: 3000,
  authenticationEnabled: true,
  authenticationUsername: 'admin',
  authenticationPassword: 'stored-secret',
  maxBackupDownloadSizeMB: 100
};
const ADMIN = { canChangeLogin: true };

describe('SettingsService', () => {
  let service: SettingsService;
  let save: jest.SpyInstance;

  beforeEach(() => {
    service = new SettingsService();
    jest.spyOn(globalConfigUtils, 'loadGlobalConfig').mockReturnValue(stored);
    save = jest.spyOn(globalConfigUtils, 'saveGlobalConfig').mockReturnValue(true);
    jest.spyOn(fsUtils, 'writeJsonAtomic').mockImplementation(() => {});
    jest.spyOn(fsUtils, 'readJsonOrQuarantine').mockReturnValue(undefined);
  });

  it('getGlobalConfig returns the stored config', () => {
    expect(service.getGlobalConfig()).toEqual(stored);
  });

  describe('toPublicGlobalConfig', () => {
    it('replaces the password with whether one is set', () => {
      const shown = toPublicGlobalConfig(stored);

      expect(shown).not.toHaveProperty('authenticationPassword');
      expect(shown).toEqual({ ...stored, authenticationPassword: undefined, authenticationPasswordSet: true });
      expect(toPublicGlobalConfig({ ...stored, authenticationPassword: '' }).authenticationPasswordSet).toBe(false);
    });
  });

  describe('updateGlobalConfig', () => {
    it('saves and returns the updated config', async () => {
      const result = await service.updateGlobalConfig({ ...stored, webServerPort: 3001 }, ADMIN);

      expect(result).toEqual({ success: true, updatedConfig: stored });
      expect(save).toHaveBeenCalledWith({ ...stored, webServerPort: 3001 });
    });

    it.each([
      ['absent', undefined],
      ['empty', '']
    ])('keeps the stored password when the new one is %s', async (_label, password) => {
      const { authenticationPassword, ...shown } = stored;

      await service.updateGlobalConfig({ ...shown, authenticationPasswordSet: true, authenticationPassword: password }, ADMIN);

      expect(save).toHaveBeenCalledWith({ ...stored });
    });

    it('stores a new password exactly as typed', async () => {
      await service.updateGlobalConfig({ ...stored, authenticationPassword: '  new secret  ' }, ADMIN);

      expect(save).toHaveBeenCalledWith(expect.objectContaining({ authenticationPassword: '  new secret  ' }));
    });

    it('never stores the authenticationPasswordSet flag', async () => {
      await service.updateGlobalConfig({ ...stored, authenticationPasswordSet: true }, ADMIN);

      expect(save.mock.calls[0][0]).not.toHaveProperty('authenticationPasswordSet');
    });

    it('cleans the username', async () => {
      await service.updateGlobalConfig({ ...stored, authenticationUsername: ' admin\x00 ' }, ADMIN);

      expect(save).toHaveBeenCalledWith(expect.objectContaining({ authenticationUsername: 'admin' }));
    });

    it.each([
      ['changed', { authenticationEnabled: false, authenticationUsername: 'mallory', authenticationPassword: 'hijack' }],
      ['cleared', { authenticationEnabled: false, authenticationUsername: '', authenticationPassword: undefined }]
    ])('keeps the stored web login when it is %s by a caller who may not change it', async (_label, login) => {
      const result = await service.updateGlobalConfig({ ...stored, webServerPort: 3001, ...login }, { canChangeLogin: false });

      expect(result.success).toBe(true);
      expect(save).toHaveBeenCalledWith({ ...stored, webServerPort: 3001 });
    });

    it('keeps the stored web login when a caller who may not change it leaves it out', async () => {
      const { authenticationEnabled, authenticationUsername, authenticationPassword, ...rest } = stored;

      await service.updateGlobalConfig({ ...rest, webServerPort: 3001 }, { canChangeLogin: false });

      expect(save).toHaveBeenCalledWith({ ...stored, webServerPort: 3001 });
    });

    it('refuses something that is not a config', async () => {
      await expect(service.updateGlobalConfig(null, ADMIN)).resolves.toEqual({ success: false, error: 'Invalid config object' });
    });

    it('refuses an invalid port', async () => {
      jest.spyOn(validationUtils, 'validatePort').mockReturnValue(false);

      await expect(service.updateGlobalConfig({ webServerPort: 1 }, ADMIN)).resolves.toEqual({ success: false, error: 'Invalid web server port' });
    });

    it('reports a failed save', async () => {
      save.mockReturnValue(false);

      await expect(service.updateGlobalConfig({ webServerPort: 3000 }, ADMIN)).resolves.toEqual({ success: false, error: 'Failed to save configuration' });
    });
  });

  it('getWebServerAuthConfig returns the plain login for the child environment', () => {
    expect(service.getWebServerAuthConfig(stored)).toEqual({ enabled: true, username: 'admin', password: 'stored-secret' });
  });

  describe('buildWebAuthConfig', () => {
    it('hashes the password', async () => {
      await expect(service.buildWebAuthConfig(stored)).resolves.toEqual({ enabled: true, username: 'admin', passwordHash: 'hashed' });
      expect(bcrypt.hash).toHaveBeenCalledWith('stored-secret', 12);
    });

    it('keeps the saved hash while the password is unchanged', async () => {
      // bcrypt salts every hash, so a fresh one for the same password would look like a new
      // login to the web server, which then makes every client reconnect.
      jest.mocked(fsUtils.readJsonOrQuarantine).mockReturnValue({ passwordHash: 'saved-hash-of-stored-secret' });

      await expect(service.buildWebAuthConfig(stored))
        .resolves.toEqual({ enabled: true, username: 'admin', passwordHash: 'saved-hash-of-stored-secret' });
      expect(fsUtils.readJsonOrQuarantine).toHaveBeenCalledWith('/install/data/auth-config.json');
      expect(bcrypt.hash).not.toHaveBeenCalled();
    });

    it('hashes a password that no longer matches the saved hash', async () => {
      jest.mocked(fsUtils.readJsonOrQuarantine).mockReturnValue({ passwordHash: 'saved-hash-of-old-secret' });

      await expect(service.buildWebAuthConfig(stored)).resolves.toMatchObject({ passwordHash: 'hashed' });
    });

    it('hashes afresh when the saved login cannot be read', async () => {
      jest.mocked(fsUtils.readJsonOrQuarantine).mockImplementation(() => { throw new Error('EACCES'); });

      await expect(service.buildWebAuthConfig(stored)).resolves.toMatchObject({ passwordHash: 'hashed' });
    });

    it('leaves the hash empty without a password', async () => {
      await expect(service.buildWebAuthConfig({ ...stored, authenticationPassword: '' }))
        .resolves.toEqual({ enabled: true, username: 'admin', passwordHash: '' });
    });
  });

  describe('updateWebServerAuth', () => {
    it('saves the hashed login and hands the same hash to the web server', async () => {
      const child = { connected: true, send: jest.fn() };

      await service.updateWebServerAuth(stored, child as never);

      const authConfig = { enabled: true, username: 'admin', passwordHash: 'hashed' };
      expect(fs.mkdirSync).toHaveBeenCalledWith('/install/data', { recursive: true });
      expect(fsUtils.writeJsonAtomic).toHaveBeenCalledWith('/install/data/auth-config.json', authConfig, { mode: 0o600 });
      expect(child.send).toHaveBeenCalledWith({ type: 'update-auth-config', authConfig });
      expect(JSON.stringify(child.send.mock.calls)).not.toContain('stored-secret');
    });

    it('sends nothing when the web server is not running', async () => {
      const child = { connected: false, send: jest.fn() };

      await service.updateWebServerAuth(stored, child as never);
      await service.updateWebServerAuth(stored, null);

      expect(child.send).not.toHaveBeenCalled();
      expect(fsUtils.writeJsonAtomic).toHaveBeenCalledTimes(2);
    });
  });
});
