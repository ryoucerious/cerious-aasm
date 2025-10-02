import { messagingService } from '../services/messaging.service';
import { LinuxDepsService } from '../services/linux-deps.service';

// Initialize service
const linuxDepsService = new LinuxDepsService();

/** Handles the 'check-linux-deps' message event from the messaging service. 
 * 
 * When triggered, this handler invokes the LinuxDepsService to check for required dependencies.
 * It then sends the result back to the sender of the message, including details such as
 * success status, missing dependencies, and any error information.
 * In case of unexpected errors during the dependency check, it logs the error and sends a failure
 * response to the sender.
 * 
 * @param payload - The payload received with the message, expected to contain a `requestId`.
 * @param sender - The sender of the message, used to route the response.
*/
messagingService.on('check-linux-deps', async (payload, sender) => {
  const { requestId } = payload || {};
  
  try {
    const result = await linuxDepsService.checkDependencies();
    
    sender?.send?.('linux-deps-check-result', {
      ...result,
      requestId
    });

  } catch (error) {
    console.error('[linux-deps-handler] Unexpected error:', error);
    
    sender?.send?.('linux-deps-check-result', {
      success: false,
      error: error instanceof Error ? error.message : 'Unexpected error',
      requestId
    });
  }
});

/** Handles the 'validate-sudo-password' message event from the messaging service. 
 * 
 * When triggered, this handler invokes the LinuxDepsService to validate the provided sudo password.
 * It then sends the result back to the sender of the message, including details such as
 * success status and any error information.
 * In case of unexpected errors during the validation, it logs the error and sends a failure
 * response to the sender.
 * 
 * @param payload - The payload received with the message, expected to contain `password` and `requestId`.
 * @param sender - The sender of the message, used to route the response.
*/
messagingService.on('validate-sudo-password', async (payload, sender) => {
  const { password, requestId } = payload || {};
  
  try {
    const result = await linuxDepsService.validateSudoPassword(password);
    
    sender?.send?.('sudo-password-validation', {
      ...result,
      requestId
    });
  } catch (error) {
    console.error('[linux-deps-handler] Unexpected error validating sudo password:', error);
    
    sender?.send?.('sudo-password-validation', {
      valid: false,
      error: error instanceof Error ? error.message : 'Unexpected error',
      requestId
    });
  }
});

/** Handles the 'install-linux-deps' message event from the messaging service. 
 * 
 * When triggered, this handler invokes the LinuxDepsService to install the specified dependencies.
 * It sends progress updates back to the sender during the installation process.
 * Once the installation is complete, it sends the final result back to the sender, including details such as
 * success status, any error information, and details of the installation process.
 * In case of unexpected errors during the installation, it logs the error and sends a failure
 * response to the sender.
 * 
 * @param payload - The payload received with the message, expected to contain `password`, `dependencies`, and `requestId`.
 * @param sender - The sender of the message, used to route the response.
*/
messagingService.on('install-linux-deps', async (payload, sender) => {
  const { password, dependencies, requestId } = payload || {};
  
  try {
    const result = await linuxDepsService.installDependencies(
      password,
      dependencies,
      (progress) => {
        sender?.send?.('linux-deps-install-progress', {
          ...progress,
          requestId
        });
      }
    );

    sender?.send?.('linux-deps-install-result', {
      ...result,
      requestId
    });

  } catch (error) {
    console.error('[linux-deps-handler] Unexpected error installing dependencies:', error);
    
    sender?.send?.('linux-deps-install-result', {
      success: false,
      error: error instanceof Error ? error.message : 'Unexpected error during installation',
      details: [],
      requestId
    });
  }
});

/** Handles the 'get-linux-deps-list' message event from the messaging service. 
 * 
 * When triggered, this handler invokes the LinuxDepsService to get the list of available dependencies.
 * It then sends the result back to the sender of the message, including details such as
 * the list of dependencies and any error information.
 * In case of unexpected errors during the retrieval, it logs the error and sends a failure
 * response to the sender.
 * 
 * @param payload - The payload received with the message, expected to contain a `requestId`.
 * @param sender - The sender of the message, used to route the response.
*/
messagingService.on('get-linux-deps-list', (payload, sender) => {
  const { requestId } = payload || {};
  
  try {
    const result = linuxDepsService.getAvailableDependencies();
    
    sender?.send?.('linux-deps-list', {
      ...result,
      requestId
    });
  } catch (error) {
    console.error('[linux-deps-handler] Unexpected error getting deps list:', error);
    
    sender?.send?.('linux-deps-list', {
      dependencies: [],
      platform: 'unknown',
      error: error instanceof Error ? error.message : 'Unexpected error',
      requestId
    });
  }
});
