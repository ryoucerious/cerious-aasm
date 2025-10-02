import { messagingService } from '../services/messaging.service';
import { platformService } from '../services/platform.service';

/** Handles the 'get-system-info' message event from the messaging service.
 * 
 * When triggered, this handler invokes the PlatformService to get system information.
 * It then sends the result back to the originator of the message, including details such as
 * the current Node.js version, Electron version, platform, and config path.
 * In case of unexpected errors during the retrieval process, it logs the error and sends a failure
 * response to the originator.
 *
 * @param payload - The payload received with the message, expected to contain `requestId`.
 * @param sender - The sender of the message, used to route the response.
 */
messagingService.on('get-system-info', (payload, sender) => {
  const { requestId } = payload || {};
  try {
    const nodeVersion = platformService.getNodeVersion();
    const electronVersion = platformService.getElectronVersion();
    const platform = platformService.getPlatform();
    const configPath = platformService.getConfigPath();
    
    messagingService.sendToOriginator('get-system-info', { nodeVersion, electronVersion, platform, configPath, requestId }, sender);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('System info handler error:', errMsg);
    messagingService.sendToOriginator('get-system-info', { error: errMsg, requestId }, sender);
  }
});
