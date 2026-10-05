import { messagingService } from '../services/messaging.service';
import { installService } from '../services/install.service';
import { onRequest } from './handler.utils';

onRequest('check-install-requirements', payload => installService.checkInstallRequirements(payload.target));

// Every message on this channel carries the requestId, and the progress report (or the failure)
// sits in `data`: the settings page listens to the whole stream, not just the first reply.
onRequest('install', async (payload, { sender, requestId }) => {
  const { target, sudoPassword } = payload;
  const report = (data: unknown) => {
    messagingService.sendToOriginator('install', { target: target || 'unknown', data, requestId }, sender);
  };

  const result = await installService.installComponent(target, progress => {
    if (typeof progress === 'string' && progress.startsWith('Error:')) {
      console.error(`[install-handler] [${target}] ${progress}`);
    }
    report(typeof progress === 'object' && progress !== null ? { ...progress, requestId } : progress);
  }, sudoPassword);

  if (result.status === 'error') {
    const error = result.error || 'Installation failed';
    // Both fields: the page shows `message` and treats `error` as the failure flag.
    return {
      target: result.target || target || 'unknown',
      data: { error, message: error, step: 'error', target: result.target, requestId }
    };
  }
  return { target: target || 'unknown', data: { ...result, requestId } };
}, {
  onError: (error, payload) => ({
    target: payload.target || 'unknown',
    data: {
      error,
      message: error,
      step: 'error',
      phase: 'error',
      overallPhase: 'Installation Failed',
      phasePercent: 0,
      requestId: payload.requestId
    }
  })
});

onRequest('cancel-install', (payload, { requestId }) => {
  const result = installService.cancelInstallation(payload.target);
  const data = result.success ? { cancelled: true, requestId } : { error: 'Cancellation not supported for this target', requestId };
  return { target: result.target, data };
}, {
  onError: (error, payload) => ({ target: payload.target || 'unknown', data: { error, requestId: payload.requestId } })
});
