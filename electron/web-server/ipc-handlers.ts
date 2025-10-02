import { messagingService } from '../services/messaging.service';
import { updateAuthConfig, hashPassword } from './auth-config';

/**
 * Setup IPC message handlers for the web server
 */
export function setupIPCHandlers(): void {
  // Listen for messaging responses from main process
  process.on('message', async (message: any) => {
    if (message.type === 'messaging-response') {
      // Forward to WebSocket clients
      messagingService.sendToAllWebSockets(message.channel, message.data);
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