import { messagingService } from '../services/messaging.service';
import { webServerService } from '../services/web-server.service';
import { settingsService } from '../services/settings.service';
import { parsePort, validatePort } from '../utils/validation.utils';
import type { MessageSender } from '../types/messaging.types';
import { errorMessage, onRequest } from './handler.utils';

const DEFAULT_PORT = 3000;

onRequest('start-web-server', async payload => {
  const requested = payload.port || DEFAULT_PORT;
  const port = parsePort(requested);
  if (port === undefined || !validatePort(port)) {
    return { success: false, port: requested, message: 'Failed to start web server: Invalid web server port' };
  }
  const authOptions = settingsService.getWebServerAuthConfig(settingsService.getGlobalConfig());
  const result = await webServerService.startWebServer(port, authOptions);
  return { success: result.success, port: result.port, message: result.message };
}, {
  // This channel reports failures in `message`, not `error`.
  onError: (message, payload) => ({
    success: false,
    port: payload.port || DEFAULT_PORT,
    message: `Failed to start web server: ${message}`
  })
});

// Replies on two channels, so it cannot use onRequest: the caller's status view updates at once.
messagingService.on('stop-web-server', async (payload: unknown, sender: MessageSender) => {
  const { requestId } = (payload ?? {}) as { requestId?: unknown };
  let result: { success: boolean; message: string };
  let running = false;
  try {
    result = await webServerService.stopWebServer();
  } catch (error) {
    console.error('[web-server-handler] Failed to stop the web server:', error);
    result = { success: false, message: `Error stopping web server: ${errorMessage(error)}` };
    running = webServerService.getStatus().running;
  }
  messagingService.sendToOriginator('stop-web-server', { ...result, requestId }, sender);
  messagingService.sendToOriginator('web-server-status', {
    running,
    port: webServerService.getStatus().port,
    message: result.message
  }, sender);
});

// No requestId: the settings page listens on this channel for status pushes as well.
messagingService.on('web-server-status', (_payload: unknown, sender: MessageSender) => {
  const { running, port } = webServerService.getStatus();
  messagingService.sendToOriginator('web-server-status', { running, port }, sender);
});
