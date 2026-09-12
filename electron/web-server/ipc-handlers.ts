import { messagingService } from '../services/messaging.service';
import { resolveAuthVerify } from './user-bridge';
import { invalidateSessionsFor } from '../utils/session-store.utils';
import { updateAuthConfig, hashPassword } from './auth-config';

/**
 * Setup IPC message handlers for the web server
 */
export function setupIPCHandlers(): void {
  // Listen for messaging responses from main process
  process.on('message', async (message: any) => {
    if (message.type === 'auth-verify-result') {
      resolveAuthVerify(message.requestId, message.user || null);
    } else if (message.type === 'invalidate-sessions') {
      const removed = invalidateSessionsFor({ userId: message.userId, roleId: message.roleId });
      if (removed > 0) {
        console.info(`[ipc-handlers] Dropped ${removed} session(s) after an account or role change.`);
      }
    } else if (message.type === 'messaging-response') {
      // A reply belongs to the client that asked. Sending it to every socket leaked one
      // user's data to all the others and let a stale requestId resolve someone else's call.
      messagingService.sendToWebSocket(message.cid, message.channel, message.data);
    } else if (message.type === 'broadcast-web') {
      // Main process requests a broadcast to web clients, with sender exclusion
      messagingService.sendToAllWebSockets(message.channel, message.data, message.excludeCid);
    } else if (message.type === 'update-auth-config') {
      // Update authentication configuration
      try {
        const authConfigUpdate = message.authConfig;

        // Handle different password formats from web UI
        if (authConfigUpdate.enabled) {
          if (authConfigUpdate.password && typeof authConfigUpdate.password === 'string') {
            // Plain text password provided - hash it
            authConfigUpdate.passwordHash = await hashPassword(authConfigUpdate.password);
            delete authConfigUpdate.password;
          } else if (authConfigUpdate.passwordHash && typeof authConfigUpdate.passwordHash === 'string') {
            // Already hashed password provided - use as is
          } else {
            // Invalid password format
            console.error('[Auth] No valid password or passwordHash provided');
            return;
          }
        }

        updateAuthConfig(authConfigUpdate);
      } catch (error) {
        console.error('[Auth] Failed to update auth config:', error);
      }
    }
  });
}