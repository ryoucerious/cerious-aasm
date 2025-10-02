import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDefaultInstallDir } from './platform.utils';

/**
 * Session data interface
 */
export interface SessionData {
  username: string;
  created: Date;
}

// Module-level state
let sessions = new Map<string, SessionData>();
let sessionFile: string;
let encryptionKey: string;
let initialized = false;
let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Initialize the secure session store
 * Must be called before using other functions
 */
export function initializeSecureSessionStore(): void {
  if (initialized) return;

  // Use the installation directory for session storage. If older files exist in
  // the app folder (process.cwd()/data), migrate them on startup.
  const installDataDir = path.join(getDefaultInstallDir(), 'data');
  const oldDataDir = path.join(process.cwd(), 'data');
  const oldSessionFile = path.join(oldDataDir, 'sessions.enc');
  const oldKeyFile = path.join(oldDataDir, 'session.key');
  const newSessionFile = path.join(installDataDir, 'sessions.enc');
  const newKeyFile = path.join(installDataDir, 'session.key');

  try {
    // Ensure install data dir exists
    if (!fs.existsSync(installDataDir)) {
      fs.mkdirSync(installDataDir, { recursive: true });
    }

    // Migrate existing files from old location if present and not already migrated
    if (fs.existsSync(oldSessionFile) && !fs.existsSync(newSessionFile)) {
      try {
        fs.renameSync(oldSessionFile, newSessionFile);
      } catch (e) {
        console.error('[Session] Failed to migrate sessions.enc:', e);
      }
    }

    if (fs.existsSync(oldKeyFile) && !fs.existsSync(newKeyFile)) {
      try {
        fs.renameSync(oldKeyFile, newKeyFile);
      } catch (e) {
        console.error('[Session] Failed to migrate session.key:', e);
      }
    }
  } catch (e) {
    console.error('[Session] Migration check failed:', e);
  }

  // Set the active file locations to the install directory
  sessionFile = newSessionFile;
  encryptionKey = getOrCreateEncryptionKey();
  loadSessions();

  // Clean up expired sessions every hour (only start once)
  if (!cleanupInterval) {
    cleanupInterval = setInterval(() => cleanupExpiredSessions(), 60 * 60 * 1000);
  }

  initialized = true;
}

/**
 * Get or create encryption key
 */
function getOrCreateEncryptionKey(): string {
  const keyFile = path.join(getDefaultInstallDir(), 'data', 'session.key');

  // Ensure data directory exists
  const dataDir = path.dirname(keyFile);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (fs.existsSync(keyFile)) {
    return fs.readFileSync(keyFile, 'utf8');
  } else {
    const key = crypto.randomBytes(32).toString('hex');
    try {
      fs.writeFileSync(keyFile, key, { mode: 0o600 }); // Restricted permissions
    } catch (e) {
      // On some platforms, mode may be ignored; still attempt to write
      fs.writeFileSync(keyFile, key);
    }
    return key;
  }
}

/**
 * Encrypt data
 */
function encrypt(data: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), iv);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt data
 */
function decrypt(encryptedData: string): string {
  const parts = encryptedData.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(encryptionKey, 'hex'), iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Load sessions from file
 */
function loadSessions(): void {
  try {
    if (fs.existsSync(sessionFile)) {
      const encryptedData = fs.readFileSync(sessionFile, 'utf8');
      if (encryptedData.trim()) {
        const decryptedData = decrypt(encryptedData);
        const sessionArray = JSON.parse(decryptedData);

        // Convert back to Map and validate dates
        for (const [token, data] of sessionArray) {
          sessions.set(token, {
            username: data.username,
            created: new Date(data.created)
          });
        }
      }
    }
  } catch (error) {
    console.error('[Session] Failed to load sessions:', error);
    sessions.clear();
  }
}

/**
 * Save sessions to file
 */
function saveSessions(): void {
  try {
    // Ensure data directory exists
    const dataDir = path.dirname(sessionFile);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const sessionArray = Array.from(sessions.entries());
    const encryptedData = encrypt(JSON.stringify(sessionArray));
    fs.writeFileSync(sessionFile, encryptedData, { mode: 0o600 });
  } catch (error) {
    console.error('[Session] Failed to save sessions:', error);
  }
}

/**
 * Clean up expired sessions
 */
function cleanupExpiredSessions(): void {
  const now = new Date();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  let cleaned = 0;

  for (const [token, session] of sessions.entries()) {
    const sessionAge = now.getTime() - session.created.getTime();
    if (sessionAge > maxAge) {
      sessions.delete(token);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    saveSessions();
  }
}

/**
 * Set a session
 * @param token - Session token
 * @param data - Session data
 */
export function setSession(token: string, data: SessionData): void {
  if (!initialized) initializeSecureSessionStore();
  sessions.set(token, data);
  saveSessions();
}

/**
 * Get a session
 * @param token - Session token
 * @returns Session data or undefined if not found
 */
export function getSession(token: string): SessionData | undefined {
  if (!initialized) initializeSecureSessionStore();
  return sessions.get(token);
}

/**
 * Delete a session
 * @param token - Session token
 * @returns True if session was deleted
 */
export function deleteSession(token: string): boolean {
  if (!initialized) initializeSecureSessionStore();
  const result = sessions.delete(token);
  if (result) {
    saveSessions();
  }
  return result;
}

/**
 * Check if a session exists
 * @param token - Session token
 * @returns True if session exists
 */
export function hasSession(token: string): boolean {
  if (!initialized) initializeSecureSessionStore();
  return sessions.has(token);
}

/**
 * Reset the session store (for testing purposes)
 */
export function resetSessionStore(): void {
  sessions.clear();
  initialized = false;
  sessionFile = '';
  encryptionKey = '';
  
  // Clear the cleanup interval
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}