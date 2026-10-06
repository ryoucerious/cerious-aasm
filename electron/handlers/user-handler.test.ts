import { messagingService } from '../services/messaging.service';
import { userDatabaseService } from '../services/auth/user-database.service';
import { ALL_PERMISSIONS, AuthenticatedUser, BUILT_IN_ROLES, Permission, Role } from '../types/auth.types';
import type { ApiProcessSender } from '../types/messaging.types';
import { getAllInstances } from '../utils/ark/instance.utils';

jest.mock('../services/messaging.service', () => ({
  messagingService: { on: jest.fn(), sendToOriginator: jest.fn(), sendToAll: jest.fn(), invalidateWebSessions: jest.fn() }
}));
jest.mock('../services/auth/user-database.service', () => ({
  userDatabaseService: {
    getUser: jest.fn(),
    getAuthenticatedUser: jest.fn(),
    getRole: jest.fn(),
    hasAnyUser: jest.fn(),
    listUsers: jest.fn(),
    listRoles: jest.fn(),
    createUser: jest.fn(),
    updateUser: jest.fn(),
    deleteUser: jest.fn(),
    createRole: jest.fn(),
    updateRole: jest.fn(),
    deleteRole: jest.fn(),
    changeOwnPassword: jest.fn()
  }
}));

jest.mock('../utils/ark/instance.utils', () => ({ getAllInstances: jest.fn() }));
// A standalone install: the mesh is off, so these sync calls do nothing.
jest.mock('../services/mesh/mesh-service', () => ({
  meshService: { syncUser: jest.fn(async () => undefined), forgetUser: jest.fn(async () => undefined), syncRole: jest.fn(async () => undefined) }
}));

const mockMessaging = jest.mocked(messagingService);
const mockGetAllInstances = jest.mocked(getAllInstances);
const db = jest.mocked(userDatabaseService);

/** Can manage users and see what a Viewer sees, but not control servers. */
const MANAGER_PERMISSIONS: Permission[] = ['users.manage', 'servers.view', 'players.view', 'backups.view', 'settings.view'];

function role(id: string, permissions: Permission[]): Role {
  return { id, name: id, description: '', permissions, builtIn: false, createdAt: 0, updatedAt: 0 };
}

const roles: Record<string, Role> = {
  ...Object.fromEntries(BUILT_IN_ROLES.map(r => [r.id, { ...role(r.id, r.permissions), builtIn: true }])),
  'user-managers': role('user-managers', MANAGER_PERMISSIONS)
};

function account(id: string, roleId: string): AuthenticatedUser {
  return {
    id, username: id, displayName: id, roleId, roleName: roleId,
    permissions: roleId === 'admin' ? [...ALL_PERMISSIONS] : roles[roleId].permissions,
    active: true, ownerUserId: null, cliLocked: false, createdAt: 0, updatedAt: 0, lastLoginAt: null
  };
}

const accounts: Record<string, AuthenticatedUser> = {
  manager: account('manager', 'user-managers'),
  boss: account('boss', 'admin'),
  op: account('op', 'operator'),
  op2: account('op2', 'operator'),
  // In op's pool.
  m1: { ...account('m1', 'server-manager'), ownerUserId: 'op' },
  view: account('view', 'viewer')
};

function web(user: AuthenticatedUser): ApiProcessSender {
  return { type: 'api-process', cid: 'c1', user, authEnabled: true, send: jest.fn() };
}

const desktop = { send: jest.fn() };
const manager = web(accounts.manager);

type Listener = (payload: unknown, sender: unknown) => Promise<void>;

// Captured once, before any test clears the mock's calls (clearMocks is on).
const poolHandlers: Record<string, Listener> = {};
beforeAll(() => {
  require('./user-handler');
  Object.assign(poolHandlers, Object.fromEntries(mockMessaging.on.mock.calls.map(([channel, listener]) => [channel, listener as Listener])));
});

describe('user-handler', () => {
  let handlers: Record<string, Listener>;

  beforeAll(() => {
    require('./user-handler');
    handlers = Object.fromEntries(mockMessaging.on.mock.calls.map(([channel, listener]) => [channel, listener as Listener]));
  });

  beforeEach(() => {
    db.getRole.mockImplementation(id => roles[id] ?? null);
    db.getAuthenticatedUser.mockImplementation(id => accounts[id] ?? null);
    db.listUsers.mockReturnValue(Object.values(accounts));
    mockGetAllInstances.mockResolvedValue([]);
    db.createUser.mockResolvedValue({ success: true, data: accounts.view });
    db.updateUser.mockResolvedValue({ success: true, data: accounts.view });
    db.deleteUser.mockReturnValue({ success: true, data: { id: 'view' } });
    db.createRole.mockReturnValue({ success: true, data: roles.viewer });
    db.updateRole.mockReturnValue({ success: true, data: roles.viewer });
  });

  async function call(channel: string, payload: Record<string, unknown>, sender: unknown = manager) {
    await handlers[channel]({ ...payload, requestId: 'r1' }, sender);
    return mockMessaging.sendToOriginator.mock.calls.find(([replyChannel]) => replyChannel === channel)?.[1];
  }

  describe('a non-admin with users.manage', () => {
    it('cannot create an admin', async () => {
      const reply = await call('create-user', { username: 'x', password: 'password1', roleId: 'admin' });

      expect(reply).toEqual({ success: false, error: 'Only an admin can give out the Admin role.', requestId: 'r1' });
      expect(db.createUser).not.toHaveBeenCalled();
    });

    it('cannot create an account with permissions it lacks', async () => {
      const reply = await call('create-user', { username: 'x', password: 'password1', roleId: 'operator' });

      expect(reply).toMatchObject({ success: false, error: 'You cannot give out a role with permissions you do not have.' });
      expect(db.createUser).not.toHaveBeenCalled();
    });

    it('can create an account with no more rights than its own', async () => {
      const reply = await call('create-user', { username: 'x', password: 'password1', roleId: 'viewer' });

      expect(reply).toEqual({ success: true, user: accounts.view, requestId: 'r1' });
      expect(db.createUser).toHaveBeenCalledWith({ username: 'x', password: 'password1', displayName: undefined, roleId: 'viewer', active: undefined });
    });

    it('cannot promote anyone to admin', async () => {
      const reply = await call('update-user', { id: 'view', roleId: 'admin' });

      expect(reply).toMatchObject({ success: false, error: 'Only an admin can give out the Admin role.' });
      expect(db.updateUser).not.toHaveBeenCalled();
    });

    it('cannot edit an admin account, not even its password', async () => {
      const reply = await call('update-user', { id: 'boss', password: 'takeover1' });

      expect(reply).toMatchObject({ success: false, error: 'Only an admin can manage an admin account.' });
      expect(db.updateUser).not.toHaveBeenCalled();
    });

    it('cannot edit an account with permissions it lacks', async () => {
      const reply = await call('update-user', { id: 'op', password: 'takeover1' });

      expect(reply).toMatchObject({ success: false, error: 'You cannot manage an account that has permissions you do not have.' });
      expect(db.updateUser).not.toHaveBeenCalled();
    });

    it('can edit an account with no more rights than its own', async () => {
      const reply = await call('update-user', { id: 'view', displayName: 'Viewer' });

      expect(reply).toEqual({ success: true, user: accounts.view, requestId: 'r1' });
    });

    it.each(['boss', 'op'])('cannot delete %s', async id => {
      const reply = await call('delete-user', { id });

      expect(reply).toMatchObject({ success: false });
      expect(db.deleteUser).not.toHaveBeenCalled();
    });

    it('can delete an account with no more rights than its own', async () => {
      expect(await call('delete-user', { id: 'view' })).toEqual({ success: true, id: 'view', requestId: 'r1' });
    });

    it('cannot create a role with permissions it lacks', async () => {
      const reply = await call('create-role', { name: 'r', permissions: ['servers.view', 'servers.control'] });

      expect(reply).toMatchObject({ success: false, error: 'You cannot grant permissions you do not have.' });
      expect(db.createRole).not.toHaveBeenCalled();
    });

    it('cannot add a permission it lacks to a role, including its own', async () => {
      const reply = await call('update-role', { id: 'user-managers', name: 'user-managers', permissions: [...MANAGER_PERMISSIONS, 'rcon.use'] });

      expect(reply).toMatchObject({ success: false, error: 'You cannot grant permissions you do not have.' });
      expect(db.updateRole).not.toHaveBeenCalled();
    });

    it('cannot delete a role with permissions it lacks', async () => {
      const reply = await call('delete-role', { id: 'operator' });

      expect(reply).toEqual({ success: false, error: 'You cannot delete a role with permissions you do not have.', requestId: 'r1' });
      expect(db.deleteRole).not.toHaveBeenCalled();
    });

    it('can delete a role with no more rights than its own', async () => {
      db.deleteRole.mockReturnValue({ success: true, data: { id: 'viewer' } });

      expect(await call('delete-role', { id: 'viewer' })).toEqual({ success: true, id: 'viewer', requestId: 'r1' });
    });

    it('can rename a role that keeps permissions it lacks, since nothing is granted', async () => {
      const reply = await call('update-role', { id: 'operator', name: 'Ops', permissions: roles.operator.permissions });

      expect(reply).toEqual({ success: true, role: roles.viewer, requestId: 'r1' });
    });
  });

  describe('an admin', () => {
    it.each([['the desktop', desktop], ['a web admin', web(accounts.boss)]])('%s can give out the Admin role', async (_label, sender) => {
      await call('create-user', { username: 'x', password: 'password1', roleId: 'admin' }, sender);
      // op2 owns nothing; op owns m1 and may not stop being an operator.
      await call('update-user', { id: 'op2', roleId: 'admin' }, sender);
      await call('create-role', { name: 'r', permissions: ALL_PERMISSIONS }, sender);

      expect(db.createUser).toHaveBeenCalled();
      expect(db.updateUser).toHaveBeenCalled();
      expect(db.createRole).toHaveBeenCalled();
    });
  });

  describe('changing yourself', () => {
    it('refuses changing your own role or disabling yourself', async () => {
      const self = web(accounts.view);

      expect(await call('update-user', { id: 'view', roleId: 'operator' }, self)).toMatchObject({
        success: false, error: 'You cannot change your own role or disable your own account.'
      });
      expect(await call('update-user', { id: 'view', active: false }, self)).toMatchObject({ success: false });
      expect(db.updateUser).not.toHaveBeenCalled();
    });

    it('refuses deleting yourself', async () => {
      expect(await call('delete-user', { id: 'view' }, web(accounts.view))).toEqual({
        success: false, error: 'You cannot delete your own account.', requestId: 'r1'
      });
    });
  });

  describe('after a change', () => {
    it('tells every client and drops the sessions whose rights changed', async () => {
      await call('update-role', { id: 'viewer', name: 'viewer', permissions: [] }, desktop);

      expect(mockMessaging.sendToAll).toHaveBeenCalledWith('users-changed', { userId: undefined, roleId: 'viewer' });
      expect(mockMessaging.invalidateWebSessions).toHaveBeenCalledWith({ userId: undefined, roleId: 'viewer' });
      expect(mockMessaging.sendToOriginator.mock.invocationCallOrder[0])
        .toBeLessThan(mockMessaging.sendToAll.mock.invocationCallOrder[0]);
    });

    it('stays quiet after a refused change', async () => {
      db.deleteUser.mockReturnValue({ success: false, error: 'User not found.' });

      expect(await call('delete-user', { id: 'ghost' }, desktop)).toEqual({ success: false, error: 'User not found.', requestId: 'r1' });
      expect(mockMessaging.sendToAll).not.toHaveBeenCalled();
    });
  });

  describe('reads', () => {
    it('get-current-user reports the account main resolved', async () => {
      db.hasAnyUser.mockReturnValue(true);

      expect(await call('get-current-user', {}, web(accounts.view))).toEqual({
        success: true, user: accounts.view, isLocalDesktop: false, isAdmin: false,
        permissions: roles.viewer.permissions, accountsInUse: true, requestId: 'r1'
      });
    });

    it('get-current-user gives the desktop every permission and no account', async () => {
      db.hasAnyUser.mockReturnValue(false);

      expect(await call('get-current-user', {}, desktop)).toEqual({
        success: true, user: null, isLocalDesktop: true, isAdmin: true,
        permissions: ALL_PERMISSIONS, accountsInUse: false, requestId: 'r1'
      });
    });

    it('get-users replies empty lists alongside an error', async () => {
      db.listUsers.mockImplementation(() => { throw new Error('locked'); });

      expect(await call('get-users', {}, desktop)).toEqual({ success: false, error: 'locked', users: [], roles: [], requestId: 'r1' });
    });

    it('get-roles replies empty lists alongside an error', async () => {
      db.listRoles.mockImplementation(() => { throw new Error('locked'); });

      expect(await call('get-roles', {}, desktop)).toEqual({ success: false, error: 'locked', roles: [], permissions: [], requestId: 'r1' });
    });

    it('answers a request without a payload', async () => {
      db.listUsers.mockReturnValue([]);
      db.listRoles.mockReturnValue([]);

      await handlers['get-users'](undefined, desktop);

      expect(mockMessaging.sendToOriginator).toHaveBeenCalledWith('get-users', { success: true, users: [], roles: [], requestId: undefined }, desktop);
    });
  });

  it('change-own-password needs an account', async () => {
    expect(await call('change-own-password', { currentPassword: 'a', newPassword: 'b' }, desktop)).toMatchObject({
      success: false, error: 'The desktop app does not sign in, so there is no password to change here.'
    });
  });
describe('user-handler pools', () => {
  const handlers = poolHandlers;
  const op = web(accounts.op);

  beforeEach(() => {
    db.getRole.mockImplementation(id => roles[id] ?? null);
    db.getAuthenticatedUser.mockImplementation(id => accounts[id] ?? null);
    db.listUsers.mockReturnValue(Object.values(accounts));
    db.listRoles.mockReturnValue(Object.values(roles));
    db.createUser.mockResolvedValue({ success: true, data: accounts.m1 });
    db.updateUser.mockResolvedValue({ success: true, data: accounts.m1 });
    db.deleteUser.mockReturnValue({ success: true, data: { id: 'm1' } });
    mockGetAllInstances.mockResolvedValue([]);
  });

  // The last reply on the channel: several calls in one test share the mock's call list.
  async function call(channel: string, payload: Record<string, unknown>, sender: unknown = op) {
    await handlers[channel]({ ...payload, requestId: 'r1' }, sender);
    return mockMessaging.sendToOriginator.mock.calls.filter(([replyChannel]) => replyChannel === channel).pop()?.[1];
  }

  it('shows a pool owner only their own accounts', async () => {
    const reply = await call('get-users', {}) as { users: AuthenticatedUser[] };

    expect(reply.users.map(user => user.id)).toEqual(['m1']);
  });

  it('shows a users.manage holder and an admin every account', async () => {
    expect(((await call('get-users', {}, manager)) as { users: unknown[] }).users).toHaveLength(Object.keys(accounts).length);
    expect(((await call('get-users', {}, desktop)) as { users: unknown[] }).users).toHaveLength(Object.keys(accounts).length);
  });

  it('forces a pool owner\'s new account into their own pool', async () => {
    await call('create-user', { username: 'x', password: 'password1', roleId: 'viewer', ownerUserId: 'op2' });

    expect(db.createUser).toHaveBeenCalledWith(expect.objectContaining({ roleId: 'viewer', ownerUserId: 'op' }));
  });

  it('refuses a pool owner creating a kind of account they may not create', async () => {
    const limited = web({ ...accounts.op, permissions: ['servers.view', 'accounts.viewers.create'] });

    const reply = await call('create-user', { username: 'x', password: 'password1', roleId: 'server-manager' }, limited);

    expect(reply).toMatchObject({ success: false, error: 'Your role cannot create that kind of account.' });
    expect(db.createUser).not.toHaveBeenCalled();
  });

  it('refuses a pool owner creating an operator', async () => {
    const reply = await call('create-user', { username: 'x', password: 'password1', roleId: 'operator' });

    expect(reply).toMatchObject({ success: false, error: 'An operator can only create a server manager, attendant or viewer.' });
  });

  it('refuses a pool owner touching an account outside their pool', async () => {
    expect(await call('update-user', { id: 'view', displayName: 'V' })).toMatchObject({ success: false, error: 'That account is not in your pool.' });
    expect(await call('delete-user', { id: 'view' })).toMatchObject({ success: false, error: 'That account is not in your pool.' });
    expect(db.updateUser).not.toHaveBeenCalled();
    expect(db.deleteUser).not.toHaveBeenCalled();
  });

  it('refuses a pool owner deleting without the delete permission for that kind', async () => {
    const limited = web({ ...accounts.op, permissions: ['servers.view', 'accounts.managers.create'] });

    expect(await call('delete-user', { id: 'm1' }, limited)).toMatchObject({ success: false, error: 'Your role cannot delete that account.' });
    expect(await call('update-user', { id: 'm1', displayName: 'M' }, limited)).toMatchObject({ success: true });
  });

  it('lets an admin place a pool account under an operator', async () => {
    await call('create-user', { username: 'x', password: 'password1', roleId: 'viewer', ownerUserId: 'op' }, desktop);

    expect(db.createUser).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: 'op' }));
  });

  it('refuses deleting an operator who still owns accounts', async () => {
    expect(await call('delete-user', { id: 'op' }, desktop)).toMatchObject({ success: false, error: 'Move or delete the accounts in this pool first.' });
    expect(db.deleteUser).not.toHaveBeenCalled();
  });

  it('refuses deleting an operator who still owns servers', async () => {
    mockGetAllInstances.mockResolvedValue([{ id: 's1', operatorUserId: 'op2' }] as never);

    expect(await call('delete-user', { id: 'op2' }, desktop)).toMatchObject({ success: false, error: 'Move or delete this operator\'s servers first.' });
  });

  it('refuses deleting, moving or re-roling an assignee who still has servers', async () => {
    mockGetAllInstances.mockResolvedValue([{ id: 's1', operatorUserId: 'op', managerUserId: 'm1' }] as never);

    expect(await call('delete-user', { id: 'm1' }, desktop)).toMatchObject({ success: false, error: 'Reassign their servers before deleting this account.' });
    expect(await call('update-user', { id: 'm1', ownerUserId: 'op2' }, desktop)).toMatchObject({ success: false, error: 'Reassign their servers before moving them to another pool.' });
    expect(await call('update-user', { id: 'm1', roleId: 'viewer' }, desktop)).toMatchObject({ success: false, error: 'Reassign their servers before changing this role.' });
    expect(await call('update-user', { id: 'm1', roleId: 'attendant' }, desktop)).toMatchObject({ success: true });
  });

  it('refuses disabling or demoting an operator who still owns accounts or servers', async () => {
    expect(await call('update-user', { id: 'op', active: false }, desktop)).toMatchObject({ success: false, error: 'Move or delete the accounts in this pool first.' });
    expect(await call('update-user', { id: 'op', roleId: 'viewer' }, desktop)).toMatchObject({ success: false, error: 'Move or delete the accounts in this pool first.' });

    mockGetAllInstances.mockResolvedValue([{ id: 's1', operatorUserId: 'op2' }] as never);
    expect(await call('update-user', { id: 'op2', active: false }, desktop)).toMatchObject({ success: false, error: 'Move or delete this operator\'s servers first.' });
    expect(await call('update-user', { id: 'op2', displayName: 'Still fine' }, desktop)).toMatchObject({ success: true });
    expect(db.updateUser).toHaveBeenCalledTimes(1);
  });

  it('lists pool labels for an admin and for an operator', async () => {
    const forAdmin = await call('list-pool-labels', {}, desktop) as { operators: { id: string }[]; assignees: { id: string; roleName: string }[] };
    expect(forAdmin.operators.map(o => o.id)).toEqual(['op', 'op2']);
    expect(forAdmin.assignees.map(a => [a.id, a.roleName])).toEqual([['m1', 'server-manager']]);

    const forOp = await call('list-pool-labels', {}, op) as { operators: { id: string }[]; assignees: { id: string }[] };
    expect(forOp.operators.map(o => o.id)).toEqual(['op']);
    expect(forOp.assignees.map(a => a.id)).toEqual(['m1']);
  });

  it('lists only the labels of visible servers for a pool member', async () => {
    mockGetAllInstances.mockResolvedValue([
      { id: 's1', operatorUserId: 'op', managerUserId: 'm1' },
      { id: 's2', operatorUserId: 'op2', managerUserId: null }
    ] as never);

    const forManager = await call('list-pool-labels', {}, web(accounts.m1)) as { operators: { id: string }[]; assignees: { id: string }[] };

    expect(forManager.operators.map(o => o.id)).toEqual(['op']);
    expect(forManager.assignees.map(a => a.id)).toEqual(['m1']);
  });
});
});
