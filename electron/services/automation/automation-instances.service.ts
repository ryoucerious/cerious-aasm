import { getAllInstances } from '../../utils/ark/instance.utils';
import { ServerAutomation } from '../../types/automation.types';

export class AutomationInstancesService {
  private automations: Map<string, ServerAutomation>;

  constructor(automations: Map<string, ServerAutomation>) {
    this.automations = automations;
  }

  async loadAutomationFromInstances(): Promise<void> {
    try {
      const allInstances = await getAllInstances();
      for (const instance of Array.isArray(allInstances) ? allInstances : []) {
        if (instance && instance.id && instance.autoStartOnAppLaunch !== undefined) {
          const automation: ServerAutomation = {
            serverId: instance.id,
            settings: {
              autoStartOnAppLaunch: !!instance.autoStartOnAppLaunch,
              autoStartOnBoot: !!instance.autoStartOnBoot,
              crashDetectionEnabled: !!instance.crashDetectionEnabled,
              crashDetectionInterval: instance.crashDetectionInterval || 60,
              maxRestartAttempts: instance.maxRestartAttempts || 3,
              scheduledRestartEnabled: !!instance.scheduledRestartEnabled,
              restartFrequency: instance.restartFrequency || 'daily',
              restartTime: instance.restartTime || '02:00',
              restartDays: instance.restartDays || [1],
              restartWarningMinutes: instance.restartWarningMinutes || 5
            },
            restartAttempts: 0,
            manuallyStopped: false,
            status: {
              isMonitoring: false,
              isScheduled: false
            }
          };
          this.automations.set(instance.id, automation);
        }
      }
    } catch (error) {
      console.error('Failed to load automation from instances:', error);
    }
  }
}