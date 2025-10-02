import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import { BackupMetadata } from '../../types/backup.types';

// File system operations
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const unlink = promisify(fs.unlink);

export class BackupCleanupService {
  /**
   * Cleanup old backups (internal implementation)
   */
  async cleanupOldBackups(serverPath: string, maxBackupsToKeep: number, getInstanceBackupsInternal: (serverPath: string) => Promise<BackupMetadata[]>): Promise<void> {
    try {
      const backups = await getInstanceBackupsInternal(serverPath);

      if (backups.length <= maxBackupsToKeep) {
        return; // Nothing to clean up
      }

      // Sort by creation date (oldest first for deletion)
      backups.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      const backupsToDelete = backups.slice(0, backups.length - maxBackupsToKeep);

      for (const backup of backupsToDelete) {
        try {
          await unlink(backup.filePath);
        } catch (error) {
          console.error(`[backup-cleanup] Failed to delete backup ${backup.filePath}:`, error);
        }
      }
    } catch (error) {
      console.error('[backup-cleanup] Failed to cleanup old backups:', error);
    }
  }

  /**
   * Clean up old ARK save files, keeping only the most recent ones
   * This helps prevent accumulation of automatic ARK game saves
   */
  async cleanupArkSaveFiles(serverPath: string, maxBackupsToKeep: number): Promise<void> {
    try {
      // ARK saves are in the instance's SavedArks directory
      // serverPath is already .../AASMServer/ShooterGame/Saved/Servers/{instanceId}
      const savedArksDir = path.join(serverPath, 'SavedArks');

      if (!fs.existsSync(savedArksDir)) {
        return; // No save directory exists
      }

      // Get all .ark.bak files from all map subdirectories
      const bakFiles: Array<{ filePath: string; modifiedTime: Date }> = [];

      // Recursively search through SavedArks directory and subdirectories
      await this.collectBakFiles(savedArksDir, bakFiles);

      if (bakFiles.length <= maxBackupsToKeep) {
        return; // Nothing to clean up
      }

      // Sort by modification time (oldest first for deletion)
      bakFiles.sort((a, b) => a.modifiedTime.getTime() - b.modifiedTime.getTime());

      const filesToDelete = bakFiles.slice(0, bakFiles.length - maxBackupsToKeep);

      for (const file of filesToDelete) {
        try {
          await unlink(file.filePath);
        } catch (error) {
          console.error(`[backup-cleanup] Failed to delete ARK save file ${file.filePath}:`, error);
        }
      }
    } catch (error) {
      console.error('[backup-cleanup] Failed to cleanup ARK save files:', error);
    }
  }

  /**
   * Recursively collect all .ark.bak files from the SavedArks directory and subdirectories
   */
  private async collectBakFiles(dirPath: string, bakFiles: Array<{ filePath: string; modifiedTime: Date }>): Promise<void> {
    try {
      const items = await readdir(dirPath);

      for (const item of items) {
        const itemPath = path.join(dirPath, item);
        const stats = await stat(itemPath);

        if (stats.isDirectory()) {
          // Recursively search subdirectories
          await this.collectBakFiles(itemPath, bakFiles);
        } else if (stats.isFile() && item.toLowerCase().endsWith('.bak')) {
          // Found a .ark.bak file
          bakFiles.push({
            filePath: itemPath,
            modifiedTime: stats.mtime
          });
        }
      }
    } catch (error) {
      console.warn(`[backup-cleanup] Could not read directory ${dirPath}:`, error);
    }
  }
}

export const backupCleanupService = new BackupCleanupService();