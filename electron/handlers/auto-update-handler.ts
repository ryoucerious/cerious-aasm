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

/**
 * Renderer requests the last known update status on boot so it doesn't miss
 * events that fired before Angular finished subscribing.
 */
messagingService.on('get-app-update-status', (_payload: any, sender: any) => {
  const last = autoUpdateService.getLastStatus();
  messagingService.sendToOriginator('app-update-status', last ?? { status: 'up-to-date' }, sender);
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

/**
 * User has chosen to download the available update.
 */
messagingService.on('download-app-update', async (_payload: any, sender: any) => {
  try {
    await autoUpdateService.downloadUpdate();
    messagingService.sendToOriginator('download-app-update', { success: true }, sender);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[auto-update-handler] Error downloading update:', errorMsg);
    messagingService.sendToOriginator('download-app-update', { success: false, error: errorMsg }, sender);
  }
});
