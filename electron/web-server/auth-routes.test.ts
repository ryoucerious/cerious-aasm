
import { loginHandler, logoutHandler, authStatusHandler } from './auth-routes';
import { validateAuthInput, sanitizeString } from '../utils/validation.utils';
import { getAuthConfig, verifyPassword } from './auth-config';
import { createSession, destroySession, isAuthenticated } from './auth-middleware';
import httpMocks from 'node-mocks-http';

// Use jest.mock with factory to override all relevant exports with jest.fn mocks
jest.mock('../utils/validation.utils', () => {
  const actual = jest.requireActual('../utils/validation.utils');
  return {
    ...actual,
    validateAuthInput: jest.fn(() => ({ valid: true })),
    sanitizeString: jest.fn((str: string) => str),
  };
});
jest.mock('../web-server/auth-config', () => {
  const actual = jest.requireActual('../web-server/auth-config');
  return {
    ...actual,
    getAuthConfig: jest.fn(() => ({ enabled: true, username: 'testuser', passwordHash: 'hashedpassword' })),
    verifyPassword: jest.fn(() => Promise.resolve(true)),
  };
});
jest.mock('../web-server/auth-middleware', () => {
  const actual = jest.requireActual('../web-server/auth-middleware');
  return {
    ...actual,
    ensureAuthInitialized: jest.fn((req: any, res: any, next: any) => next()),
    createSession: jest.fn(),
    destroySession: jest.fn(),
    isAuthenticated: jest.fn(() => false),
  };
});

const validationUtils = require('../utils/validation.utils');
const authConfigModule = require('../web-server/auth-config');
const authMiddlewareModule = require('../web-server/auth-middleware');
const { createRequest, createResponse } = require('node-mocks-http');


jest.mock('express');

const mockExpress = require('express');

describe('auth-routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  describe('loginHandler', () => {
    it('should return 400 if validation fails', async () => {
      (validateAuthInput as jest.Mock).mockReturnValue({ valid: false, error: 'Missing fields' });
      const req = httpMocks.createRequest({ method: 'POST', body: { username: '', password: '' } });
      const res = httpMocks.createResponse();
      await loginHandler(req, res);
      expect(res.statusCode).toBe(400);
      expect(res._getJSONData()).toEqual({ success: false, error: 'Missing fields' });
    });

    it('should return success if auth is disabled', async () => {
      (validateAuthInput as jest.Mock).mockReturnValue({ valid: true });
      (getAuthConfig as jest.Mock).mockReturnValue({ enabled: false });
      const req = httpMocks.createRequest({ method: 'POST', body: { username: 'user', password: 'pass' } });
      const res = httpMocks.createResponse();
      await loginHandler(req, res);
      expect(res._getJSONData()).toEqual({ success: true, message: 'Authentication not required' });
    });

    it('should return 500 if config is missing', async () => {
      (validateAuthInput as jest.Mock).mockReturnValue({ valid: true });
      (getAuthConfig as jest.Mock).mockReturnValue({ enabled: true });
      const req = httpMocks.createRequest({ method: 'POST', body: { username: 'user', password: 'pass' } });
      const res = httpMocks.createResponse();
      await loginHandler(req, res);
      expect(res.statusCode).toBe(500);
      expect(res._getJSONData()).toEqual({ success: false, error: 'Authentication configuration error' });
    });

    it('should return 401 if credentials are invalid', async () => {
      (validateAuthInput as jest.Mock).mockReturnValue({ valid: true });
      (getAuthConfig as jest.Mock).mockReturnValue({ enabled: true, username: 'user', passwordHash: 'hash' });
      (verifyPassword as jest.Mock).mockResolvedValue(false);
      const req = httpMocks.createRequest({ method: 'POST', body: { username: 'user', password: 'wrong' } });
      const res = httpMocks.createResponse();
      await loginHandler(req, res);
      expect(res.statusCode).toBe(401);
      expect(res._getJSONData()).toEqual({ success: false, error: 'Invalid credentials' });
    });

    it('should return success and create session if credentials are valid', async () => {
      (validateAuthInput as jest.Mock).mockReturnValue({ valid: true });
      (getAuthConfig as jest.Mock).mockReturnValue({ enabled: true, username: 'user', passwordHash: 'hash' });
      (verifyPassword as jest.Mock).mockResolvedValue(true);
      const req = httpMocks.createRequest({ method: 'POST', body: { username: 'user', password: 'pass' } });
      const res = httpMocks.createResponse();
      await loginHandler(req, res);
      expect(createSession).toHaveBeenCalledWith(res, 'user');
      expect(res._getJSONData()).toEqual({ success: true, message: 'Login successful' });
    });
  });
});
  describe('logoutHandler', () => {
    it('should destroy session and return success', () => {
      const req = httpMocks.createRequest({ method: 'POST' });
      const res = httpMocks.createResponse();
      logoutHandler(req, res);
      expect(destroySession).toHaveBeenCalledWith(req, res);
      expect(res._getJSONData()).toEqual({ success: true, message: 'Logged out successfully' });
    });
  });

  describe('authStatusHandler', () => {
    it('should return not required if auth is disabled', () => {
      (getAuthConfig as jest.Mock).mockReturnValue({ enabled: false });
      const req = httpMocks.createRequest({ method: 'GET' });
      const res = httpMocks.createResponse();
      authStatusHandler(req, res);
      expect(res._getJSONData()).toEqual({
        requiresAuth: false,
        authenticated: true,
        message: 'Authentication not enabled'
      });
    });

    it('should return authenticated status', () => {
      (getAuthConfig as jest.Mock).mockReturnValue({ enabled: true });
      (isAuthenticated as jest.Mock).mockReturnValue(true);
      const req = httpMocks.createRequest({ method: 'GET' });
      const res = httpMocks.createResponse();
      authStatusHandler(req, res);
      expect(res._getJSONData()).toEqual({
        requiresAuth: true,
        authenticated: true,
        message: 'Authenticated'
      });
    });

    it('should return not authenticated status', () => {
      (getAuthConfig as jest.Mock).mockReturnValue({ enabled: true });
      (isAuthenticated as jest.Mock).mockReturnValue(false);
      const req = httpMocks.createRequest({ method: 'GET' });
      const res = httpMocks.createResponse();
      authStatusHandler(req, res);
      expect(res._getJSONData()).toEqual({
        requiresAuth: true,
        authenticated: false,
        message: 'Not authenticated'
      });
    });
  });

