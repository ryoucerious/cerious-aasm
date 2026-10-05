import httpMocks from 'node-mocks-http';
import { authStatusHandler, loginHandler, logoutHandler } from './auth-routes';
import { getAuthConfig, legacyLoginFingerprint, verifyPassword } from './auth-config';
import { createSession, destroySession, isAuthenticated } from './auth-middleware';
import { verifyWithUserDatabase } from './user-bridge';
import type { AuthenticatedUser } from '../types/auth.types';

jest.mock('./auth-config', () => ({
  getAuthConfig: jest.fn(),
  legacyLoginFingerprint: jest.fn(),
  verifyPassword: jest.fn()
}));
jest.mock('./user-bridge', () => ({ verifyWithUserDatabase: jest.fn() }));
jest.mock('./auth-middleware', () => ({
  createSession: jest.fn(),
  destroySession: jest.fn(),
  isAuthenticated: jest.fn()
}));

const mockedGetAuthConfig = jest.mocked(getAuthConfig);
const mockedVerifyPassword = jest.mocked(verifyPassword);
const mockedVerifyWithUserDatabase = jest.mocked(verifyWithUserDatabase);

const account: AuthenticatedUser = {
  id: 'u1', username: 'jared', displayName: 'Jared', roleId: 'operator', roleName: 'Operator',
  permissions: ['servers.view'], active: true, ownerUserId: null, cliLocked: false, createdAt: 1, updatedAt: 1, lastLoginAt: null
};

let nextIp = 1;

/** Each test signs in from its own address so the limiter's memory does not leak between tests. */
function freshIp(): string {
  return `10.0.0.${nextIp++}`;
}

async function login(body: Record<string, unknown>, ip = freshIp()) {
  const req = httpMocks.createRequest({ method: 'POST', body, ip });
  const res = httpMocks.createResponse();
  await loginHandler(req, res);
  return { req, res };
}

describe('auth-routes', () => {
  beforeEach(() => {
    jest.mocked(legacyLoginFingerprint).mockImplementation(login => `${login?.username}:${login?.passwordHash}`);
    mockedGetAuthConfig.mockReturnValue({ enabled: true, username: 'admin', passwordHash: 'legacy-hash' });
    mockedVerifyPassword.mockResolvedValue(false);
    mockedVerifyWithUserDatabase.mockResolvedValue(null);
  });

  describe('loginHandler', () => {
    it('rejects a request without a username or password', async () => {
      const { res } = await login({ username: '', password: '' });

      expect(res.statusCode).toBe(400);
      expect(res._getJSONData()).toEqual({ success: false, error: 'Username is required' });
    });

    it('rejects a request without a body', async () => {
      const req = httpMocks.createRequest({ method: 'POST', ip: freshIp() });
      (req as { body?: unknown }).body = undefined;
      const res = httpMocks.createResponse();

      await loginHandler(req, res);

      expect(res.statusCode).toBe(400);
    });

    it('says no sign-in is needed while authentication is off', async () => {
      mockedGetAuthConfig.mockReturnValue({ enabled: false, username: '', passwordHash: '' });

      const { res } = await login({ username: 'user', password: 'pass' });

      expect(res._getJSONData()).toEqual({ success: true, message: 'Authentication not required' });
    });

    it('signs in an account', async () => {
      mockedVerifyWithUserDatabase.mockResolvedValue(account);

      const { req, res } = await login({ username: 'jared', password: 'correct horse' });

      expect(res.statusCode).toBe(200);
      expect(res._getJSONData()).toEqual({ success: true, message: 'Login successful', user: account });
      expect(createSession).toHaveBeenCalledWith(req, res, 'jared', account);
    });

    it('passes the password on exactly as typed', async () => {
      await login({ username: ' jared ', password: '  spaces count  ' });

      expect(mockedVerifyWithUserDatabase).toHaveBeenCalledWith('jared', '  spaces count  ');
      expect(mockedVerifyPassword).toHaveBeenCalledWith('  spaces count  ', 'legacy-hash');
    });

    it('signs in with the single legacy login', async () => {
      mockedVerifyPassword.mockResolvedValue(true);

      const { req, res } = await login({ username: 'admin', password: 'pass' });

      expect(res._getJSONData()).toEqual({ success: true, message: 'Login successful' });
      expect(createSession).toHaveBeenCalledWith(req, res, 'admin', { loginFingerprint: 'admin:legacy-hash' });
    });

    it('stamps a legacy session with the login the password was checked against', async () => {
      // A login changed while the hash was being compared must not vouch for the old password.
      mockedVerifyPassword.mockImplementation(async () => {
        mockedGetAuthConfig.mockReturnValue({ enabled: true, username: 'admin', passwordHash: 'changed-hash' });
        return true;
      });

      const { req, res } = await login({ username: 'admin', password: 'old password' });

      expect(createSession).toHaveBeenCalledWith(req, res, 'admin', { loginFingerprint: 'admin:legacy-hash' });
    });

    it('refuses a wrong password', async () => {
      const { res } = await login({ username: 'admin', password: 'wrong' });

      expect(res.statusCode).toBe(401);
      expect(res._getJSONData()).toEqual({ success: false, error: 'Invalid credentials' });
      expect(createSession).not.toHaveBeenCalled();
    });

    it('checks the password even when the username is not the legacy one', async () => {
      // Skipping the hash for an unknown name would reveal the legacy username through timing.
      mockedVerifyPassword.mockResolvedValue(true);

      const { res } = await login({ username: 'someone-else', password: 'pass' });

      expect(mockedVerifyPassword).toHaveBeenCalledWith('pass', 'legacy-hash');
      expect(res.statusCode).toBe(401);
    });

    it('still does a full password check when there is no legacy login', async () => {
      mockedGetAuthConfig.mockReturnValue({ enabled: true, username: '', passwordHash: '' });

      const { res } = await login({ username: 'nobody', password: 'pass' });

      expect(mockedVerifyPassword).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(401);
      expect(res._getJSONData()).toEqual({ success: false, error: 'Invalid credentials' });
    });

    describe('rate limit', () => {
      async function failTimes(count: number, username: string, ip: string) {
        for (let i = 0; i < count; i++) {
          const { res } = await login({ username, password: 'wrong' }, ip);
          expect(res.statusCode).toBe(401);
        }
      }

      it('answers 429 after 10 failures for one address and username, without checking the password', async () => {
        const ip = freshIp();
        await failTimes(10, 'admin', ip);
        mockedVerifyPassword.mockClear();
        mockedVerifyWithUserDatabase.mockClear();

        const { res } = await login({ username: 'ADMIN', password: 'right' }, ip);

        expect(res.statusCode).toBe(429);
        expect(res._getJSONData()).toEqual({ success: false, error: 'Too many sign-in attempts. Try again later.' });
        expect(mockedVerifyPassword).not.toHaveBeenCalled();
        expect(mockedVerifyWithUserDatabase).not.toHaveBeenCalled();
      });

      it('counts attempts still in flight, so concurrent guesses cannot race past the limit', async () => {
        const ip = freshIp();
        const pending: Array<(account: null) => void> = [];
        mockedVerifyWithUserDatabase.mockImplementation(() => new Promise(resolve => pending.push(resolve)));

        const attempts = Array.from({ length: 15 }, () => login({ username: 'admin', password: 'guess' }, ip));
        await new Promise(resolve => setImmediate(resolve));

        expect(mockedVerifyWithUserDatabase).toHaveBeenCalledTimes(10);
        pending.forEach(resolve => resolve(null));
        const statuses = (await Promise.all(attempts)).map(({ res }) => res.statusCode);
        expect(statuses.filter(status => status === 429)).toHaveLength(5);
        expect(statuses.filter(status => status === 401)).toHaveLength(10);
      });

      it('counts each username and address separately', async () => {
        const ip = freshIp();
        await failTimes(10, 'admin', ip);

        expect((await login({ username: 'jared', password: 'wrong' }, ip)).res.statusCode).toBe(401);
        expect((await login({ username: 'admin', password: 'wrong' }, freshIp())).res.statusCode).toBe(401);
      });

      it('lets the address try again once the 15 minutes are up', async () => {
        const ip = freshIp();
        await failTimes(10, 'admin', ip);
        jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 15 * 60 * 1000 + 1);

        expect((await login({ username: 'admin', password: 'wrong' }, ip)).res.statusCode).toBe(401);
      });

      it('clears the count after a successful sign-in', async () => {
        const ip = freshIp();
        await failTimes(9, 'admin', ip);
        mockedVerifyPassword.mockResolvedValueOnce(true);
        expect((await login({ username: 'admin', password: 'right' }, ip)).res.statusCode).toBe(200);

        await failTimes(10, 'admin', ip);
      });
    });
  });

  describe('logoutHandler', () => {
    it('destroys the session', () => {
      const req = httpMocks.createRequest({ method: 'POST' });
      const res = httpMocks.createResponse();

      logoutHandler(req, res);

      expect(destroySession).toHaveBeenCalledWith(req, res);
      expect(res._getJSONData()).toEqual({ success: true, message: 'Logged out successfully' });
    });
  });

  describe('authStatusHandler', () => {
    function status() {
      const res = httpMocks.createResponse();
      authStatusHandler(httpMocks.createRequest(), res);
      return res._getJSONData();
    }

    it('says no sign-in is needed while authentication is off', () => {
      mockedGetAuthConfig.mockReturnValue({ enabled: false, username: '', passwordHash: '' });

      expect(status()).toEqual({ requiresAuth: false, authenticated: true, message: 'Authentication not enabled' });
    });

    it('reports a signed-in client', () => {
      jest.mocked(isAuthenticated).mockReturnValue(true);

      expect(status()).toEqual({ requiresAuth: true, authenticated: true, message: 'Authenticated' });
    });

    it('reports a client that is not signed in', () => {
      jest.mocked(isAuthenticated).mockReturnValue(false);

      expect(status()).toEqual({ requiresAuth: true, authenticated: false, message: 'Not authenticated' });
    });
  });
});
