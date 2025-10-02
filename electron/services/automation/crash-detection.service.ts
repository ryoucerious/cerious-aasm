import { serverInstanceService } from '../server-instance/server-instance.service';
import { serverLifecycleService } from '../server-instance/server-lifecycle.service';
import { getInstance, saveInstance } from '../../utils/ark/instance.utils';
import { ServerAutomation } from '../../types/automation.types';

export class CrashDetectionService {
  private automations: Map<string, ServerAutomation>;

  constructor(automations: Map<string, ServerAutomation>) {
    this.automations = automations;
  }

  startCrashDetection(serverId: string): void {
    const automation = this.automations.get(serverId);
    if (!automation) return;

    this.stopCrashDetection(serverId);
    automation.status.isMonitoring = true;
    automation.crashDetectionTimer = setInterval(async () => {
      await this.checkForCrash(serverId);
    }, automation.settings.crashDetectionInterval);
  }

  stopCrashDetection(serverId: string): void {
    const automation = this.automations.get(serverId);
    if (!automation) return;

    if (automation.crashDetectionTimer) {
      clearInterval(automation.crashDetectionTimer);
      automation.crashDetectionTimer = undefined;
    }

    automation.status.isMonitoring = false;
  }

  private async checkForCrash(serverId: string): Promise<void> {
    const automation = this.automations.get(serverId);
    if (!automation) return;

    try {
      const state = require('../server-instance/server-process.service').serverProcessService.getInstanceState(serverId);
      const arkProcess = require('../server-instance/server-process.service').serverProcessService.getServerProcess(serverId);

      if (state === 'running' && !arkProcess) {
        if (automation.manuallyStopped) {
          automation.manuallyStopped = false;
          return;
        }

        if (automation.restartAttempts >= automation.settings.maxRestartAttempts) {
          this.stopCrashDetection(serverId);
          require('../server-instance/server-process.service').serverProcessService.setInstanceState(serverId, 'stopped');
          return;
        }
        automation.restartAttempts++;
        automation.lastCrashTime = new Date();

        try {
          const { onLog, onState } = serverInstanceService.getStandardEventCallbacks(serverId);
          await serverInstanceService.startServerInstance(serverId, onLog, onState);
        } catch (error) {
          console.error(`Failed to restart server ${serverId} after crash:`, error);
        }

        const instance = getInstance(serverId);
        if (instance) {
          await saveInstance(instance);
        }
      } else if (state === 'running' && arkProcess) {
        if (automation.restartAttempts > 0) {
          automation.restartAttempts = 0;
          const instance = getInstance(serverId);
          if (instance) {
            await saveInstance(instance);
          }
        }
      }
    } catch (error) {
      console.error(`Error during crash detection for server ${serverId}:`, error);
    }
  }
}