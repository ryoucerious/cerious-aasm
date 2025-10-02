import { serverInstanceService } from '../server-instance/server-instance.service';
import { serverLifecycleService } from '../server-instance/server-lifecycle.service';
import {
  disconnectRcon,
  sendRconCommand,
  isRconConnected,
  connectRcon
} from '../../utils/rcon.utils';
import { getInstance, saveInstance } from '../../utils/ark/instance.utils';
import { AutomationSettings, ServerAutomation } from '../../types/automation.types';

export class ScheduledRestartService {
  private automations: Map<string, ServerAutomation>;

  constructor(automations: Map<string, ServerAutomation>) {
    this.automations = automations;
  }

  scheduleRestart(serverId: string): void {
    const automation = this.automations.get(serverId);
    if (!automation) return;

    this.unscheduleRestart(serverId);
    const nextRestart = this.calculateNextRestart(automation.settings);
    automation.status.nextRestart = nextRestart;
    automation.status.isScheduled = true;

    const timeUntilRestart = nextRestart.getTime() - Date.now();
    automation.scheduledRestartTimer = setTimeout(async () => {
      await this.executeScheduledRestart(serverId);
      // Update instance config.json after scheduled restart
      const instance = getInstance(serverId);
      if (instance) {
        await saveInstance(instance);
      }
    }, timeUntilRestart);
  }

  unscheduleRestart(serverId: string): void {
    const automation = this.automations.get(serverId);
    if (!automation) return;

    if (automation.scheduledRestartTimer) {
      clearTimeout(automation.scheduledRestartTimer);
      automation.scheduledRestartTimer = undefined;
    }

    automation.status.isScheduled = false;
    delete automation.status.nextRestart;
    // Update instance config.json after unscheduling
    const instance = getInstance(serverId);
    if (instance) {
      saveInstance(instance);
    }
  }

  private calculateNextRestart(settings: AutomationSettings): Date {
    const now = new Date();
    const [hours, minutes] = settings.restartTime.split(':').map(Number);

    let nextRestart = new Date();
    nextRestart.setHours(hours, minutes, 0, 0);

    if (settings.restartFrequency === 'daily') {
      if (nextRestart <= now) {
        nextRestart.setDate(nextRestart.getDate() + 1);
      }
    } else if (settings.restartFrequency === 'weekly') {
      const targetDay = settings.restartDays[0];
      const currentDay = nextRestart.getDay();
      let daysUntilTarget = targetDay - currentDay;

      if (daysUntilTarget < 0 || (daysUntilTarget === 0 && nextRestart <= now)) {
        daysUntilTarget += 7;
      }

      nextRestart.setDate(nextRestart.getDate() + daysUntilTarget);
    }

    return nextRestart;
  }

  private async executeScheduledRestart(serverId: string): Promise<void> {
    const automation = this.automations.get(serverId);
    if (!automation) return;

    try {
      if (isRconConnected(serverId)) {
        await sendRconCommand(serverId, `broadcast Server will restart in ${automation.settings.restartWarningMinutes} minutes!`);

        setTimeout(async () => {
          try {
            await sendRconCommand(serverId, 'broadcast Server restarting now!');
            await sendRconCommand(serverId, 'saveworld');

            setTimeout(async () => {
              const state = require('../server-instance/server-process.service').serverProcessService.getInstanceState(serverId);
              if (state === 'running') {
                automation.manuallyStopped = true;
                const arkProcess = require('../server-instance/server-process.service').serverProcessService.getServerProcess(serverId);
                if (arkProcess) {
                  arkProcess.kill();
                }

                setTimeout(async () => {
                  try {
                    const { onLog, onState } = serverInstanceService.getStandardEventCallbacks(serverId);
                    await serverInstanceService.startServerInstance(serverId, onLog, onState);
                    // Save instance after restart
                    const instance = getInstance(serverId);
                    if (instance) {
                      await saveInstance(instance);
                    }
                  } catch (error) {
                    console.error(`Failed to start server after scheduled restart:`, error);
                  }
                }, 5000);
              }
            }, 2000);
          } catch (error) {
            console.error('Failed to send restart commands via RCON:', error);
          }
        }, automation.settings.restartWarningMinutes * 60 * 1000);
      } else {
        const state = require('../server-instance/server-process.service').serverProcessService.getInstanceState(serverId);
        if (state === 'running') {
          automation.manuallyStopped = true;
          const arkProcess = require('../server-instance/server-process.service').serverProcessService.getServerProcess(serverId);
          if (arkProcess) {
            arkProcess.kill();
          }

          setTimeout(async () => {
            try {
              const { onLog, onState } = serverInstanceService.getStandardEventCallbacks(serverId);
              await serverInstanceService.startServerInstance(serverId, onLog, onState);
              // Save instance after restart
              const instance = getInstance(serverId);
              if (instance) {
                await saveInstance(instance);
              }
            } catch (error) {
              console.error(`Failed to start server after scheduled restart:`, error);
            }
          }, 5000);
        }
      }

      this.scheduleRestart(serverId);

    } catch (error) {
      console.error(`Failed to execute scheduled restart for server ${serverId}:`, error);
    }
  }
}