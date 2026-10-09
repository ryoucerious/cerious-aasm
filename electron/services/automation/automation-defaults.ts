import type { AutomationSettings, ServerAutomation } from '../../types/automation.types';

// The UI's defaults (server page), for settings an instance has never saved.
const DEFAULT_SETTINGS: AutomationSettings = {
  autoStartOnAppLaunch: false,
  autoStartOnBoot: false,
  crashDetectionEnabled: false,
  crashDetectionInterval: 60,
  maxRestartAttempts: 3,
  scheduledRestartEnabled: false,
  restartFrequency: 'daily',
  restartTime: '02:00',
  restartDays: [1],
  restartWarningMinutes: 5
};

/** A new automation record from the settings a config.json holds, with defaults for the rest. */
export function createServerAutomation(serverId: string, stored: Partial<AutomationSettings> = {}): ServerAutomation {
  return {
    serverId,
    settings: {
      autoStartOnAppLaunch: !!stored.autoStartOnAppLaunch,
      autoStartOnBoot: !!stored.autoStartOnBoot,
      crashDetectionEnabled: !!stored.crashDetectionEnabled,
      crashDetectionInterval: stored.crashDetectionInterval || DEFAULT_SETTINGS.crashDetectionInterval,
      maxRestartAttempts: stored.maxRestartAttempts || DEFAULT_SETTINGS.maxRestartAttempts,
      scheduledRestartEnabled: !!stored.scheduledRestartEnabled,
      restartFrequency: stored.restartFrequency || DEFAULT_SETTINGS.restartFrequency,
      restartTime: stored.restartTime || DEFAULT_SETTINGS.restartTime,
      restartTimes: stored.restartTimes?.length ? [...stored.restartTimes] : [stored.restartTime || DEFAULT_SETTINGS.restartTime],
      restartDays: stored.restartDays || [...DEFAULT_SETTINGS.restartDays],
      restartWarningMinutes: stored.restartWarningMinutes || DEFAULT_SETTINGS.restartWarningMinutes
    },
    restartAttempts: 0,
    manuallyStopped: false,
    status: { isMonitoring: false, isScheduled: false }
  };
}

export function getOrCreateAutomation(automations: Map<string, ServerAutomation>, serverId: string): ServerAutomation {
  let automation = automations.get(serverId);
  if (!automation) {
    automation = createServerAutomation(serverId);
    automations.set(serverId, automation);
  }
  return automation;
}
