// A real SQLite database: these tests pin how statements bind their parameters, which a fake would not.
jest.unmock('fs');
jest.unmock('path');
jest.unmock('crypto');

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getDefaultInstallDir } from '../../utils/platform.utils';
import { UserDatabaseService, type MeshAccount } from './user-database.service';
import { hashArgon2id } from '../mesh/passwords';

jest.mock('../../utils/platform.utils', () => ({ getDefaultInstallDir: jest.fn() }));

describe('UserDatabaseService', () => {
  let installDir: string;
  let service: UserDatabaseService;

  beforeEach(() => {
    installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-users-'));
    jest.mocked(getDefaultInstallDir).mockReturnValue(installDir);
    service = new UserDatabaseService();
    service.initialize();
  });

  afterEach(() => {
    service.close();
    fs.rmSync(installDir, { recursive: true, force: true });
  });

  async function createUser(username: string, roleId: string) {
    const result = await service.createUser({ username, password: 'password1', roleId });
    if (!result.success) throw new Error(result.error);
    return result.data;
  }

  it('copies the account database to a file that opens on its own', async () => {
    await createUser('ada', 'viewer');
    const copy = path.join(installDir, 'accounts-copy.db');

    service.snapshotTo(copy);

    const { Database } = require('node-sqlite3-wasm') as typeof import('node-sqlite3-wasm');
    const opened = new Database(copy);
    const rows = opened.all('SELECT username FROM users');
    opened.close();
    expect(rows).toEqual([{ username: 'ada' }]);
  });

  describe('mirroring the mesh accounts', () => {
    const meshRole = { roleId: 'moderators', name: 'Moderators', permissions: ['servers.view'] };

    function meshUser(overrides: Partial<MeshAccount> = {}): MeshAccount {
      return {
        userId: 'u1', username: 'ada', displayName: 'Ada', passwordHash: '$2b$10$abcdefghijklmnopqrstuuMx1XQYZ6EyuX5w0rBgk0gbtV2tNxk7i',
        enabled: true, roleId: 'moderators', ownerUserId: null, createdAt: 1, updatedAt: 2, ...overrides
      };
    }

    it('adds and updates accounts and custom roles to match the mesh', () => {
      service.applyMeshAccounts({ users: [meshUser()], roles: [meshRole] });

      expect(service.getUser('u1')).toMatchObject({ username: 'ada', displayName: 'Ada', roleId: 'moderators', active: true });
      expect(service.getRole('moderators')).toMatchObject({ name: 'Moderators', permissions: ['servers.view'], builtIn: false });

      service.applyMeshAccounts({ users: [meshUser({ enabled: false, displayName: 'Ada L.' })], roles: [meshRole] });

      expect(service.getUser('u1')).toMatchObject({ displayName: 'Ada L.', active: false });
    });

    it('removes accounts and custom roles the mesh no longer has, but never a built-in role', async () => {
      await createUser('old', 'viewer');
      service.createRole({ name: 'Legacy', permissions: [] });

      service.applyMeshAccounts({ users: [], roles: [] }, Date.now() + 2 * 60_000);

      expect(service.listUsers()).toEqual([]);
      expect(service.listRoles().filter(role => !role.builtIn)).toEqual([]);
      expect(service.getRole('admin')?.builtIn).toBe(true);
    });

    it('replaces a local account that has the same name as a mesh account', async () => {
      const local = await createUser('ada', 'viewer');

      service.applyMeshAccounts({ users: [meshUser()], roles: [meshRole] });

      expect(service.getUser(local.id)).toBeNull();
      expect(service.getUser('u1')?.username).toBe('ada');
    });

    it('keeps an account set from the command line, which stays local', async () => {
      const cli = await service.syncCliAdmin('operator', 'password1');

      service.applyMeshAccounts({ users: [meshUser()], roles: [meshRole] });

      expect(cli.success && service.getUser(cli.data.id)?.username).toBe('operator');
    });

    it('keeps the command-line account when the mesh has another with the same name', async () => {
      const cli = await service.syncCliAdmin('ada', 'password1');

      service.applyMeshAccounts({ users: [meshUser()], roles: [meshRole] });

      expect(cli.success && service.getUser(cli.data.id)?.username).toBe('ada');
      expect(service.getUser('u1')).toBeNull();
    });

    it('keeps an account made here moments ago, before it has reached the mesh', async () => {
      const fresh = await createUser('fresh', 'viewer');

      service.applyMeshAccounts({ users: [], roles: [] });

      expect(service.getUser(fresh.id)?.username).toBe('fresh');
    });

    it('keeps a change made here that the mesh has not caught up with', async () => {
      service.applyMeshAccounts({ users: [meshUser()], roles: [meshRole] });
      await service.updateUser({ id: 'u1', displayName: 'Changed here' });

      service.applyMeshAccounts({ users: [meshUser()], roles: [meshRole] });

      expect(service.getUser('u1')?.displayName).toBe('Changed here');
    });

    it('takes the mesh version once that minute has passed, whatever the clocks say', async () => {
      service.applyMeshAccounts({ users: [meshUser()], roles: [meshRole] });
      await service.updateUser({ id: 'u1', displayName: 'Changed here' });

      // Another node changed it later, but its clock is behind this one.
      service.applyMeshAccounts({ users: [meshUser({ displayName: 'Changed there', updatedAt: 5 })], roles: [meshRole] }, Date.now() + 2 * 60_000);

      expect(service.getUser('u1')?.displayName).toBe('Changed there');
    });

    it('keeps when an account last signed in on this machine', async () => {
      service.applyMeshAccounts({ users: [meshUser({ passwordHash: (await hashArgon2id('correct horse')).hash })], roles: [meshRole] });
      await service.verifyCredentials('ada', 'correct horse');
      const signedIn = service.getUser('u1')?.lastLoginAt;

      service.applyMeshAccounts({ users: [meshUser({ displayName: 'Changed', updatedAt: 3 })], roles: [meshRole] });

      expect(signedIn).toEqual(expect.any(Number));
      expect(service.getUser('u1')?.lastLoginAt).toBe(signedIn);
    });

    it('reports what changed, and nothing when it already matches', () => {
      expect(service.applyMeshAccounts({ users: [meshUser()], roles: [meshRole] })).toEqual({ changedUserIds: ['u1'], changedRoleIds: ['moderators'] });
      expect(service.applyMeshAccounts({ users: [meshUser()], roles: [meshRole] })).toEqual({ changedUserIds: [], changedRoleIds: [] });
    });

    it('signs in an account whose verifier is Argon2id', async () => {
      service.applyMeshAccounts({ users: [meshUser({ passwordHash: (await hashArgon2id('correct horse')).hash })], roles: [meshRole] });

      expect((await service.verifyCredentials('ada', 'correct horse'))?.id).toBe('u1');
      expect(await service.verifyCredentials('ada', 'wrong horse')).toBeNull();
    });

    it('changes the password of an account whose verifier is Argon2id', async () => {
      service.applyMeshAccounts({ users: [meshUser({ passwordHash: (await hashArgon2id('correct horse')).hash })], roles: [meshRole] });

      expect(await service.changeOwnPassword('u1', 'correct horse', 'battery staple')).toEqual({ success: true, data: { id: 'u1' } });
      expect((await service.verifyCredentials('ada', 'battery staple'))?.id).toBe('u1');
    });
  });

  describe('the last active admin', () => {
    it('can be demoted while another active admin remains', async () => {
      const first = await createUser('first', 'admin');
      await createUser('second', 'admin');

      const result = await service.updateUser({ id: first.id, roleId: 'viewer' });

      expect(result).toMatchObject({ success: true, data: { roleId: 'viewer' } });
    });

    it('can be deleted while another active admin remains', async () => {
      const first = await createUser('first', 'admin');
      await createUser('second', 'admin');

      expect(service.deleteUser(first.id)).toEqual({ success: true, data: { id: first.id } });
    });

    it('cannot be demoted, disabled or deleted when it is the only one', async () => {
      const only = await createUser('only', 'admin');
      await createUser('viewer', 'viewer');

      expect(await service.updateUser({ id: only.id, roleId: 'viewer' })).toMatchObject({ success: false });
      expect(await service.updateUser({ id: only.id, active: false })).toMatchObject({ success: false });
      expect(service.deleteUser(only.id)).toMatchObject({ success: false });
    });
  });

  it('refuses renaming a user to a name another user has', async () => {
    await createUser('taken', 'viewer');
    const other = await createUser('other', 'viewer');

    expect(await service.updateUser({ id: other.id, username: 'TAKEN' })).toEqual({
      success: false, error: 'A user named "TAKEN" already exists.'
    });
  });

  it('refuses renaming a role to a name another role has', () => {
    const created = service.createRole({ name: 'Moderators', permissions: [] });
    if (!created.success) throw new Error(created.error);

    expect(service.updateRole({ id: created.data.id, name: 'viewer', permissions: [] })).toEqual({
      success: false, error: 'A role named "viewer" already exists.'
    });
  });

  it('finalizes every statement it prepares', async () => {
    // node-sqlite3-wasm frees a prepared statement only on finalize; main now looks an account
    // up for every web message, so a leak here would grow the WASM heap without bound.
    const user = await createUser('sam', 'viewer');
    const db = (service as unknown as { db: { prepare(sql: string): { isFinalized: boolean } } }).db;
    const prepared: { isFinalized: boolean }[] = [];
    const prepare = db.prepare.bind(db);
    jest.spyOn(db, 'prepare').mockImplementation(sql => {
      const statement = prepare(sql);
      prepared.push(statement);
      return statement;
    });

    service.getAuthenticatedUser(user.id);
    service.listUsers();
    service.listRoles();
    service.hasAnyUser();
    service.listActivity();
    service.listPlayerHistory(0);
    await service.verifyCredentials('sam', 'password1');
    await service.updateUser({ id: user.id, username: 'sam2' });

    expect(prepared.length).toBeGreaterThan(0);
    expect(prepared.filter(statement => !statement.isFinalized)).toEqual([]);
  });

  it('lists activity newest first', () => {
    service.recordActivity({ kind: 'info', message: 'first' });
    service.recordActivity({ kind: 'start', message: 'second', instanceId: 'i1', username: 'sam' });

    expect(service.listActivity(10)).toEqual([
      { id: 2, kind: 'start', message: 'second', instanceId: 'i1', username: 'sam', createdAt: expect.any(Number) },
      { id: 1, kind: 'info', message: 'first', instanceId: null, username: null, createdAt: expect.any(Number) }
    ]);
  });
  // A level above operator: one mesh machine's admin.
  describe('machine admins', () => {
    it('looks after the machine it was made for', async () => {
      const result = await service.createUser({ username: 'admin2-germany01', password: 'password1', roleId: 'machine-admin', machineNodeId: 'n1' });

      expect(result).toMatchObject({ success: true, data: { roleId: 'machine-admin', machineNodeId: 'n1', updatesAnyMachine: false } });
      const signedIn = service.getAuthenticatedUser(result.success ? result.data.id : '')!;
      expect(signedIn).toMatchObject({ roleName: 'Machine Admin', machineNodeId: 'n1' });
      expect(signedIn.permissions).toEqual(expect.arrayContaining(['servers.move', 'app.install', 'servers.control']));
      expect(signedIn.permissions).not.toContain('nodes.enroll');
      expect(signedIn.permissions).not.toContain('users.manage');
    });

    it('needs a machine', async () => {
      expect(await service.createUser({ username: 'ma', password: 'password1', roleId: 'machine-admin' }))
        .toEqual({ success: false, error: 'Choose the machine this admin looks after.' });
    });

    it('may be allowed to update every machine, and loses its machine with the role', async () => {
      const created = await service.createUser({ username: 'ma', password: 'password1', roleId: 'machine-admin', machineNodeId: 'n1' });
      const id = created.success ? created.data.id : '';

      expect(await service.updateUser({ id, updatesAnyMachine: true })).toMatchObject({ success: true, data: { machineNodeId: 'n1', updatesAnyMachine: true } });
      expect(await service.updateUser({ id, machineNodeId: 'n2' })).toMatchObject({ success: true, data: { machineNodeId: 'n2', updatesAnyMachine: true } });
      expect(await service.updateUser({ id, roleId: 'viewer' })).toMatchObject({ success: true, data: { machineNodeId: null, updatesAnyMachine: false } });
    });

    it('never gives a machine to another role', async () => {
      const result = await service.createUser({ username: 'op', password: 'password1', roleId: 'operator', machineNodeId: 'n1', updatesAnyMachine: true });

      expect(result).toMatchObject({ success: true, data: { machineNodeId: null, updatesAnyMachine: false } });
    });

    it('comes from the mesh with its machine', () => {
      service.applyMeshAccounts({
        users: [{
          userId: 'u9', username: 'admin3-dallas01', displayName: 'Admin 3', passwordHash: '$2b$10$abcdefghijklmnopqrstuuMx1XQYZ6EyuX5w0rBgk0gbtV2tNxk7i',
          enabled: true, roleId: 'machine-admin', ownerUserId: null, createdAt: 1, updatedAt: 2, machineNodeId: 'n3', updatesAnyMachine: true
        }],
        roles: []
      });

      expect(service.getUser('u9')).toMatchObject({ machineNodeId: 'n3', updatesAnyMachine: true });
      expect(service.exportCredentialRows()).toEqual([expect.objectContaining({ id: 'u9', machineNodeId: 'n3', updatesAnyMachine: true, cliLocked: false })]);
    });
  });

  // Only the mesh admin brings machines in or takes them out.
  it('never lets a custom role add or remove machines', () => {
    const role = service.createRole({ name: 'Mesh Helpers', permissions: ['servers.view', 'nodes.enroll', 'nodes.remove', 'nodes.manage'] });
    if (!role.success) throw new Error(role.error);
    const db = (service as unknown as { conn: { run(sql: string, params: unknown[]): void } }).conn;
    db.run('INSERT INTO users (id, username, password_hash, display_name, role_id, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1, 1)',
      ['h1', 'helper', 'x', 'Helper', role.data.id]);

    expect(service.getAuthenticatedUser('h1')!.permissions).toEqual(['servers.view', 'nodes.manage']);
  });

  describe('pools', () => {
    it('opens again with the owner column already present', () => {
      const again = new UserDatabaseService();
      again.initialize();
      expect(again.listUsers()).toEqual([]);
      again.close();
    });

    it('stores a pool account under an active operator', async () => {
      const operator = await createUser('op', 'operator');

      const result = await service.createUser({ username: 'm', password: 'password1', roleId: 'server-manager', ownerUserId: operator.id });

      expect(result).toMatchObject({ success: true, data: { ownerUserId: operator.id } });
    });

    it('refuses an owner that is not an active operator', async () => {
      const viewer = await createUser('v', 'viewer');

      const result = await service.createUser({ username: 'm', password: 'password1', roleId: 'server-manager', ownerUserId: viewer.id });

      expect(result).toEqual({ success: false, error: 'Choose an active operator for this pool.' });
    });

    it('never stores an owner on an admin or operator account', async () => {
      const operator = await createUser('op', 'operator');

      const other = await service.createUser({ username: 'op2', password: 'password1', roleId: 'operator', ownerUserId: operator.id });

      expect(other).toMatchObject({ success: true, data: { ownerUserId: null } });
    });

    it('moves an account between pools on update and keeps it when the field is absent', async () => {
      const a = await createUser('a', 'operator');
      const b = await createUser('b', 'operator');
      const created = await service.createUser({ username: 'm', password: 'password1', roleId: 'viewer', ownerUserId: a.id });
      const m = created.success ? created.data : null;

      expect(await service.updateUser({ id: m!.id, displayName: 'M' })).toMatchObject({ success: true, data: { ownerUserId: a.id } });
      expect(await service.updateUser({ id: m!.id, ownerUserId: b.id })).toMatchObject({ success: true, data: { ownerUserId: b.id } });
      expect(await service.updateUser({ id: m!.id, ownerUserId: null })).toMatchObject({ success: true, data: { ownerUserId: null } });
    });

    it('drops the owner when an account is promoted to operator', async () => {
      const a = await createUser('a', 'operator');
      const created = await service.createUser({ username: 'm', password: 'password1', roleId: 'viewer', ownerUserId: a.id });
      const m = created.success ? created.data : null;

      expect(await service.updateUser({ id: m!.id, roleId: 'operator' })).toMatchObject({ success: true, data: { ownerUserId: null } });
    });

    it('leaves a pool member editable after their operator is disabled', async () => {
      const op = await createUser('op', 'operator');
      const created = await service.createUser({ username: 'm', password: 'password1', roleId: 'viewer', ownerUserId: op.id });
      const m = created.success ? created.data : null;
      expect(await service.updateUser({ id: op.id, active: false })).toMatchObject({ success: true });

      expect(await service.updateUser({ id: m!.id, displayName: 'M' })).toMatchObject({ success: true, data: { ownerUserId: op.id } });
      expect(await service.updateUser({ id: m!.id, ownerUserId: op.id })).toEqual({ success: false, error: 'Choose an active operator for this pool.' });
    });

    it('restores the built-in roles and leaves a custom role alone', () => {
      const manager = service.getRole('server-manager')!;
      const operator = service.getRole('operator')!;
      expect(manager.permissions).not.toContain('servers.create');
      expect(manager.permissions).not.toContain('servers.delete');
      expect(manager.permissions).toEqual(expect.arrayContaining(['servers.view', 'servers.control', 'servers.configure']));
      expect(operator.permissions).toEqual(expect.arrayContaining([
        'servers.create', 'servers.delete', 'accounts.managers.create', 'accounts.viewers.delete'
      ]));
      expect(service.getRole('attendant')!.permissions).toEqual(['servers.view', 'servers.control', 'players.view']);
      expect(service.getRole('viewer')!.permissions).toEqual(['servers.view', 'players.view']);

      service.updateRole({ id: 'server-manager', name: 'Server Manager', permissions: ['servers.view', 'servers.create'] });
      const db = (service as unknown as { conn: { run(sql: string, params: unknown[]): void } }).conn;
      db.run('UPDATE roles SET permissions = ? WHERE id = ?', [
        JSON.stringify(['servers.view', 'servers.control', 'servers.create', 'servers.delete']),
        'server-manager'
      ]);
      const custom = service.createRole({ name: 'Auditors', permissions: ['servers.view'] });
      if (!custom.success) throw new Error(custom.error);

      const again = new UserDatabaseService();
      again.initialize();
      expect(again.getRole('server-manager')!.permissions).not.toContain('servers.create');
      expect(again.getRole('viewer')!.permissions).toEqual(['servers.view', 'players.view']);
      expect(again.getRole(custom.data.id)!.permissions).toEqual(['servers.view']);
      expect(again.updateRole({ id: 'operator', name: 'Operator', permissions: ['servers.view'] })).toEqual({
        success: false, error: 'Built-in roles have a fixed set of permissions and cannot be edited.'
      });
      again.close();
    });
  });
});
