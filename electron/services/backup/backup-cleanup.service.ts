import * as fs from 'fs';
import * as path from 'path';
import { BackupMetadata } from '../../types/backup.types';

/** Settings come from disk and clients: a missing, zero, negative or fractional count would delete everything. */
function isRetentionCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

export class BackupCleanupService {
  /** Deletes the oldest backups beyond `maxBackupsToKeep`. Does nothing unless that is an integer of at least 1. */
  async cleanupOldBackups(
    serverPath: string,
    maxBackupsToKeep: unknown,
    listBackups: (serverPath: string) => Promise<BackupMetadata[]>
  ): Promise<void> {
    if (!isRetentionCount(maxBackupsToKeep)) {
      console.warn(`[backup-cleanup] Keeping every backup: ${String(maxBackupsToKeep)} is not a number of backups to keep`);
      return;
    }

    try {
      const newestFirst = [...await listBackups(serverPath)]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      for (const backup of newestFirst.slice(maxBackupsToKeep)) {
        try {
          await fs.promises.unlink(backup.filePath);
        } catch (error) {
          console.error(`[backup-cleanup] Failed to delete backup ${backup.filePath}:`, error);
        }
      }
    } catch (error) {
      console.error('[backup-cleanup] Failed to clean up old backups:', error);
    }
  }

  /**
   * ARK's own world copies (`.ark.bak`) pile up in SavedArks; keeps the newest `maxToKeep` in each
   * map folder. Does nothing unless that is an integer of at least 1.
   */
  async cleanupArkSaveFiles(serverPath: string, maxToKeep: unknown): Promise<void> {
    if (!isRetentionCount(maxToKeep)) {
      return;
    }
    try {
      await this.pruneWorldCopies(path.join(serverPath, 'SavedArks'), maxToKeep);
    } catch (error) {
      console.error('[backup-cleanup] Failed to clean up ARK save files:', error);
    }
  }

  // Dirents describe links rather than their targets, so a link is never followed out of SavedArks.
  private async pruneWorldCopies(dir: string, maxToKeep: number): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`[backup-cleanup] Could not read ${dir}:`, error);
      }
      return;
    }

    const copies: Array<{ filePath: string; modifiedAt: number }> = [];
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.pruneWorldCopies(entryPath, maxToKeep);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.ark.bak')) {
        try {
          copies.push({ filePath: entryPath, modifiedAt: (await fs.promises.stat(entryPath)).mtimeMs });
        } catch (error) {
          // ARK rotates its copies while the server runs; one gone since the listing is skipped.
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.warn(`[backup-cleanup] Could not read ${entryPath}:`, error);
          }
        }
      }
    }

    copies.sort((a, b) => b.modifiedAt - a.modifiedAt);
    for (const copy of copies.slice(maxToKeep)) {
      try {
        await fs.promises.unlink(copy.filePath);
      } catch (error) {
        console.error(`[backup-cleanup] Failed to delete ARK save file ${copy.filePath}:`, error);
      }
    }
  }
}