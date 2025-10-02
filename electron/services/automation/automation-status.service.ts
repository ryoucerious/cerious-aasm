import { AutomationStatusResult, ServerAutomation } from '../../types/automation.types';

export class AutomationStatusService {
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

  getAutostartInstanceIds(): string[] {
    const ids: string[] = [];
    for (const [serverId, automation] of this.automations) {
      if (automation.settings.autoStartOnAppLaunch) {
        ids.push(serverId);
      }
    }
    return ids;
  }

  async getAutomationStatus(serverId: string): Promise<AutomationStatusResult> {
    try {
      const automation = this.getOrCreateAutomation(serverId);
      return {
        success: true,
        status: {
          settings: automation.settings,
          status: automation.status,
          restartAttempts: automation.restartAttempts,
          lastCrashTime: automation.lastCrashTime,
          manuallyStopped: automation.manuallyStopped
        }
      };
    } catch (error) {
      console.error('Failed to get automation status:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  setManuallyStopped(serverId: string, manually: boolean): void {
    const automation = this.automations.get(serverId);
    if (automation) {
      automation.manuallyStopped = manually;
    }
  }
}