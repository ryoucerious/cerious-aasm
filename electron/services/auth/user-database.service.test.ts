// A real SQLite database: these tests pin how statements bind their parameters, which a fake would not.
jest.unmock('fs');
jest.unmock('path');
jest.unmock('crypto');

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getDefaultInstallDir } from '../../utils/platform.utils';
import { UserDatabaseService } from './user-database.service';

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
});
