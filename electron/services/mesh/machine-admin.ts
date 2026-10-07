import * as fs from 'fs';
import * as path from 'path';

/**
 * A machine's own admin password, carried into the mesh when the machine joins.
 *
 * The mesh's accounts replace a joining machine's own, and its single web login stops signing in,
 * so without this the machine's admin is locked out of it. Its password, as the hash already
 * stored, becomes a numbered machine admin for that machine.
 */

/** An account as these rules read it. */
export interface LocalAccount {
  username: string;
  passwordHash: string;
  roleId: string;
  active: boolean;
  cliLocked: boolean;
}

export interface CarriedLogin {
  /** What it was called on this machine, for the log. */
  username: string;
  passwordHash: string;
  source: 'command line' | 'account' | 'web login';
}

/**
 * The admin password a machine had: the one it was started with (--password or AASM_PASSWORD),
 * else its oldest active admin account, else its single web login. `accounts` are oldest first.
 */
export function localLoginToCarry(
  accounts: LocalAccount[],
  webLogin: { username?: string; passwordHash?: string } | null
): CarriedLogin | null {
  const admins = accounts.filter(account => account.active && account.roleId === 'admin' && account.passwordHash);
  const commandLine = admins.find(account => account.cliLocked);
  if (commandLine) return { username: commandLine.username, passwordHash: commandLine.passwordHash, source: 'command line' };
  const account = admins[0];
  if (account) return { username: account.username, passwordHash: account.passwordHash, source: 'account' };
  if (webLogin?.username && webLogin.passwordHash) {
    return { username: webLogin.username, passwordHash: webLogin.passwordHash, source: 'web login' };
  }
  return null;
}

const MAX_USERNAME = 50;

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * The next numbered admin, named for the site (the machine's name in the mesh) and the machine
 * (its host name, up to the first dot). The mesh's first admin counts as number 1. The host is left
 * out where it adds nothing: the same as the site, or a container's random one (pass '').
 */
export function machineAdminName(taken: string[], nodeName: string, hostName: string): { username: string; displayName: string } {
  const highest = taken.reduce((max, name) => {
    const match = /^admin(\d+)(?:-|$)/i.exec(name);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 1);
  const number = highest + 1;
  const site = slug(nodeName);
  const host = slug(hostName.split('.')[0] || '');
  const parts = [`admin${number}`, site, host && host !== site ? host : ''].filter(Boolean);
  const username = parts.join('-').slice(0, MAX_USERNAME).replace(/-+$/, '');
  const displayName = `Admin ${number}, ${nodeName}${hostName ? ` (${hostName})` : ''}`;
  return { username, displayName };
}

/** The copy of its accounts a machine kept when it last joined a mesh; null when it has none. */
export function latestAccountsBeforeJoin(dir: string): string | null {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const copies = names
    .map(name => ({ name, at: Number(/^accounts-before-join-(\d+)\.db$/.exec(name)?.[1]) }))
    .filter(copy => Number.isFinite(copy.at))
    .sort((a, b) => b.at - a.at);
  return copies.length ? path.join(dir, copies[0].name) : null;
}

/** The accounts in such a copy, oldest first; none when it cannot be read. */
export function readAccountsSnapshot(file: string): LocalAccount[] {
  if (!fs.existsSync(file)) return [];
  const { Database } = require('node-sqlite3-wasm') as typeof import('node-sqlite3-wasm');
  let db: InstanceType<typeof Database> | null = null;
  try {
    db = new Database(file, { readOnly: true });
    const rows = db.all('SELECT username, password_hash, role_id, active, cli_locked FROM users ORDER BY created_at ASC') as Array<Record<string, unknown>>;
    return rows.map(row => ({
      username: String(row.username),
      passwordHash: String(row.password_hash),
      roleId: String(row.role_id),
      active: Number(row.active) === 1,
      cliLocked: Number(row.cli_locked) === 1
    }));
  } catch (error) {
    console.warn(`[mesh] Could not read the accounts kept in ${file}:`, error instanceof Error ? error.message : error);
    return [];
  } finally {
    db?.close();
  }
}
