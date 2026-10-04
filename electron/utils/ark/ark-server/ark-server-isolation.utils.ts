import type { Stats } from 'fs';
import * as path from 'path';
import * as fsExtra from 'fs-extra';
import { getInstanceSaveDir } from '../instance.utils';

/**
 * Win64 subfolders generated at runtime (by the shared install or the instance) or holding
 * per-instance plugin state. Each instance owns these; they are never linked to the shared install.
 */
export const INSTANCE_OWNED_WIN64_SUBDIRS = [
  'arkapi',
  'plugins',
  'shootergame',
  'saved',
  'config',
  'logs',
  'appcache'
];

/**
 * ShooterGame subfolders each instance owns: Binaries is copied per instance for ArkApi isolation,
 * Saved holds its own worlds, config and logs, Content is junctioned separately, and
 * .sentry-native is a per-process crash database.
 */
export const INSTANCE_OWNED_SHOOTERGAME_SUBDIRS = [
  'binaries',
  'saved',
  'content',
  '.sentry-native'
];

/**
 * Loose Win64 files each instance writes for itself. The per-instance binary copy must never carry
 * them over from the shared install: a whitelist written there by a server that runs the shared
 * executable would otherwise land in every isolated instance's folder.
 */
export const INSTANCE_OWNED_WIN64_FILES = [
  'playersjoinnochecklist.txt',
  'playersexclusivejoinlist.txt'
];

export function isInstanceOwnedWin64File(fileName: string): boolean {
  return INSTANCE_OWNED_WIN64_FILES.includes(fileName.toLowerCase());
}

/**
 * Links the shared install's subfolders of `sourceDir` into an instance's `destDir`, skipping any
 * name in `instanceOwned` (case-insensitive). Returns the names linked (or copied).
 *
 * ARK resolves the EOS SDK (Win64/RedpointEOS) and its bundled UE plugins
 * (ShooterGame/Plugins/DiscordPartnerSDK, AWSSDK, sentry) relative to the instance it launches
 * from, so an instance with only loose binaries aborts at startup. Junctions keep these read-only
 * game folders in sync with the shared install instead of duplicating them.
 */
export async function linkSharedSubdirs(
  sourceDir: string,
  destDir: string,
  instanceOwned: string[]
): Promise<string[]> {
  if (!(await fsExtra.pathExists(sourceDir))) return [];
  await fsExtra.ensureDir(destDir);

  const entries = await fsExtra.readdir(sourceDir, { withFileTypes: true });
  const linked: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (instanceOwned.includes(entry.name.toLowerCase())) continue;

    const srcDir = path.join(sourceDir, entry.name);
    const linkDir = path.join(destDir, entry.name);
    try {
      if (await ensureLinkedDir(srcDir, linkDir)) linked.push(entry.name);
    } catch {
      // Junctions fail on some filesystems (network shares, restrictive policies). These folders
      // are read-only game data, so a copy still lets the server start.
      try {
        await fsExtra.copy(srcDir, linkDir, { overwrite: false, errorOnExist: false });
        linked.push(entry.name);
      } catch (copyError) {
        console.error(`[ark-server-isolation] Failed to provide "${entry.name}":`, copyError);
      }
    }
  }

  return linked;
}

/** lstat, or null when nothing is there. lstat reports a junction even when its target is gone. */
async function lstatOrNull(target: string): Promise<Stats | null> {
  try {
    return await fsExtra.lstat(target);
  } catch {
    return null;
  }
}

// stat follows the link. access() succeeds on a dangling junction on Windows.
async function targetExists(link: string): Promise<boolean> {
  try {
    await fsExtra.stat(link);
    return true;
  } catch {
    return false;
  }
}

/**
 * Points `destDir` at `srcDir` with a junction, leaving a real folder or a healthy link alone and
 * repairing a dangling one. Returns true when a link was created. Throws when it cannot be.
 */
async function ensureLinkedDir(srcDir: string, destDir: string): Promise<boolean> {
  const existing = await lstatOrNull(destDir);
  if (existing) {
    if (!existing.isSymbolicLink()) return false;
    if (await targetExists(destDir)) return false;
    // Dangling: the shared install was moved or reinstalled.
    await fsExtra.unlink(destDir);
  }
  await fsExtra.ensureSymlink(srcDir, destDir, 'junction');
  return true;
}

/**
 * Points an isolated instance's runtime save folder at its canonical SavedArks. ARK resolves
 * ?AltSaveDirectoryName=SavedArks to <instance>/ShooterGame/Saved/SavedArks, while backups, restore
 * and import use <instance>/SavedArks, so the runtime path is junctioned onto it rather than
 * keeping worlds in two places. Backups skip the junction and archive the real folder.
 *
 * Returns false when there is nothing to do (a shared-install instance's save path already lands
 * in its folder). Throws when the link cannot be made: a copy would take the writes while backups
 * went on reading the canonical folder.
 */
export async function linkInstanceSaveDir(instanceDir: string, runtimeRoot: string): Promise<boolean> {
  if (path.resolve(runtimeRoot) !== path.resolve(instanceDir)) return false;

  const canonicalSaveDir = getInstanceSaveDir(instanceDir);
  const runtimeSaveDir = path.join(runtimeRoot, 'ShooterGame', 'Saved', 'SavedArks');
  await fsExtra.ensureDir(canonicalSaveDir);
  await fsExtra.ensureDir(path.dirname(runtimeSaveDir));

  const existing = await lstatOrNull(runtimeSaveDir);
  if (existing && !existing.isSymbolicLink()) {
    if ((await fsExtra.readdir(runtimeSaveDir)).length > 0) {
      console.warn(
        `[ark-server-isolation] ${runtimeSaveDir} is a real folder with files in it, so ARK saves there ` +
        `while backups read ${canonicalSaveDir}. Move its contents into ${canonicalSaveDir} and delete it.`
      );
      return false;
    }
    await fsExtra.remove(runtimeSaveDir);
  }

  try {
    return await ensureLinkedDir(canonicalSaveDir, runtimeSaveDir);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not link ${runtimeSaveDir} to ${canonicalSaveDir} (${reason}). The server was not started, ` +
      'because its saves would miss every backup. Keep the server data on a drive that supports junctions or symlinks.'
    );
  }
}

/**
 * Links the game's own Win64 subfolders (RedpointEOS, BattlEye, D3D12, DML, ...). Without
 * RedpointEOS next to the exe the server aborts with "The EOS SDK could not be found. Please
 * reinstall the application."
 */
export async function linkSharedWin64Subdirs(sourceWin64: string, destWin64: string): Promise<string[]> {
  return linkSharedSubdirs(sourceWin64, destWin64, INSTANCE_OWNED_WIN64_SUBDIRS);
}

/**
 * Links the game's bundled UE plugin folders (ShooterGame/Plugins and any future siblings).
 * Without them the server aborts with "Failed to load Discord Partner SDK third party library".
 */
export async function linkSharedShooterGameSubdirs(sourceShooterGame: string, destShooterGame: string): Promise<string[]> {
  return linkSharedSubdirs(sourceShooterGame, destShooterGame, INSTANCE_OWNED_SHOOTERGAME_SUBDIRS);
}
