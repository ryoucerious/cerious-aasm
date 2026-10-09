import { authorizeChannel, identifySender, isDesktopWindow } from './permission-gate';
import { noteLocalNode, noteMeshServers, noteSecurityVersion, registerMeshAuth } from '../mesh/mesh-hooks';
import { setMeshDesktopMode } from './desktop-session';
import type { ApiProcessSender, WebSocketClient } from '../../types/messaging.types';
import { ALL_PERMISSIONS, AuthenticatedUser, BUILT_IN_ROLES } from '../../types/auth.types';
import { permissionForChannel } from './channel-permissions';
import { getInstance } from '../../utils/ark/instance.utils';

jest.mock('../../utils/ark/instance.utils', () => ({ getInstance: jest.fn() }));
const mockGetInstance = jest.mocked(getInstance);

function account(roleId: string, permissions: AuthenticatedUser['permissions']): AuthenticatedUser {
  return {
    id: `id-${roleId}`, username: roleId, displayName: roleId, roleId, roleName: roleId, permissions,
    active: true, ownerUserId: null, cliLocked: false, createdAt: 0, updatedAt: 0, lastLoginAt: null
  };
}

function web(user: AuthenticatedUser | null, authEnabled = true): ApiProcessSender {
  return { type: 'api-process', cid: 'c1', user, authEnabled, send: jest.fn() };
}

const desktop = { send: jest.fn() } as never;

afterEach(() => setMeshDesktopMode(false));

describe('identifySender', () => {
  it('treats the desktop window as the admin who owns the machine', () => {
    expect(identifySender(desktop)).toMatchObject({ isAdmin: true, isLocalDesktop: true, user: null });
  });

  it('uses the account main resolved for a web client', () => {
    const viewer = account('viewer', ['servers.view']);

    expect(identifySender(web(viewer))).toEqual({
      user: viewer, permissions: ['servers.view'], isAdmin: false, isLocalDesktop: false
    });
    expect(identifySender(web(account('admin', ALL_PERMISSIONS))).isAdmin).toBe(true);
  });

  it('treats a web client without an account as anonymous, unless authentication is off', () => {
    expect(identifySender(web(null))).toMatchObject({ isAdmin: false, user: null });
    expect(identifySender(web(null, false))).toMatchObject({ isAdmin: true, isLocalDesktop: true });
  });

  it('never gives a raw socket the desktop rights', () => {
    const socket: WebSocketClient = {
      _cid: 'c1', _user: { ...account('admin', []) }, _authEnabled: true, readyState: 1, send: jest.fn(), close: jest.fn()
    };

    expect(identifySender(socket)).toMatchObject({ isAdmin: false, user: null });
    expect(identifySender({ ...socket, _authEnabled: false }).isAdmin).toBe(true);
  });
});

// Auth being off gives a web client the desktop's rights, but it is still not on this machine.
describe('isDesktopWindow', () => {
  it('is true for the app\'s own window', () => {
    expect(isDesktopWindow(desktop)).toBe(true);
  });

  it.each([
    ['a signed-in web client', web(account('admin', ALL_PERMISSIONS))],
    ['a web client with authentication off', web(null, false)],
    ['a raw socket with authentication off', { _authEnabled: false, readyState: 1, send: jest.fn(), close: jest.fn() } as WebSocketClient],
    ['no sender', undefined]
  ])('is false for %s', (_label, sender) => {
    expect(isDesktopWindow(sender)).toBe(false);
  });
});

describe('authorizeChannel', () => {
  it('lets an admin use any channel, even an unclassified one', () => {
    expect(authorizeChannel('no-such-channel', desktop)).toEqual({ allowed: true });
  });

  it('asks an anonymous client to sign in', () => {
    expect(authorizeChannel('get-server-instances', web(null))).toEqual({ allowed: false, error: 'You must sign in to do that.' });
  });

  it('lets the desktop read who it is and sign in once a mesh is on', () => {
    setMeshDesktopMode(true);
    expect(authorizeChannel('get-host-resources', desktop)).toEqual({ allowed: false, error: 'You must sign in to do that.' });
    expect(authorizeChannel('get-current-user', desktop)).toEqual({ allowed: true });
    expect(authorizeChannel('mesh-login', desktop)).toEqual({ allowed: true });
    expect(authorizeChannel('mesh-bootstrap-admin', desktop)).toEqual({ allowed: true });
    expect(authorizeChannel('mesh-bootstrap-admin', web(null))).toEqual({ allowed: false, error: 'You must sign in to do that.' });
  });

  it('follows the permission map for everyone else', () => {
    const viewer = web(account('viewer', ['servers.view']));

    expect(authorizeChannel('get-server-instances', viewer)).toEqual({ allowed: true });
    expect(authorizeChannel('get-current-user', viewer)).toEqual({ allowed: true });
    expect(authorizeChannel('start-server-instance', viewer)).toEqual({
      allowed: false, error: 'Your role does not allow this (servers.control required).'
    });
    expect(authorizeChannel('no-such-channel', viewer)).toEqual({ allowed: false, error: 'Your role does not allow this.' });
  });

  it.each(BUILT_IN_ROLES.map(role => [role.name, role] as const))(
    'lets the %s role make the requests every page sends on load',
    (_name, role) => {
      const sender = web(account(role.id, role.permissions));

      for (const channel of ['get-app-update-status', 'get-global-config', 'get-ark-installation']) {
        expect(authorizeChannel(channel, sender)).toEqual({ allowed: true });
      }
    }
  );

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'treats the inherited object property %s as an unclassified channel',
    channel => {
      const viewer = web(account('viewer', ['servers.view']));

      expect(permissionForChannel(channel)).toBeUndefined();
      expect(authorizeChannel(channel, viewer)).toEqual({ allowed: false, error: 'Your role does not allow this.' });
    }
  );

  it('lets whoever may control servers stop one gracefully', () => {
    const operator = web(account('operator', ['servers.view', 'servers.control']));
    const viewer = web(account('viewer', ['servers.view']));

    expect(authorizeChannel('stop-server-instance', operator)).toEqual({ allowed: true });
    expect(authorizeChannel('stop-server-instance', viewer)).toEqual({
      allowed: false, error: 'Your role does not allow this (servers.control required).'
    });
  });
describe('authorizeChannel pool scope', () => {
  const operator = (permissions: AuthenticatedUser['permissions']) => ({ ...account('operator', permissions), id: 'op-1' });

  beforeEach(() => mockGetInstance.mockReset());
  afterEach(() => noteMeshServers([]));

  it('refuses a call about a server another node hosts outside the pool', () => {
    mockGetInstance.mockReturnValue(null);
    noteMeshServers([{ serverId: 's9', nodeId: 'n2', operatorUserId: 'op-2', managerUserId: null }]);

    expect(authorizeChannel('rcon-command', web(operator(['rcon.use'])), { id: 's9' }))
      .toEqual({ allowed: false, error: 'That server is not in your pool.' });
  });

  it('allows a call about a server another node hosts inside the pool', () => {
    mockGetInstance.mockReturnValue(null);
    noteMeshServers([{ serverId: 's9', nodeId: 'n2', operatorUserId: 'op-1', managerUserId: null }]);

    expect(authorizeChannel('save-ini-file', web(operator(['servers.configure'])), { instanceId: 's9' })).toEqual({ allowed: true });
  });

  it('checks the pool of a server being moved', () => {
    mockGetInstance.mockReturnValue({ id: 's1', operatorUserId: 'op-2' } as never);

    expect(authorizeChannel('move-server', web(operator(['servers.move'])), { serverId: 's1', nodeId: 'n2' }).allowed).toBe(false);
  });


  it('refuses a call about a server outside the caller\'s pool', () => {
    mockGetInstance.mockReturnValue({ id: 's1', operatorUserId: 'op-2' } as never);

    expect(authorizeChannel('start-server-instance', web(operator(['servers.control'])), { id: 's1' }))
      .toEqual({ allowed: false, error: 'That server is not in your pool.' });
    expect(mockGetInstance).toHaveBeenCalledWith('s1');
  });

  it('allows a call about a server inside the pool', () => {
    mockGetInstance.mockReturnValue({ id: 's1', operatorUserId: 'op-1' } as never);

    expect(authorizeChannel('create-backup', web(operator(['backups.create'])), { instanceId: 's1' })).toEqual({ allowed: true });
  });

  it('refuses a reorder that includes any server outside the pool', () => {
    mockGetInstance.mockImplementation(id => ({ id, operatorUserId: id === 's2' ? 'op-2' : 'op-1' }) as never);

    expect(authorizeChannel('reorder-server-instances', web(operator(['servers.configure'])), { orderedIds: ['s1', 's2'] }).allowed).toBe(false);
    expect(authorizeChannel('reorder-server-instances', web(operator(['servers.configure'])), { orderedIds: ['s1'] }).allowed).toBe(true);
  });

  it('reads the id of the instance being saved and skips a new server', () => {
    mockGetInstance.mockReturnValue({ id: 's1', operatorUserId: 'op-2' } as never);
    const sender = web(operator(['servers.create', 'servers.configure']));

    expect(authorizeChannel('save-server-instance', sender, { instance: { id: 's1', name: 'x' } }).allowed).toBe(false);
    expect(authorizeChannel('save-server-instance', sender, { instance: { name: 'new' } }).allowed).toBe(true);
    expect(mockGetInstance).toHaveBeenCalledTimes(1);
  });

  it('leaves an unknown server to the handler', () => {
    mockGetInstance.mockReturnValue(null);

    expect(authorizeChannel('start-server-instance', web(operator(['servers.control'])), { id: 'nope' }).allowed).toBe(true);
  });

  it('never scopes an admin or the desktop', () => {
    mockGetInstance.mockReturnValue({ id: 's1', operatorUserId: 'op-2' } as never);

    expect(authorizeChannel('start-server-instance', desktop, { id: 's1' }).allowed).toBe(true);
    expect(authorizeChannel('start-server-instance', web(account('admin', ALL_PERMISSIONS)), { id: 's1' }).allowed).toBe(true);
    expect(mockGetInstance).not.toHaveBeenCalled();
  });

  it('still refuses on permission before looking at the pool', () => {
    expect(authorizeChannel('start-server-instance', web(operator(['servers.view'])), { id: 's1' }).allowed).toBe(false);
    expect(mockGetInstance).not.toHaveBeenCalled();
  });
});

// A machine admin sees the whole mesh but changes only its own machine and the servers on it.
describe('authorizeChannel machine scope', () => {
  const OTHER_MACHINE = 'That server is on another machine. A machine admin changes only the servers on its own machine.';
  const NOT_YOURS = 'That is not your machine. A machine admin changes only its own machine.';
  const machineAdmin = (extra: Partial<AuthenticatedUser> = {}) => ({
    ...account('machine-admin', BUILT_IN_ROLES.find(role => role.id === 'machine-admin')!.permissions),
    id: 'ma-1', machineNodeId: 'n1', ...extra
  });

  beforeEach(() => {
    mockGetInstance.mockReset();
    mockGetInstance.mockImplementation(id => (id === 'here' ? { id } : null) as never);
    noteMeshServers([
      { serverId: 'there', nodeId: 'n2', operatorUserId: 'op-2', managerUserId: null },
      // A copy left here of a server since moved: the mesh's placement wins.
      { serverId: 'moved', nodeId: 'n2', operatorUserId: null, managerUserId: null }
    ]);
    noteLocalNode('n1');
  });
  afterEach(() => {
    noteMeshServers([]);
    noteLocalNode(null);
  });

  it('runs and changes the servers on its own machine', () => {
    expect(authorizeChannel('start-server-instance', web(machineAdmin()), { id: 'here' })).toEqual({ allowed: true });
    expect(authorizeChannel('save-ini-file', web(machineAdmin()), { instanceId: 'here' })).toEqual({ allowed: true });
  });

  it('only looks at the servers on another machine', () => {
    expect(authorizeChannel('start-server-instance', web(machineAdmin()), { id: 'there' })).toEqual({ allowed: false, error: OTHER_MACHINE });
    expect(authorizeChannel('create-backup', web(machineAdmin()), { instanceId: 'there' })).toEqual({ allowed: false, error: OTHER_MACHINE });
    expect(authorizeChannel('get-server-instance-logs', web(machineAdmin()), { id: 'there' })).toEqual({ allowed: true });
    expect(authorizeChannel('get-backup-list', web(machineAdmin()), { instanceId: 'there' })).toEqual({ allowed: true });
  });

  it('goes by where the mesh says a server is, not by a copy left on this machine', () => {
    mockGetInstance.mockImplementation(id => ({ id }) as never);

    expect(authorizeChannel('stop-server-instance', web(machineAdmin()), { id: 'moved' })).toEqual({ allowed: false, error: OTHER_MACHINE });
  });

  it('moves any server between machines', () => {
    expect(authorizeChannel('move-server', web(machineAdmin()), { serverId: 'there', nodeId: 'n3' })).toEqual({ allowed: true });
  });

  it('installs and updates on its own machine, and on another only when a mesh admin allowed it', () => {
    expect(authorizeChannel('install', web(machineAdmin()), { target: 'server' })).toEqual({ allowed: true });
    expect(authorizeChannel('mesh-node-update', web(machineAdmin()), { nodeId: 'n1', kind: 'ark' })).toEqual({ allowed: true });

    noteLocalNode('n2');
    expect(authorizeChannel('install', web(machineAdmin()), { target: 'server' })).toEqual({ allowed: false, error: NOT_YOURS });
    expect(authorizeChannel('install', web(machineAdmin({ updatesAnyMachine: true })), { target: 'server' })).toEqual({ allowed: true });
    expect(authorizeChannel('mesh-node-update', web(machineAdmin()), { nodeId: 'n2', kind: 'ark' }))
      .toEqual({ allowed: false, error: 'A machine admin updates only its own machine, unless a mesh admin allows it to update every machine.' });
    expect(authorizeChannel('mesh-node-update', web(machineAdmin({ updatesAnyMachine: true })), { nodeId: 'n2', kind: 'app' })).toEqual({ allowed: true });
  });

  it('changes nothing else about a machine that is not its own', () => {
    noteLocalNode('n2');

    expect(authorizeChannel('setup-ark-server-firewall', web(machineAdmin()), {})).toEqual({ allowed: false, error: NOT_YOURS });
    expect(authorizeChannel('setup-ark-server-firewall', web(machineAdmin({ updatesAnyMachine: true })), {})).toEqual({ allowed: false, error: NOT_YOURS });
    // Working through another machine's page on a server of its own is fine.
    expect(authorizeChannel('curseforge-search-mods', web(machineAdmin()), { query: 'dino' })).toEqual({ allowed: true });
    expect(authorizeChannel('get-server-instances', web(machineAdmin()))).toEqual({ allowed: true });
  });

  it('cannot add or remove machines, even through a role that lists it', () => {
    expect(authorizeChannel('create-enrollment-token', web(machineAdmin()))).toMatchObject({ allowed: false });
  });
});

describe('authorizeChannel security version', () => {
  afterEach(() => registerMeshAuth(null));

  it('rejects an admin session issued before the account security version changed', () => {
    const admin = { ...account('admin', ALL_PERMISSIONS), securityVersion: 1 };
    noteSecurityVersion(admin.id, 2);
    expect(authorizeChannel('get-server-instances', web(admin))).toEqual({
      allowed: false,
      error: 'Your session is out of date. Sign in again.'
    });
  });

  it('allows a session that matches the current security version', () => {
    const admin = { ...account('admin', ALL_PERMISSIONS), securityVersion: 2 };
    noteSecurityVersion(admin.id, 2);
    expect(authorizeChannel('get-server-instances', web(admin)).allowed).toBe(true);
  });
});
});
