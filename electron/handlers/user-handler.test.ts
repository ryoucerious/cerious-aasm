import { messagingService } from '../services/messaging.service';
import { userDatabaseService } from '../services/auth/user-database.service';
import { ALL_PERMISSIONS, AuthenticatedUser, BUILT_IN_ROLES, Permission, Role } from '../types/auth.types';
import type { ApiProcessSender } from '../types/messaging.types';

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

const mockMessaging = jest.mocked(messagingService);
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
    active: true, cliLocked: false, createdAt: 0, updatedAt: 0, lastLoginAt: null
  };
}

const accounts: Record<string, AuthenticatedUser> = {
  manager: account('manager', 'user-managers'),
  boss: account('boss', 'admin'),
  op: account('op', 'operator'),
  view: account('view', 'viewer')
};

function web(user: AuthenticatedUser): ApiProcessSender {
  return { type: 'api-process', cid: 'c1', user, authEnabled: true, send: jest.fn() };
}

const desktop = { send: jest.fn() };
const manager = web(accounts.manager);

type Listener = (payload: unknown, sender: unknown) => Promise<void>;

describe('user-handler', () => {
  let handlers: Record<string, Listener>;

  beforeAll(() => {
    require('./user-handler');
    handlers = Object.fromEntries(mockMessaging.on.mock.calls.map(([channel, listener]) => [channel, listener as Listener]));
  });

  beforeEach(() => {
    db.getRole.mockImplementation(id => roles[id] ?? null);
    db.getAuthenticatedUser.mockImplementation(id => accounts[id] ?? null);
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
      await call('update-user', { id: 'op', roleId: 'admin' }, sender);
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
});
