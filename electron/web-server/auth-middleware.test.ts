import httpMocks from 'node-mocks-http';
import { getAuthConfig, legacyLoginFingerprint } from './auth-config';
import {
  SessionOwner,
  createSession,
  destroySession,
  generateSessionToken,
  getLiveSession,
  isAuthenticated,
  resolveSessionFromCookieHeader,
  sessionAuth,
  sessionTokenFromCookieHeader
} from './auth-middleware';
import { SESSION_MAX_AGE_MS, getSession, resetSessionStore, setSession } from '../utils/session-store.utils';
import { messagingService } from '../services/messaging.service';

jest.mock('./auth-config', () => ({ getAuthConfig: jest.fn(), legacyLoginFingerprint: jest.fn() }));
jest.mock('../services/messaging.service', () => ({ messagingService: { closeWebSockets: jest.fn() } }));
jest.mock('../utils/fs.utils');
jest.mock('../utils/platform.utils', () => ({ getDefaultInstallDir: () => '/install' }));

const mockedGetAuthConfig = jest.mocked(getAuthConfig);
jest.mocked(legacyLoginFingerprint).mockImplementation(() => {
  const { username, passwordHash } = mockedGetAuthConfig();
  return `${username}:${passwordHash}`;
});

function authEnabled(enabled: boolean) {
  mockedGetAuthConfig.mockReturnValue({ enabled, username: '', passwordHash: '' });
}

function legacyLogin(username: string, passwordHash: string) {
  mockedGetAuthConfig.mockReturnValue({ enabled: true, username, passwordHash });
}

/** A plain-HTTP request; node-mocks-http leaves `secure` unset where Express always has a boolean. */
function request(options: httpMocks.RequestOptions = {}, secure = false) {
  const req = httpMocks.createRequest(options);
  Object.defineProperty(req, 'secure', { value: secure });
  return req;
}

/** Signs in (with the current legacy login unless an account is given) and returns the Cookie header a browser would send back. */
function signIn(owner: SessionOwner = { loginFingerprint: legacyLoginFingerprint() }): string {
  const res = httpMocks.createResponse();
  createSession(request(), res, 'jared', owner);
  return `session=${res.cookies.session.value}`;
}

describe('auth-middleware', () => {
  beforeEach(() => {
    resetSessionStore();
    authEnabled(true);
  });

  afterEach(() => {
    resetSessionStore();
  });

  describe('sessionTokenFromCookieHeader', () => {
    it('finds the session cookie among others', () => {
      expect(sessionTokenFromCookieHeader('theme=dark; session=abc123; lang=en')).toBe('abc123');
    });

    it('keeps everything after the first "="', () => {
      expect(sessionTokenFromCookieHeader('session=abc=def')).toBe('abc=def');
    });

    it('returns null when there is no session cookie', () => {
      expect(sessionTokenFromCookieHeader(undefined)).toBeNull();
      expect(sessionTokenFromCookieHeader('xsession=abc')).toBeNull();
      expect(sessionTokenFromCookieHeader('session=')).toBeNull();
    });
  });

  it('generates a 256-bit hex token', () => {
    expect(generateSessionToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  describe('createSession', () => {
    it('stores the account with the session', () => {
      const cookie = signIn({ id: 'u-1', roleId: 'viewer', permissions: ['servers.view'] });

      expect(resolveSessionFromCookieHeader(cookie)).toMatchObject({
        username: 'jared', userId: 'u-1', roleId: 'viewer', permissions: ['servers.view']
      });
      expect(resolveSessionFromCookieHeader(cookie)?.loginFingerprint).toBeUndefined();
    });

    it('stamps a legacy session with the fingerprint it is given, not the current login', () => {
      // The caller checked the password against a snapshot; the login may have changed since.
      legacyLogin('admin', 'hash-2');
      const res = httpMocks.createResponse();

      createSession(request(), res, 'jared', { loginFingerprint: 'admin:hash-1' });

      expect(getSession(res.cookies.session.value)).toMatchObject({ username: 'jared', loginFingerprint: 'admin:hash-1' });
      expect(getSession(res.cookies.session.value)?.userId).toBeUndefined();
    });

    it('sets an HttpOnly, SameSite=Strict cookie that lasts as long as the session', () => {
      const res = httpMocks.createResponse();
      createSession(request(), res, 'jared', { loginFingerprint: 'fp' });

      expect(res.cookies.session.options).toEqual({
        httpOnly: true, secure: false, sameSite: 'strict', maxAge: SESSION_MAX_AGE_MS
      });
    });

    it('marks the cookie Secure when the request came over HTTPS', () => {
      const res = httpMocks.createResponse();

      createSession(request({}, true), res, 'jared', { loginFingerprint: 'fp' });

      expect(res.cookies.session.options.secure).toBe(true);
    });
  });

  describe('sessionAuth', () => {
    function run(path: string, cookie?: string) {
      const req = request({ path, headers: cookie ? { cookie } : {} });
      const res = httpMocks.createResponse();
      const next = jest.fn();
      sessionAuth(req, res, next);
      return { res, next };
    }

    it('lets everything through while authentication is off', () => {
      authEnabled(false);

      expect(run('/anything').next).toHaveBeenCalled();
    });

    it.each(['/login', '/logout', '/auth-status'])('lets %s through without a session', path => {
      expect(run(path).next).toHaveBeenCalled();
    });

    it('refuses a request without a session', () => {
      const { res, next } = run('/anything');

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
      expect(res._getJSONData()).toEqual({ error: 'Authentication required', requiresLogin: true });
    });

    it('lets a live session through', () => {
      expect(run('/anything', signIn()).next).toHaveBeenCalled();
    });

    it('refuses an expired session', () => {
      const cookie = signIn();
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + SESSION_MAX_AGE_MS + 1000);

      const { res, next } = run('/anything', cookie);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
    });
  });

  describe('isAuthenticated', () => {
    it('is true for a live session', () => {
      expect(isAuthenticated(request({ headers: { cookie: signIn() } }))).toBe(true);
    });

    it('is false without a session cookie', () => {
      expect(isAuthenticated(request())).toBe(false);
    });

    it('is false once the session has expired', () => {
      const cookie = signIn();
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + SESSION_MAX_AGE_MS + 1000);

      expect(isAuthenticated(request({ headers: { cookie } }))).toBe(false);
    });
  });

  describe('getLiveSession', () => {
    const cookieFor = (token: string) => `session=${token}`;

    it('signs a legacy session out once its login changes, and for good', () => {
      legacyLogin('admin', 'hash-1');
      const cookie = signIn();
      expect(isAuthenticated(request({ headers: { cookie } }))).toBe(true);

      legacyLogin('admin', 'hash-2');
      expect(isAuthenticated(request({ headers: { cookie } }))).toBe(false);

      legacyLogin('admin', 'hash-1');
      expect(isAuthenticated(request({ headers: { cookie } }))).toBe(false);
      expect(getSession(sessionTokenFromCookieHeader(cookie)!)).toBeUndefined();
    });

    it('signs a legacy session out when the username changes', () => {
      legacyLogin('admin', 'hash-1');
      const cookie = signIn();

      legacyLogin('owner', 'hash-1');

      expect(resolveSessionFromCookieHeader(cookie)).toBeNull();
    });

    it('keeps account sessions when the legacy login changes', () => {
      legacyLogin('admin', 'hash-1');
      const cookie = signIn({ id: 'u-1', roleId: 'viewer', permissions: ['servers.view'] });

      legacyLogin('admin', 'hash-2');

      expect(resolveSessionFromCookieHeader(cookie)).toMatchObject({ userId: 'u-1' });
    });

    it('treats a legacy session saved without a fingerprint as missing', () => {
      // Saved by a version that did not stamp sessions; nothing says which login made it.
      const token = 'ab'.repeat(32);
      setSession(token, { username: 'admin', created: new Date() });

      expect(getLiveSession(token)).toBeUndefined();
      expect(resolveSessionFromCookieHeader(cookieFor(token))).toBeNull();
    });
  });

  describe('destroySession', () => {
    it('deletes the session and expires the cookie', () => {
      const cookie = signIn();
      const token = sessionTokenFromCookieHeader(cookie)!;
      const res = httpMocks.createResponse();

      destroySession(request({ headers: { cookie } }), res);

      expect(getSession(token)).toBeUndefined();
      const [code, reason, matches] = jest.mocked(messagingService.closeWebSockets).mock.calls[0];
      expect([code, reason]).toEqual([4401, 'Signed out']);
      expect(matches!({ _sessionToken: token, readyState: 1, send: jest.fn(), close: jest.fn() })).toBe(true);
      expect(matches!({ _sessionToken: 'other', readyState: 1, send: jest.fn(), close: jest.fn() })).toBe(false);
      expect(res.cookies.session.value).toBe('');
      expect(res.cookies.session.options).toEqual({
        httpOnly: true, secure: false, sameSite: 'strict', path: '/', expires: new Date(0)
      });
    });

    it('still clears the cookie when there is no session', () => {
      const res = httpMocks.createResponse();

      destroySession(request(), res);

      expect(res.cookies.session.value).toBe('');
    });
  });
});
