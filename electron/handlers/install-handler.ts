import { messagingService } from '../services/messaging.service';
import { installService } from '../services/install.service';

/** Handles the 'check-install-requirements' message event from the messaging service. 
 * 
 * When triggered, this handler invokes the InstallService to check if the system meets
 * the installation requirements for a specified target component.
 * It then sends the result back to the originator of the message, including details such as
 * success status and any error information.
 * In case of unexpected errors during the requirements check, it logs the error and
 * sends a failure response to the originator.
 * 
 * @param payload - The payload received with the message, expected to contain `target` and `requestId`.
 * @param sender - The sender of the message, used to route the response.
*/
messagingService.on('check-install-requirements', async (payload, sender) => {
  const { target, requestId } = payload || {};
  
  try {
    const result = await installService.checkInstallRequirements(target);
    
    messagingService.sendToOriginator('check-install-requirements', {
      ...result,
      requestId
    }, sender);
  } catch (error) {
    console.error('[install-handler] Error checking install requirements:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    messagingService.sendToOriginator('check-install-requirements', {
      success: false,
      error: errorMsg,
      requestId
    }, sender);
  }
});

/** Handles the 'install' message event from the messaging service. 
 * 
 * When triggered, this handler invokes the InstallService to perform the installation of a specified target component.
 * It provides real-time progress updates back to the originator of the message, including details such as
 * current step, percentage complete, and any error information.
 * In case of unexpected errors during the installation, it logs the error and sends a failure
 * response to the originator.
 * 
 * @param payload - The payload received with the message, expected to contain `target`, `requestId`, and optionally `sudoPassword`.
 * @param sender - The sender of the message, used to route the response.
*/
messagingService.on('install', async (payload, sender) => {
  const { target, requestId, sudoPassword } = payload || {};
  
  try {
    function emitOutput(data: any) {
      // Log every progress event for debugging
      let parsed: any = null;
      try { 
        parsed = JSON.parse(data); 
      } catch {}
      
      if (parsed && parsed.step && parsed.percent !== undefined) {
        // Valid progress data
      } else if (typeof data === 'string' && data.startsWith('Error:')) {
        console.error(`[install-handler] [${target}] ${data}`);
      }
      
      // Attach requestId to progress if present
      let outputData = data;
      try {
        const progressObj = data;
        if (requestId !== undefined) progressObj.requestId = requestId;
        outputData = progressObj;
      } catch {
        // If not JSON, append requestId manually (even if undefined, for coverage)
        outputData += `|requestId:${requestId}`;
      }
      
      // Send detailed progress to the originating client
      messagingService.sendToOriginator('install', { target: target || 'unknown', data: outputData, requestId }, sender);
    }

    const result = await installService.installComponent(target, emitOutput, sudoPassword);
    
    // Handle the result based on status
    if (result.status === 'error') {
      // Send error result immediately to frontend
      // Put error in both 'error' and 'message' fields for frontend compatibility
      const errorData = { 
        error: result.error || 'Installation failed',
        message: result.error || 'Installation failed',
        step: 'error',
        target: result.target,
        requestId 
      };
      messagingService.sendToOriginator('install', { 
        target: result.target || target || 'unknown', 
        data: errorData, 
        requestId 
      }, sender);
    } else {
      // Send success result
      const finalOutput = { ...result, requestId };
      emitOutput(`[install-handler] Install complete: ${finalOutput}`);
    }
    
  } catch (error) {
    console.error('[install-handler] Unexpected error during installation:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorData = { error: errorMsg, requestId };
    messagingService.sendToOriginator('install', { target: target || 'unknown', data: errorData, requestId }, sender);
  }
});

/** Handles the 'cancel-install' message event from the messaging service. 
 * 
 * When triggered, this handler invokes the InstallService to cancel an ongoing installation for a specified target component.
 * It then sends the result back to the originator of the message, including details such as
 * success status and any error information.
 * In case of unexpected errors during the cancellation, it logs the error and sends a failure
 * response to the originator.
 * 
 * @param payload - The payload received with the message, expected to contain `target` and `requestId`.
 * @param sender - The sender of the message, used to route the response.
*/
messagingService.on('cancel-install', (payload, sender) => {
  const { target, requestId } = payload || {};
  
  try {
    const result = installService.cancelInstallation(target);
    
    if (result.success) {
      // Notify frontend of cancellation
      messagingService.sendToOriginator('cancel-install', { 
        target: result.target, 
        data: { cancelled: true, requestId }, 
        requestId 
      }, sender);
    } else {
      messagingService.sendToOriginator('cancel-install', { 
        target: result.target, 
        data: { error: 'Cancellation not supported for this target', requestId }, 
        requestId 
      }, sender);
    }
  } catch (error) {
    console.error('[install-handler] Error cancelling installation:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    messagingService.sendToOriginator('cancel-install', { 
      target: target || 'unknown', 
      data: { error: errorMsg, requestId }, 
      requestId 
    }, sender);
  }
});
