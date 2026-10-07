import * as fs from 'fs';
import * as path from 'path';

/**
 * The copy of the ARK install an update downloads into while the servers keep running.
 *
 * SteamCMD cannot replace files a running server holds open, so the update goes into a copy of the
 * game files beside the install. Once the new build is there and the servers have stopped, the
 * files it changed are moved into the install. Only the game files are copied: everything under
 * ShooterGame/Saved (every server's folder, the managed clusters, the shared config) stays where
 * it is and is never touched.
 */

/** Size and modified time of each game file, by its path from the install's root with '/' separators. */
export type GameFiles = Map<string, { size: number; mtimeMs: number }>;

/** What an update changed: files added or rewritten, and files it took away. */
export interface GameFileChanges {
  changed: string[];
  removed: string[];
}

/** Server data, and SteamCMD's own work folders: never part of the copy. Compared lower-case. */
const LEFT_OUT = ['shootergame/saved', 'steamapps/downloading', 'steamapps/temp'];
/** Room for SteamCMD to work in on top of the copy itself. */
const ROOM_MARGIN = 1.1;
/** The install reports its build from this, so it is put in place last. */
const MANIFEST = /^steamapps\/appmanifest_\d+\.acf$/i;

function leftOut(relative: string): boolean {
  const lower = relative.toLowerCase();
  return LEFT_OUT.some(prefix => lower === prefix || lower.startsWith(`${prefix}/`));
}

/** A sibling of the install, so the copy is on the same volume and its files can be moved in. */
export function stagingDirFor(installDir: string): string {
  return `${path.resolve(installDir)}-update`;
}

/**
 * The game files under `root`. Links are not followed, as they point at something that is not the
 * game: readdir reports a link as a link, never as the folder or file it points at.
 */
export async function listGameFiles(root: string): Promise<GameFiles> {
  const files: GameFiles = new Map();
  const walk = async (relative: string): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(path.join(root, ...relative.split('/').filter(Boolean)), { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (leftOut(child)) continue;
      if (entry.isDirectory()) {
        await walk(child);
      } else if (entry.isFile()) {
        const stat = await fs.promises.stat(path.join(root, ...child.split('/')));
        files.set(child, { size: stat.size, mtimeMs: stat.mtimeMs });
      }
    }
  };
  await walk('');
  return files;
}

/** Free bytes on the volume holding `dir`; null where that cannot be read. */
export function freeBytes(dir: string): number | null {
  try {
    const statfs = (fs as unknown as { statfsSync?(target: string): { bavail: number; bsize: number } }).statfsSync;
    if (!statfs) return null;
    const stats = statfs(dir);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
}

/** Whether `free` bytes hold a copy of these game files with room to spare. Unknown free space goes ahead. */
export function roomForStaging(files: GameFiles, free: number | null): { enough: boolean; needed: number; free: number | null } {
  const size = [...files.values()].reduce((sum, file) => sum + file.size, 0);
  const needed = Math.ceil(size * ROOM_MARGIN);
  return { enough: free === null || free >= needed, needed, free };
}

/**
 * Copies the install's game files to `stagingDir`, keeping their modified times, after removing
 * anything left there by an earlier update. A file that cannot be read (held open) is left out:
 * SteamCMD's validate fetches it. Returns the files left out.
 */
export async function seedStaging(installDir: string, stagingDir: string, onProgress?: (percent: number) => void): Promise<string[]> {
  await removeStaging(stagingDir);
  const files = await listGameFiles(installDir);
  const total = [...files.values()].reduce((sum, file) => sum + file.size, 0) || 1;
  const skipped: string[] = [];
  let copied = 0;
  let reported = -1;
  for (const [relative, file] of files) {
    const from = path.join(installDir, ...relative.split('/'));
    const to = path.join(stagingDir, ...relative.split('/'));
    try {
      await fs.promises.mkdir(path.dirname(to), { recursive: true });
      await fs.promises.copyFile(from, to);
      const mtime = new Date(file.mtimeMs);
      await fs.promises.utimes(to, mtime, mtime);
    } catch (error) {
      skipped.push(relative);
      console.warn(`[ark-update-staging] Could not copy ${relative}; SteamCMD will fetch it:`, (error as Error).message);
    }
    copied += file.size;
    const percent = Math.floor((copied / total) * 100);
    if (percent !== reported) {
      reported = percent;
      onProgress?.(percent);
    }
  }
  if (reported !== 100) onProgress?.(100);
  return skipped;
}

/** Files that are new or whose size or modified time differs, and files no longer there. */
export function changesBetween(before: GameFiles, after: GameFiles): GameFileChanges {
  const changed = [...after].filter(([relative, file]) => {
    const old = before.get(relative);
    return !old || old.size !== file.size || old.mtimeMs !== file.mtimeMs;
  }).map(([relative]) => relative);
  const removed = [...before.keys()].filter(relative => !after.has(relative));
  return { changed, removed };
}

/** The file in `root` a game file's path names; throws for anything that is not a game file. */
function gameFilePath(root: string, relative: string): string {
  const resolved = path.resolve(root, ...relative.split('/'));
  const inside = path.relative(path.resolve(root), resolved).split(path.sep).join('/');
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside) || leftOut(inside)) {
    throw new Error(`Refusing to touch ${relative}: it is outside the game files.`);
  }
  return resolved;
}

/**
 * Moves the files an update changed from `stagingDir` into `installDir` (a copy where a move
 * fails), then deletes the files it took away. The Steam manifest goes last, so the install
 * reports the new build only once every other file is in. Run with the servers stopped.
 */
export async function putInPlace(stagingDir: string, installDir: string, changes: GameFileChanges): Promise<void> {
  // Every path is checked before anything is touched.
  const moves = changes.changed.map(relative => ({
    relative, from: gameFilePath(stagingDir, relative), to: gameFilePath(installDir, relative)
  }));
  const deletions = changes.removed.map(relative => gameFilePath(installDir, relative));
  moves.sort((a, b) => Number(MANIFEST.test(a.relative)) - Number(MANIFEST.test(b.relative)));

  for (const deletion of deletions) {
    await fs.promises.rm(deletion, { force: true });
  }
  for (const move of moves) {
    await fs.promises.mkdir(path.dirname(move.to), { recursive: true });
    try {
      await fs.promises.rename(move.from, move.to);
    } catch {
      await fs.promises.copyFile(move.from, move.to);
      const stat = await fs.promises.stat(move.from);
      await fs.promises.utimes(move.to, stat.atime, stat.mtime);
    }
  }
}

export async function removeStaging(stagingDir: string): Promise<void> {
  await fs.promises.rm(stagingDir, { recursive: true, force: true });
}
