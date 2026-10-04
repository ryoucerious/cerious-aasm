import { messagingService } from '../services/messaging.service';
import { resolveAuthVerify } from './user-bridge';
import { invalidateSessionsFor } from '../utils/session-store.utils';
import { AuthConfig, getAuthConfig, updateAuthConfig } from './auth-config';
import { MainToChildMessage, SOCKET_CLOSE } from '../types/messaging.types';

/** Handles what the main process sends this child. */
export function setupIPCHandlers(): void {
  process.on('message', (message: MainToChildMessage | undefined) => {
    switch (message?.type) {
      case 'auth-verify-result':
        resolveAuthVerify(message.requestId, message.user || null);
        break;
      case 'invalidate-sessions': {
        const removed = invalidateSessionsFor({ userId: message.userId, roleId: message.roleId });
        if (removed.length > 0) {
          console.info(`[ipc-handlers] Dropped ${removed.length} session(s) after an account or role change.`);
          messagingService.closeWebSockets(SOCKET_CLOSE.UNAUTHORIZED, 'Session ended',
            socket => !!socket._sessionToken && removed.includes(socket._sessionToken));
        }
        break;
      }
      case 'messaging-response':
        // A reply belongs to the client that asked. Sending it to every socket leaked one
        // user's data to all the others and let a stale requestId resolve someone else's call.
        messagingService.sendToWebSocket(message.cid, message.channel, message.data);
        break;
      case 'broadcast-web':
        messagingService.sendToAllWebSockets(message.channel, message.data, message.excludeCid);
        break;
      case 'update-auth-config': {
        const before = getAuthConfig();
        // Only these fields: spreading the message once saved a plaintext password to disk.
        const { enabled, username, passwordHash } = message.authConfig;
        updateAuthConfig({ enabled, username, passwordHash });
        // A socket keeps the rights it was opened with; one opened while authentication was off
        // would keep the owner's. Reconnecting makes every client pass the new handshake.
        if (loginChanged(before, getAuthConfig())) {
          messagingService.closeWebSockets(SOCKET_CLOSE.RECONNECT, 'Sign-in settings changed');
        }
        break;
      }
    }
  });
}

function loginChanged(before: AuthConfig, after: AuthConfig): boolean {
  return before.enabled !== after.enabled
    || before.username !== after.username
    || before.passwordHash !== after.passwordHash;
}
