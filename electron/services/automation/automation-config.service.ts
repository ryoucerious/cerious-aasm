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

  /** `time` is one HH:MM, or several for more than one restart a day. */
  configureScheduledRestart(
    serverId: string,
    enabled: boolean,
    frequency: AutomationSettings['restartFrequency'],
    time: string | string[],
    days: number[],
    warningMinutes: number
  ): Promise<AutomationConfigResult> {
    const times = restartTimesFrom(time);
    return this.apply(serverId, {
      scheduledRestartEnabled: enabled,
      restartFrequency: frequency,
      // The first time is restartTime too, for older versions, which know only one.
      restartTime: times[0] ?? '02:00',
      restartTimes: times,
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

/** Valid HH:MM times, each once, in order of the day. */
function restartTimesFrom(time: string | string[]): string[] {
  const times = (Array.isArray(time) ? time : [time]).filter(value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value));
  return [...new Set(times)].sort();
}
