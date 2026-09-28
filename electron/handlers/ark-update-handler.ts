import { messagingService } from '../services/messaging.service';
import { ArkUpdateService } from '../services/ark-update.service';

// Will be set by main.ts via setArkUpdateService()
let arkUpdateService: ArkUpdateService | null = null;

export function setArkUpdateService(service: ArkUpdateService): void {
  arkUpdateService = service;
}

/**
 * Handles the 'check-ark-update' message event from the messaging service.
 * 
 * When triggered, this handler invokes the ArkUpdateService to check for available updates.
 * It then sends the result back to the originator of the message, including details such as
 * whether an update is available, the build ID, a message, and any error information.
 * 
 * In case of unexpected errors during the update check, it logs the error and sends a failure
 * response to the originator.
 * 
 * @param payload - The payload received with the message, expected to contain a `requestId`.
 * @param sender - The sender of the message, used to route the response.
 */
/**
 * Handles 'get-ark-installation': everything the ARK Installation settings page shows —
 * whether the server is installed, the installed and latest build ids, where it lives, and
 * when the two were last compared.
 */
messagingService.on('get-ark-installation', async (payload: any, sender: any) => {
  const { requestId } = payload || {};
  try {
    const { isArkServerInstalled, getArkServerDir } = require('../utils/ark/ark-install.utils');
    const installed = isArkServerInstalled();
    // Re-read the installed build through the service so the build shown and the update flag
    // come from one comparison. Straight after an install the disk has the new build while the
    // last poll still says an update is pending.
    const status = arkUpdateService ? await arkUpdateService.refreshInstalledBuild() : null;

    messagingService.sendToOriginator('get-ark-installation', {
      success: true,
      installed,
      installedBuildId: status?.installedBuildId ?? null,
      latestBuildId: status?.latestBuildId ?? null,
      updateAvailable: !!status?.updateAvailable,
      lastCheckedAt: status?.lastCheckedAt ?? null,
      installPath: getArkServerDir(),
      requestId
    }, sender);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ark-update-handler] Failed to read installation status:', message);
    messagingService.sendToOriginator('get-ark-installation', { success: false, error: message, requestId }, sender);
  }
});

messagingService.on('check-ark-update', async (payload, sender) => {
  const { requestId } = payload || {};
  
  if (!arkUpdateService) {
    console.error('[ark-update-handler] ArkUpdateService not initialized');
    messagingService.sendToOriginator('check-ark-update', {
      success: false,
      error: 'Update service not initialized',
      requestId
    }, sender);
    return;
  }

  try {
    const result = await arkUpdateService.checkForUpdate();
    
    messagingService.sendToOriginator('check-ark-update', {
      success: result.success,
      hasUpdate: result.hasUpdate,
      buildId: result.buildId,
      message: result.message,
      error: result.error,
      requestId
    }, sender);
  } catch (error) {
    console.error('[ark-update-handler] Unexpected error:', error);
    
    messagingService.sendToOriginator('check-ark-update', {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      requestId
    }, sender);
  }
});
