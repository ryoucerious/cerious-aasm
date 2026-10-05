import type { IncomingMessage } from 'http';
import { getAuthConfig } from './auth-config';
import { getLiveSession, resolveSessionFromCookieHeader } from './auth-middleware';
import { installSocketAuth, resolveSocketIdentity } from './socket-auth';
import { messagingService } from '../services/messaging.service';

jest.mock('../services/messaging.service', () => ({ messagingService: {} }));
jest.mock('./auth-config', () => ({ getAuthConfig: jest.fn() }));
jest.mock('./auth-middleware', () => ({
  ...jest.requireActual('./auth-middleware'),
  resolveSessionFromCookieHeader: jest.fn(),
  getLiveSession: jest.fn()
}));

const upgrade = { headers: { cookie: 'session=abc' } } as IncomingMessage;

describe('resolveSocketIdentity', () => {
  beforeEach(() => {
    jest.mocked(getAuthConfig).mockReturnValue({ enabled: true, username: '', passwordHash: '' });
  });

  it('lets everyone in while authentication is off', () => {
    jest.mocked(getAuthConfig).mockReturnValue({ enabled: false, username: '', passwordHash: '' });

    expect(resolveSocketIdentity(upgrade)).toEqual({ user: null, authEnabled: false, allowed: true });
  });

  it('refuses a connection without a live session', () => {
    jest.mocked(resolveSessionFromCookieHeader).mockReturnValue(null);

    expect(resolveSocketIdentity(upgrade)).toEqual({ user: null, authEnabled: true, allowed: false });
    expect(resolveSessionFromCookieHeader).toHaveBeenCalledWith('session=abc');
  });

  it('names the account behind the session', () => {
    jest.mocked(resolveSessionFromCookieHeader).mockReturnValue({
      username: 'jared', created: new Date(), userId: 'u1', roleId: 'viewer', permissions: ['servers.view']
    });

    expect(resolveSocketIdentity(upgrade)).toEqual({
      user: {
        id: 'u1', username: 'jared', displayName: 'jared', roleId: 'viewer', roleName: '',
        permissions: ['servers.view'], active: true
      },
      authEnabled: true,
      allowed: true,
      sessionToken: 'abc'
    });
  });

  it("lets the bus check that a socket's session is still live", () => {
    // getLiveSession, not the raw store, so a legacy session of a changed login counts as gone.
    installSocketAuth();
    jest.mocked(getLiveSession).mockReturnValueOnce({ username: 'jared', created: new Date() }).mockReturnValueOnce(undefined);

    expect(messagingService.isSessionLive!('abc')).toBe(true);
    expect(messagingService.isSessionLive!('gone')).toBe(false);
    expect(getLiveSession).toHaveBeenCalledWith('abc');
  });

  it('treats a session from the legacy single login as the admin it always was', () => {
    jest.mocked(resolveSessionFromCookieHeader).mockReturnValue({ username: 'admin', created: new Date() });

    expect(resolveSocketIdentity(upgrade).user).toMatchObject({ id: 'legacy-admin', roleId: 'admin' });
  });
});
