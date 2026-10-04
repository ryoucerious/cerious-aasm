import { AutomationStatusResult, ServerAutomation } from '../../types/automation.types';
import { getOrCreateAutomation } from './automation-defaults';

export class AutomationStatusService {
  private automations: Map<string, ServerAutomation>;

  constructor(automations: Map<string, ServerAutomation>) {
    this.automations = automations;
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
      const automation = getOrCreateAutomation(this.automations, serverId);
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
      console.error('[automation-status] Failed to get automation status:', error);
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