import express from 'express';
import crypto from 'crypto';
import { setSession, getSession, deleteSession, hasSession, SessionData } from '../utils/session-store.utils';
import { getAuthConfig, isAuthInitialized } from './auth-config';

// =============================================================================
// CONSTANTS
// =============================================================================

const SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

// =============================================================================
// SESSION MANAGEMENT
// =============================================================================

/**
 * Generate a secure session token
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Session-based authentication middleware
 */
export function sessionAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const authConfig = getAuthConfig();

  // Skip auth if not enabled
  if (!authConfig.enabled) {
    return next();
  }

  // Skip auth for login/logout endpoints (remove /api prefix since middleware is already scoped)
  if (req.path === '/login' || req.path === '/logout' || req.path === '/auth-status') {
    return next();
  }

  // Check for session token in cookies
  const sessionToken = req.headers.cookie?.split(';')
    .find(c => c.trim().startsWith('session='))
    ?.split('=')[1];

  if (!sessionToken || !hasSession(sessionToken)) {
    res.status(401).json({ error: 'Authentication required', requiresLogin: true });
    return;
  }

  // Check session expiry
  const session = getSession(sessionToken);
  if (!session) {
    res.status(401).json({ error: 'Invalid session', requiresLogin: true });
    return;
  }

  const now = new Date();
  const sessionAge = now.getTime() - session.created.getTime();

  if (sessionAge > SESSION_MAX_AGE) {
    deleteSession(sessionToken);
    res.status(401).json({ error: 'Session expired', requiresLogin: true });
    return;
  }

  // Valid session
  (req as any).user = { username: session.username };
  next();
}

// =============================================================================
// MIDDLEWARE
// =============================================================================

/**
 * Middleware to ensure auth is initialized
 */
export async function ensureAuthInitialized(req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> {
  // Wait for auth to be initialized if it isn't already
  while (!isAuthInitialized()) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  next();
}

/**
 * Create and set a session for a user.
 *
 * `account` is the row from the user database; it is stored on the session so the
 * WebSocket handshake can attach an identity without another database round trip.
 * It is omitted in the legacy single-login mode, which has no database user.
 */
export function createSession(res: express.Response, username: string, account?: { id: string; roleId: string; permissions: string[] }): void {
  const sessionToken = generateSessionToken();
  setSession(sessionToken, {
    username,
    created: new Date(),
    userId: account?.id,
    roleId: account?.roleId,
    permissions: account?.permissions
  });

  // Set session cookie (secure for local environment)
  res.cookie('session', sessionToken, {
    httpOnly: true,
    secure: false, // Keep false for local HTTP environment
    sameSite: 'strict', // CSRF protection
    maxAge: SESSION_MAX_AGE
  });
}

/**
 * Destroy a session
 */
export function destroySession(req: express.Request, res: express.Response): void {
  const sessionToken = req.headers.cookie?.split(';')
    .find((c: string) => c.trim().startsWith('session='))
    ?.split('=')[1];

  if (sessionToken) {
    deleteSession(sessionToken);
  }

  // Clear cookie by setting it to expire immediately
  res.cookie('session', '', {
    httpOnly: true,
    secure: false,
    sameSite: 'strict',
    path: '/',
    expires: new Date(0)
  });
}

/** Pull the session token out of a raw Cookie header. */
export function sessionTokenFromCookieHeader(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const entry = cookieHeader.split(';').find((c: string) => c.trim().startsWith('session='));
  if (!entry) return null;
  // Split once only: a token is hex, but a stray '=' should not silently truncate it.
  const value = entry.trim().slice('session='.length);
  return value || null;
}

/**
 * The session behind a raw Cookie header, or null when it is missing or expired.
 * Used by the WebSocket upgrade, which never passes through Express middleware.
 */
export function resolveSessionFromCookieHeader(cookieHeader: string | undefined) {
  const token = sessionTokenFromCookieHeader(cookieHeader);
  if (!token) return null;
  const session = getSession(token);
  if (!session) return null;
  if (Date.now() - new Date(session.created).getTime() > SESSION_MAX_AGE) {
    deleteSession(token);
    return null;
  }
  return session;
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(req: express.Request): boolean {
  const sessionToken = req.headers.cookie?.split(';')
    .find((c: string) => c.trim().startsWith('session='))
    ?.split('=')[1];

  return !!(sessionToken && hasSession(sessionToken));
}