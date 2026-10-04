jest.unmock('crypto');

import * as crypto from 'crypto';
import * as fs from 'fs';
import { getDefaultInstallDir } from './platform.utils';
import { writeFileAtomic } from './fs.utils';
import {
  SESSION_MAX_AGE_MS,
  SessionData,
  deleteSession,
  getSession,
  initializeSecureSessionStore,
  invalidateSessionsFor,
  resetSessionStore,
  setSession
} from './session-store.utils';

jest.mock('./platform.utils');
jest.mock('./fs.utils');

const DATA_DIR = '/install/data';
const SESSION_FILE = `${DATA_DIR}/sessions.enc`;
const KEY_FILE = `${DATA_DIR}/session.key`;
const KEY = 'ab'.repeat(32);

const mockedFs = jest.mocked(fs);
const mockedWriteFileAtomic = jest.mocked(writeFileAtomic);

/** What is on "disk", by path. */
let disk: Map<string, string>;

function encrypt(text: string, key = KEY): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const encrypted = cipher.update(text, 'utf8', 'hex') + cipher.final('hex');
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted}`;
}

function decrypt(data: string, key = KEY): unknown {
  const [iv, tag, encrypted] = data.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return JSON.parse(decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8'));
}

/** The process restarts: the in-memory store is gone and the next call reloads from disk. */
function restart(): void {
  resetSessionStore();
}

function session(overrides: Partial<SessionData> = {}): SessionData {
  return {
    username: 'viewer1',
    created: new Date(),
    userId: 'u-1',
    roleId: 'viewer',
    permissions: ['servers.view'],
    ...overrides
  };
}

describe('session-store.utils', () => {
  beforeEach(() => {
    resetSessionStore();
    disk = new Map([[KEY_FILE, KEY]]);
    jest.mocked(getDefaultInstallDir).mockReturnValue('/install');
    mockedFs.existsSync.mockImplementation(p => p === DATA_DIR || disk.has(String(p)));
    mockedFs.readFileSync.mockImplementation(((p: string) => {
      const content = disk.get(String(p));
      if (content === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return content;
    }) as typeof fs.readFileSync);
    mockedWriteFileAtomic.mockImplementation((p, data) => { disk.set(p, String(data)); });
  });

  afterEach(() => {
    resetSessionStore();
  });

  it('keeps userId, roleId and permissions across a restart', () => {
    const saved = session({ userId: 'u-7', roleId: 'operator', permissions: ['servers.view', 'rcon.use'] });
    setSession('token-1', saved);

    restart();

    expect(getSession('token-1')).toEqual(saved);
  });

  it('saves a versioned store that only the owner can read', () => {
    setSession('token-1', session());

    expect(mockedWriteFileAtomic).toHaveBeenLastCalledWith(SESSION_FILE, expect.any(String), { mode: 0o600 });
    expect(decrypt(disk.get(SESSION_FILE)!)).toEqual({
      version: 2,
      sessions: [expect.objectContaining({ token: 'token-1', userId: 'u-1', roleId: 'viewer' })]
    });
  });

  it('discards a session file in the old array format and says so once', () => {
    // Saved before sessions kept userId; restoring these would make every one of them an admin.
    const legacy = [['token-1', { username: 'viewer1', created: new Date().toISOString() }]];
    disk.set(SESSION_FILE, encrypt(JSON.stringify(legacy)));
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});

    expect(getSession('token-1')).toBeUndefined();
    expect(info).toHaveBeenCalledTimes(1);
    expect(decrypt(disk.get(SESSION_FILE)!)).toEqual({ version: 2, sessions: [] });

    restart();
    expect(getSession('token-1')).toBeUndefined();
    expect(info).toHaveBeenCalledTimes(1);
  });

  it('refuses and forgets an expired session', () => {
    setSession('old', session({ created: new Date(Date.now() - SESSION_MAX_AGE_MS - 1000) }));

    expect(getSession('old')).toBeUndefined();
    restart();
    expect(getSession('old')).toBeUndefined();
    expect((decrypt(disk.get(SESSION_FILE)!) as { sessions: unknown[] }).sessions).toEqual([]);
  });

  it('does not restore an expired session from disk', () => {
    const created = new Date(Date.now() - SESSION_MAX_AGE_MS - 1000).toISOString();
    disk.set(SESSION_FILE, encrypt(JSON.stringify({
      version: 2,
      sessions: [{ token: 'old', username: 'viewer1', created, userId: 'u-1', roleId: 'viewer', permissions: [] }]
    })));

    expect(getSession('old')).toBeUndefined();
  });

  it('skips malformed entries and keeps the rest', () => {
    disk.set(SESSION_FILE, encrypt(JSON.stringify({
      version: 2,
      sessions: [
        { token: 'bad', username: 42, created: 'not a date' },
        { token: 'good', username: 'viewer1', created: new Date().toISOString(), userId: 'u-1' }
      ]
    })));

    expect(getSession('bad')).toBeUndefined();
    expect(getSession('good')).toMatchObject({ username: 'viewer1', userId: 'u-1' });
  });

  it('starts empty, without logging the file, when it cannot be decrypted', () => {
    disk.set(SESSION_FILE, encrypt(JSON.stringify({ version: 2, sessions: [] }), 'cd'.repeat(32)));

    expect(() => initializeSecureSessionStore()).not.toThrow();
    expect(getSession('token-1')).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(SESSION_FILE));
  });

  it('deletes a session', () => {
    setSession('token-1', session());

    expect(deleteSession('token-1')).toBe(true);
    expect(deleteSession('token-1')).toBe(false);
    expect(getSession('token-1')).toBeUndefined();
  });

  it('drops the sessions of one user or of everyone holding a role', () => {
    setSession('a', session({ userId: 'u-1', roleId: 'viewer' }));
    setSession('b', session({ userId: 'u-2', roleId: 'viewer' }));
    setSession('c', session({ userId: 'u-3', roleId: 'operator' }));

    expect(invalidateSessionsFor({ userId: 'u-3' })).toEqual(['c']);
    expect(invalidateSessionsFor({ roleId: 'viewer' })).toEqual(['a', 'b']);
    expect([getSession('a'), getSession('b'), getSession('c')]).toEqual([undefined, undefined, undefined]);
  });

  it('keeps the login fingerprint of a legacy session across a restart', () => {
    setSession('legacy', { username: 'admin', created: new Date(), loginFingerprint: 'fp-1' });

    restart();

    expect(getSession('legacy')).toEqual(expect.objectContaining({ username: 'admin', loginFingerprint: 'fp-1' }));
    expect(getSession('legacy')?.userId).toBeUndefined();
  });

  describe('encryption key', () => {
    it('creates a key readable only by the owner when there is none', () => {
      disk.delete(KEY_FILE);

      initializeSecureSessionStore();

      expect(mockedWriteFileAtomic).toHaveBeenCalledWith(KEY_FILE, expect.stringMatching(/^[0-9a-f]{64}$/), { mode: 0o600 });
    });

    it('keeps sessions in memory when the key cannot be saved', () => {
      disk.delete(KEY_FILE);
      mockedWriteFileAtomic.mockImplementationOnce(() => { throw new Error('EACCES'); });

      setSession('token-1', session());

      expect(getSession('token-1')).toMatchObject({ userId: 'u-1' });
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining(KEY_FILE), expect.any(Error));
    });

    it('replaces a key file that does not hold a 256-bit hex key', () => {
      disk.set(KEY_FILE, 'truncated');

      setSession('token-1', session());
      restart();

      expect(disk.get(KEY_FILE)).toMatch(/^[0-9a-f]{64}$/);
      expect(getSession('token-1')).toMatchObject({ userId: 'u-1' });
    });
  });
});
