import { PoolDirectory, poolDirectory, PoolSnapshot } from './pool-directory';
import { userDatabaseService } from './user-database.service';
import { getAllInstancesSync } from '../../utils/ark/instance.utils';
import { notifyInstancesChanged } from '../../utils/ark/instance-changes';

jest.mock('./user-database.service', () => ({ userDatabaseService: { listUsers: jest.fn() } }));
jest.mock('../../utils/ark/instance.utils', () => ({ getAllInstancesSync: jest.fn() }));

const db = jest.mocked(userDatabaseService);
const mockInstances = jest.mocked(getAllInstancesSync);

function user(id: string, roleId: string, ownerUserId: string | null = null, active = true) {
  return { id, username: id, displayName: id, roleId, active, ownerUserId, cliLocked: false, createdAt: 0, updatedAt: 0, lastLoginAt: null };
}

describe('PoolDirectory', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    poolDirectory.invalidate();
  });

  it('reads active accounts and server ownership from the database', () => {
    db.listUsers.mockReturnValue([user('a1', 'admin'), user('op1', 'operator'), user('v1', 'viewer', 'op1'), user('x', 'viewer', 'op1', false)]);
    mockInstances.mockReturnValue([{ id: 's1', operatorUserId: 'op1' }, { id: 's2' }]);

    expect(poolDirectory.snapshot()).toEqual({
      scoped: true,
      users: [
        { id: 'a1', roleId: 'admin', ownerUserId: null },
        { id: 'op1', roleId: 'operator', ownerUserId: null },
        { id: 'v1', roleId: 'viewer', ownerUserId: 'op1' }
      ],
      instances: [{ id: 's1', operatorUserId: 'op1', managerUserId: null }, { id: 's2', operatorUserId: null, managerUserId: null }]
    });
  });

  it('is unscoped, without reading servers, when only admins exist', () => {
    db.listUsers.mockReturnValue([user('a1', 'admin'), user('old', 'viewer', null, false)]);

    expect(poolDirectory.snapshot().scoped).toBe(false);
    expect(mockInstances).not.toHaveBeenCalled();
  });

  it('caches the snapshot until it is invalidated or a server config changes', () => {
    const load = jest.fn((): PoolSnapshot => ({ users: [], instances: [], scoped: false }));
    const directory = new PoolDirectory(load, () => 1000);

    directory.snapshot();
    directory.snapshot();
    expect(load).toHaveBeenCalledTimes(1);

    directory.invalidate();
    directory.snapshot();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('reloads on its own after thirty seconds', () => {
    let now = 0;
    const load = jest.fn((): PoolSnapshot => ({ users: [], instances: [], scoped: false }));
    const directory = new PoolDirectory(load, () => now);

    directory.snapshot();
    now = 29_000;
    directory.snapshot();
    expect(load).toHaveBeenCalledTimes(1);
    now = 31_000;
    directory.snapshot();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('forgets the shared snapshot when a server config changes', () => {
    db.listUsers.mockReturnValue([user('op1', 'operator')]);
    mockInstances.mockReturnValue([]);
    poolDirectory.snapshot();

    notifyInstancesChanged();
    poolDirectory.snapshot();

    expect(mockInstances).toHaveBeenCalledTimes(2);
  });

  it('hands out an admins-only snapshot while reading fails, and retries after a pause', () => {
    let now = 0;
    const load = jest.fn((): PoolSnapshot => { throw new Error('database locked'); });
    const directory = new PoolDirectory(load, () => now);

    expect(directory.snapshot()).toEqual({ users: [], instances: [], scoped: true });
    now = 1_000;
    directory.snapshot();
    expect(load).toHaveBeenCalledTimes(1);
    now = 6_000;
    directory.snapshot();
    expect(load).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});
