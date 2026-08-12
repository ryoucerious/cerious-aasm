// ark-server-isolation.utils.ts
// Helpers for building an instance's isolated ShooterGame folder

import * as path from 'path';
const fsExtra = require('fs-extra');

/**
 * Win64 subfolders that are generated at runtime (by the shared install or by the
 * instance itself) or that hold per-instance plugin state. Each instance must own
 * these, so they are never linked back to the shared install.
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
 * ShooterGame subfolders each instance must own: Binaries is copied per-instance for
 * ArkApi isolation, Saved holds the instance's own worlds/config/logs, Content is
 * junctioned separately, and .sentry-native is a per-process crash database.
 */
export const INSTANCE_OWNED_SHOOTERGAME_SUBDIRS = [
  'binaries',
  'saved',
  'content',
  '.sentry-native'
];

/**
 * Links the shared install's subfolders of `sourceDir` into an instance's `destDir`,
 * skipping any name in `instanceOwned` (compared case-insensitively).
 *
 * ARK resolves both the EOS SDK (Win64/RedpointEOS) and its bundled UE plugins
 * (ShooterGame/Plugins/DiscordPartnerSDK, AWSSDK, sentry) relative to the instance it
 * launches from, so an instance that only received loose binaries aborts at startup.
 * Junctions keep these read-only game folders in sync with the shared install instead
 * of duplicating them per instance.
 *
 * Returns the subfolder names that were linked (or copied as a fallback).
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

    const created = await ensureLinkedDir(
      path.join(sourceDir, entry.name),
      path.join(destDir, entry.name)
    );
    if (created) linked.push(entry.name);
  }

  return linked;
}

/**
 * Point `destDir` at `srcDir` via a junction, leaving an existing real directory or healthy
 * link alone and repairing a dangling one. Returns true when a link (or fallback copy) was
 * created, false when nothing needed doing.
 */
async function ensureLinkedDir(srcDir: string, destDir: string): Promise<boolean> {
  try {
    // lstat describes the entry itself, so an existing junction is reported even when
    // its target is gone (shared install moved or reinstalled).
    let existing: any = null;
    try {
      existing = await fsExtra.lstat(destDir);
    } catch {
      existing = null;
    }

    if (existing) {
      if (!existing.isSymbolicLink()) return false; // a real folder lives here

      let targetAlive = true;
      try {
        await fsExtra.stat(destDir);
      } catch {
        targetAlive = false;
      }
      if (targetAlive) return false;

      await fsExtra.unlink(destDir); // dangling link, recreate below
    }

    await fsExtra.ensureSymlink(srcDir, destDir, 'junction');
    return true;
  } catch (error) {
    // Junctions can fail on some filesystems (network shares, restrictive policies).
    // Fall back to a real copy so the server can still start.
    try {
      await fsExtra.copy(srcDir, destDir, { overwrite: false, errorOnExist: false });
      return true;
    } catch (copyError) {
      console.error(`[ark-server-isolation] Failed to provide "${path.basename(destDir)}":`, copyError);
      return false;
    }
  }
}

/**
 * Point the instance's runtime save directory at its canonical SavedArks folder.
 *
 * An isolated instance runs out of its own tree, so ARK resolves ?AltSaveDirectoryName=SavedArks
 * to <instance>/ShooterGame/Saved/SavedArks. Backups, restore and import all address the
 * instance's saves at <instance>/SavedArks, so the runtime path is junctioned onto it rather
 * than moving worlds to a second location. Backups skip the junction and archive the real
 * folder exactly as before.
 *
 * No-op for instances that run from the shared install — their AltSaveDirectoryName already
 * lands inside the instance folder.
 */
export async function linkInstanceSaveDir(instanceDir: string, runtimeRoot: string): Promise<boolean> {
  if (path.resolve(runtimeRoot) !== path.resolve(instanceDir)) return false;

  const canonicalSaveDir = path.join(instanceDir, 'SavedArks');
  const runtimeSaveDir = path.join(runtimeRoot, 'ShooterGame', 'Saved', 'SavedArks');

  await fsExtra.ensureDir(canonicalSaveDir);
  await fsExtra.ensureDir(path.dirname(runtimeSaveDir));
  return ensureLinkedDir(canonicalSaveDir, runtimeSaveDir);
}

/**
 * Links the game's own Win64 subfolders (RedpointEOS, BattlEye, D3D12, DML, ...) into an
 * instance's isolated Win64 folder. Without RedpointEOS next to the exe the server aborts
 * with "The EOS SDK could not be found. Please reinstall the application."
 */
export async function linkSharedWin64Subdirs(sourceWin64: string, destWin64: string): Promise<string[]> {
  return linkSharedSubdirs(sourceWin64, destWin64, INSTANCE_OWNED_WIN64_SUBDIRS);
}

/**
 * Links the game's bundled UE plugin folders (ShooterGame/Plugins and any future siblings)
 * into an instance. Without them the server aborts with "Failed to load Discord Partner SDK
 * third party library".
 */
export async function linkSharedShooterGameSubdirs(sourceShooterGame: string, destShooterGame: string): Promise<string[]> {
  return linkSharedSubdirs(sourceShooterGame, destShooterGame, INSTANCE_OWNED_SHOOTERGAME_SUBDIRS);
}
