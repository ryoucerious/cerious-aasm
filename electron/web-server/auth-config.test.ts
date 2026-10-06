import * as fs from 'fs';
import bcrypt from 'bcrypt';
import { readJsonOrQuarantine, writeJsonAtomic } from '../utils/fs.utils';
import { UNMATCHABLE_BCRYPT_HASH } from '../types/auth.types';

jest.unmock('crypto');
jest.mock('../utils/fs.utils');
jest.mock('../utils/platform.utils', () => ({ getDefaultInstallDir: () => '/install' }));

import {
  AuthConfig,
  getAuthConfig,
  hashPassword,
  initializeAuth,
  initializeAuthFromEnv,
  legacyLoginFingerprint,
  loadAuthConfig,
  migrateAuthConfig,
  saveAuthConfig,
  setMeshSignInRequired,
  updateAuthConfig,
  verifyPassword
} from './auth-config';

const AUTH_FILE = '/install/data/auth-config.json';
const OLD_AUTH_FILE = '/app/dir/data/auth-config.json';

const mockedFs = jest.mocked(fs);
const mockedBcrypt = jest.mocked(bcrypt);
const mockedRead = jest.mocked(readJsonOrQuarantine);
const mockedWrite = jest.mocked(writeJsonAtomic);

const disabled: AuthConfig = { enabled: false, username: '', passwordHash: '' };

describe('auth-config', () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.AUTH_ENABLED;
    delete process.env.AUTH_USERNAME;
    delete process.env.AUTH_PASSWORD;
    jest.spyOn(process, 'cwd').mockReturnValue('/app/dir');
    mockedRead.mockReturnValue(undefined);
    updateAuthConfig(disabled);
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = env;
  });

  describe('loadAuthConfig', () => {
    it('merges the saved login over the defaults', () => {
      mockedRead.mockReturnValue({ enabled: true, username: 'admin', passwordHash: 'hash' });

      loadAuthConfig();

      expect(mockedRead).toHaveBeenCalledWith(AUTH_FILE);
      expect(getAuthConfig()).toEqual({ enabled: true, username: 'admin', passwordHash: 'hash' });
    });

    it('drops a plaintext password an older version saved, so the next save scrubs it', () => {
      mockedRead.mockReturnValue({ enabled: false, username: 'admin', passwordHash: 'hash', password: 'plaintext' } as never);

      loadAuthConfig();
      saveAuthConfig();

      expect(getAuthConfig()).toEqual({ enabled: false, username: 'admin', passwordHash: 'hash' });
      expect(mockedWrite).toHaveBeenLastCalledWith(
        AUTH_FILE, { enabled: false, username: 'admin', passwordHash: 'hash' }, { mode: 0o600 }
      );
    });

    it('ignores saved fields of the wrong type', () => {
      mockedRead.mockReturnValue({ enabled: 'yes', username: 42, passwordHash: null } as never);

      loadAuthConfig();

      expect(getAuthConfig()).toEqual(disabled);
    });

    it('keeps the defaults when there is no saved login', () => {
      loadAuthConfig();

      expect(getAuthConfig()).toEqual(disabled);
    });

    it('logs and keeps the defaults when the file cannot be read', () => {
      mockedRead.mockImplementation(() => { throw new Error('EACCES'); });

      loadAuthConfig();

      expect(getAuthConfig()).toEqual(disabled);
      expect(console.error).toHaveBeenCalledWith('[auth-config] Failed to load the saved login:', expect.any(Error));
    });
  });

  describe('saveAuthConfig', () => {
    it('writes the file atomically, readable only by the owner', () => {
      updateAuthConfig({ enabled: true, username: 'admin', passwordHash: 'hash' });
      mockedWrite.mockClear();

      saveAuthConfig();

      expect(mockedFs.mkdirSync).toHaveBeenCalledWith('/install/data', { recursive: true });
      expect(mockedWrite).toHaveBeenCalledWith(
        AUTH_FILE, { enabled: true, username: 'admin', passwordHash: 'hash' }, { mode: 0o600 }
      );
    });

    it('logs a failed write', () => {
      mockedWrite.mockImplementationOnce(() => { throw new Error('ENOSPC'); });

      saveAuthConfig();

      expect(console.error).toHaveBeenCalledWith('[auth-config] Failed to save the login:', expect.any(Error));
    });
  });

  describe('migrateAuthConfig', () => {
    function filesExist(...paths: string[]) {
      mockedFs.existsSync.mockImplementation(p => paths.includes(String(p)));
    }

    it('moves the file out of the working directory', () => {
      filesExist(OLD_AUTH_FILE);

      migrateAuthConfig();

      expect(mockedFs.mkdirSync).toHaveBeenCalledWith('/install/data', { recursive: true });
      expect(mockedFs.renameSync).toHaveBeenCalledWith(OLD_AUTH_FILE, AUTH_FILE);
    });

    it('leaves an existing file alone', () => {
      filesExist(OLD_AUTH_FILE, AUTH_FILE);

      migrateAuthConfig();

      expect(mockedFs.renameSync).not.toHaveBeenCalled();
    });

    it('logs a failed move', () => {
      filesExist(OLD_AUTH_FILE);
      mockedFs.renameSync.mockImplementation(() => { throw new Error('EXDEV'); });

      migrateAuthConfig();

      expect(console.error).toHaveBeenCalledWith('[auth-config] Failed to migrate auth-config.json:', expect.any(Error));
    });
  });

  describe('hashPassword', () => {
    it('hashes with cost 12', async () => {
      await expect(hashPassword('secret')).resolves.toBe('hashed_secret');
      expect(mockedBcrypt.hash).toHaveBeenCalledWith('secret', 12);
    });

    it.each([[''], [null], [123]])('refuses %p', async password => {
      await expect(hashPassword(password as string)).rejects.toThrow('Password must be a non-empty string');
    });
  });

  describe('verifyPassword', () => {
    it('reports whether the password matches the hash', async () => {
      mockedBcrypt.compare.mockResolvedValueOnce(true as never).mockResolvedValueOnce(false as never);

      await expect(verifyPassword('secret', 'hash')).resolves.toBe(true);
      await expect(verifyPassword('wrong', 'hash')).resolves.toBe(false);
      expect(mockedBcrypt.compare).toHaveBeenCalledWith('secret', 'hash');
    });

    it('refuses an empty password without hashing', async () => {
      await expect(verifyPassword('', 'hash')).resolves.toBe(false);
      expect(mockedBcrypt.compare).not.toHaveBeenCalled();
    });

    it('refuses a missing hash, but only after a full-cost comparison', async () => {
      mockedBcrypt.compare.mockResolvedValueOnce(true as never).mockResolvedValueOnce(true as never);

      await expect(verifyPassword('secret', '')).resolves.toBe(false);
      await expect(verifyPassword('secret', null as unknown as string)).resolves.toBe(false);
      expect(mockedBcrypt.compare).toHaveBeenCalledWith('secret', UNMATCHABLE_BCRYPT_HASH);
      expect(mockedBcrypt.compare).toHaveBeenCalledTimes(2);
    });

    it('treats a bcrypt error as a mismatch', async () => {
      mockedBcrypt.compare.mockRejectedValueOnce(new Error('bad hash') as never);

      await expect(verifyPassword('secret', 'hash')).resolves.toBe(false);
    });
  });

  describe('updateAuthConfig', () => {
    it('applies and saves a valid login', () => {
      const login = { enabled: true, username: 'admin', passwordHash: 'hash' };

      updateAuthConfig(login);

      expect(getAuthConfig()).toEqual(login);
      expect(mockedWrite).toHaveBeenCalledWith(AUTH_FILE, login, { mode: 0o600 });
    });

    it.each([
      ['no single login', { enabled: true, username: '', passwordHash: '' }],
      ['a username without a password', { enabled: true, username: 'admin', passwordHash: '' }],
      ['a password without a username', { enabled: true, username: '', passwordHash: 'hash' }]
    ])('applies authentication with %s, leaving sign-in to accounts', (_label, login) => {
      // Refusing it would leave the previous login in force, which may be authentication off.
      updateAuthConfig(login);

      expect(getAuthConfig()).toEqual(login);
      expect(mockedWrite).toHaveBeenCalledWith(AUTH_FILE, login, { mode: 0o600 });
      expect(console.error).not.toHaveBeenCalled();
    });

    it('refuses a login whose fields are not text', () => {
      updateAuthConfig({ enabled: true, username: 42, passwordHash: 'hash' } as unknown as AuthConfig);

      expect(console.error).toHaveBeenCalledWith('[auth-config] Refused a malformed login update.');
      expect(getAuthConfig()).toEqual(disabled);
      expect(mockedWrite).not.toHaveBeenCalled();
    });

    it('stores only the login fields', () => {
      updateAuthConfig({ enabled: false, username: 'admin', passwordHash: 'hash', password: 'plaintext' } as AuthConfig);

      expect(getAuthConfig()).toEqual({ enabled: false, username: 'admin', passwordHash: 'hash' });
    });

    it('hands out a copy', () => {
      getAuthConfig().enabled = true;

      expect(getAuthConfig().enabled).toBe(false);
    });
  });

  describe('legacyLoginFingerprint', () => {
    it('changes with the username or the password hash, and only with them', () => {
      updateAuthConfig({ enabled: true, username: 'admin', passwordHash: 'hash-1' });
      const original = legacyLoginFingerprint();

      expect(original).toMatch(/^[0-9a-f]{64}$/);
      expect(legacyLoginFingerprint()).toBe(original);

      updateAuthConfig({ enabled: false, username: 'admin', passwordHash: 'hash-1' });
      expect(legacyLoginFingerprint()).toBe(original);

      updateAuthConfig({ enabled: true, username: 'admin', passwordHash: 'hash-2' });
      expect(legacyLoginFingerprint()).not.toBe(original);

      updateAuthConfig({ enabled: true, username: 'owner', passwordHash: 'hash-1' });
      expect(legacyLoginFingerprint()).not.toBe(original);
    });

    it('fingerprints a login it is given as it would the current one', () => {
      updateAuthConfig({ enabled: true, username: 'admin', passwordHash: 'hash-1' });
      const snapshot = getAuthConfig();
      const original = legacyLoginFingerprint();

      updateAuthConfig({ enabled: true, username: 'admin', passwordHash: 'hash-2' });

      expect(legacyLoginFingerprint(snapshot)).toBe(original);
      expect(legacyLoginFingerprint()).not.toBe(original);
    });
  });

  // A mesh member's web interface controls servers on every node.
  describe('in a mesh', () => {
    afterEach(() => setMeshSignInRequired(false));

    it('requires sign-in, with mesh accounts only, while this machine\'s own login is off', () => {
      updateAuthConfig({ enabled: false, username: 'admin', passwordHash: 'hash' });

      setMeshSignInRequired(true);

      expect(getAuthConfig()).toEqual({ enabled: true, username: '', passwordHash: '' });
    });

    it('keeps this machine\'s own login when it is on', () => {
      updateAuthConfig({ enabled: true, username: 'admin', passwordHash: 'hash' });

      setMeshSignInRequired(true);

      expect(getAuthConfig()).toEqual({ enabled: true, username: 'admin', passwordHash: 'hash' });
    });

    it('goes back to this machine\'s own login after leaving, having never saved over it', () => {
      updateAuthConfig({ enabled: false, username: 'admin', passwordHash: 'hash' });
      mockedWrite.mockClear();

      setMeshSignInRequired(true);
      setMeshSignInRequired(false);

      expect(getAuthConfig()).toEqual({ enabled: false, username: 'admin', passwordHash: 'hash' });
      expect(mockedWrite).not.toHaveBeenCalled();
    });

    it('stops honouring a session of the single login while only the mesh requires sign-in', () => {
      updateAuthConfig({ enabled: false, username: 'admin', passwordHash: 'hash' });
      const own = legacyLoginFingerprint();

      setMeshSignInRequired(true);

      expect(legacyLoginFingerprint()).not.toBe(own);
    });
  });

  describe('initializeAuthFromEnv', () => {
    it('sets the login from AUTH_ENABLED, AUTH_USERNAME and AUTH_PASSWORD', async () => {
      Object.assign(process.env, { AUTH_ENABLED: 'true', AUTH_USERNAME: 'envuser', AUTH_PASSWORD: 'envpassword' });

      await initializeAuthFromEnv();

      expect(getAuthConfig()).toEqual({ enabled: true, username: 'envuser', passwordHash: 'hashed_envpassword' });
      expect(mockedWrite).toHaveBeenCalled();
    });

    it('defaults the username to admin', async () => {
      Object.assign(process.env, { AUTH_ENABLED: 'true', AUTH_PASSWORD: 'envpassword' });

      await initializeAuthFromEnv();

      expect(getAuthConfig().username).toBe('admin');
    });

    it('overrides the saved login', async () => {
      mockedRead.mockReturnValue({ enabled: true, username: 'saved', passwordHash: 'saved-hash' });
      mockedBcrypt.compare.mockResolvedValueOnce(false as never);
      Object.assign(process.env, { AUTH_ENABLED: 'true', AUTH_USERNAME: 'envuser', AUTH_PASSWORD: 'envpassword' });

      await initializeAuthFromEnv();

      expect(getAuthConfig()).toEqual({ enabled: true, username: 'envuser', passwordHash: 'hashed_envpassword' });
    });

    it('keeps the saved hash while AUTH_PASSWORD still matches it', async () => {
      // A fresh salt on every start would sign out every legacy session at each restart.
      mockedRead.mockReturnValue({ enabled: true, username: 'saved', passwordHash: 'saved-hash' });
      Object.assign(process.env, { AUTH_ENABLED: 'true', AUTH_USERNAME: 'saved', AUTH_PASSWORD: 'envpassword' });

      await initializeAuthFromEnv();

      expect(mockedBcrypt.compare).toHaveBeenCalledWith('envpassword', 'saved-hash');
      expect(mockedBcrypt.hash).not.toHaveBeenCalled();
      expect(getAuthConfig()).toEqual({ enabled: true, username: 'saved', passwordHash: 'saved-hash' });
    });

    it('enables auth without a password, leaving sign-in to accounts', async () => {
      // Leaving it disabled here would serve the web interface to anyone who can reach it.
      process.env.AUTH_ENABLED = 'true';

      await initializeAuthFromEnv();

      expect(getAuthConfig().enabled).toBe(true);
    });

    it('keeps the saved login when AUTH_ENABLED is not "true"', async () => {
      mockedRead.mockReturnValue({ enabled: true, username: 'saved', passwordHash: 'saved-hash' });
      Object.assign(process.env, { AUTH_ENABLED: 'false', AUTH_PASSWORD: 'envpassword' });

      await initializeAuthFromEnv();

      expect(getAuthConfig()).toEqual({ enabled: true, username: 'saved', passwordHash: 'saved-hash' });
      expect(mockedWrite).not.toHaveBeenCalled();
    });
  });

  describe('initializeAuth', () => {
    it('migrates the old file before loading the login', async () => {
      mockedFs.existsSync.mockImplementation(p => p === OLD_AUTH_FILE);

      await initializeAuth();

      expect(mockedFs.renameSync.mock.invocationCallOrder[0]).toBeLessThan(mockedRead.mock.invocationCallOrder[0]);
    });

    it('logs instead of failing when the environment login cannot be hashed', async () => {
      Object.assign(process.env, { AUTH_ENABLED: 'true', AUTH_PASSWORD: 'envpassword' });
      mockedBcrypt.hash.mockRejectedValueOnce(new Error('out of memory') as never);

      await expect(initializeAuth()).resolves.toBeUndefined();

      expect(console.error).toHaveBeenCalledWith('[auth-config] Failed to initialize authentication:', expect.any(Error));
    });
  });
});
