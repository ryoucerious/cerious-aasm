import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import * as instanceUtils from '../../utils/ark/instance.utils';

// File system operations
const mkdir = promisify(fs.mkdir);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const copyFile = promisify(fs.copyFile);
const unlink = promisify(fs.unlink);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

// Note: Using require() due to lack of proper TypeScript definitions for adm-zip
const AdmZip = require('adm-zip') as any;

export class BackupImportService {
  /**
   * Import a backup file as a new server instance
   */
  async importBackupAsNewServer(serverName: string, backupFilePath: string): Promise<any> {
    const { v4: uuidv4 } = await import('uuid');

    let newInstance: any = null;

    try {
      // Validate backup file exists
      if (!fs.existsSync(backupFilePath)) {
        throw new Error(`Backup file not found: ${backupFilePath}`);
      }

      // Generate new instance ID
      const instanceId = uuidv4();

      // Get base directory for instances
      const baseDir = instanceUtils.getInstancesBaseDir();
      const instanceDir = path.join(baseDir, instanceId);

      // Create instance directory
      await fs.promises.mkdir(instanceDir, { recursive: true });

      // Extract backup to temporary directory first
      const tempDir = path.join(instanceDir, 'temp_import');
      await fs.promises.mkdir(tempDir, { recursive: true });

      try {
        // Extract backup
        const zip = new AdmZip(backupFilePath);
        zip.extractAllTo(tempDir, true);

        // Try to find and read the original server configuration
        const configPath = path.join(tempDir, 'config.json');
        let originalConfig = null;

        if (fs.existsSync(configPath)) {
          try {
            const configContent = await fs.promises.readFile(configPath, 'utf8');
            originalConfig = JSON.parse(configContent);
          } catch (error) {
            console.warn(`[backup-import] Failed to parse config.json from backup, using defaults:`, error);
          }
        } else {
          console.warn(`[backup-import] No config.json found in backup, using defaults`);
        }

        // Create new instance with original settings (if available) or defaults
        if (originalConfig) {
          // Use original config but update ID and name
          newInstance = {
            ...originalConfig,
            id: instanceId,
            name: serverName,
            sessionName: serverName
          };
        } else {
          // Fallback to defaults if no config found
          newInstance = {
            id: instanceId,
            name: serverName,
            sessionName: serverName,
            mapName: 'TheIsland_WP',
            gamePort: 7777,
            rconPort: 27020,
            maxPlayers: 70,
            serverPassword: '',
            serverAdminPassword: '',
            crossplay: ['Steam (PC)'],
            xpMultiplier: 1.0,
            installed: false,
            currentVersion: null,
            autoUpdateEnabled: true
          };
        }

        // Move extracted files to instance directory (excluding temp folder)
        const extractedItems = await fs.promises.readdir(tempDir);
        for (const item of extractedItems) {
          const sourcePath = path.join(tempDir, item);
          const destPath = path.join(instanceDir, item);

          // Use recursive copy for directories, direct copy for files
          const stats = await fs.promises.stat(sourcePath);
          if (stats.isDirectory()) {
            await this.copyDirectory(sourcePath, destPath);
          } else {
            await fs.promises.copyFile(sourcePath, destPath);
          }
        }

        // Initialize backup directory for the new instance
        const backupsDir = path.join(instanceDir, 'backups');
        await fs.promises.mkdir(backupsDir, { recursive: true });

        // Save the new instance
        const saveResult = await instanceUtils.saveInstance(newInstance);
        if (!saveResult) {
          throw new Error('Failed to save new server instance');
        }
        return newInstance;

      } finally {
        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
          await this.removeDirectory(tempDir);
        }
      }

    } catch (error) {
      console.error('[backup-import] Failed to import backup as new server:', error);

      // Clean up instance directory if it was created
      if (newInstance?.id) {
        const baseDir = instanceUtils.getInstancesBaseDir();
        const instanceDir = path.join(baseDir, newInstance.id);
        if (fs.existsSync(instanceDir)) {
          try {
            await this.removeDirectory(instanceDir);
          } catch (cleanupError) {
            console.error('[backup-import] Failed to cleanup failed import:', cleanupError);
          }
        }
      }

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
          await copyFile(sourcePath, destPath);
        }
      }
    } catch (error) {
      console.error('[backup-import] Failed to copy directory:', error);
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
          await fs.promises.unlink(itemPath);
        }
      }

      fs.rmdirSync(dirPath);
    } catch (error) {
      console.error('[backup-import] Failed to remove directory:', error);
      throw error;
    }
  }
}

export const backupImportService = new BackupImportService();