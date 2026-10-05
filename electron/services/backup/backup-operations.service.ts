import AdmZip from 'adm-zip';
import * as fs from 'fs';
import * as path from 'path';
import { BackupMetadata } from '../../types/backup.types';
import { BackupFilenameUtils, BackupPathUtils } from '../../utils/backup.utils';
import { copyDirectory, moveFile, removeDirectory } from '../../utils/fs.utils';

// Names the backup list never shows: an archive being written, and a restore's extraction.
const ARCHIVE_TEMP_SUFFIX = '.zip.tmp';
const RESTORE_TEMP_PREFIX = '.restore-';

export class BackupOperationsService {
  async createBackupInternal(
    instanceId: string,
    serverPath: string,
    type: 'manual' | 'scheduled',
    customName?: string
  ): Promise<BackupMetadata> {
    const backupDir = BackupPathUtils.getInstanceBackupDir(serverPath);
    await fs.promises.mkdir(backupDir, { recursive: true });

    const fileName = this.unusedFileName(backupDir, BackupFilenameUtils.generateFilename(type, customName));
    const filePath = path.join(backupDir, fileName);
    // Written under a name the list ignores, then moved into place: a half-written zip must never
    // be listed, restored or counted by retention.
    const tempPath = `${filePath}.tmp`;
    try {
      const zip = new AdmZip();
      await this.addToZip(zip, serverPath, '');
      zip.writeZip(tempPath);
      moveFile(tempPath, filePath);
    } catch (error) {
      // The move falls back to copying, which can fail with part of the archive under the final
      // name; that name was unused, so nothing else is lost.
      await Promise.allSettled([fs.promises.rm(tempPath, { force: true }), fs.promises.rm(filePath, { force: true })]);
      throw error;
    }

    const stats = await fs.promises.stat(filePath);
    const metadata = BackupFilenameUtils.parseFilename(fileName, filePath, instanceId, stats.mtime);
    if (!metadata) {
      throw new Error('Failed to parse backup filename');
    }
    metadata.size = stats.size;
    return metadata;
  }

  /** `name.zip`, or `name (2).zip` and so on when that is taken: a backup never replaces another. */
  private unusedFileName(backupDir: string, fileName: string): string {
    const stem = BackupFilenameUtils.getBackupId(fileName);
    let candidate = fileName;
    for (let copy = 2; fs.existsSync(path.join(backupDir, candidate)); copy++) {
      candidate = `${stem} (${copy}).zip`;
    }
    return candidate;
  }

  // Matched on the path tail so that only ARK's own log folder is skipped, never a user folder that
  // happens to be called "Logs".
  private isInstanceLogsDir(dirPath: string): boolean {
    return /[/\\]ShooterGame[/\\]Saved[/\\]Logs$/i.test(dirPath);
  }

  /**
   * Adds a directory's contents, skipping backup folders and links. lstat, not stat: the junctions
   * into the shared install (Content ~70 GB, Engine ~3 GB) must be skipped, not read into memory.
   */
  private async addToZip(zip: AdmZip, sourcePath: string, relativePath: string): Promise<void> {
    const items = await fs.promises.readdir(sourcePath);

    // The exe and DLLs directly in Win64 (~200 MB) are copied from the shared install on every
    // start. Its subfolders, ArkApi with the user's plugins among them, are kept.
    const isWin64Dir = /[/\\]ShooterGame[/\\]Binaries[/\\]Win64$/i.test(sourcePath);

    for (const item of items) {
      const itemPath = path.join(sourcePath, item);
      const itemRelativePath = relativePath ? path.join(relativePath, item) : item;
      const stats = await fs.promises.lstat(itemPath);

      if (item.toLowerCase().includes('backup') || stats.isSymbolicLink()) {
        continue;
      }

      if (stats.isDirectory()) {
        // ARK logs grow to several GB and AdmZip reads every file fully into memory, which can fail
        // the whole backup. A restore has no use for them.
        if (this.isInstanceLogsDir(itemPath)) {
          continue;
        }
        await this.addToZip(zip, itemPath, itemRelativePath);
      } else if (stats.isFile() && !isWin64Dir) {
        zip.addFile(itemRelativePath, await fs.promises.readFile(itemPath));
      }
    }
  }

  /** Removes what a backup or restore interrupted by an exit left in the instance's backup folder. */
  async removeStaleTempFiles(serverPath: string): Promise<void> {
    const backupDir = BackupPathUtils.getInstanceBackupDir(serverPath);
    let entries: string[];
    try {
      entries = await fs.promises.readdir(backupDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[backup-operations] Failed to look for leftover temporary files:', error);
      }
      return;
    }

    for (const entry of entries) {
      if (!entry.endsWith(ARCHIVE_TEMP_SUFFIX) && !entry.startsWith(RESTORE_TEMP_PREFIX)) continue;
      try {
        await fs.promises.rm(path.join(backupDir, entry), { recursive: true, force: true });
      } catch (error) {
        console.warn(`[backup-operations] Failed to remove the leftover ${entry}:`, error);
      }
    }
  }

  /** The instance's backups, newest first. */
  async getInstanceBackupsInternal(serverPath: string): Promise<BackupMetadata[]> {
    const backupDir = BackupPathUtils.getInstanceBackupDir(serverPath);
    const instanceId = path.basename(backupDir);

    let files: string[];
    try {
      files = await fs.promises.readdir(backupDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[backup-operations] Failed to list backups:', error);
      }
      return [];
    }

    const backups: BackupMetadata[] = [];
    for (const file of files.filter(name => BackupFilenameUtils.isBackupFile(name))) {
      try {
        const filePath = path.join(backupDir, file);
        const stats = await fs.promises.stat(filePath);
        const metadata = BackupFilenameUtils.parseFilename(file, filePath, instanceId, stats.mtime);
        if (metadata) {
          metadata.size = stats.size;
          backups.push(metadata);
        }
      } catch (error) {
        console.error(`[backup-operations] Failed to read backup ${file}:`, error);
      }
    }

    return backups.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async restoreBackupInternal(backupId: string, serverPath: string): Promise<void> {
    // Never operate on an empty path or the instances root: clearServerDirectory() would wipe every
    // server on disk.
    if (!serverPath || typeof serverPath !== 'string' || !path.isAbsolute(serverPath)) {
      throw new Error(`Refusing to restore backup: invalid server path "${serverPath}"`);
    }

    const backupDir = BackupPathUtils.getInstanceBackupDir(serverPath);
    const backupFilePath = await this.findBackupFile(backupDir, backupId);

    // config.json is what puts the server in the list. A restore that fails partway (a file locked
    // by a running server on Windows) or a backup without one must not make the server vanish.
    const configPath = path.join(serverPath, 'config.json');
    let preservedConfig: Buffer | null = null;
    try {
      preservedConfig = await fs.promises.readFile(configPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[backup-operations] Failed to read config.json before the restore:', error);
      }
    }

    const tempDir = await fs.promises.mkdtemp(path.join(backupDir, RESTORE_TEMP_PREFIX));
    try {
      // Extracted in full before anything is cleared, so a bad archive cannot leave the server
      // directory empty.
      new AdmZip(backupFilePath).extractAllTo(tempDir, true);
      await this.clearServerDirectory(serverPath);
      await copyDirectory(tempDir, serverPath);
    } finally {
      // Before the temp cleanup, so a cleanup failure cannot skip it.
      try {
        if (preservedConfig && !fs.existsSync(configPath)) {
          await fs.promises.writeFile(configPath, preservedConfig);
        }
      } catch (error) {
        console.error('[backup-operations] Failed to put config.json back:', error);
      }
      try {
        await removeDirectory(tempDir);
      } catch (error) {
        console.error('[backup-operations] Failed to remove the restore temp directory:', error);
      }
    }
  }

  async deleteBackupInternal(backupId: string, serverPath: string): Promise<void> {
    const backupDir = BackupPathUtils.getInstanceBackupDir(serverPath);
    await fs.promises.unlink(await this.findBackupFile(backupDir, backupId));
  }

  /** The archive whose id is exactly `backupId`: `My` must never match `My (old).zip`. */
  private async findBackupFile(backupDir: string, backupId: string): Promise<string> {
    let files: string[] = [];
    try {
      files = await fs.promises.readdir(backupDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const match = files.find(file => BackupFilenameUtils.isBackupFile(file) && BackupFilenameUtils.getBackupId(file) === backupId);
    if (!match) {
      throw new Error(`Backup with ID ${backupId} not found`);
    }
    return path.join(backupDir, match);
  }

  /** Moves backups from inside the instance directory, where older versions kept them. Idempotent. */
  async migrateLegacyBackups(serverPath: string): Promise<void> {
    try {
      const legacyDir = BackupPathUtils.getLegacyInstanceBackupDir(serverPath);
      const newDir = BackupPathUtils.getInstanceBackupDir(serverPath);
      if (!fs.existsSync(legacyDir) || path.resolve(legacyDir) === path.resolve(newDir)) {
        return;
      }

      await fs.promises.mkdir(newDir, { recursive: true });
      for (const entry of await fs.promises.readdir(legacyDir)) {
        const source = path.join(legacyDir, entry);
        const destination = path.join(newDir, entry);
        try {
          const stats = await fs.promises.stat(source);
          if (!stats.isFile() || !BackupFilenameUtils.isBackupFile(entry) || fs.existsSync(destination)) {
            continue;
          }
          try {
            await fs.promises.rename(source, destination);
          } catch {
            // A rename cannot cross volumes. The copy keeps the file time, which dates a manual
            // backup: without it the copy would count as the newest backup.
            await fs.promises.copyFile(source, destination);
            await fs.promises.utimes(destination, stats.atime, stats.mtime);
            await fs.promises.unlink(source);
          }
        } catch (error) {
          console.error(`[backup-operations] Failed to migrate backup ${entry}:`, error);
        }
      }

      if ((await fs.promises.readdir(legacyDir)).length === 0) {
        await fs.promises.rmdir(legacyDir);
      }
    } catch (error) {
      console.error('[backup-operations] Failed to migrate legacy backups:', error);
    }
  }

  private async clearServerDirectory(serverPath: string): Promise<void> {
    for (const item of await fs.promises.readdir(serverPath)) {
      if (item.toLowerCase().includes('backup')) {
        continue;
      }

      const itemPath = path.join(serverPath, item);
      // lstat, never stat: an instance directory is mostly junctions into the shared install
      // (ShooterGame/Content, Engine, Win64/RedpointEOS, ShooterGame/Plugins). stat() follows a
      // junction and reports a directory, which would send the removal into the shared game files
      // of every instance on the machine.
      const stats = await fs.promises.lstat(itemPath);
      if (stats.isSymbolicLink()) {
        await this.removeLink(itemPath);
      } else if (stats.isDirectory()) {
        await removeDirectory(itemPath);
      } else {
        await fs.promises.unlink(itemPath);
      }
    }
  }

  // Windows refuses unlink() on a directory junction; rmdir() removes the link and not its target.
  private async removeLink(linkPath: string): Promise<void> {
    try {
      await fs.promises.unlink(linkPath);
    } catch {
      await fs.promises.rmdir(linkPath);
    }
  }
}