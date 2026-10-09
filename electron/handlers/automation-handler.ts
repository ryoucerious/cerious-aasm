import { automationService } from '../services/automation/automation.service';
import { validateDiscordConfig } from '../services/discord.service';
import { schedulerService } from '../services/scheduler.service';
import * as instanceUtils from '../utils/ark/instance.utils';
import { validateInstanceId } from '../utils/validation.utils';
import type { BroadcastConfig, InstanceConfig, ScheduledBroadcast } from '../types/server-instance.types';
import { onRequest } from './handler.utils';

const INVALID_ID = { success: false, error: 'Invalid instance ID' };

onRequest('configure-autostart', payload => {
  const { serverId, autoStartOnAppLaunch, autoStartOnBoot } = payload;
  if (!validateInstanceId(serverId)) return INVALID_ID;
  return automationService.configureAutostart(serverId, autoStartOnAppLaunch, autoStartOnBoot);
}, { host: { idKey: 'serverId' } });

onRequest('configure-crash-detection', payload => {
  const { serverId, enabled, checkInterval, maxRestartAttempts } = payload;
  if (!validateInstanceId(serverId)) return INVALID_ID;
  return automationService.configureCrashDetection(serverId, enabled, checkInterval, maxRestartAttempts);
}, { host: { idKey: 'serverId' } });

onRequest('configure-discord-webhook', async payload => {
  const { serverId, config } = payload;
  if (!validateInstanceId(serverId)) return INVALID_ID;
  const invalid = validateDiscordConfig(config);
  if (invalid) return { success: false, error: invalid };
  return saveToInstance(serverId, { discordConfig: config });
}, { host: { idKey: 'serverId' } });

onRequest('configure-broadcasts', async payload => {
  const { serverId, broadcastConfig, broadcasts } = payload;
  if (!validateInstanceId(serverId)) return INVALID_ID;

  let changes: Partial<InstanceConfig> = {};
  if (broadcastConfig) {
    changes = { broadcastConfig };
  } else if (Array.isArray(broadcasts)) {
    // Older clients send a flat list instead of a broadcastConfig.
    changes = { broadcastConfig: fromBroadcastList(broadcasts), broadcasts };
  }
  const result = await saveToInstance(serverId, changes);
  if (result.success) {
    await schedulerService.initSchedule(serverId);
  }
  return result;
}, { host: { idKey: 'serverId' } });

onRequest('configure-scheduled-restart', payload => {
  const { serverId, enabled, frequency, time, times, days, warningMinutes } = payload;
  if (!validateInstanceId(serverId)) return INVALID_ID;
  // Several times a day, or the one time older pages send.
  return automationService.configureScheduledRestart(serverId, enabled, frequency, Array.isArray(times) ? times : time, days, warningMinutes);
}, { host: { idKey: 'serverId' } });

onRequest('get-automation-status', payload => {
  const { serverId } = payload;
  if (!validateInstanceId(serverId)) return INVALID_ID;
  return automationService.getAutomationStatus(serverId);
}, { host: { idKey: 'serverId', read: true } });

onRequest('auto-start-on-app-launch', async () => {
  await automationService.handleAutoStartOnAppLaunch();
  return { success: true };
});

async function saveToInstance(serverId: string, changes: Partial<InstanceConfig>): Promise<{ success: boolean; error?: string }> {
  const instance = instanceUtils.getInstance(serverId);
  if (!instance) {
    throw new Error('Instance not found');
  }
  const saved = await instanceUtils.saveInstance({ ...instance, ...changes });
  return saved.error ? { success: false, error: saved.error } : { success: true };
}

function fromBroadcastList(broadcasts: ScheduledBroadcast[]): BroadcastConfig {
  return {
    enabled: broadcasts.length > 0,
    messages: broadcasts.map(({ id, message, interval, intervalMinutes, enabled }) => ({
      id,
      message,
      interval: interval ?? intervalMinutes ?? 60,
      enabled: enabled !== false
    }))
  };
}
