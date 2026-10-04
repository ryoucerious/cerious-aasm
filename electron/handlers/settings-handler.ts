import { messagingService } from '../services/messaging.service';
import { identifySender } from '../services/auth/permission-gate';
import { settingsService, toPublicGlobalConfig } from '../services/settings.service';
import { webServerService } from '../services/web-server.service';
import { onRequest } from './handler.utils';

onRequest('get-global-config', (_payload, { afterReply }) => {
  const config = toPublicGlobalConfig(settingsService.getGlobalConfig());
  // Every open client keeps its copy of the settings in step, not only the one that asked.
  afterReply(() => messagingService.sendToAll('global-config', config));
  return config;
}, { onError: message => ({ error: message }) });

onRequest('set-global-config', async (payload, { sender, afterReply }) => {
  // The single web login signs in as Admin, so only an administrator may change or disable it.
  const canChangeLogin = identifySender(sender).isAdmin;
  const result = await settingsService.updateGlobalConfig(payload.config, { canChangeLogin });
  const updatedConfig = result.updatedConfig;
  if (result.success && updatedConfig) {
    afterReply(async () => {
      // A headless run's login comes from the command line; the global config's (usually off
      // there) must not replace it.
      if (!webServerService.usesCommandLineLogin()) {
        await settingsService.updateWebServerAuth(updatedConfig, messagingService.getApiProcess());
      }
      messagingService.sendToAll('global-config', toPublicGlobalConfig(updatedConfig));
    });
  }
  return { success: result.success, error: result.error };
});
