import express from 'express';
import { validateAuthInput, sanitizeString } from '../utils/validation.utils';
import { getAuthConfig, verifyPassword, hashPassword, updateAuthConfig } from './auth-config';
import { ensureAuthInitialized, createSession, destroySession, isAuthenticated } from './auth-middleware';
import { verifyWithUserDatabase } from './user-bridge';

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
  const cleanUsername = sanitizeString(username);
  const cleanPassword = sanitizeString(password);

  // Accounts live in the main process's database; ask it first. A null answer means either
  // bad credentials or no accounts at all, so fall through to the legacy single login.
  const account = await verifyWithUserDatabase(cleanUsername, cleanPassword);
  if (account) {
    createSession(res, account.username, {
      id: account.id,
      roleId: account.roleId,
      permissions: account.permissions || []
    });
    res.json({ success: true, message: 'Login successful', user: account });
    return;
  }

  // The single login that predates accounts. It is optional now: an install that only has
  // accounts leaves it unset, and checking for it before the accounts above turned every
  // sign-in into a configuration error.
  const hasLegacyLogin = !!authConfig.username && !!authConfig.passwordHash;
  if (hasLegacyLogin
      && cleanUsername === authConfig.username
      && await verifyPassword(cleanPassword, authConfig.passwordHash)) {
    createSession(res, cleanUsername);
    res.json({ success: true, message: 'Login successful' });
    return;
  }

  if (!hasLegacyLogin) {
    // Worth saying out loud: with no single login configured, accounts are the only way in,
    // so a rejection here means the account was not found rather than a typo in the config.
    console.warn('[Auth] No single login is configured; sign-in is by account only.');
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