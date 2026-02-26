import { messagingService } from '../services/messaging.service';
import { autoUpdateService } from '../services/auto-update.service';

/**
 * IPC handler for auto-update actions from the renderer / web clients.
 *
 * Supported channels:
 *   - check-for-app-update   → triggers an update check
 *   - install-app-update     → quits and installs the downloaded update
 */

messagingService.on('check-for-app-update', async (_payload: any, sender: any) => {
  try {
    await autoUpdateService.checkForUpdates();
    messagingService.sendToOriginator('check-for-app-update', { success: true }, sender);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[auto-update-handler] Error checking for update:', errorMsg);
    messagingService.sendToOriginator('check-for-app-update', { success: false, error: errorMsg }, sender);
  }
});

messagingService.on('install-app-update', async (_payload: any, sender: any) => {
  try {
    if (!autoUpdateService.isUpdateReady()) {
      messagingService.sendToOriginator('install-app-update', {
        success: false,
        error: 'No update has been downloaded yet.',
      }, sender);
      return;
    }
    messagingService.sendToOriginator('install-app-update', { success: true }, sender);
    // Give the response a moment to reach the client before restarting
    setTimeout(() => autoUpdateService.quitAndInstall(), 1000);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[auto-update-handler] Error installing update:', errorMsg);
    messagingService.sendToOriginator('install-app-update', { success: false, error: errorMsg }, sender);
  }
});
