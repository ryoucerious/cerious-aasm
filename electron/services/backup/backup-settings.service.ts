import * as fs from 'fs';
import { BackupSettings } from '../../types/backup.types';
import { BackupPathUtils } from '../../utils/backup.utils';
import { writeJsonAtomic } from '../../utils/fs.utils';

export class BackupSettingsService {
  /** The instance's backup-settings.json; null when there is none or it cannot be read. */
  async getBackupSettingsInternal(serverPath: string): Promise<BackupSettings | null> {
    const filePath = BackupPathUtils.getSettingsFilePath(serverPath);
    let content: string;
    try {
      content = await fs.promises.readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[backup-settings] Failed to read backup settings:', error);
      }
      return null;
    }
    // A byte order mark (Notepad, PowerShell 5) is not JSON. The parser's message quotes the file,
    // so it is not logged.
    try {
      return JSON.parse(content.replace(/^\uFEFF/, '')) as BackupSettings;
    } catch {
      console.error(`[backup-settings] ${filePath} is not valid JSON; ignoring it.`);
      return null;
    }
  }

  /** The settings live in the server directory; the backups directory is made by the first backup. */
  async saveBackupSettingsInternal(settings: BackupSettings, serverPath: string): Promise<void> {
    writeJsonAtomic(BackupPathUtils.getSettingsFilePath(serverPath), settings);
  }
}