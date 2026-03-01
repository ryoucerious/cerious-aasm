import { messagingService } from '../services/messaging.service';
import { directoryService } from '../services/directory.service';
import { dialog, BrowserWindow } from 'electron';

/**
 * Handles the 'select-directory' message event from the messaging service.
 * Allows the user to select a directory via system dialog.
 */
messagingService.on('select-directory', async (payload, sender) => {
  const { title, requestId } = payload || {};
  const win = BrowserWindow.fromWebContents(sender);
  
  if (!win) {
    messagingService.sendToOriginator('select-directory-response', { 
      error: 'Could not determine window',
      requestId 
    }, sender);
    return;
  }

  try {
    const result = await dialog.showOpenDialog(win, {
      title: title || 'Select Directory',
      properties: ['openDirectory', 'createDirectory']
    });

    if (!result.canceled && result.filePaths.length > 0) {
      messagingService.sendToOriginator('select-directory', { 
        path: result.filePaths[0],
        requestId 
      }, sender);
    } else {
      messagingService.sendToOriginator('select-directory', { 
        canceled: true,
        requestId 
      }, sender);
    }
  } catch (error) {
    console.error('[directory-handler] Error selecting directory:', error);
    messagingService.sendToOriginator('select-directory', { 
      error: String(error),
      requestId 
    }, sender);
  }
});



/**
 * Handles the 'open-config-directory' message event from the messaging service.
 *
 * When triggered, this handler invokes the DirectoryService to open the config directory.
 * It then sends the result back to the originator of the message, including details such as
 * success status and any error information.
 * In case of unexpected errors during the config directory opening, it logs the error and sends a failure
 * response to the originator.
 *
 * @param payload - The payload received with the message, expected to contain `requestId`.
 * @param sender - The sender of the message, used to route the response.
 */
messagingService.on('open-config-directory', async (payload, sender) => {
  const { requestId } = payload || {};
  
  try {
    const result = await directoryService.openConfigDirectory();
    
    if (result.success) {
      messagingService.sendToOriginator('open-config-directory', { 
        configDir: result.configDir, 
        requestId 
      }, sender);
    } else {
      messagingService.sendToOriginator('open-config-directory-error', { 
        error: result.error, 
        requestId 
      }, sender);
    }
  } catch (error) {
    console.error('[directory-handler] Error opening config directory:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    messagingService.sendToOriginator('open-config-directory-error', { 
      error: errorMsg, 
      requestId 
    }, sender);
  }
});

/**
 * Handles the 'test-directory-access' message event from the messaging service.
 *
 * When triggered, this handler invokes the DirectoryService to test if a directory is accessible.
 * It then sends the result back to the originator of the message, including details such as
 * accessibility status and any error information.
 * In case of unexpected errors during the directory access test, it logs the error and sends a failure
 * response to the originator.
 *
 * @param payload - The payload received with the message, expected to contain `directoryPath` and `requestId`.
 * @param sender - The sender of the message, used to route the response.
 */
messagingService.on('test-directory-access', async (payload, sender) => {
  const { directoryPath, requestId } = payload || {};

  try {
    const result = await directoryService.testDirectoryAccess(directoryPath);

    messagingService.sendToOriginator('test-directory-access', {
      accessible: result.accessible,
      error: result.error,
      requestId
    }, sender);
  } catch (error) {
    console.error('[directory-handler] Error testing directory access:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    messagingService.sendToOriginator('test-directory-access', {
      accessible: false,
      error: errorMsg,
      requestId
    }, sender);
  }
});

/**
 * Handles the 'open-directory' message event from the messaging service.
 *
 * When triggered, this handler invokes the DirectoryService to open an instance directory.
 * It then sends the result back to the originator of the message, including details such as
 * success status and any error information.
 * In case of unexpected errors during the directory opening, it logs the error and sends a failure
 * response to the originator.
 *
 * @param payload - The payload received with the message, expected to contain `id` and `requestId`.
 * @param sender - The sender of the message, used to route the response.
 */
messagingService.on('open-directory', async (payload, sender) => {
  const { id, requestId } = payload || {};

  try {
    const result = await directoryService.openInstanceDirectory(id);

    if (result.success) {
      messagingService.sendToOriginator('open-directory', {
        id: result.instanceId,
        requestId
      }, sender);
    } else {
      messagingService.sendToOriginator('open-directory-error', {
        error: result.error,
        requestId
      }, sender);
    }
  } catch (error) {
    console.error('[directory-handler] Error opening directory:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    messagingService.sendToOriginator('open-directory-error', {
      error: errorMsg,
      requestId
    }, sender);
  }
});
