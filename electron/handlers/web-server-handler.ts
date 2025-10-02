import { messagingService } from '../services/messaging.service';
import { webServerService } from '../services/web-server.service';
import { settingsService } from '../services/settings.service';

messagingService.on('start-web-server', async (payload, sender) => {
  const port = payload?.port || 3000;
  try {
    // Load current global config to get authentication settings
    const globalConfig = settingsService.getGlobalConfig();
    const authOptions = settingsService.getWebServerAuthConfig(globalConfig);
    
    const result = await webServerService.startWebServer(port, authOptions);
    // Send direct response to the requester with requestId for proper matching
    sender?.send?.('start-web-server', {
      success: result.success,
      port: result.port,
      message: result.message,
      requestId: payload?.requestId // Include requestId for frontend matching
    });
  } catch (error) {
    // Send direct error response to the requester with requestId
    sender?.send?.('start-web-server', {
      success: false,
      port,
      message: `Failed to start web server: ${error}`,
      requestId: payload?.requestId // Include requestId for frontend matching
    });
  }
});

messagingService.on('stop-web-server', async (payload, sender) => {
  try {
    const result = await webServerService.stopWebServer();
    // Send direct response to the requester
    sender?.send?.('stop-web-server', {
      success: result.success,
      message: result.message,
      requestId: payload?.requestId // Include requestId for frontend matching
    });
    // Also broadcast status to all clients
    sender?.send?.('web-server-status', {
      running: false,
      port: webServerService.getStatus().port,
      message: result.message
    });
  } catch (error) {
    // Send direct error response to the requester
    sender?.send?.('stop-web-server', {
      success: false,
      message: `Error stopping web server: ${error}`,
      requestId: payload?.requestId // Include requestId for frontend matching
    });
    // Also broadcast status to all clients
    sender?.send?.('web-server-status', {
      running: webServerService.getStatus().running,
      port: webServerService.getStatus().port,
      message: `Error stopping web server: ${error}`
    });
  }
});

messagingService.on('web-server-status', (_payload, sender) => {
  const status = webServerService.getStatus();
  sender?.send?.('web-server-status', { running: status.running, port: status.port });
});