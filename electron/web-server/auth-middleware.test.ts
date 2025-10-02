import {
  generateSessionToken,
  sessionAuth,
  ensureAuthInitialized,
  createSession,
  destroySession,
  isAuthenticated
} from '../web-server/auth-middleware';

// Mock dependencies
jest.mock('crypto');
jest.mock('express');
jest.mock('../utils/session-store.utils');
jest.mock('../web-server/auth-config');

const mockCrypto = require('crypto');
const mockExpress = require('express');
const mockSessionStore = require('../utils/session-store.utils');
const mockAuthConfig = require('../web-server/auth-config');

// Mock express types
const mockRequest = () => ({
  headers: {},
  path: '/api/test'
});

const mockResponse = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
  cookie: jest.fn()
});

const mockNext = jest.fn();

describe('auth-middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default mocks
    mockAuthConfig.getAuthConfig.mockReturnValue({
      enabled: false,
      username: '',
      passwordHash: ''
    });
    mockAuthConfig.isAuthInitialized.mockReturnValue(true);
    mockSessionStore.hasSession.mockReturnValue(false);
    mockSessionStore.getSession.mockReturnValue(null);
  });

  describe('generateSessionToken', () => {
    it('should generate a secure random token', () => {
      mockCrypto.randomBytes.mockReturnValue(Buffer.from('testtoken1234567890123456'));

      const token = generateSessionToken();

      expect(mockCrypto.randomBytes).toHaveBeenCalledWith(32);
      expect(token).toBe('74657374746f6b656e31323334353637383930313233343536');
    });
  });

  describe('sessionAuth', () => {
    it('should call next() when auth is disabled', () => {
      mockAuthConfig.getAuthConfig.mockReturnValue({ enabled: false });

      const req = mockRequest();
      const res = mockResponse();

      sessionAuth(req as any, res as any, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should call next() for auth endpoints', () => {
      mockAuthConfig.getAuthConfig.mockReturnValue({ enabled: true });

      const req = mockRequest();
      req.path = '/login';
      const res = mockResponse();

      sessionAuth(req as any, res as any, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should return 401 when no session token provided', () => {
      mockAuthConfig.getAuthConfig.mockReturnValue({ enabled: true });

      const req = mockRequest();
      const res = mockResponse();

      sessionAuth(req as any, res as any, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Authentication required',
        requiresLogin: true
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when session token is invalid', () => {
      mockAuthConfig.getAuthConfig.mockReturnValue({ enabled: true });
      mockSessionStore.hasSession.mockReturnValue(false);

      const req = mockRequest();
      req.headers = { cookie: 'session=invalidtoken' };
      const res = mockResponse();

      sessionAuth(req as any, res as any, mockNext);

      expect(mockSessionStore.hasSession).toHaveBeenCalledWith('invalidtoken');
      expect(res.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when session is expired', () => {
      mockAuthConfig.getAuthConfig.mockReturnValue({ enabled: true });
      mockSessionStore.hasSession.mockReturnValue(true);
      mockSessionStore.getSession.mockReturnValue({
        username: 'testuser',
        created: new Date(Date.now() - 25 * 60 * 60 * 1000) // 25 hours ago
      });

      const req = mockRequest();
      req.headers = { cookie: 'session=validtoken' };
      const res = mockResponse();

      sessionAuth(req as any, res as any, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Session expired',
        requiresLogin: true
      });
      expect(mockSessionStore.deleteSession).toHaveBeenCalledWith('validtoken');
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should call next() for valid session', () => {
      mockAuthConfig.getAuthConfig.mockReturnValue({ enabled: true });
      mockSessionStore.hasSession.mockReturnValue(true);
      mockSessionStore.getSession.mockReturnValue({
        username: 'testuser',
        created: new Date(Date.now() - 1 * 60 * 60 * 1000) // 1 hour ago
      });

      const req = mockRequest();
      req.headers = { cookie: 'session=validtoken' };
      const res = mockResponse();

      sessionAuth(req as any, res as any, mockNext);

      expect((req as any).user).toEqual({ username: 'testuser' });
      expect(mockNext).toHaveBeenCalled();
    });

    it('should extract session token from cookie header', () => {
      mockAuthConfig.getAuthConfig.mockReturnValue({ enabled: true });

      const req = mockRequest();
      req.headers = { cookie: 'other=value; session=testtoken; another=value' };
      const res = mockResponse();

      sessionAuth(req as any, res as any, mockNext);

      expect(mockSessionStore.hasSession).toHaveBeenCalledWith('testtoken');
    });
  });

  describe('ensureAuthInitialized', () => {
    it('should call next() when auth is already initialized', async () => {
      mockAuthConfig.isAuthInitialized.mockReturnValue(true);

      const req = mockRequest();
      const res = mockResponse();

      await ensureAuthInitialized(req as any, res as any, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should wait for auth initialization', async () => {
      mockAuthConfig.isAuthInitialized
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);

      jest.useFakeTimers();
      const req = mockRequest();
      const res = mockResponse();

      const promise = ensureAuthInitialized(req as any, res as any, mockNext);

      // Run all pending timers and microtasks
      await Promise.resolve();
      if (jest.runAllTimersAsync) {
        await jest.runAllTimersAsync();
      } else {
        jest.runAllTimers();
        await Promise.resolve();
      }
      await promise;

      expect(mockNext).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe('createSession', () => {
    it('should create and set a session cookie', () => {
      mockCrypto.randomBytes.mockReturnValue(Buffer.from('testtoken1234567890123456'));

      const res = mockResponse();

      createSession(res as any, 'testuser');

      expect(mockSessionStore.setSession).toHaveBeenCalled();
      const [token, sessionData] = mockSessionStore.setSession.mock.calls[0];
      expect(token).toBe('74657374746f6b656e31323334353637383930313233343536');
      expect(sessionData.username).toBe('testuser');
      expect(sessionData.created).toBeInstanceOf(Date);

      expect(res.cookie).toHaveBeenCalledWith(
        'session',
        '74657374746f6b656e31323334353637383930313233343536',
        {
          httpOnly: true,
          secure: false,
          sameSite: 'strict',
          maxAge: 24 * 60 * 60 * 1000
        }
      );
    });
  });

  describe('destroySession', () => {
    it('should delete session and clear cookie', () => {
      const req = mockRequest();
      req.headers = { cookie: 'session=testtoken' };
      const res = mockResponse();

      destroySession(req as any, res as any);

      expect(mockSessionStore.deleteSession).toHaveBeenCalledWith('testtoken');
      expect(res.cookie).toHaveBeenCalled();
      const cookieCall = res.cookie.mock.calls.find(call => call[0] === 'session');
      expect(cookieCall).toBeDefined();
      expect(cookieCall[1]).toBe('');
      expect(cookieCall[2].httpOnly).toBe(true);
      expect(cookieCall[2].secure).toBe(false);
      expect(cookieCall[2].sameSite).toBe('strict');
      expect(cookieCall[2].path).toBe('/');
      expect(cookieCall[2].expires).toBeInstanceOf(Date);
    });

    it('should handle missing session token', () => {
      const req = mockRequest();
      const res = mockResponse();

      destroySession(req as any, res as any);

      expect(mockSessionStore.deleteSession).not.toHaveBeenCalled();
      expect(res.cookie).toHaveBeenCalled();
    });
  });

  describe('isAuthenticated', () => {
    it('should return true for valid session', () => {
      mockSessionStore.hasSession.mockReturnValue(true);

      const req = mockRequest();
      req.headers = { cookie: 'session=validtoken' };

      const result = isAuthenticated(req as any);

      expect(result).toBe(true);
      expect(mockSessionStore.hasSession).toHaveBeenCalledWith('validtoken');
    });

    it('should return false for invalid session', () => {
      mockSessionStore.hasSession.mockReturnValue(false);

      const req = mockRequest();
      req.headers = { cookie: 'session=invalidtoken' };

      const result = isAuthenticated(req as any);

      expect(result).toBe(false);
    });

    it('should return false when no session cookie', () => {
      const req = mockRequest();

      const result = isAuthenticated(req as any);

      expect(result).toBe(false);
      expect(mockSessionStore.hasSession).not.toHaveBeenCalled();
    });

    it('should extract session token from complex cookie header', () => {
      mockSessionStore.hasSession.mockReturnValue(true);

      const req = mockRequest();
      req.headers = { cookie: 'other=value; session=complex; another=value' };

      const result = isAuthenticated(req as any);

      expect(result).toBe(true);
      expect(mockSessionStore.hasSession).toHaveBeenCalledWith('complex');
    });
  });
});