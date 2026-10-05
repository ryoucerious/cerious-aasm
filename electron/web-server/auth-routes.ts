import express from 'express';
import { validateAuthInput, sanitizeString } from '../utils/validation.utils';
import { getAuthConfig, legacyLoginFingerprint, verifyPassword } from './auth-config';
import { createSession, destroySession, isAuthenticated } from './auth-middleware';
import { verifyWithUserDatabase } from './user-bridge';

const MAX_FAILED_LOGINS = 10;
const FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000;
// Expired windows are only swept once this many keys are tracked, so a login costs O(1).
const SWEEP_THRESHOLD = 1000;

interface AttemptWindow {
  count: number;
  startedAt: number;
}

// Keyed by address and lower-cased username; throttles guessing before the bcrypt checks, which
// share a thread pool with main's file I/O. An attempt counts when it starts, so concurrent
// guesses cannot all pass before the first fails. A successful sign-in clears the count.
const loginAttempts = new Map<string, AttemptWindow>();

export async function loginHandler(req: express.Request, res: express.Response) {
  const { username, password } = req.body ?? {};
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

  // Only the username is cleaned: a password is compared exactly as it was typed.
  const cleanUsername = sanitizeString(username);
  const limiterKey = `${req.ip ?? ''}\n${cleanUsername.toLowerCase()}`;
  const now = Date.now();
  if (isLockedOut(limiterKey, now)) {
    res.status(429).json({ success: false, error: 'Too many sign-in attempts. Try again later.' });
    return;
  }
  countAttempt(limiterKey, now);

  // A null answer means bad credentials or no accounts at all, so fall through to the legacy login.
  const account = await verifyWithUserDatabase(cleanUsername, password);
  if (account) {
    loginAttempts.delete(limiterKey);
    createSession(req, res, account.username, account);
    res.json({ success: true, message: 'Login successful', user: account });
    return;
  }

  // The single login that predates accounts, now optional. The password is checked even when
  // the username does not match, so the response time does not give the username away.
  const hasLegacyLogin = !!authConfig.username && !!authConfig.passwordHash;
  const passwordMatches = await verifyPassword(password, authConfig.passwordHash);
  if (hasLegacyLogin && cleanUsername === authConfig.username && passwordMatches) {
    loginAttempts.delete(limiterKey);
    // From the snapshot the password was checked against: the login may have changed during the hash.
    createSession(req, res, cleanUsername, { loginFingerprint: legacyLoginFingerprint(authConfig) });
    res.json({ success: true, message: 'Login successful' });
    return;
  }

  res.status(401).json({ success: false, error: 'Invalid credentials' });
}

export function logoutHandler(req: express.Request, res: express.Response) {
  destroySession(req, res);
  res.json({ success: true, message: 'Logged out successfully' });
}

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
  app.post('/api/login', loginHandler);
  app.post('/api/logout', logoutHandler);
  app.get('/api/auth-status', authStatusHandler);
}

function isLockedOut(key: string, now: number): boolean {
  const window = loginAttempts.get(key);
  if (!window) return false;
  if (now - window.startedAt >= FAILED_LOGIN_WINDOW_MS) {
    loginAttempts.delete(key);
    return false;
  }
  return window.count >= MAX_FAILED_LOGINS;
}

function countAttempt(key: string, now: number): void {
  const window = loginAttempts.get(key);
  if (window && now - window.startedAt < FAILED_LOGIN_WINDOW_MS) {
    window.count++;
    return;
  }
  if (loginAttempts.size >= SWEEP_THRESHOLD) {
    for (const [trackedKey, tracked] of loginAttempts) {
      if (now - tracked.startedAt >= FAILED_LOGIN_WINDOW_MS) {
        loginAttempts.delete(trackedKey);
      }
    }
  }
  loginAttempts.set(key, { count: 1, startedAt: now });
}
