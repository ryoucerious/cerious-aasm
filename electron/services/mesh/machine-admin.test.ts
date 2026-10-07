jest.unmock('fs');
jest.unmock('path');
jest.unmock('crypto');

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { latestAccountsBeforeJoin, localLoginToCarry, machineAdminName, readAccountsSnapshot, type CarriedLogin } from './machine-admin';

const bcrypt = (tag: string) => `$2b$12$${tag.padEnd(53, 'x')}`;

function row(overrides: Partial<Parameters<typeof localLoginToCarry>[0][number]> = {}) {
  return { username: 'admin', passwordHash: bcrypt('account'), roleId: 'admin', active: true, cliLocked: false, ...overrides };
}

describe('localLoginToCarry', () => {
  it('takes the password the process was started with first', () => {
    const carried = localLoginToCarry(
      [row(), row({ username: 'root', passwordHash: bcrypt('cli'), cliLocked: true })],
      { username: 'web', passwordHash: bcrypt('web') }
    );

    expect(carried).toEqual<CarriedLogin>({ username: 'root', passwordHash: bcrypt('cli'), source: 'command line' });
  });

  it('then the oldest active admin account', () => {
    const carried = localLoginToCarry(
      [row({ username: 'gone', active: false }), row({ username: 'viewer', roleId: 'viewer' }), row({ username: 'first' }), row({ username: 'second' })],
      { username: 'web', passwordHash: bcrypt('web') }
    );

    expect(carried).toEqual({ username: 'first', passwordHash: bcrypt('account'), source: 'account' });
  });

  it('then the single web login', () => {
    expect(localLoginToCarry([], { username: 'web', passwordHash: bcrypt('web') }))
      .toEqual({ username: 'web', passwordHash: bcrypt('web'), source: 'web login' });
  });

  it('carries nothing from a machine with no admin password', () => {
    expect(localLoginToCarry([row({ roleId: 'operator' })], { username: '', passwordHash: '' })).toBeNull();
    expect(localLoginToCarry([], null)).toBeNull();
  });
});

describe('machineAdminName', () => {
  it('numbers it after the admins already in the mesh, and names the site and the machine', () => {
    expect(machineAdminName(['admin', 'ada'], 'Germany01', 'asa-1')).toEqual({ username: 'admin2-germany01-asa-1', displayName: 'Admin 2, Germany01 (asa-1)' });
    expect(machineAdminName(['admin', 'admin2-germany01-asa-1'], 'Dallas01', 's001.nohk59g0cwp.com'))
      .toEqual({ username: 'admin3-dallas01-s001', displayName: 'Admin 3, Dallas01 (s001.nohk59g0cwp.com)' });
  });

  it('leaves out a machine name that says nothing more', () => {
    expect(machineAdminName([], 'PC 1', 'pc-1').username).toBe('admin2-pc-1');
    expect(machineAdminName([], 'Docker 1', '').username).toBe('admin2-docker-1');
  });

  it('stays a username the app accepts', () => {
    const { username } = machineAdminName([], 'A very long site name that goes on and on', 'an-equally-long-host-name.example.org');

    expect(username.length).toBeLessThanOrEqual(50);
    expect(username).toMatch(/^[a-z0-9-]+$/);
    expect(username).not.toMatch(/-$/);
  });

  it('never repeats a name already taken', () => {
    expect(machineAdminName(['admin2-site', 'admin7-other'], 'Site', '').username).toBe('admin8-site');
  });
});

describe('the accounts a machine had before it joined', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-carry-'));
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('finds the latest copy kept at a join', () => {
    for (const name of ['accounts-before-join-100.db', 'accounts-before-join-300.db', 'accounts-before-join-20.db', 'node.json']) {
      fs.writeFileSync(path.join(dir, name), '');
    }

    expect(latestAccountsBeforeJoin(dir)).toBe(path.join(dir, 'accounts-before-join-300.db'));
    expect(latestAccountsBeforeJoin(path.join(dir, 'missing'))).toBeNull();
  });

  it('reads the accounts in a copy, oldest first', () => {
    const { Database } = require('node-sqlite3-wasm') as typeof import('node-sqlite3-wasm');
    const file = path.join(dir, 'accounts-before-join-1.db');
    const db = new Database(file);
    db.exec(`CREATE TABLE users (id TEXT, username TEXT, password_hash TEXT, role_id TEXT, active INTEGER, cli_locked INTEGER, created_at INTEGER)`);
    db.run('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)', ['2', 'later', 'h2', 'admin', 1, 0, 20]);
    db.run('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)', ['1', 'first', 'h1', 'admin', 1, 1, 10]);
    db.close();

    expect(readAccountsSnapshot(file)).toEqual([
      { username: 'first', passwordHash: 'h1', roleId: 'admin', active: true, cliLocked: true },
      { username: 'later', passwordHash: 'h2', roleId: 'admin', active: true, cliLocked: false }
    ]);
    expect(readAccountsSnapshot(path.join(dir, 'missing.db'))).toEqual([]);
  });
});
