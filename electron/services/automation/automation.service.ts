import { serverInstanceService } from '../server-instance/server-instance.service';
import { AutomationConfigService } from './automation-config.service';
import { AutomationStatusService } from './automation-status.service';
import { CrashDetectionService } from './crash-detection.service';
import { ScheduledRestartService } from './scheduled-restart.service';
import { AutomationInstancesService } from './automation-instances.service';
import { AutomationConfigResult, AutomationStatusResult, ServerAutomation } from '../../types/automation.types';

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
    this.instancesService.loadAutomationFromInstances();
  }

  // Delegate to config service
  async configureAutostart(serverId: string, autoStartOnAppLaunch: boolean, autoStartOnBoot: boolean): Promise<AutomationConfigResult> {
    const result = await this.configService.configureAutostart(serverId, autoStartOnAppLaunch, autoStartOnBoot);
    if (result.success) {
      // Start/stop crash detection based on settings
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

  async configureScheduledRestart(serverId: string, enabled: boolean, frequency: 'daily' | 'weekly' | 'custom', time: string, days: number[], warningMinutes: number): Promise<AutomationConfigResult> {
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

  // Delegate to status service
  getAutostartInstanceIds(): string[] {
    return this.statusService.getAutostartInstanceIds();
  }

  async getAutomationStatus(serverId: string): Promise<AutomationStatusResult> {
    return this.statusService.getAutomationStatus(serverId);
  }

  setManuallyStopped(serverId: string, manually: boolean): void {
    this.statusService.setManuallyStopped(serverId, manually);
  }

  // Auto-start on app launch
  async handleAutoStartOnAppLaunch(): Promise<void> {
    try {
      // Delay autostart to allow UI to subscribe
      setTimeout(async () => {
        for (const [serverId, automation] of this.automations) {
          if (automation.settings.autoStartOnAppLaunch) {
            try {
              const { onLog, onState } = serverInstanceService.getStandardEventCallbacks(serverId);
              await serverInstanceService.startServerInstance(serverId, onLog, onState);
            } catch (error) {
              console.error(`Failed to auto-start server ${serverId}:`, error);
            }
          }
        }
      }, 4000); // 4s delay to allow UI to subscribe
    } catch (error) {
      console.error('Failed during auto-start on app launch:', error);
    }
  }

  // Initialize automation
  initializeAutomation(): void {
    for (const [serverId, automation] of this.automations) {
      if (automation.settings.crashDetectionEnabled) {
        this.crashDetectionService.startCrashDetection(serverId);
      }

      if (automation.settings.scheduledRestartEnabled) {
        this.scheduledRestartService.scheduleRestart(serverId);
      }
    }

    this.handleAutoStartOnAppLaunch();
  }

  // Cleanup
  cleanup(): void {
    for (const [serverId] of this.automations) {
      this.crashDetectionService.stopCrashDetection(serverId);
      this.scheduledRestartService.unscheduleRestart(serverId);
    }
  }
}

export const automationService = new AutomationService();