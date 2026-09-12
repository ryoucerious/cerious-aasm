import * as fs from 'fs';
import * as path from 'path';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { getDefaultInstallDir } from '../../utils/platform.utils';
import {
  ALL_PERMISSIONS, BUILT_IN_ROLES, ROLE_IDS, Permission, Role, User, AuthenticatedUser,
  effectivePermissions
} from '../../types/auth.types';

const SALT_ROUNDS = 12;
const SCHEMA_VERSION = 1;
/** How long to wait before trying again when another instance holds the database. */
const OPEN_RETRY_INTERVAL_MS = 30_000;

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  role_id: string;
  active: number;
  created_at: number;
  updated_at: number;
  last_login_at: number | null;
}

interface RoleRow {
  id: string;
  name: string;
  description: string;
  permissions: string;
  built_in: number;
  created_at: number;
  updated_at: number;
}

export interface CreateUserInput {
  username: string;
  password: string;
  displayName?: string;
  roleId: string;
  active?: boolean;
}

export interface UpdateUserInput {
  id: string;
  username?: string;
  displayName?: string;
  roleId?: string;
  active?: boolean;
  /** When present the password is replaced; an empty string is rejected. */
  password?: string;
}

export interface RoleInput {
  id?: string;
  name: string;
  description?: string;
  permissions: Permission[];
}

export type Result<T> = { success: true; data: T } | { success: false; error: string };

/**
 * The user and role store, backed by SQLite.
 *
 * Owned by the main process alone. The web-server child never opens this file; it asks the
 * main process to verify credentials over the existing process IPC, which avoids two
 * processes writing one SQLite file. The driver is the WebAssembly build, so there is no
 * native module to compile or to rebuild for Electron's ABI.
 *
 * Passwords are bcrypt hashes and never leave this module.
 */
export class UserDatabaseService {
  private db: any = null;
  private dbPath = '';
  /** Path of the file recording which process owns the database. */
  private pidPath = '';
  /** Set when another live process owns the database, so we stop trying to write. */
  private ownedByOtherInstance = false;
  /** When we last tried to open, used to back off while another instance holds the file. */
  private lastOpenAttempt = 0;

  /** Opens (creating if needed) the database and applies the schema. Safe to call repeatedly. */
  initialize(): void {
    if (this.db) return;

    const dataDir = path.join(getDefaultInstallDir(), 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    this.dbPath = path.join(dataDir, 'users.db');
    this.pidPath = `${this.dbPath}.pid`;

    // The driver locks by creating a "<db>.lock" directory around each write and removing it
    // afterwards. A process killed mid-write leaves that directory behind, and from then on
    // every write fails with "database is locked" — busy_timeout does not help, because the
    // lock is a directory rather than SQLite's own contention. Clear it if whoever made it
    // is gone, and leave it alone if that process is still running.
    this.releaseStaleLock();

    try {
      this.openAndPrepare();
    } catch (error) {
      // Opening alone can succeed while the first write fails: the driver only takes the
      // lock when it writes, so the schema statements are where a stale lock shows up.
      this.discardConnection();
      if (!this.isLockError(error)) throw error;
      if (!this.releaseStaleLock()) {
        this.ownedByOtherInstance = true;
        throw error;
      }
      this.openAndPrepare();
    }

    // Claim ownership only once we have actually written, so a failed attempt never
    // overwrites a live instance's claim and mislabels that process as dead.
    this.claimOwnership();
    this.ownedByOtherInstance = false;
  }

  /** Open the file and bring the schema up to date. Throws if either step cannot write. */
  private openAndPrepare(): void {
    // Required lazily so an environment without the driver still starts (tests, odd packaging).
    const { Database } = require('node-sqlite3-wasm');
    this.db = new Database(this.dbPath);
    this.db.exec('PRAGMA foreign_keys = ON');
    // Wait rather than fail if a write briefly overlaps another.
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.applySchema();
    this.seedBuiltInRoles();
  }

  /** Drop a half-opened connection without touching the ownership marker. */
  private discardConnection(): void {
    try {
      this.db?.close();
    } catch {
      // already gone
    }
    this.db = null;
  }

  close(): void {
    try {
      this.db?.close();
    } catch {
      // closing a database that never opened is not an error worth surfacing
    }
    this.db = null;
    // Drop our own ownership marker and lock so the next launch starts clean. If the claim
    // on disk belongs to another live process we never held the lock, so leave both alone.
    try {
      if (!this.pidPath || this.ownerIsAlive()) return;
      if (fs.existsSync(this.pidPath)) fs.rmSync(this.pidPath, { force: true });
      const lockPath = `${this.dbPath}.lock`;
      if (this.dbPath && fs.existsSync(lockPath)) fs.rmSync(lockPath, { recursive: true, force: true });
    } catch (error) {
      console.debug('[user-database] Could not clean up the lock on close:', error);
    }
  }

  /**
   * Run a statement, recovering once from a lock left behind by a dead process.
   *
   * Every write goes through here. A lock held by a process that is still running is left
   * alone — clearing it would let two processes write at once and corrupt the file — so in
   * that case the write is dropped and reported instead.
   */
  private write<T>(operation: () => T): T | undefined {
    try {
      return operation();
    } catch (error) {
      if (!this.isLockError(error)) throw error;
      if (!this.releaseStaleLock()) {
        if (!this.ownedByOtherInstance) {
          this.ownedByOtherInstance = true;
          console.warn('[user-database] Another running instance owns the database; skipping writes from this one.');
        }
        return undefined;
      }
      return operation();
    }
  }

  /** True once at least one user exists, i.e. accounts are actually in use. */
  hasAnyUser(): boolean {
    this.ensureOpen();
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
    return (row?.count ?? 0) > 0;
  }

  // -------------------- Schema --------------------

  private applySchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS roles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        permissions TEXT NOT NULL DEFAULT '[]',
        built_in INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        role_id TEXT NOT NULL REFERENCES roles(id),
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_login_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_id);
      CREATE TABLE IF NOT EXISTS activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        message TEXT NOT NULL,
        instance_id TEXT,
        username TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at DESC);
      CREATE TABLE IF NOT EXISTS player_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id TEXT NOT NULL,
        players INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_player_history_time ON player_history(created_at);
    `);
    this.db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['schema_version', String(SCHEMA_VERSION)]);
  }

  private seedBuiltInRoles(): void {
    const now = Date.now();
    for (const role of BUILT_IN_ROLES) {
      const existing = this.db.prepare('SELECT id FROM roles WHERE id = ?').get(role.id);
      if (existing) {
        // Keep the built-in description and name current with the app, but leave any
        // permission edits the operator made to a non-admin built-in role alone.
        this.db.run('UPDATE roles SET name = ?, description = ?, built_in = 1, updated_at = ? WHERE id = ?',
          [role.name, role.description, now, role.id]);
        continue;
      }
      this.db.run(
        'INSERT INTO roles (id, name, description, permissions, built_in, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
        [role.id, role.name, role.description, JSON.stringify(role.permissions), now, now]
      );
    }
  }

  // -------------------- Activity feed --------------------

  /**
   * Append an entry and trim the table back to `maxEntries`.
   *
   * The trim runs on every write rather than on a timer so the table has a hard ceiling
   * even if the app is killed; deleting by id keeps it a single indexed statement.
   */
  recordActivity(entry: {
    kind: string;
    message: string;
    instanceId?: string | null;
    username?: string | null;
    maxEntries?: number;
  }): void {
    this.ensureOpen();
    this.write(() => {
      this.db.run(
        'INSERT INTO activity (kind, message, instance_id, username, created_at) VALUES (?, ?, ?, ?, ?)',
        [entry.kind, entry.message, entry.instanceId ?? null, entry.username ?? null, Date.now()]
      );

      const max = entry.maxEntries ?? 500;
      this.db.run(
        `DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY id DESC LIMIT ?)`,
        [max]
      );
    });
  }

  /** Most recent first. */
  listActivity(limit = 100): any[] {
    this.ensureOpen();
    const rows = this.db
      .prepare('SELECT id, kind, message, instance_id, username, created_at FROM activity ORDER BY id DESC LIMIT ?')
      .all(Math.max(1, Math.min(500, limit))) as any[];
    return rows.map(row => ({
      id: row.id,
      kind: row.kind,
      message: row.message,
      instanceId: row.instance_id,
      username: row.username,
      createdAt: row.created_at
    }));
  }

  clearActivity(): void {
    this.ensureOpen();
    this.db.run('DELETE FROM activity');
  }

  // -------------------- Player history --------------------

  /**
   * Record one sample: the player count of every instance at a moment in time. Written as
   * one row per instance so the table can be queried per server without unpacking JSON.
   */
  recordPlayerCounts(counts: Record<string, number>, at: number, retentionMs: number): void {
    this.ensureOpen();
    this.write(() => {
      const entries = Object.entries(counts || {});
      for (const [instanceId, players] of entries) {
        const value = Number.isFinite(players) && players > 0 ? Math.round(players) : 0;
        this.db.run('INSERT INTO player_history (instance_id, players, created_at) VALUES (?, ?, ?)',
          [instanceId, value, at]);
      }
      this.db.run('DELETE FROM player_history WHERE created_at < ?', [at - retentionMs]);
    });
  }

  /**
   * Samples inside the retention window, shaped the way the dashboard expects: one entry per
   * timestamp with a count per instance.
   */
  listPlayerHistory(sinceMs: number): { t: number; counts: Record<string, number> }[] {
    this.ensureOpen();
    const rows = this.db
      .prepare('SELECT instance_id, players, created_at FROM player_history WHERE created_at >= ? ORDER BY created_at ASC')
      .all(sinceMs) as { instance_id: string; players: number; created_at: number }[];

    const byTime = new Map<number, Record<string, number>>();
    for (const row of rows) {
      let bucket = byTime.get(row.created_at);
      if (!bucket) {
        bucket = {};
        byTime.set(row.created_at, bucket);
      }
      bucket[row.instance_id] = row.players;
    }
    return Array.from(byTime.entries()).map(([t, counts]) => ({ t, counts }));
  }

  // -------------------- Roles --------------------

  listRoles(): Role[] {
    this.ensureOpen();
    const rows = this.db.prepare('SELECT * FROM roles ORDER BY built_in DESC, name ASC').all() as RoleRow[];
    return rows.map(row => this.toRole(row));
  }

  getRole(id: string): Role | null {
    this.ensureOpen();
    const row = this.db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as RoleRow | undefined;
    return row ? this.toRole(row) : null;
  }

  createRole(input: RoleInput): Result<Role> {
    this.ensureOpen();
    const name = (input.name || '').trim();
    if (!name) return { success: false, error: 'Role name is required.' };
    if (this.db.prepare('SELECT id FROM roles WHERE name = ? COLLATE NOCASE').get(name)) {
      return { success: false, error: `A role named "${name}" already exists.` };
    }

    const id = input.id?.trim() || this.slugify(name);
    if (this.db.prepare('SELECT id FROM roles WHERE id = ?').get(id)) {
      return { success: false, error: `A role with the id "${id}" already exists.` };
    }

    const now = Date.now();
    this.db.run(
      'INSERT INTO roles (id, name, description, permissions, built_in, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
      [id, name, (input.description || '').trim(), JSON.stringify(this.sanitizePermissions(input.permissions)), now, now]
    );
    return { success: true, data: this.getRole(id)! };
  }

  updateRole(input: RoleInput & { id: string }): Result<Role> {
    this.ensureOpen();
    const existing = this.getRole(input.id);
    if (!existing) return { success: false, error: 'Role not found.' };
    if (existing.id === ROLE_IDS.ADMIN) {
      return { success: false, error: 'The Admin role always has every permission and cannot be edited.' };
    }

    const name = (input.name || '').trim() || existing.name;
    const clash = this.db.prepare('SELECT id FROM roles WHERE name = ? COLLATE NOCASE AND id != ?').get(name, input.id);
    if (clash) return { success: false, error: `A role named "${name}" already exists.` };

    this.db.run('UPDATE roles SET name = ?, description = ?, permissions = ?, updated_at = ? WHERE id = ?', [
      name,
      (input.description ?? existing.description).trim(),
      JSON.stringify(this.sanitizePermissions(input.permissions)),
      Date.now(),
      input.id
    ]);
    return { success: true, data: this.getRole(input.id)! };
  }

  deleteRole(id: string): Result<{ id: string }> {
    this.ensureOpen();
    const role = this.getRole(id);
    if (!role) return { success: false, error: 'Role not found.' };
    if (role.builtIn) return { success: false, error: 'Built-in roles cannot be deleted.' };

    const inUse = this.db.prepare('SELECT COUNT(*) AS count FROM users WHERE role_id = ?').get(id) as { count: number };
    if ((inUse?.count ?? 0) > 0) {
      return { success: false, error: `${inUse.count} user(s) still have this role. Move them to another role first.` };
    }

    this.db.run('DELETE FROM roles WHERE id = ?', [id]);
    return { success: true, data: { id } };
  }

  // -------------------- Users --------------------

  listUsers(): User[] {
    this.ensureOpen();
    const rows = this.db.prepare('SELECT * FROM users ORDER BY username ASC').all() as UserRow[];
    return rows.map(row => this.toUser(row));
  }

  getUser(id: string): User | null {
    this.ensureOpen();
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row ? this.toUser(row) : null;
  }

  /** A user with their role's permissions resolved, for a session or a permission check. */
  getAuthenticatedUser(id: string): AuthenticatedUser | null {
    const user = this.getUser(id);
    if (!user) return null;
    const role = this.getRole(user.roleId);
    return {
      ...user,
      roleName: role?.name || 'Unknown',
      permissions: effectivePermissions(role)
    };
  }

  async createUser(input: CreateUserInput): Promise<Result<User>> {
    this.ensureOpen();
    const username = (input.username || '').trim();
    const validation = this.validateCredentials(username, input.password);
    if (validation) return { success: false, error: validation };

    if (this.db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username)) {
      return { success: false, error: `A user named "${username}" already exists.` };
    }
    if (!this.getRole(input.roleId)) {
      return { success: false, error: 'That role does not exist.' };
    }

    const now = Date.now();
    const id = this.newId();
    const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
    this.db.run(
      `INSERT INTO users (id, username, password_hash, display_name, role_id, active, created_at, updated_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [id, username, passwordHash, (input.displayName || '').trim(), input.roleId, input.active === false ? 0 : 1, now, now]
    );
    return { success: true, data: this.getUser(id)! };
  }

  async updateUser(input: UpdateUserInput): Promise<Result<User>> {
    this.ensureOpen();
    const existing = this.getUser(input.id);
    if (!existing) return { success: false, error: 'User not found.' };

    const username = input.username !== undefined ? input.username.trim() : existing.username;
    if (!username) return { success: false, error: 'Username is required.' };
    if (username.length > 50) return { success: false, error: 'Username must be 50 characters or fewer.' };

    const clash = this.db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?').get(username, input.id);
    if (clash) return { success: false, error: `A user named "${username}" already exists.` };

    const roleId = input.roleId ?? existing.roleId;
    if (!this.getRole(roleId)) return { success: false, error: 'That role does not exist.' };

    const active = input.active ?? existing.active;
    // Never allow the last active admin to be demoted or disabled — that would lock everyone out.
    const losingAdmin = existing.roleId === ROLE_IDS.ADMIN && (roleId !== ROLE_IDS.ADMIN || !active);
    if (losingAdmin && this.countOtherActiveAdmins(existing.id) === 0) {
      return { success: false, error: 'This is the only active admin. Promote another user first.' };
    }

    if (input.password !== undefined) {
      const validation = this.validateCredentials(username, input.password);
      if (validation) return { success: false, error: validation };
    }

    const passwordHash = input.password !== undefined
      ? await bcrypt.hash(input.password, SALT_ROUNDS)
      : null;

    this.db.run(
      `UPDATE users SET username = ?, display_name = ?, role_id = ?, active = ?, updated_at = ?
       ${passwordHash ? ', password_hash = ?' : ''} WHERE id = ?`,
      passwordHash
        ? [username, (input.displayName ?? existing.displayName).trim(), roleId, active ? 1 : 0, Date.now(), passwordHash, input.id]
        : [username, (input.displayName ?? existing.displayName).trim(), roleId, active ? 1 : 0, Date.now(), input.id]
    );
    return { success: true, data: this.getUser(input.id)! };
  }

  deleteUser(id: string): Result<{ id: string }> {
    this.ensureOpen();
    const user = this.getUser(id);
    if (!user) return { success: false, error: 'User not found.' };
    if (user.roleId === ROLE_IDS.ADMIN && this.countOtherActiveAdmins(id) === 0) {
      return { success: false, error: 'This is the only active admin and cannot be deleted.' };
    }
    this.db.run('DELETE FROM users WHERE id = ?', [id]);
    return { success: true, data: { id } };
  }

  /**
   * Check a username and password.
   *
   * Returns null for a bad username, a bad password or a disabled account, without saying
   * which. A bcrypt comparison always runs, even for an unknown username, so the response
   * time does not reveal whether the account exists.
   */
  async verifyCredentials(username: string, password: string): Promise<AuthenticatedUser | null> {
    this.ensureOpen();
    const name = (username || '').trim();
    const row = name
      ? (this.db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(name) as UserRow | undefined)
      : undefined;

    const hash = row?.password_hash || '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinva';
    let ok = false;
    try {
      ok = await bcrypt.compare(password || '', hash);
    } catch {
      ok = false;
    }

    if (!row || !ok || !row.active) return null;

    this.db.run('UPDATE users SET last_login_at = ? WHERE id = ?', [Date.now(), row.id]);
    return this.getAuthenticatedUser(row.id);
  }

  /** Change your own password, checking the current one first. */
  async changeOwnPassword(id: string, currentPassword: string, newPassword: string): Promise<Result<{ id: string }>> {
    this.ensureOpen();
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    if (!row) return { success: false, error: 'User not found.' };

    const ok = await bcrypt.compare(currentPassword || '', row.password_hash).catch(() => false);
    if (!ok) return { success: false, error: 'Current password is incorrect.' };

    const validation = this.validateCredentials(row.username, newPassword);
    if (validation) return { success: false, error: validation };

    const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    this.db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [hash, Date.now(), id]);
    return { success: true, data: { id } };
  }

  /**
   * Create the first admin from the single username/password the app used before accounts
   * existed, so upgrading does not lock anyone out. Does nothing once any user exists.
   */
  async seedFirstAdmin(username: string, password: string): Promise<Result<User | null>> {
    this.ensureOpen();
    if (this.hasAnyUser()) return { success: true, data: null };

    const name = (username || '').trim() || 'admin';
    if (!password) return { success: false, error: 'Cannot create the first admin without a password.' };

    return this.createUser({ username: name, password, displayName: name, roleId: ROLE_IDS.ADMIN, active: true });
  }

  // -------------------- Helpers --------------------

  private countOtherActiveAdmins(excludeUserId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM users WHERE role_id = ? AND active = 1 AND id != ?')
      .get(ROLE_IDS.ADMIN, excludeUserId) as { count: number };
    return row?.count ?? 0;
  }

  private validateCredentials(username: string, password: string): string | null {
    if (!username) return 'Username is required.';
    if (username.length > 50) return 'Username must be 50 characters or fewer.';
    if (!/^[A-Za-z0-9._@-]+$/.test(username)) {
      return 'Username may only contain letters, numbers and . _ @ -';
    }
    if (!password) return 'Password is required.';
    if (password.length < 8) return 'Password must be at least 8 characters.';
    if (password.length > 200) return 'Password must be 200 characters or fewer.';
    return null;
  }

  private sanitizePermissions(permissions: Permission[] | undefined): Permission[] {
    const allowed = new Set<string>(ALL_PERMISSIONS);
    return Array.from(new Set((permissions || []).filter(p => allowed.has(p))));
  }

  private slugify(name: string): string {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return base || `role-${Date.now()}`;
  }

  private newId(): string {
    try {
      return randomUUID();
    } catch {
      return `u_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }
  }

  private toRole(row: RoleRow): Role {
    let permissions: Permission[] = [];
    try {
      const parsed = JSON.parse(row.permissions);
      if (Array.isArray(parsed)) permissions = this.sanitizePermissions(parsed);
    } catch {
      permissions = [];
    }
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      permissions,
      builtIn: !!row.built_in,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private toUser(row: UserRow): User {
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      roleId: row.role_id,
      active: !!row.active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastLoginAt: row.last_login_at
    };
  }

  private isLockError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /locked|SQLITE_BUSY|EEXIST/i.test(message);
  }

  /**
   * Record this process as the owner, so a later run can tell a crash from a live instance.
   *
   * Only ever called after a write has succeeded, which is itself the proof that no other
   * process holds the lock — SQLite would have returned "database is locked" otherwise. So
   * the record is always overwritten: leaving an older process's pid in place was how a
   * dead pid came to stand for a live owner, and the next run then cleared a lock that was
   * still in use.
   */
  private claimOwnership(): void {
    try {
      fs.writeFileSync(this.pidPath, String(process.pid), { mode: 0o600 });
    } catch (error) {
      console.debug('[user-database] Could not record database ownership:', error);
    }
  }

  /** Whether the process that last claimed the database is still running. */
  private ownerIsAlive(): boolean {
    try {
      if (!fs.existsSync(this.pidPath)) return false;
      const pid = Number(fs.readFileSync(this.pidPath, 'utf8').trim());
      if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
      // Signal 0 checks for existence without touching the process.
      process.kill(pid, 0);
      return true;
    } catch {
      // ESRCH (no such process) or an unreadable pid file: treat the owner as gone.
      return false;
    }
  }

  /**
   * Remove a lock left behind by a process that is no longer running.
   * Returns true when a lock was cleared, false when it belongs to a live instance.
   */
  private releaseStaleLock(): boolean {
    const lockPath = `${this.dbPath}.lock`;
    try {
      if (!fs.existsSync(lockPath)) return true;
      if (this.ownerIsAlive()) return false;

      fs.rmSync(lockPath, { recursive: true, force: true });
      console.warn('[user-database] Cleared a lock left behind by a previous run.');
      return true;
    } catch (error) {
      console.warn('[user-database] Could not clear the stale lock:', error);
      return false;
    }
  }

  private ensureOpen(): void {
    if (this.db) return;
    // When another instance holds the file, stop hammering it: retry occasionally rather
    // than on every single call, so a busy period does not fill the log.
    if (this.ownedByOtherInstance && Date.now() - this.lastOpenAttempt < OPEN_RETRY_INTERVAL_MS) {
      throw new Error('The user database is in use by another running instance.');
    }
    this.lastOpenAttempt = Date.now();
    this.initialize();
  }
}

export const userDatabaseService = new UserDatabaseService();
