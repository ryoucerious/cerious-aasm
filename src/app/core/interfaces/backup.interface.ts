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

export interface BackupCreateRequest {
  instanceId: string;
  type: 'manual' | 'scheduled';
  name?: string;
}

export interface BackupRestoreRequest {
  instanceId: string;
  backupId: string;
}

export interface BackupDeleteRequest {
  backupId: string;
}

export interface BackupListResponse {
  success: boolean;
  backups?: BackupMetadata[];
  error?: string;
}

export interface BackupOperationResponse {
  success: boolean;
  backupId?: string;
  error?: string;
  message?: string;
  // Download-specific properties
  fileName?: string;
  fileData?: string; // base64 encoded file data
  filePath?: string; // file path for Electron
  mimeType?: string;
  // Large file handling
  fileSize?: number; // file size in bytes
  fileSizeMB?: number; // file size in MB (rounded)
  maxSizeMB?: number; // configured size limit in MB
  isLargeFile?: boolean; // indicates if file exceeds web download limits
}