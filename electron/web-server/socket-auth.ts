import type { IncomingMessage } from 'http';
import { messagingService } from '../services/messaging.service';
import { LEGACY_ADMIN_ID, ROLE_IDS, SessionUser } from '../types/auth.types';
import type { SocketIdentity } from '../types/messaging.types';
import { getAuthConfig } from './auth-config';
import { getLiveSession, resolveSessionFromCookieHeader, sessionTokenFromCookieHeader } from './auth-middleware';

/**
 * Teaches the WebSocket server who is on the other end of a connection.
 *
 * The upgrade never passes through Express, so none of the HTTP auth middleware runs on it; before
 * this hook a browser could open /ws without signing in and call every channel. The account read
 * from the session cookie travels with each message, and main re-resolves it before the
 * permission check.
 */
export function installSocketAuth(): void {
  messagingService.resolveSocketUser = resolveSocketIdentity;
  messagingService.isSessionLive = token => getLiveSession(token) !== undefined;
}

export function resolveSocketIdentity(request: IncomingMessage): SocketIdentity {
  // With authentication off the web UI is open by design: every connection acts with full rights.
  if (!getAuthConfig().enabled) {
    return { user: null, authEnabled: false, allowed: true };
  }

  const session = resolveSessionFromCookieHeader(request.headers.cookie);
  if (!session) {
    return { user: null, authEnabled: true, allowed: false };
  }

  // A session from the single login that predates accounts has no userId. That login was
  // always a full administrator.
  const user: SessionUser = session.userId
    ? {
        id: session.userId,
        username: session.username,
        displayName: session.username,
        roleId: session.roleId || '',
        roleName: '',
        permissions: session.permissions || [],
        active: true
      }
    : {
        id: LEGACY_ADMIN_ID,
        username: session.username,
        displayName: session.username,
        roleId: ROLE_IDS.ADMIN,
        roleName: 'Admin',
        permissions: [],
        active: true
      };
  return { user, authEnabled: true, allowed: true, sessionToken: sessionTokenFromCookieHeader(request.headers.cookie) ?? undefined };
}
