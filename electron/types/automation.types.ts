export interface AutomationSettings {
  autoStartOnAppLaunch: boolean;
  autoStartOnBoot: boolean;
  crashDetectionEnabled: boolean;
  /** Seconds between crash checks. */
  crashDetectionInterval: number;
  maxRestartAttempts: number;
  scheduledRestartEnabled: boolean;
  /** 'custom' is what older versions stored for weekly on chosen days; 'none' never restarts. */
  restartFrequency: 'none' | 'daily' | 'weekly' | 'custom';
  /** HH:MM, host local time. The first of restartTimes, kept for older versions. */
  restartTime: string;
  /** Every HH:MM a day (or chosen day) to restart at, host local time. Unset in older versions. */
  restartTimes?: string[];
  /** Weekdays for a weekly restart, 0 = Sunday. */
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

export interface AutomationStatus {
  settings: AutomationSettings;
  status: ServerAutomation['status'];
  restartAttempts: number;
  lastCrashTime?: Date;
  manuallyStopped: boolean;
}

export interface AutomationStatusResult {
  success: boolean;
  status?: AutomationStatus;
  error?: string;
}