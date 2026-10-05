import { getInstance, saveInstance } from '../../utils/ark/instance.utils';
import { AutomationConfigResult, AutomationSettings, ServerAutomation } from '../../types/automation.types';
import { getOrCreateAutomation } from './automation-defaults';

/** Applies automation settings to the in-memory record and stores them in the instance's config.json. */
export class AutomationConfigService {
  private automations: Map<string, ServerAutomation>;

  constructor(automations: Map<string, ServerAutomation>) {
    this.automations = automations;
  }

  configureAutostart(serverId: string, autoStartOnAppLaunch: boolean, autoStartOnBoot: boolean): Promise<AutomationConfigResult> {
    return this.apply(serverId, { autoStartOnAppLaunch, autoStartOnBoot });
  }

  configureCrashDetection(serverId: string, enabled: boolean, checkInterval: number, maxRestartAttempts: number): Promise<AutomationConfigResult> {
    return this.apply(serverId, { crashDetectionEnabled: enabled, crashDetectionInterval: checkInterval, maxRestartAttempts });
  }

  configureScheduledRestart(
    serverId: string,
    enabled: boolean,
    frequency: AutomationSettings['restartFrequency'],
    time: string,
    days: number[],
    warningMinutes: number
  ): Promise<AutomationConfigResult> {
    return this.apply(serverId, {
      scheduledRestartEnabled: enabled,
      restartFrequency: frequency,
      restartTime: time,
      restartDays: days,
      restartWarningMinutes: warningMinutes
    });
  }

  private async apply(serverId: string, changes: Partial<AutomationSettings>): Promise<AutomationConfigResult> {
    try {
      const automation = getOrCreateAutomation(this.automations, serverId);
      Object.assign(automation.settings, changes);

      const instance = getInstance(serverId);
      if (instance) {
        const saved = await saveInstance({ ...instance, ...changes });
        if (saved.error !== undefined) {
          return { success: false, error: saved.error };
        }
      }
      return { success: true };
    } catch (error) {
      console.error(`[automation-config] Failed to save automation settings for ${serverId}:`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}