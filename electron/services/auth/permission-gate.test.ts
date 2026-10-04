import { authorizeChannel, identifySender, isDesktopWindow } from './permission-gate';
import type { ApiProcessSender, WebSocketClient } from '../../types/messaging.types';
import { ALL_PERMISSIONS, AuthenticatedUser, BUILT_IN_ROLES } from '../../types/auth.types';
import { permissionForChannel } from './channel-permissions';

function account(roleId: string, permissions: AuthenticatedUser['permissions']): AuthenticatedUser {
  return {
    id: `id-${roleId}`, username: roleId, displayName: roleId, roleId, roleName: roleId, permissions,
    active: true, cliLocked: false, createdAt: 0, updatedAt: 0, lastLoginAt: null
  };
}

function web(user: AuthenticatedUser | null, authEnabled = true): ApiProcessSender {
  return { type: 'api-process', cid: 'c1', user, authEnabled, send: jest.fn() };
}

const desktop = { send: jest.fn() } as never;

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
});
