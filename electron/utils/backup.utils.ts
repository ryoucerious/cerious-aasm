import * as path from 'path';
import { BackupSettings, BackupMetadata } from '../types/backup.types';

/**
 * Backup Utilities - Helper Functions Only
 * Pure helper functions for backup filename management and path operations
 */

/**
 * Helper functions for filename-based backup management
 */
export class BackupFilenameUtils {
  /**
   * Generate a backup filename 
   * Manual backups: Use custom name only (e.g., "MyBackup.zip")
   * Scheduled backups: Include timestamp for uniqueness (e.g., "scheduled_20250916_230510_backup.zip")
   */
  static generateFilename(type: 'manual' | 'scheduled', customName?: string): string {
    if (type === 'manual' && customName) {
      // For manual backups, use just the custom name
      const safeName = BackupFilenameUtils.sanitizeFilename(customName);
      return `${safeName}.zip`;
    }
    
    // For scheduled backups or manual without custom name, use timestamp format
    const utcTimestamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(0, 14); // YYYYMMDDHHMMSS in UTC
    const safeName = customName ? BackupFilenameUtils.sanitizeFilename(customName) : 'backup';
    return `${type}_${utcTimestamp}_${safeName}.zip`;
  }

  /**
   * Parse backup metadata from filename
   * Supports two formats:
   * 1. Manual backups: {customName}.zip (e.g., "MyBackup.zip")
   * 2. Scheduled backups: {type}_{utcTimestamp}_{customName}.zip (e.g., "scheduled_20250916230510_backup.zip")
   */
  static parseFilename(filename: string, filePath: string, instanceId: string): BackupMetadata | null {
    try {
      // Remove .zip extension
      const nameWithoutExt = filename.replace(/\.zip$/i, '');
      const parts = nameWithoutExt.split('_');
      
      // Check if this is a simple manual backup (no underscores or doesn't start with type)
      if (parts.length === 1 || (parts.length > 1 && parts[0] !== 'manual' && parts[0] !== 'scheduled')) {
        // Simple manual backup format: just the custom name
        return {
          id: nameWithoutExt,
          instanceId,
          name: nameWithoutExt,
          createdAt: new Date(), // Use current time since we don't have timestamp
          size: 0, // Will be populated by caller with actual file size
          type: 'manual',
          filePath
        };
      }

      // Structured format: {type}_{timestamp}_{customName}
      if (parts.length < 3) {
        console.warn(`[backup-filename-utils] Invalid structured backup filename format: ${filename}`);
        return null;
      }

      const type = parts[0] as 'manual' | 'scheduled';
      const timestamp = parts[1];
      const customName = parts.slice(2).join('_');

      // Parse UTC timestamp (YYYYMMDDHHMMSS format)
      if (timestamp.length !== 14) {
        console.warn(`[backup-filename-utils] Invalid timestamp format in filename: ${filename}`);
        return null;
      }

      const year = parseInt(timestamp.substring(0, 4));
      const month = parseInt(timestamp.substring(4, 6)) - 1; // Month is 0-indexed
      const day = parseInt(timestamp.substring(6, 8));
      const hour = parseInt(timestamp.substring(8, 10));
      const minute = parseInt(timestamp.substring(10, 12));
      const second = parseInt(timestamp.substring(12, 14));

      const createdAt = new Date(Date.UTC(year, month, day, hour, minute, second));

      // Use filename without extension as ID (matches original behavior)
      const id = nameWithoutExt;

      return {
        id,
        instanceId,
        name: customName,
        createdAt,
        size: 0, // Will be populated by caller with actual file size
        type,
        filePath
      };
    } catch (error) {
      console.error(`[backup-filename-utils] Error parsing filename ${filename}:`, error);
      return null;
    }
  }

  /**
   * Sanitize a backup name for use in filenames
   * Removes only problematic characters, preserves spaces
   */
  private static sanitizeFilename(name: string): string {
    // Remove only invalid filename characters, preserve spaces
    return name
      .replace(/[<>:"/\\|?*]/g, '') // Remove invalid chars but keep spaces
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .trim() // Remove leading/trailing spaces
      .substring(0, 50); // Limit length
  }

  /**
   * Check if a filename matches backup file pattern
   * Supports both formats:
   * 1. Simple manual backups: *.zip
   * 2. Structured backups: (manual|scheduled)_timestamp_name.zip
   */
  static isBackupFile(filename: string): boolean {
    // Must be a zip file
    if (!filename.toLowerCase().endsWith('.zip')) {
      return false;
    }
    
    // Check for structured format first
    if (/^(manual|scheduled)_\d{14}_.*\.zip$/i.test(filename)) {
      return true;
    }
    
    // For simple format, accept any .zip file that's not a system file
    const name = filename.toLowerCase();
    const systemFiles = ['thumbs.db.zip', 'desktop.ini.zip', '.ds_store.zip'];
    return !systemFiles.includes(name) && !name.startsWith('.');
  }
}

/**
 * Path calculation helpers
 */
export class BackupPathUtils {
  /**
   * Get the backup directory for a specific instance
   */
  static getInstanceBackupDir(serverPath: string): string {
    return path.join(serverPath, 'backups');
  }

  /**
   * Get the backup settings file path
   */
  static getSettingsFilePath(serverPath: string): string {
    return path.join(serverPath, 'backup-settings.json');
  }

  /**
   * Get full backup file path
   */
  static getBackupFilePath(serverPath: string, filename: string): string {
    return path.join(BackupPathUtils.getInstanceBackupDir(serverPath), filename);
  }
}