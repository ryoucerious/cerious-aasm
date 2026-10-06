import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { getDefaultInstallDir } from '../utils/platform.utils';
import { readJsonOrQuarantine, writeJsonAtomic } from '../utils/fs.utils';
import { UNMATCHABLE_BCRYPT_HASH } from '../types/auth.types';

const SALT_ROUNDS = 12;

/** The single web login that predates accounts. */
export interface AuthConfig {
  enabled: boolean;
  username: string;
  passwordHash: string;
}

let authConfig: AuthConfig = {
  enabled: false,
  username: '',
  passwordHash: ''
};

const authConfigFile = path.join(getDefaultInstallDir(), 'data', 'auth-config.json');

export function loadAuthConfig(): void {
  try {
    const saved = readJsonOrQuarantine<Record<string, unknown>>(authConfigFile);
    if (saved) {
      authConfig = {
        enabled: typeof saved.enabled === 'boolean' ? saved.enabled : authConfig.enabled,
        username: typeof saved.username === 'string' ? saved.username : authConfig.username,
        passwordHash: typeof saved.passwordHash === 'string' ? saved.passwordHash : authConfig.passwordHash
      };
    }
  } catch (error) {
    console.error('[auth-config] Failed to load the saved login:', error);
  }
}

// Main writes this file too (settings.service updateWebServerAuth); both writes are atomic.
export function saveAuthConfig(): void {
  try {
    fs.mkdirSync(path.dirname(authConfigFile), { recursive: true });
    writeJsonAtomic(authConfigFile, authConfig, { mode: 0o600 });
  } catch (error) {
    console.error('[auth-config] Failed to save the login:', error);
  }
}

/** Older versions kept the file under process.cwd()/data, which moves with the app. */
export function migrateAuthConfig(): void {
  try {
    const oldAuthFile = path.join(process.cwd(), 'data', 'auth-config.json');
    const newAuthDir = path.dirname(authConfigFile);

    if (!fs.existsSync(newAuthDir)) {
      fs.mkdirSync(newAuthDir, { recursive: true });
    }

    if (fs.existsSync(oldAuthFile) && !fs.existsSync(authConfigFile)) {
      try {
        fs.renameSync(oldAuthFile, authConfigFile);
      } catch (error) {
        console.error('[auth-config] Failed to migrate auth-config.json:', error);
      }
    }
  } catch (error) {
    console.error('[auth-config] Migration check failed:', error);
  }
}

export async function hashPassword(password: string): Promise<string> {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }
  return bcrypt.hash(password, SALT_ROUNDS);
}

/** False for a missing hash as well, but only after a full-cost comparison, so timing tells nothing. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!password || typeof password !== 'string') {
    return false;
  }
  const usable = typeof hash === 'string' && hash.length > 0;
  try {
    const matches = await bcrypt.compare(password, usable ? hash : UNMATCHABLE_BCRYPT_HASH);
    return usable && matches;
  } catch (error) {
    console.error('[auth-config] Password verification error:', error);
    return false;
  }
}

/**
 * An empty username or password hash is accepted: authentication stays on and only accounts can
 * sign in, since the single login needs both (see the login route).
 */
export function updateAuthConfig(config: AuthConfig): void {
  if (typeof config.enabled !== 'boolean' || typeof config.username !== 'string' || typeof config.passwordHash !== 'string') {
    console.error('[auth-config] Refused a malformed login update.');
    return;
  }

  // Only these fields: an older version saved a plaintext password alongside them.
  authConfig = { enabled: config.enabled, username: config.username, passwordHash: config.passwordHash };
  saveAuthConfig();
}

/**
 * The login in force. In a mesh, sign-in is required even where this machine's own login is off,
 * and then only mesh accounts sign in: the single login was never meant to be in force. The
 * saved login is never changed for it, so leaving the mesh puts this machine's own back.
 */
export function getAuthConfig(): AuthConfig {
  if (meshSignInRequired && !authConfig.enabled) return { enabled: true, username: '', passwordHash: '' };
  return { ...authConfig };
}

let meshSignInRequired = false;

/** Set by main while this node is in a mesh. */
export function setMeshSignInRequired(required: boolean): void {
  meshSignInRequired = required;
}

/**
 * Identifies a legacy login's username and password hash (the login in force by default). A legacy
 * session is stamped with it, so a login changed since (even while the server was down) no longer
 * honours the session.
 */
export function legacyLoginFingerprint(login: Pick<AuthConfig, 'username' | 'passwordHash'> = getAuthConfig()): string {
  return crypto.createHash('sha256').update(JSON.stringify([login.username, login.passwordHash])).digest('hex');
}

/** Applies AUTH_ENABLED / AUTH_USERNAME / AUTH_PASSWORD, which main sets when it forks this process. */
export async function initializeAuthFromEnv(): Promise<void> {
  loadAuthConfig();
  // Set by main for a mesh member, so sign-in is on from the first request rather than from
  // the message main sends once this process is ready.
  setMeshSignInRequired(process.env.AASM_MESH_SIGN_IN === '1');

  const authEnabled = process.env.AUTH_ENABLED === 'true';
  const authUsername = process.env.AUTH_USERNAME || 'admin';
  const authPassword = process.env.AUTH_PASSWORD || '';

  if (authEnabled && authPassword) {
    // bcrypt salts every hash, so a fresh one for the same password would change the login's
    // fingerprint and sign out every legacy session at each restart.
    const unchanged = await verifyPassword(authPassword, authConfig.passwordHash);
    authConfig = {
      enabled: true,
      username: authUsername,
      passwordHash: unchanged ? authConfig.passwordHash : await hashPassword(authPassword)
    };
    saveAuthConfig();
  } else if (authEnabled) {
    // No single password given: accounts are the login. Turning authentication off here
    // instead would leave the web interface open to anyone who can reach it.
    authConfig = { ...authConfig, enabled: true };
    saveAuthConfig();
    console.log('[auth-config] Authentication is on with no single login; accounts are the way in.');
  }
}

export async function initializeAuth(): Promise<void> {
  migrateAuthConfig();
  try {
    await initializeAuthFromEnv();
  } catch (error) {
    // The server still starts, with whatever login was saved before.
    console.error('[auth-config] Failed to initialize authentication:', error);
  }
}
