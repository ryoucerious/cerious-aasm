import { serverInstanceService } from '../server-instance/server-instance.service';
import { getStandardEventCallbacks } from '../server-instance/instance-events';
import { schedulerService } from '../scheduler.service';
import { getInstance } from '../../utils/ark/instance.utils';
import { loadGlobalConfig } from '../../utils/global-config.utils';
import { validateInstanceId } from '../../utils/validation.utils';
import { createServerAutomation } from './automation-defaults';
import { AutomationConfigService } from './automation-config.service';
import { AutomationStatusService } from './automation-status.service';
import { CrashDetectionService } from './crash-detection.service';
import { ScheduledRestartService } from './scheduled-restart.service';
import { AutomationInstancesService } from './automation-instances.service';
import { AutomationConfigResult, AutomationSettings, AutomationStatusResult, ServerAutomation } from '../../types/automation.types';

const DEFAULT_START_DELAY_SECONDS = 60;
// Lets the UI subscribe before the first auto-started server reports its state.
const AUTO_START_DELAY_MS = 4000;

/** Auto-start, crash detection and scheduled restarts, per server. */
export class AutomationService {
  private automations: Map<string, ServerAutomation> = new Map();
  private configService: AutomationConfigService;
  private statusService: AutomationStatusService;
  private crashDetectionService: CrashDetectionService;
  private scheduledRestartService: ScheduledRestartService;
  private instancesService: AutomationInstancesService;

  constructor() {
    this.configService = new AutomationConfigService(this.automations);
    this.statusService = new AutomationStatusService(this.automations);
    this.crashDetectionService = new CrashDetectionService(this.automations);
    this.scheduledRestartService = new ScheduledRestartService(this.automations);
    this.instancesService = new AutomationInstancesService(this.automations);
    void this.instancesService.loadAutomationFromInstances();
  }

  async configureAutostart(serverId: string, autoStartOnAppLaunch: boolean, autoStartOnBoot: boolean): Promise<AutomationConfigResult> {
    const result = await this.configService.configureAutostart(serverId, autoStartOnAppLaunch, autoStartOnBoot);
    if (result.success) {
      const automation = this.automations.get(serverId);
      if (automation?.settings.crashDetectionEnabled) {
        this.crashDetectionService.startCrashDetection(serverId);
      } else {
        this.crashDetectionService.stopCrashDetection(serverId);
      }
      if (automation?.settings.scheduledRestartEnabled) {
        this.scheduledRestartService.scheduleRestart(serverId);
      } else {
        this.scheduledRestartService.unscheduleRestart(serverId);
      }
    }
    return result;
  }

  async configureCrashDetection(serverId: string, enabled: boolean, checkInterval: number, maxRestartAttempts: number): Promise<AutomationConfigResult> {
    const result = await this.configService.configureCrashDetection(serverId, enabled, checkInterval, maxRestartAttempts);
    if (result.success) {
      if (enabled) {
        this.crashDetectionService.startCrashDetection(serverId);
      } else {
        this.crashDetectionService.stopCrashDetection(serverId);
      }
    }
    return result;
  }

  async configureScheduledRestart(
    serverId: string,
    enabled: boolean,
    frequency: AutomationSettings['restartFrequency'],
    time: string | string[],
    days: number[],
    warningMinutes: number
  ): Promise<AutomationConfigResult> {
    const result = await this.configService.configureScheduledRestart(serverId, enabled, frequency, time, days, warningMinutes);
    if (result.success) {
      if (enabled) {
        this.scheduledRestartService.scheduleRestart(serverId);
      } else {
        this.scheduledRestartService.unscheduleRestart(serverId);
      }
    }
    return result;
  }

  getAutostartInstanceIds(): string[] {
    return this.statusService.getAutostartInstanceIds();
  }

  async getAutomationStatus(serverId: string): Promise<AutomationStatusResult> {
    return this.statusService.getAutomationStatus(serverId);
  }

  setManuallyStopped(serverId: string, manually: boolean): void {
    this.statusService.setManuallyStopped(serverId, manually);
  }

  /** For a deleted instance: its crash detection and scheduled restart stop, and its record goes. */
  forgetInstance(serverId: string): void {
    this.crashDetectionService.stopCrashDetection(serverId);
    this.scheduledRestartService.unscheduleRestart(serverId);
    this.automations.delete(serverId);
  }

  /** Undoes forgetInstance for a delete that failed: the record comes back from config.json, re-armed. */
  restoreInstance(serverId: string): void {
    // A client-supplied id; getInstance would throw on a bad one.
    if (!validateInstanceId(serverId)) return;
    let instance: Partial<AutomationSettings> | null;
    try {
      instance = getInstance(serverId);
    } catch (error) {
      console.error(`[automation] Failed to restore the automation of ${serverId}:`, error);
      return;
    }
    if (!instance || this.automations.has(serverId)) return;

    const automation = createServerAutomation(serverId, instance);
    this.automations.set(serverId, automation);
    this.arm(serverId, automation);
  }

  async handleAutoStartOnAppLaunch(): Promise<void> {
    const startDelayMs = (loadGlobalConfig().serverStartDelaySeconds ?? DEFAULT_START_DELAY_SECONDS) * 1000;

    setTimeout(async () => {
      for (const [serverId, automation] of this.automations) {
        if (!automation.settings.autoStartOnAppLaunch) continue;
        try {
          const { onLog, onState } = getStandardEventCallbacks(serverId);
          await serverInstanceService.startServerInstance(serverId, onLog, onState);
          // Staggered: starting several servers at once races Steam/Proton initialisation and
          // spikes the CPU on every platform.
          await new Promise(resolve => setTimeout(resolve, startDelayMs));
        } catch (error) {
          console.error(`[automation] Failed to auto-start ${serverId}:`, error);
        }
      }
    }, AUTO_START_DELAY_MS);
  }

  initializeAutomation(): void {
    for (const [serverId, automation] of this.automations) {
      this.arm(serverId, automation);
    }

    // Scheduled RCON announcements, from each instance's saved broadcastConfig.
    schedulerService.initAllSchedules().catch((error: Error) => {
      console.error('[automation] Failed to start the broadcast schedules:', error);
    });

    void this.handleAutoStartOnAppLaunch();
  }

  private arm(serverId: string, automation: ServerAutomation): void {
    if (automation.settings.crashDetectionEnabled) {
      this.crashDetectionService.startCrashDetection(serverId);
    }
    if (automation.settings.scheduledRestartEnabled) {
      this.scheduledRestartService.scheduleRestart(serverId);
    }
  }

  cleanup(): void {
    for (const [serverId] of this.automations) {
      this.crashDetectionService.stopCrashDetection(serverId);
      this.scheduledRestartService.unscheduleRestart(serverId);
    }
  }
}

export const automationService = new AutomationService();