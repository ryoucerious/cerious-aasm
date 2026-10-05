import { scopeBroadcast } from './pool-broadcast';
import type { PoolSnapshot } from './pool-directory';

const s1 = { id: 's1', name: 'One', operatorUserId: 'op1', managerUserId: null };
const s2 = { id: 's2', name: 'Two', operatorUserId: null, managerUserId: 'm1' };

const snapshot: PoolSnapshot = {
  scoped: true,
  users: [
    { id: 'a1', roleId: 'admin', ownerUserId: null },
    { id: 'op1', roleId: 'operator', ownerUserId: null },
    { id: 'op2', roleId: 'operator', ownerUserId: null },
    { id: 'v1', roleId: 'viewer', ownerUserId: 'op1' },
    { id: 'm1', roleId: 'server-manager', ownerUserId: null }
  ],
  instances: [s1, s2]
};
const directory = (value: PoolSnapshot) => ({ snapshot: () => value });

describe('scopeBroadcast', () => {
  it('sends everything unscoped when no non-admin account exists', () => {
    const quiet = directory({ ...snapshot, scoped: false });

    expect(scopeBroadcast('server-instances', [s1, s2], quiet)).toEqual([{ data: [s1, s2] }]);
    expect(scopeBroadcast('server-instance-log', { instanceId: 's1', log: 'x' }, quiet)).toEqual([{ data: { instanceId: 's1', log: 'x' } }]);
  });

  it('splits server-instances into the full list for admins and one view per distinct pool', () => {
    const messages = scopeBroadcast('server-instances', [s1, s2], directory(snapshot));

    expect(messages).toEqual([
      { data: [s1, s2], audience: { userIds: ['a1'], owners: true } },
      { data: [s1], audience: { userIds: ['op1', 'v1'], owners: false } },
      { data: [], audience: { userIds: ['op2'], owners: false } },
      { data: [s2], audience: { userIds: ['m1'], owners: false } }
    ]);
  });

  it('addresses an instanceId payload to the users who can see that server plus admins', () => {
    const log = { instanceId: 's1', log: 'line' };

    expect(scopeBroadcast('server-instance-log', log, directory(snapshot))).toEqual([
      { data: log, audience: { userIds: ['a1', 'op1', 'v1'], owners: true } }
    ]);
    expect(scopeBroadcast('notification', { instanceId: 's2', message: 'Two started.' }, directory(snapshot))[0].audience)
      .toEqual({ userIds: ['a1', 'm1'], owners: true });
  });

  it('addresses server-instance-updated by the instance itself', () => {
    expect(scopeBroadcast('server-instance-updated', s2, directory(snapshot))).toEqual([
      { data: s2, audience: { userIds: ['a1', 'm1'], owners: true } }
    ]);
  });

  it('sends a server the directory does not know to admins and owners only', () => {
    expect(scopeBroadcast('rcon-status', { instanceId: 'new', connected: true }, directory(snapshot))[0].audience)
      .toEqual({ userIds: ['a1'], owners: true });
  });

  it('leaves other channels, and payloads without an instance id, unscoped', () => {
    expect(scopeBroadcast('global-config', { webServerPort: 3000 }, directory(snapshot))).toEqual([{ data: { webServerPort: 3000 } }]);
    expect(scopeBroadcast('notification', { message: 'Web server started.' }, directory(snapshot))).toEqual([{ data: { message: 'Web server started.' } }]);
    expect(scopeBroadcast('server-instances', 'not a list', directory(snapshot))).toEqual([{ data: 'not a list' }]);
  });

  it('reaches admins and owners only while the directory is unavailable', () => {
    const unavailable = directory({ users: [], instances: [], scoped: true });

    expect(scopeBroadcast('server-instance-log', { instanceId: 's1' }, unavailable)).toEqual([
      { data: { instanceId: 's1' }, audience: { userIds: [], owners: true } }
    ]);
  });
});
