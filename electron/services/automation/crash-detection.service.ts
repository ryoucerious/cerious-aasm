import { serverInstanceService } from '../server-instance/server-instance.service';
import { serverProcessService } from '../server-instance/server-process.service';
import { getStandardEventCallbacks } from '../server-instance/instance-events';
import { areServerFilesUpdating } from '../../utils/ark/ark-server/ark-server-state.utils';
import { discordService } from '../discord.service';
import { ServerAutomation } from '../../types/automation.types';

const DEFAULT_INTERVAL_SECONDS = 60;
const MIN_INTERVAL_SECONDS = 30;
const MAX_INTERVAL_SECONDS = 300;

/** crashDetectionInterval is in seconds; hand-edited values are held to the UI's 30-300. */
function intervalMs(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_INTERVAL_SECONDS * 1000;
  return Math.min(MAX_INTERVAL_SECONDS, Math.max(MIN_INTERVAL_SECONDS, seconds)) * 1000;
}

/**
 * Restarts servers that crashed. The process service records an exit nobody asked for as
 * 'crashed'; this polls for that state and restarts, up to maxRestartAttempts in a row.
 */
export class CrashDetectionService {
  private automations: Map<string, ServerAutomation>;
  private readonly restarting = new Set<string>();

  constructor(automations: Map<string, ServerAutomation>) {
    this.automations = automations;
  }

  startCrashDetection(serverId: string): void {
    const automation = this.automations.get(serverId);
    if (!automation) return;

    this.stopCrashDetection(serverId);
    automation.status.isMonitoring = true;
    automation.crashDetectionTimer = setInterval(() => {
      void this.checkForCrash(serverId);
    }, intervalMs(automation.settings.crashDetectionInterval));
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
    // A restart can outlast the interval: the state stays 'crashed' until the new process spawns.
    // During an install or update the start would be refused, and must not use up an attempt.
    if (!automation || this.restarting.has(serverId) || areServerFilesUpdating()) return;

    try {
      const state = serverProcessService.getInstanceState(serverId);
      if (state === 'running' && serverProcessService.hasActiveProcess(serverId)) {
        automation.restartAttempts = 0;
        return;
      }

      if (state !== 'crashed' || serverProcessService.hasActiveProcess(serverId) || automation.manuallyStopped) {
        return;
      }

      const { maxRestartAttempts } = automation.settings;
      if (automation.restartAttempts >= maxRestartAttempts) {
        console.warn(`[crash-detection] ${serverId} crashed after ${maxRestartAttempts} restarts; no longer restarting it`);
        this.stopCrashDetection(serverId);
        return;
      }
      automation.restartAttempts++;
      automation.lastCrashTime = new Date();
      discordService.sendNotification(
        serverId,
        'crash',
        `Attempting an automatic restart after a crash (${automation.restartAttempts}/${maxRestartAttempts}).`
      );

      this.restarting.add(serverId);
      try {
        const { onLog, onState } = getStandardEventCallbacks(serverId);
        const result = await serverInstanceService.startServerInstance(serverId, onLog, onState);
        if (!result.started) {
          console.error(`[crash-detection] Could not restart ${serverId}: ${result.portError}`);
        }
      } finally {
        this.restarting.delete(serverId);
      }
    } catch (error) {
      console.error(`[crash-detection] Check failed for ${serverId}:`, error);
    }
  }
}
