import AdmZip from 'adm-zip';
import * as fs from 'fs';
import * as path from 'path';
import { BackupMetadata } from '../../types/backup.types';
import { BackupFilenameUtils, BackupPathUtils } from '../../utils/backup.utils';
import { copyDirectory, moveFile, removeDirectory } from '../../utils/fs.utils';

// Names the backup list never shows: an archive being written, and a restore's extraction.
const ARCHIVE_TEMP_SUFFIX = '.zip.tmp';
const RESTORE_TEMP_PREFIX = '.restore-';

// ARK's own timestamped world copies, `<Map>_DD.MM.YYYY_HH.MM.SS.ark`, next to the live `<Map>.ark`.
// A long-lived map keeps gigabytes of them, and the server rotates them while it runs.
const DATED_WORLD = /^(.+)_\d{2}\.\d{2}\.\d{4}_\d{2}\.\d{2}\.\d{2}\.ark$/i;

export interface BackupContentOptions {
  /** Every dated world copy as well. Off, a backup holds one world per map: the live one, or the newest copy. */
  allWorldSaves?: boolean;
}

export class BackupOperationsService {
  async createBackupInternal(
    instanceId: string,
    serverPath: string,
    type: 'manual' | 'scheduled',
    customName?: string,
    options: BackupContentOptions = {}
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
      await this.addToZip(zip, serverPath, '', options);
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
  private async addToZip(zip: AdmZip, sourcePath: string, relativePath: string, options: BackupContentOptions = {}): Promise<void> {
    let items: string[];
    try {
      items = await fs.promises.readdir(sourcePath);
    } catch (error) {
      // The server removed a directory between listing its parent and reading it. The instance
      // root itself missing is a real failure.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && relativePath) {
        console.warn(`[backup-operations] Skipping ${sourcePath}: it disappeared while the server was running`);
        return;
      }
      throw error;
    }

    // The exe and DLLs directly in Win64 (~200 MB) are copied from the shared install on every
    // start. Its subfolders, ArkApi with the user's plugins among them, are kept.
    const isWin64Dir = /[/\\]ShooterGame[/\\]Binaries[/\\]Win64$/i.test(sourcePath);
    const worldCopies = options.allWorldSaves ? new Map<string, string[]>() : this.datedWorldsByMap(items);
    const worldsAdded = new Set<string>();

    for (const item of items) {
      const itemPath = path.join(sourcePath, item);
      const itemRelativePath = relativePath ? path.join(relativePath, item) : item;
      // SaveWorld writes a timestamped .arkrbf and deletes it when the save lands. Listing it and
      // then finding it gone is why a backup of a running server failed with ENOENT on lstat.
      if (/\.arkrbf$/i.test(item)) continue;
      if (worldCopies.size > 0) {
        if (DATED_WORLD.test(item) || /\.ark\.bak$/i.test(item)) continue;
        const map = /^(.+)\.ark$/i.exec(item)?.[1];
        const copies = map === undefined ? undefined : worldCopies.get(map);
        if (map !== undefined && copies) {
          worldsAdded.add(map);
          await this.addWorld(zip, sourcePath, relativePath, map, copies);
          continue;
        }
      }
      const stats = await this.lstatOrGone(itemPath);
      if (!stats) continue;

      if (item.toLowerCase().includes('backup') || stats.isSymbolicLink()
        || /^(logs|crashreports)$/i.test(item) || /\.(log|pid|lock)$/i.test(item)) {
        continue;
      }

      if (stats.isDirectory()) {
        // ARK logs grow to several GB and AdmZip reads every file fully into memory, which can fail
        // the whole backup. A restore has no use for them.
        if (this.isInstanceLogsDir(itemPath)) {
          continue;
        }
        await this.addToZip(zip, itemPath, itemRelativePath, options);
      } else if (stats.isFile() && !isWin64Dir) {
        const contents = await this.readSnapshotFile(itemPath);
        if (contents) zip.addFile(itemRelativePath, contents);
      }
    }

    // Maps with dated copies but no live world listed.
    for (const [map, copies] of worldCopies) {
      if (!worldsAdded.has(map)) await this.addWorld(zip, sourcePath, relativePath, map, copies);
    }
  }

  /** The dated world copies in a listing, by the map they belong to. */
  private datedWorldsByMap(items: string[]): Map<string, string[]> {
    const byMap = new Map<string, string[]>();
    for (const item of items) {
      const map = DATED_WORLD.exec(item)?.[1];
      if (map !== undefined) byMap.set(map, [...(byMap.get(map) ?? []), item]);
    }
    return byMap;
  }

  /**
   * One world for the map, always stored as `<map>.ark` so a restore needs no renaming: the live
   * world when it reads back unchanged, else the newest dated copy that can still be read. A live
   * world that changes during the read may be half written, and a restore from it can fail to load.
   */
  private async addWorld(zip: AdmZip, dir: string, relativeDir: string, map: string, copies: string[]): Promise<void> {
    const entryName = relativeDir ? path.join(relativeDir, `${map}.ark`) : `${map}.ark`;
    const live = await this.readUnchanged(path.join(dir, `${map}.ark`));
    if (live) {
      zip.addFile(entryName, live);
      return;
    }

    const dated: Array<{ name: string; modifiedAt: number }> = [];
    for (const name of copies) {
      const stats = await this.retryMissing(path.join(dir, name), target => fs.promises.lstat(target));
      if (stats?.isFile()) dated.push({ name, modifiedAt: stats.mtimeMs });
    }
    dated.sort((a, b) => b.modifiedAt - a.modifiedAt);
    for (const { name } of dated) {
      const contents = await this.readSnapshotFile(path.join(dir, name));
      if (!contents) continue;
      console.warn(`[backup-operations] Backing up ${name} as ${map}.ark: the live world was missing or being written`);
      zip.addFile(entryName, contents);
      return;
    }

    const error = new Error(`ENOENT: no readable copy of the world ${map} in '${dir}'`) as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    throw error;
  }

  /** The file's contents, or null when it is missing or its size or time changed while it was read. */
  private async readUnchanged(filePath: string): Promise<Buffer | null> {
    const before = await this.retryMissing(filePath, target => fs.promises.lstat(target));
    if (!before?.isFile()) return null;
    let contents: Buffer | null;
    try {
      contents = await this.readSnapshotFile(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    if (!contents) return null;
    const after = await this.retryMissing(filePath, target => fs.promises.lstat(target));
    if (!after || after.mtimeMs !== before.mtimeMs || after.size !== before.size || contents.length !== before.size) {
      return null;
    }
    return contents;
  }

  /**
   * lstat, or null when a file the server created and then deleted is gone. A world, profile,
   * tribe or config that disappears is still a failed backup: those are the files a restore needs.
   */
  private async lstatOrGone(itemPath: string): Promise<fs.Stats | null> {
    const stats = await this.retryMissing(itemPath, target => fs.promises.lstat(target));
    if (stats) return stats;
    if (this.isPersistentData(itemPath)) {
      const error = new Error(`ENOENT: no such file or directory, lstat '${itemPath}'`) as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      throw error;
    }
    console.warn(`[backup-operations] Skipping ${itemPath}: it disappeared while the server was running`);
    return null;
  }

  /**
   * World, player, tribe and config files. A backup that omits one of these is not a backup. A dated
   * world copy is not: the server deletes old ones as it saves.
   */
  private isPersistentData(filePath: string): boolean {
    return /\.(ark|arkprofile|arktribe|arktributetribe|json|ini)$/i.test(filePath) && !DATED_WORLD.test(path.basename(filePath));
  }

  /** One short wait, for a file SaveWorld replaces. Anything still missing stays missing. */
  private async retryMissing<T>(filePath: string, read: (filePath: string) => Promise<T>): Promise<T | null> {
    try {
      return await read(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
    try {
      return await read(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return null;
    }
  }

  /** SaveWorld can briefly lock a world file on Windows. Never silently omit persistent data. */
  private async readSnapshotFile(filePath: string): Promise<Buffer | null> {
    for (let attempt = 0; ; attempt++) {
      try { return await fs.promises.readFile(filePath); }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          const recovered = await this.retryMissing(filePath, target => fs.promises.readFile(target));
          if (recovered) return recovered;
          if (!this.isPersistentData(filePath)) {
            console.warn(`[backup-operations] Skipping ${filePath}: it disappeared while the server was running`);
            return null;
          }
          throw error;
        }
        if (attempt >= 4 || !['EBUSY', 'EPERM', 'EACCES'].includes(code || '')) throw error;
        await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt));
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
    const instanceId = path.basename(serverPath);

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
        const stats = await fs.promises.lstat(filePath);
        if (!stats.isFile() || stats.isSymbolicLink()) continue;
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
    const settingsPath = BackupPathUtils.getSettingsFilePath(serverPath);
    const preservedSettings = fs.existsSync(settingsPath) ? await fs.promises.readFile(settingsPath) : null;
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
        if (preservedSettings) await fs.promises.writeFile(settingsPath, preservedSettings);
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
    const filePath = path.join(backupDir, match);
    const stat = await fs.promises.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Backup must be a regular file');
    return filePath;
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
