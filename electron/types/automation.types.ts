export interface AutomationSettings {
  autoStartOnAppLaunch: boolean;
  autoStartOnBoot: boolean;
  crashDetectionEnabled: boolean;
  crashDetectionInterval: number;
  maxRestartAttempts: number;
  scheduledRestartEnabled: boolean;
  restartFrequency: 'daily' | 'weekly' | 'custom';
  restartTime: string;
  restartDays: number[];
  restartWarningMinutes: number;
}

export interface ServerAutomation {
  serverId: string;
  settings: AutomationSettings;
  crashDetectionTimer?: NodeJS.Timeout;
  scheduledRestartTimer?: NodeJS.Timeout;
  restartAttempts: number;
  lastCrashTime?: Date;
  manuallyStopped: boolean;
  status: {
    isMonitoring: boolean;
    isScheduled: boolean;
    nextRestart?: Date;
  };
}

export interface AutomationConfigResult {
  success: boolean;
  error?: string;
}

export interface AutomationStatusResult {
  success: boolean;
  status?: any;
  error?: string;
}