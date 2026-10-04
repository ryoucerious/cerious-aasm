import { messagingService } from '../services/messaging.service';
import { autoUpdateService } from '../services/auto-update.service';
import type { MessageSender } from '../types/messaging.types';
import { errorMessage } from './handler.utils';

// The renderer sends these as notifications and follows progress through app-update-status
// pushes, so no reply here carries a requestId.

messagingService.on('check-for-app-update', async (_payload: unknown, sender: MessageSender) => {
  try {
    await autoUpdateService.checkForUpdates();
    messagingService.sendToOriginator('check-for-app-update', { success: true }, sender);
  } catch (error) {
    const message = errorMessage(error);
    console.error('[auto-update-handler] Error checking for update:', message);
    messagingService.sendToOriginator('check-for-app-update', { success: false, error: message }, sender);
  }
});

// Asked for on boot, so a renderer that subscribed late still learns about events it missed.
messagingService.on('get-app-update-status', (_payload: unknown, sender: MessageSender) => {
  messagingService.sendToOriginator('app-update-status', autoUpdateService.getLastStatus() ?? { status: 'up-to-date' }, sender);
});

messagingService.on('install-app-update', (_payload: unknown, sender: MessageSender) => {
  try {
    if (!autoUpdateService.isUpdateReady()) {
      messagingService.sendToOriginator('install-app-update', { success: false, error: 'No update has been downloaded yet.' }, sender);
      return;
    }
    messagingService.sendToOriginator('install-app-update', { success: true }, sender);
    // Give the reply a moment to reach the client before the app restarts.
    setTimeout(() => autoUpdateService.quitAndInstall(), 1000);
  } catch (error) {
    const message = errorMessage(error);
    console.error('[auto-update-handler] Error installing update:', message);
    messagingService.sendToOriginator('install-app-update', { success: false, error: message }, sender);
  }
});

messagingService.on('download-app-update', async (_payload: unknown, sender: MessageSender) => {
  try {
    await autoUpdateService.downloadUpdate();
    messagingService.sendToOriginator('download-app-update', { success: true }, sender);
  } catch (error) {
    const message = errorMessage(error);
    console.error('[auto-update-handler] Error downloading update:', message);
    messagingService.sendToOriginator('download-app-update', { success: false, error: message }, sender);
  }
});
