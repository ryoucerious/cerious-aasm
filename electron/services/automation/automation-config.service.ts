import { getInstance, saveInstance } from '../../utils/ark/instance.utils';
import { AutomationConfigResult, AutomationSettings, ServerAutomation } from '../../types/automation.types';

export class AutomationConfigService {
  private automations: Map<string, ServerAutomation>;

  constructor(automations: Map<string, ServerAutomation>) {
    this.automations = automations;
  }

  private getOrCreateAutomation(serverId: string): ServerAutomation {
    if (!this.automations.has(serverId)) {
      const automation: ServerAutomation = {
        serverId,
        settings: {
          autoStartOnAppLaunch: false,
          autoStartOnBoot: false,
          crashDetectionEnabled: false,
          crashDetectionInterval: 60000,
          maxRestartAttempts: 3,
          scheduledRestartEnabled: false,
          restartFrequency: 'daily',
          restartTime: '04:00',
          restartDays: [0],
          restartWarningMinutes: 15
        },
        restartAttempts: 0,
        manuallyStopped: false,
        status: {
          isMonitoring: false,
          isScheduled: false
        }
      };
      this.automations.set(serverId, automation);
    }
    return this.automations.get(serverId)!;
  }

  async configureAutostart(serverId: string, autoStartOnAppLaunch: boolean, autoStartOnBoot: boolean): Promise<AutomationConfigResult> {
    try {
      const automation = this.getOrCreateAutomation(serverId);
      automation.settings.autoStartOnAppLaunch = autoStartOnAppLaunch;
      automation.settings.autoStartOnBoot = autoStartOnBoot;

      // Update instance config.json
      const instance = getInstance(serverId);
      if (instance) {
        instance.autoStartOnAppLaunch = autoStartOnAppLaunch;
        instance.autoStartOnBoot = autoStartOnBoot;
        await saveInstance(instance);
      }

      return { success: true };
    } catch (error) {
      console.error('Failed to configure autostart:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async configureCrashDetection(serverId: string, enabled: boolean, checkInterval: number, maxRestartAttempts: number): Promise<AutomationConfigResult> {
    try {
      const automation = this.getOrCreateAutomation(serverId);
      automation.settings.crashDetectionEnabled = enabled;
      automation.settings.crashDetectionInterval = checkInterval;
      automation.settings.maxRestartAttempts = maxRestartAttempts;

      // Update instance config.json
      const instance = getInstance(serverId);
      if (instance) {
        instance.crashDetectionEnabled = enabled;
        instance.crashDetectionInterval = checkInterval;
        instance.maxRestartAttempts = maxRestartAttempts;
        await saveInstance(instance);
      }
      return { success: true };
    } catch (error) {
      console.error('Failed to configure crash detection:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async configureScheduledRestart(serverId: string, enabled: boolean, frequency: 'daily' | 'weekly' | 'custom', time: string, days: number[], warningMinutes: number): Promise<AutomationConfigResult> {
    try {
      const automation = this.getOrCreateAutomation(serverId);
      automation.settings.scheduledRestartEnabled = enabled;
      automation.settings.restartFrequency = frequency;
      automation.settings.restartTime = time;
      automation.settings.restartDays = days;
      automation.settings.restartWarningMinutes = warningMinutes;

      // Update instance config.json
      const instance = getInstance(serverId);
      if (instance) {
        instance.scheduledRestartEnabled = enabled;
        instance.restartFrequency = frequency;
        instance.restartTime = time;
        instance.restartDays = days;
        instance.restartWarningMinutes = warningMinutes;
        await saveInstance(instance);
      }
      return { success: true };
    } catch (error) {
      console.error('Failed to configure scheduled restart:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}