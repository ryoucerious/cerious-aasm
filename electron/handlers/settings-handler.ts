import { messagingService } from '../services/messaging.service';
import { settingsService } from '../services/settings.service';

/** Handles the 'get-global-config' message event from the messaging service.
 * 
 * When triggered, this handler invokes the SettingsService to get the global configuration.
 * It then sends the result back to the originator of the message, including details such as
 * the current configuration values.
 * In case of unexpected errors during the retrieval process, it logs the error and sends a failure
 * response to the originator.
 *
 * @param payload - The payload received with the message, expected to contain `requestId`.
 * @param sender - The sender of the message, used to route the response.
 */
messagingService.on('get-global-config', async (payload, sender) => {
  const { requestId } = payload || {};
  
  try {
    const config = settingsService.getGlobalConfig();
    messagingService.sendToOriginator('get-global-config', { ...config, requestId }, sender);
    // Also broadcast to all clients for consistent state
    messagingService.sendToAll('global-config', config);
  } catch (error) {
    console.error('[settings-handler] Error loading global config:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    messagingService.sendToOriginator('get-global-config', { error: errorMsg, requestId }, sender);
  }
});

/** Handles the 'set-global-config' message event from the messaging service.
 * 
 * When triggered, this handler invokes the SettingsService to update the global configuration.
 * It then sends the result back to the originator of the message, including details such as
 * success status and any error information.
 * If the update is successful, it also updates the web server authentication configuration
 * and broadcasts the updated configuration to all connected clients.
 * In case of unexpected errors during the update process, it logs the error and sends a failure
 * response to the originator.
 * 
 * @param payload - The payload received with the message, expected to contain `config` and `requestId`.
 * @param sender - The sender of the message, used to route the response.
 */
messagingService.on('set-global-config', async (payload, sender) => {
  const { config, requestId } = payload || {};
  
  try {
    const result = await settingsService.updateGlobalConfig(config);
    
    messagingService.sendToOriginator('set-global-config', { 
      success: result.success,
      error: result.error,
      requestId 
    }, sender);
    
    if (result.success && result.updatedConfig) {
      // Update web server authentication configuration
      const apiProcess = (messagingService as any).apiProcess;
      await settingsService.updateWebServerAuth(result.updatedConfig, apiProcess);
      
      // Broadcast updated config to all clients
      messagingService.sendToAll('global-config', result.updatedConfig);
    }
  } catch (error) {
    console.error('[settings-handler] Error updating global config:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    messagingService.sendToOriginator('set-global-config', { 
      success: false, 
      error: errorMsg,
      requestId 
    }, sender);
  }
});
