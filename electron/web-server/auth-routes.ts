import express from 'express';
import { validateAuthInput, sanitizeString } from '../utils/validation.utils';
import { getAuthConfig, verifyPassword, hashPassword, updateAuthConfig } from './auth-config';
import { ensureAuthInitialized, createSession, destroySession, isAuthenticated } from './auth-middleware';

/**
 * Setup authentication routes on the Express app
 */

// Pure handler for login
export async function loginHandler(req: express.Request, res: express.Response) {
  const { username, password } = req.body;
  const validation = validateAuthInput(username, password);
  if (!validation.valid) {
    res.status(400).json({ success: false, error: validation.error });
    return;
  }
  const authConfig = getAuthConfig();
  if (!authConfig.enabled) {
    res.json({ success: true, message: 'Authentication not required' });
    return;
  }
  if (!authConfig.username || !authConfig.passwordHash) {
    console.error('[Auth] Authentication is enabled but username or password hash is missing');
    res.status(500).json({ success: false, error: 'Authentication configuration error' });
    return;
  }
  const cleanUsername = sanitizeString(username);
  const cleanPassword = sanitizeString(password);
  if (cleanUsername === authConfig.username && await verifyPassword(cleanPassword, authConfig.passwordHash)) {
    createSession(res, cleanUsername);
    res.json({ success: true, message: 'Login successful' });
    return;
  }
  res.status(401).json({ success: false, error: 'Invalid credentials' });
}

// Pure handler for logout
export function logoutHandler(req: express.Request, res: express.Response) {
  destroySession(req, res);
  res.json({ success: true, message: 'Logged out successfully' });
}

// Pure handler for auth status
export function authStatusHandler(req: express.Request, res: express.Response) {
  const authConfig = getAuthConfig();
  if (!authConfig.enabled) {
    res.json({
      requiresAuth: false,
      authenticated: true,
      message: 'Authentication not enabled'
    });
    return;
  }
  const authenticated = isAuthenticated(req);
  res.json({
    requiresAuth: true,
    authenticated,
    message: authenticated ? 'Authenticated' : 'Not authenticated'
  });
}

export function setupAuthRoutes(app: express.Express): void {
  app.post('/api/login', ensureAuthInitialized, loginHandler);
  app.post('/api/logout', ensureAuthInitialized, logoutHandler);
  app.get('/api/auth-status', ensureAuthInitialized, authStatusHandler);
}