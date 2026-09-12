import { messagingService } from '../services/messaging.service';
import { getAuthConfig } from './auth-config';
import { resolveSessionFromCookieHeader } from './auth-middleware';

/**
 * Teaches the WebSocket server who is on the other end of a connection.
 *
 * The socket upgrade never passes through Express, so none of the HTTP auth middleware runs
 * on it. Until this hook existed a browser could open /ws without signing in and call every
 * channel on the bus. The resolver reads the same session cookie the HTTP routes use and
 * hands back the account, which then travels with each message for the permission check in
 * the main process.
 */
export function installSocketAuth(): void {
  messagingService.resolveSocketUser = (request: any) => {
    const authEnabled = !!getAuthConfig().enabled;

    // With authentication off the web UI is open by design, exactly as before accounts
    // existed. Every connection is allowed and acts with full rights.
    if (!authEnabled) {
      return { user: null, authEnabled: false, allowed: true };
    }

    const session = resolveSessionFromCookieHeader(request?.headers?.cookie);
    if (!session) {
      return { user: null, authEnabled: true, allowed: false };
    }

    // A session created before accounts existed (legacy single login) has no userId. Treat
    // it as a full administrator, which is what that single login always was.
    if (!session.userId) {
      return {
        user: {
          id: 'legacy-admin',
          username: session.username,
          displayName: session.username,
          roleId: 'admin',
          roleName: 'Admin',
          permissions: [],
          active: true
        },
        authEnabled: true,
        allowed: true
      };
    }

    return {
      user: {
        id: session.userId,
        username: session.username,
        displayName: session.username,
        roleId: session.roleId || '',
        roleName: '',
        permissions: session.permissions || [],
        active: true
      },
      authEnabled: true,
      allowed: true
    };
  };
}
