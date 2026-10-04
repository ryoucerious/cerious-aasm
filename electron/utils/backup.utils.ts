import * as path from 'path';
import { BackupMetadata } from '../types/backup.types';
import { getDefaultInstallDir } from './platform.utils';

const MAX_NAME_LENGTH = 50;
// Windows refuses these as file names, with or without an extension; COM and LPT take 0-9 and the
// superscripts 1-3.
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|(com|lpt)[0-9\u00B9\u00B2\u00B3])(\.|$)/i;
const STRUCTURED_BACKUP_FILE = /^(manual|scheduled)_\d{14}_.*\.zip$/i;
const SYSTEM_FILES = ['thumbs.db.zip', 'desktop.ini.zip', '.ds_store.zip'];

/**
 * Backup files are named `<name>.zip` (manual, named by the user) or
 * `<type>_<YYYYMMDDHHMMSS UTC>_<name>.zip`. The id of a backup is its file name without `.zip`.
 */
export class BackupFilenameUtils {
  static generateFilename(type: 'manual' | 'scheduled', customName?: string): string {
    if (type === 'manual' && customName) {
      return `${BackupFilenameUtils.sanitizeFilename(customName)}.zip`;
    }

    const utcTimestamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    const safeName = customName ? BackupFilenameUtils.sanitizeFilename(customName) : 'backup';
    return `${type}_${utcTimestamp}_${safeName}.zip`;
  }

  /** `modifiedAt` dates a manual backup, whose name carries no timestamp. */
  static parseFilename(filename: string, filePath: string, instanceId: string, modifiedAt: Date): BackupMetadata | null {
    const id = BackupFilenameUtils.getBackupId(filename);
    const parts = id.split('_');

    if (parts.length === 1 || (parts[0] !== 'manual' && parts[0] !== 'scheduled')) {
      return { id, instanceId, name: id, createdAt: modifiedAt, size: 0, type: 'manual', filePath };
    }

    if (parts.length < 3) {
      console.warn(`[backup-utils] Invalid structured backup filename format: ${filename}`);
      return null;
    }

    const [type, timestamp] = parts;
    if (!/^\d{14}$/.test(timestamp)) {
      console.warn(`[backup-utils] Invalid timestamp format in filename: ${filename}`);
      return null;
    }

    const field = (start: number, end: number) => Number(timestamp.substring(start, end));
    const createdAt = new Date(Date.UTC(field(0, 4), field(4, 6) - 1, field(6, 8), field(8, 10), field(10, 12), field(12, 14)));

    return {
      id,
      instanceId,
      name: parts.slice(2).join('_'),
      createdAt,
      size: 0,
      type: type as 'manual' | 'scheduled',
      filePath
    };
  }

  static getBackupId(filename: string): string {
    return filename.replace(/\.zip$/i, '');
  }

  /** Accepts both naming formats; any other `.zip` counts as a manual backup. */
  static isBackupFile(filename: string): boolean {
    const name = filename.toLowerCase();
    if (!name.endsWith('.zip')) {
      return false;
    }
    if (STRUCTURED_BACKUP_FILE.test(filename)) {
      return true;
    }
    return !SYSTEM_FILES.includes(name) && !name.startsWith('.');
  }

  /** A user's backup name as a file name the list shows and every platform accepts. Keeps spaces. */
  private static sanitizeFilename(name: string): string {
    const stripped = name
      .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '')
      .replace(/\s+/g, ' ');
    // Cut by code point: a cut between the halves of a surrogate pair leaves invalid UTF-16.
    const cleaned = Array.from(stripped).slice(0, MAX_NAME_LENGTH).join('')
      // A leading dot hides the file from the list; Windows drops trailing dots and spaces.
      .replace(/^[.\s]+|[.\s]+$/g, '');

    if (!cleaned) {
      return 'backup';
    }
    if (RESERVED_WINDOWS_NAME.test(cleaned)) {
      return `_${cleaned}`;
    }
    // Would be parsed as a structured name, and hidden as a broken one.
    return cleaned.replace(/^(manual|scheduled)_/, '$1-');
  }
}

export class BackupPathUtils {
  /**
   * `<installDir>/backups/<instanceId>`, outside the instance directory: a restore clears and
   * rewrites that directory, and must never touch, lock or delete the backups it reads from.
   */
  static getInstanceBackupDir(serverPath: string): string {
    const instanceId = path.basename(serverPath);
    return path.join(getDefaultInstallDir(), 'backups', instanceId);
  }

  /** Where older versions kept backups, inside the instance directory. Read only to migrate them. */
  static getLegacyInstanceBackupDir(serverPath: string): string {
    return path.join(serverPath, 'backups');
  }

  static getSettingsFilePath(serverPath: string): string {
    return path.join(serverPath, 'backup-settings.json');
  }
}