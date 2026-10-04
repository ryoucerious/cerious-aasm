import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDefaultInstallDir } from './platform.utils';
import { writeFileAtomic } from './fs.utils';
import type { Permission } from '../types/auth.types';

/** A session older than this is refused and pruned. */
export const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const STORE_VERSION = 2;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const KEY_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Carries the resolved account so the WebSocket handshake needs no database round trip.
 * `userId` is absent for the legacy single login, which has no database user; its sessions carry
 * `loginFingerprint` instead, the login they were made with.
 */
export interface SessionData {
  username: string;
  created: Date;
  userId?: string;
  roleId?: string;
  permissions?: Permission[];
  loginFingerprint?: string;
}

interface StoredSession {
  token: string;
  username: string;
  created: string;
  userId?: string;
  roleId?: string;
  permissions?: string[];
  loginFingerprint?: string;
}

interface StoreFile {
  version: typeof STORE_VERSION;
  sessions: StoredSession[];
}

let sessions = new Map<string, SessionData>();
let sessionFile = '';
let encryptionKey = '';
let initialized = false;
let cleanupInterval: NodeJS.Timeout | null = null;

export function initializeSecureSessionStore(): void {
  if (initialized) return;

  const installDataDir = path.join(getDefaultInstallDir(), 'data');
  migrateFromWorkingDirectory(installDataDir);

  sessionFile = path.join(installDataDir, 'sessions.enc');
  encryptionKey = loadOrCreateEncryptionKey(path.join(installDataDir, 'session.key'));
  initialized = true;
  loadSessions();

  if (!cleanupInterval) {
    cleanupInterval = setInterval(() => cleanupExpiredSessions(), CLEANUP_INTERVAL_MS);
    cleanupInterval.unref();
  }
}

// Older versions kept these files under process.cwd()/data, which moves with the app.
function migrateFromWorkingDirectory(installDataDir: string): void {
  const oldDataDir = path.join(process.cwd(), 'data');
  try {
    if (!fs.existsSync(installDataDir)) {
      fs.mkdirSync(installDataDir, { recursive: true });
    }
    for (const name of ['sessions.enc', 'session.key']) {
      const from = path.join(oldDataDir, name);
      const to = path.join(installDataDir, name);
      if (fs.existsSync(from) && !fs.existsSync(to)) {
        try {
          fs.renameSync(from, to);
        } catch (error) {
          console.error(`[session-store] Failed to migrate ${name}:`, error);
        }
      }
    }
  } catch (error) {
    console.error('[session-store] Migration check failed:', error);
  }
}

function loadOrCreateEncryptionKey(keyFile: string): string {
  if (fs.existsSync(keyFile)) {
    const key = fs.readFileSync(keyFile, 'utf8').trim();
    if (KEY_PATTERN.test(key)) {
      return key;
    }
    console.warn(`[session-store] ${keyFile} does not hold a valid key; replacing it, so everyone signs in again`);
  }
  const key = crypto.randomBytes(32).toString('hex');
  try {
    writeFileAtomic(keyFile, key, { mode: 0o600 });
  } catch (error) {
    console.error(`[session-store] Could not save ${keyFile}; sessions will not survive a restart:`, error);
  }
  return key;
}

function encrypt(data: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), iv);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function decrypt(encryptedData: string): string {
  const [iv, authTag, encrypted] = encryptedData.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function loadSessions(): void {
  let stored: unknown;
  try {
    if (!fs.existsSync(sessionFile)) return;
    const encryptedData = fs.readFileSync(sessionFile, 'utf8');
    if (!encryptedData.trim()) return;
    stored = JSON.parse(decrypt(encryptedData));
  } catch {
    // Not the error itself: a JSON syntax error would quote the decrypted file, live tokens included.
    console.error(`[session-store] Could not read ${sessionFile}; starting with no sessions`);
    return;
  }

  // Sessions saved before version 2 lost their userId on load, so any of them could be a
  // demoted or deleted user who would now read as the legacy admin.
  if (Array.isArray(stored)) {
    console.info('[session-store] Discarded sessions saved by an older version; everyone signs in again');
    saveSessions();
    return;
  }
  if (!isStoreFile(stored)) {
    console.error(`[session-store] ${sessionFile} has an unknown format; starting with no sessions`);
    return;
  }

  for (const entry of stored.sessions) {
    const session = toSession(entry);
    if (session && !isExpired(session)) {
      sessions.set(entry.token, session);
    }
  }
}

function isStoreFile(value: unknown): value is StoreFile {
  const file = value as StoreFile | null;
  return typeof file === 'object' && file !== null && file.version === STORE_VERSION && Array.isArray(file.sessions);
}

function toSession(entry: StoredSession): SessionData | null {
  const created = new Date(entry?.created);
  if (typeof entry?.token !== 'string' || typeof entry.username !== 'string' || Number.isNaN(created.getTime())) {
    return null;
  }
  return {
    username: entry.username,
    created,
    userId: typeof entry.userId === 'string' ? entry.userId : undefined,
    roleId: typeof entry.roleId === 'string' ? entry.roleId : undefined,
    permissions: Array.isArray(entry.permissions)
      ? entry.permissions.filter((p): p is Permission => typeof p === 'string')
      : undefined,
    loginFingerprint: typeof entry.loginFingerprint === 'string' ? entry.loginFingerprint : undefined
  };
}

function saveSessions(): void {
  const file: StoreFile = {
    version: STORE_VERSION,
    sessions: Array.from(sessions, ([token, session]) => ({
      token,
      username: session.username,
      created: session.created.toISOString(),
      userId: session.userId,
      roleId: session.roleId,
      permissions: session.permissions,
      loginFingerprint: session.loginFingerprint
    }))
  };
  try {
    writeFileAtomic(sessionFile, encrypt(JSON.stringify(file)), { mode: 0o600 });
  } catch (error) {
    console.error('[session-store] Failed to save sessions:', error);
  }
}

function isExpired(session: SessionData, now = Date.now()): boolean {
  return now - session.created.getTime() > SESSION_MAX_AGE_MS;
}

function cleanupExpiredSessions(): void {
  const now = Date.now();
  let cleaned = 0;
  for (const [token, session] of sessions) {
    if (isExpired(session, now)) {
      sessions.delete(token);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    saveSessions();
  }
}

export function setSession(token: string, data: SessionData): void {
  initializeSecureSessionStore();
  sessions.set(token, data);
  saveSessions();
}

/** The session behind a token; undefined when unknown or expired (an expired one is removed). */
export function getSession(token: string): SessionData | undefined {
  initializeSecureSessionStore();
  const session = sessions.get(token);
  if (session && isExpired(session)) {
    sessions.delete(token);
    saveSessions();
    return undefined;
  }
  return session;
}

export function deleteSession(token: string): boolean {
  initializeSecureSessionStore();
  const removed = sessions.delete(token);
  if (removed) {
    saveSessions();
  }
  return removed;
}

/**
 * Remove sessions for one user, or for everyone with a given role, so a demoted, disabled or
 * deleted account loses its rights now. Returns the tokens of the dropped sessions.
 */
export function invalidateSessionsFor(filter: { userId?: string; roleId?: string }): string[] {
  initializeSecureSessionStore();
  const removed: string[] = [];
  for (const [token, session] of sessions) {
    const matchesUser = filter.userId && session.userId === filter.userId;
    const matchesRole = filter.roleId && session.roleId === filter.roleId;
    if (matchesUser || matchesRole) {
      sessions.delete(token);
      removed.push(token);
    }
  }
  if (removed.length > 0) saveSessions();
  return removed;
}

/** Forget all in-memory state, as a process restart would. For tests. */
export function resetSessionStore(): void {
  sessions = new Map();
  initialized = false;
  sessionFile = '';
  encryptionKey = '';
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
