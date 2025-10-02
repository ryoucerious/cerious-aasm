import * as fs from 'fs';
import { promisify } from 'util';
import { BackupSettings } from '../../types/backup.types';
import { BackupPathUtils } from '../../utils/backup.utils';

// File system operations
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

export class BackupSettingsService {
  /**
   * Get backup settings (internal implementation)
   */
  async getBackupSettingsInternal(instanceId: string, serverPath: string): Promise<BackupSettings | null> {
    try {
      const settingsFile = BackupPathUtils.getSettingsFilePath(serverPath);
      if (!fs.existsSync(settingsFile)) {
        return null;
      }

      const content = await readFile(settingsFile, 'utf8');
      const settings = JSON.parse(content) as BackupSettings;

      return settings;
    } catch (error) {
      console.error('[backup-settings] Failed to get backup settings:', error);
      return null;
    }
  }

  /**
   * Save backup settings (internal implementation)
   */
  async saveBackupSettingsInternal(settings: BackupSettings, serverPath: string): Promise<void> {
    try {
      const settingsFile = BackupPathUtils.getSettingsFilePath(serverPath);
      const backupDir = BackupPathUtils.getInstanceBackupDir(serverPath);

      // Ensure backup directory exists
      await mkdir(backupDir, { recursive: true });

      await writeFile(settingsFile, JSON.stringify(settings, null, 2));
    } catch (error) {
      console.error('[backup-settings] Failed to save backup settings:', error);
      throw error;
    }
  }
}

export const backupSettingsService = new BackupSettingsService();