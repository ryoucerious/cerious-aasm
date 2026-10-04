import { messagingService } from '../services/messaging.service';
import { LinuxDepsService } from '../services/linux-deps.service';
import type { MessageSender } from '../types/messaging.types';
import { asPayload, errorMessage } from './handler.utils';

const linuxDepsService = new LinuxDepsService();

// Each request is answered on a channel of its own, so these cannot use onRequest. Errors are
// logged by message only: a failed sudo call can carry the command it ran.

messagingService.on('check-linux-deps', async (payload: unknown, sender: MessageSender) => {
  const { requestId } = asPayload(payload);
  try {
    const result = await linuxDepsService.checkDependencies();
    messagingService.sendToOriginator('linux-deps-check-result', { ...result, requestId }, sender);
  } catch (error) {
    console.error('[linux-deps-handler] Failed to check dependencies:', errorMessage(error));
    messagingService.sendToOriginator('linux-deps-check-result', { success: false, error: errorMessage(error), requestId }, sender);
  }
});

messagingService.on('validate-sudo-password', async (payload: unknown, sender: MessageSender) => {
  const { password, requestId } = asPayload(payload);
  try {
    const result = await linuxDepsService.validateSudoPassword(password);
    messagingService.sendToOriginator('sudo-password-validation', { ...result, requestId }, sender);
  } catch (error) {
    console.error('[linux-deps-handler] Failed to validate the sudo password:', errorMessage(error));
    messagingService.sendToOriginator('sudo-password-validation', { valid: false, error: errorMessage(error), requestId }, sender);
  }
});

messagingService.on('install-linux-deps', async (payload: unknown, sender: MessageSender) => {
  const { password, dependencies, requestId } = asPayload(payload);
  try {
    const result = await linuxDepsService.installDependencies(password, dependencies, progress => {
      messagingService.sendToOriginator('linux-deps-install-progress', { ...progress, requestId }, sender);
    });
    messagingService.sendToOriginator('linux-deps-install-result', { ...result, requestId }, sender);
  } catch (error) {
    const message = errorMessage(error, 'Unexpected error during installation');
    console.error('[linux-deps-handler] Failed to install dependencies:', message);
    messagingService.sendToOriginator('linux-deps-install-result', { success: false, error: message, details: [], requestId }, sender);
  }
});

messagingService.on('get-linux-deps-list', (payload: unknown, sender: MessageSender) => {
  const { requestId } = asPayload(payload);
  try {
    const result = linuxDepsService.getAvailableDependencies();
    messagingService.sendToOriginator('linux-deps-list', { ...result, requestId }, sender);
  } catch (error) {
    console.error('[linux-deps-handler] Failed to list dependencies:', errorMessage(error));
    messagingService.sendToOriginator('linux-deps-list', {
      dependencies: [],
      platform: 'unknown',
      error: errorMessage(error),
      requestId
    }, sender);
  }
});
