export interface BackupSettings {
  instanceId: string;
  enabled: boolean;
  frequency: 'hourly' | 'daily' | 'weekly';
  time: string; // HH:MM format
  dayOfWeek?: number; // 0-6, Sunday to Saturday
  maxBackupsToKeep: number;
}

export interface BackupMetadata {
  id: string;
  instanceId: string;
  name: string;
  createdAt: Date;
  size: number;
  type: 'manual' | 'scheduled';
  filePath: string;
}

export interface BackupResult {
  success: boolean;
  backupId?: string;
  message?: string;
  error?: string;
}

export interface BackupListResult {
  success: boolean;
  backups?: BackupMetadata[];
  error?: string;
}

export interface BackupSettingsResult {
  success: boolean;
  settings?: BackupSettings;
  error?: string;
}

export interface BackupRestoreResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface BackupSchedulerResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface BackupSchedulerStatusResult {
  success: boolean;
  isRunning?: boolean;
  nextBackup?: Date;
  error?: string;
}

export interface BackupDownloadResult {
  success: boolean;
  filePath?: string;
  fileName?: string;
  error?: string;
}