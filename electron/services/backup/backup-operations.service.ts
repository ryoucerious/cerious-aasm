import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import { BackupSettings, BackupMetadata } from '../../types/backup.types';
import { BackupFilenameUtils, BackupPathUtils } from '../../utils/backup.utils';
import { BackupResult, BackupListResult, BackupRestoreResult } from '../../types/backup.types';

// File system operations
const mkdir = promisify(fs.mkdir);
const stat = promisify(fs.stat);
const readdir = promisify(fs.readdir);
const unlink = promisify(fs.unlink);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

// Note: Using require() due to lack of proper TypeScript definitions for adm-zip
const AdmZip = require('adm-zip') as any;

export class BackupOperationsService {
  /**
   * Create a backup (internal implementation)
   */
  async createBackupInternal(
    instanceId: string,
    serverPath: string,
    type: 'manual' | 'scheduled',
    customName?: string
  ): Promise<BackupMetadata> {
    try {
      const instanceBackupDir = BackupPathUtils.getInstanceBackupDir(serverPath);
      await mkdir(instanceBackupDir, { recursive: true });

      // Generate structured filename
      const backupFileName = BackupFilenameUtils.generateFilename(type, customName);
      const backupFilePath = path.join(instanceBackupDir, backupFileName);

      // Create the zip archive
      await this.createZipArchive(serverPath, backupFilePath, instanceId);

      // Get file size and parse metadata from filename
      const stats = await stat(backupFilePath);
      const metadata = BackupFilenameUtils.parseFilename(backupFileName, backupFilePath, instanceId);

      if (!metadata) {
        throw new Error('Failed to parse backup filename');
      }

      // Update size from file stats
      metadata.size = stats.size;

      return metadata;
    } catch (error) {
      console.error('[backup-operations] Failed to create backup:', error);
      throw error;
    }
  }

  /**
   * Create a zip archive excluding the backup folder
   */
  private async createZipArchive(sourcePath: string, outputPath: string, instanceId: string): Promise<void> {
    try {
      const zip = new AdmZip();

      // Add all files and directories except backup folders
      await this.addToZip(zip, sourcePath, '', instanceId);

      // Write the zip file
      zip.writeZip(outputPath);
    } catch (error) {
      console.error('[backup-operations] Failed to create zip archive:', error);
      throw error;
    }
  }

  /**
   * Recursively add files to zip, excluding backup directories
   */
  private async addToZip(zip: any, sourcePath: string, relativePath: string, instanceId: string): Promise<void> {
    try {
      const items = await readdir(sourcePath);

      for (const item of items) {
        const itemPath = path.join(sourcePath, item);
        const itemRelativePath = relativePath ? path.join(relativePath, item) : item;
        const stats = await stat(itemPath);

        // Skip backup-related directories
        if (item.toLowerCase().includes('backup')) {
          continue;
        }

        if (stats.isDirectory()) {
          // Recursively add directory contents
          await this.addToZip(zip, itemPath, itemRelativePath, instanceId);
        } else {
          // Add file
          const fileBuffer = await fs.promises.readFile(itemPath);
          zip.addFile(itemRelativePath, fileBuffer);
        }
      }
    } catch (error) {
      console.error('[backup-operations] Failed to add items to zip:', error);
      throw error;
    }
  }

  /**
   * Get instance backups (internal implementation)
   */
  async getInstanceBackupsInternal(serverPath: string): Promise<BackupMetadata[]> {
    try {
      const instanceBackupDir = BackupPathUtils.getInstanceBackupDir(serverPath);

      if (!fs.existsSync(instanceBackupDir)) {
        return [];
      }

      const files = await readdir(instanceBackupDir);
      // Filter for backup ZIP files only
      const backupFiles = files.filter(f => BackupFilenameUtils.isBackupFile(f));

      const backups: BackupMetadata[] = [];

      for (const backupFile of backupFiles) {
        try {
          const backupFilePath = path.join(instanceBackupDir, backupFile);

          // Check if file exists and get stats
          if (!fs.existsSync(backupFilePath)) {
            continue;
          }

          const stats = await stat(backupFilePath);

          // Parse metadata from filename
          // Extract instanceId from serverPath
          const instanceId = path.basename(path.dirname(instanceBackupDir));
          const metadata = BackupFilenameUtils.parseFilename(backupFile, backupFilePath, instanceId);

          if (metadata) {
            metadata.size = stats.size;
            backups.push(metadata);
          }
        } catch (error) {
          console.error(`[backup-operations] Failed to process backup file ${backupFile}:`, error);
        }
      }

      // Sort by creation date (newest first)
      backups.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      return backups;
    } catch (error) {
      console.error('[backup-operations] Failed to get instance backups:', error);
      return [];
    }
  }

  /**
   * Restore backup (internal implementation)
   */
  async restoreBackupInternal(backupId: string, serverPath: string): Promise<void> {
    try {
      // Find the backup file by searching for files with matching ID
      const instanceBackupDir = BackupPathUtils.getInstanceBackupDir(serverPath);

      if (!fs.existsSync(instanceBackupDir)) {
        throw new Error(`Backup directory not found: ${instanceBackupDir}`);
      }

      const files = await readdir(instanceBackupDir);
      const backupFile = files.find(f => f.startsWith(backupId) && f.endsWith('.zip'));

      if (!backupFile) {
        throw new Error(`Backup with ID ${backupId} not found`);
      }

      const backupFilePath = path.join(instanceBackupDir, backupFile);

      // Check if backup file exists
      if (!fs.existsSync(backupFilePath)) {
        throw new Error(`Backup file not found: ${backupFilePath}`);
      }

      // Create temporary directory for extraction
      const tempDir = path.join(path.dirname(backupFilePath), `temp_${backupId}`);
      await mkdir(tempDir, { recursive: true });

      try {
        // Extract backup
        const zip = new AdmZip(backupFilePath);
        zip.extractAllTo(tempDir, true);

        // Remove existing server files (except backup folder)
        await this.clearServerDirectory(serverPath);

        // Copy extracted files to server directory
        await this.copyDirectory(tempDir, serverPath);
      } finally {
        // Clean up temporary directory
        await this.removeDirectory(tempDir);
      }
    } catch (error) {
      console.error('[backup-operations] Failed to restore backup:', error);
      throw error;
    }
  }

  /**
   * Delete backup (internal implementation)
   */
  async deleteBackupInternal(backupId: string, serverPath: string): Promise<void> {
    try {
      const instanceBackupDir = BackupPathUtils.getInstanceBackupDir(serverPath);

      if (!fs.existsSync(instanceBackupDir)) {
        throw new Error(`Backup directory not found: ${instanceBackupDir}`);
      }

      const files = await readdir(instanceBackupDir);

      // First try: exact filename match (new format)
      let backupFile = files.find(f => f === `${backupId}.zip`);

      // Second try: startsWith match (handles legacy or partial matches)
      if (!backupFile) {
        backupFile = files.find(f => f.startsWith(backupId) && f.endsWith('.zip'));
      }

      // Third try: search by parsing all backup files and matching ID (most robust)
      if (!backupFile) {
        const instanceId = path.basename(path.dirname(instanceBackupDir));
        for (const file of files) {
          if (BackupFilenameUtils.isBackupFile(file)) {
            const filePath = path.join(instanceBackupDir, file);
            const metadata = BackupFilenameUtils.parseFilename(file, filePath, instanceId);
            if (metadata && metadata.id === backupId) {
              backupFile = file;
              break;
            }
          }
        }
      }

      if (!backupFile) {
        throw new Error(`Backup with ID ${backupId} not found`);
      }

      const backupFilePath = path.join(instanceBackupDir, backupFile);
      await unlink(backupFilePath);
    } catch (error) {
      console.error('[backup-operations] Failed to delete backup:', error);
      throw error;
    }
  }

  /**
   * Clear server directory (except backup folders)
   */
  private async clearServerDirectory(serverPath: string): Promise<void> {
    try {
      const items = await readdir(serverPath);

      for (const item of items) {
        // Skip backup-related directories
        if (item.toLowerCase().includes('backup')) {
          continue;
        }

        const itemPath = path.join(serverPath, item);
        const stats = await stat(itemPath);

        if (stats.isDirectory()) {
          await this.removeDirectory(itemPath);
        } else {
          await unlink(itemPath);
        }
      }
    } catch (error) {
      console.error('[backup-operations] Failed to clear server directory:', error);
      throw error;
    }
  }

  /**
   * Copy directory recursively
   */
  private async copyDirectory(source: string, destination: string): Promise<void> {
    try {
      await mkdir(destination, { recursive: true });
      const items = await readdir(source);

      for (const item of items) {
        const sourcePath = path.join(source, item);
        const destPath = path.join(destination, item);
        const stats = await stat(sourcePath);

        if (stats.isDirectory()) {
          await this.copyDirectory(sourcePath, destPath);
        } else {
          const fileBuffer = await readFile(sourcePath);
          await writeFile(destPath, fileBuffer);
        }
      }
    } catch (error) {
      console.error('[backup-operations] Failed to copy directory:', error);
      throw error;
    }
  }

  /**
   * Remove directory recursively
   */
  private async removeDirectory(dirPath: string): Promise<void> {
    try {
      if (!fs.existsSync(dirPath)) {
        return;
      }

      const items = await readdir(dirPath);

      for (const item of items) {
        const itemPath = path.join(dirPath, item);
        const stats = await stat(itemPath);

        if (stats.isDirectory()) {
          await this.removeDirectory(itemPath);
        } else {
          await unlink(itemPath);
        }
      }

      fs.rmdirSync(dirPath);
    } catch (error) {
      console.error('[backup-operations] Failed to remove directory:', error);
      throw error;
    }
  }
}

export const backupOperationsService = new BackupOperationsService();