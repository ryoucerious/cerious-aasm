import crypto from 'crypto';
import type express from 'express';
import type { AuthenticatedUser } from '../types/auth.types';
import { messagingService } from '../services/messaging.service';
import { SOCKET_CLOSE } from '../types/messaging.types';
import { SESSION_MAX_AGE_MS, SessionData, deleteSession, getSession, setSession } from '../utils/session-store.utils';
import { DEFAULT_REMEMBER_ME_DAYS, loadGlobalConfig, validRememberMeDays } from '../utils/global-config.utils';
import { getAuthConfig, legacyLoginFingerprint } from './auth-config';

const DAY_MS = 24 * 60 * 60 * 1000;

const SESSION_COOKIE = 'session';
const PUBLIC_API_PATHS = new Set(['/login', '/logout', '/auth-status']);

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function sessionTokenFromCookieHeader(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const entry = cookieHeader.split(';').find(c => c.trim().startsWith(`${SESSION_COOKIE}=`));
  if (!entry) return null;
  const value = entry.trim().slice(SESSION_COOKIE.length + 1);
  return value || null;
}

/**
 * The session behind a token, or undefined when it is unknown or expired, or when it belongs to the
 * legacy login and that login's username or password changed since it was made (it is then removed).
 * Every request and socket message resolves sessions through here.
 */
export function getLiveSession(token: string): SessionData | undefined {
  const session = getSession(token);
  if (session && !session.userId && session.loginFingerprint !== legacyLoginFingerprint()) {
    deleteSession(token);
    return undefined;
  }
  return session;
}

/**
 * The live session behind a raw Cookie header, or null when there is none.
 * The WebSocket upgrade uses this directly because it never passes through Express.
 */
export function resolveSessionFromCookieHeader(cookieHeader: string | undefined): SessionData | null {
  const token = sessionTokenFromCookieHeader(cookieHeader);
  return (token && getLiveSession(token)) || null;
}

/** Guards /api while authentication is on; mounted on '/api', so paths arrive without the prefix. */
export function sessionAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!getAuthConfig().enabled || PUBLIC_API_PATHS.has(req.path)) {
    next();
    return;
  }
  if (!isAuthenticated(req)) {
    res.status(401).json({ error: 'Authentication required', requiresLogin: true });
    return;
  }
  next();
}

/**
 * Who a session belongs to: an account, or the legacy single login, identified by the fingerprint of
 * the login the password was checked against (see legacyLoginFingerprint).
 */
export type SessionOwner = (Pick<AuthenticatedUser, 'id' | 'roleId' | 'permissions'> & { securityVersion?: number }) | { loginFingerprint: string };

/**
 * How long a remembered sign-in lasts. Read from the global config on each sign-in, so a change in
 * Settings applies to the next sign-in without restarting the web server.
 */
export function rememberMeDurationMs(): number {
  return (validRememberMeDays(loadGlobalConfig().rememberMeDays) ?? DEFAULT_REMEMBER_ME_DAYS) * DAY_MS;
}

/**
 * The account is stored on the session so the WebSocket handshake can attach an identity without a
 * database round trip. A remembered session keeps its cookie across browser restarts for the
 * configured days; any other ends with the browser, and on the server after SESSION_MAX_AGE_MS.
 */
export function createSession(req: express.Request, res: express.Response, username: string, owner: SessionOwner, remember = false): void {
  const token = generateSessionToken();
  const created = new Date();
  const lifetimeMs = remember ? rememberMeDurationMs() : SESSION_MAX_AGE_MS;
  const expiresAt = new Date(created.getTime() + lifetimeMs);
  const session: SessionData = 'loginFingerprint' in owner
    ? { username, created, expiresAt, loginFingerprint: owner.loginFingerprint }
    : { username, created, expiresAt, userId: owner.id, roleId: owner.roleId, permissions: owner.permissions, securityVersion: owner.securityVersion };
  setSession(token, session);
  res.cookie(SESSION_COOKIE, token, remember ? { ...cookieOptions(req), maxAge: lifetimeMs } : cookieOptions(req));
}

export function destroySession(req: express.Request, res: express.Response): void {
  const token = sessionTokenFromCookieHeader(req.headers.cookie);
  if (token) {
    deleteSession(token);
    // Other tabs share the cookie, and their sockets would otherwise stay signed in.
    messagingService.closeWebSockets(SOCKET_CLOSE.UNAUTHORIZED, 'Signed out', socket => socket._sessionToken === token);
  }
  res.cookie(SESSION_COOKIE, '', { ...cookieOptions(req), path: '/', expires: new Date(0) });
}

export function isAuthenticated(req: express.Request): boolean {
  return resolveSessionFromCookieHeader(req.headers.cookie) !== null;
}

// Secure follows the request: the UI is also served over plain HTTP on a LAN, where a Secure
// cookie would never be sent back.
function cookieOptions(req: express.Request): express.CookieOptions {
  return { httpOnly: true, secure: req.secure, sameSite: 'strict' };
}
