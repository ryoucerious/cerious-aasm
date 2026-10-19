import * as fs from 'fs';
import * as path from 'path';
import { getDefaultInstallDir } from './platform.utils';

const RELATIVE_PART = /^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,49}$/;
const RESERVED_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
const MAX_LENGTH = 1024;

/**
 * A full path to any folder: a drive (`D:\Backups`), a UNC share (`\\nas\backups`), or a POSIX
 * absolute path. `\tmp` and `C:relative` are not, and stay rejected.
 */
export function isAbsoluteBackupLocation(value: string): boolean {
  if (!value) return false;
  if (process.platform === 'win32') {
    const unified = value.replace(/\//g, '\\');
    return /^[a-zA-Z]:\\/.test(unified) || /^\\\\[^\\]+\\[^\\]+/.test(unified);
  }
  return value.startsWith('/');
}

/** A relative folder inside the app backup area, or an absolute path to any folder. Empty keeps the default. */
export function validateBackupLocation(value: unknown): string {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string') throw new Error('Invalid backup location');
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length > MAX_LENGTH || trimmed.includes('\0')) throw new Error('Invalid backup location');
  if (isAbsoluteBackupLocation(trimmed)) return normalizeAbsolute(trimmed);
  return normalizeRelative(trimmed);
}

function normalizeRelative(value: string): string {
  const parts = value.split('/');
  if (parts.some(part => !RELATIVE_PART.test(part) || part.endsWith(' ') || RESERVED_NAME.test(part))) {
    throw new Error('Backup location must be an absolute path, or relative folders with letters, numbers, spaces, hyphens or underscores (separated by /).');
  }
  return value;
}

function normalizeAbsolute(value: string): string {
  const segments = value.split(/[\\/]/).filter(Boolean);
  const named = process.platform === 'win32' && /^[a-zA-Z]:$/.test(segments[0]) ? segments.slice(1) : segments;
  if (named.some(part => part === '.' || part === '..' || part.endsWith(' ') || part.endsWith('.')
    || RESERVED_NAME.test(part) || part.includes(':'))) {
    throw new Error('Backup location must be a real absolute path without shortcuts or reserved names.');
  }
  return path.resolve(value);
}

/** Rechecked on every resolution, including reads. Relative locations stay inside the app backup area. */
export function checkedBackupDirectory(instanceId?: string, location: unknown = ''): string {
  const chosen = validateBackupLocation(location);
  if (instanceId !== undefined && !/^[a-zA-Z0-9_-]+$/.test(instanceId)) {
    throw new Error('Invalid backup instance ID');
  }
  if (isAbsoluteBackupLocation(chosen)) {
    const directory = instanceId ? path.join(chosen, instanceId) : chosen;
    assertRealDirectory(directory);
    return directory;
  }
  let directory = getDefaultInstallDir();
  const parts = ['backups', ...(instanceId ? [instanceId] : []), ...chosen.split('/').filter(Boolean)];
  for (const part of parts) {
    directory = path.join(directory, part);
    assertRealEntry(directory);
  }
  return directory;
}

/** Backup copies take an absolute path only. Empty is refused here; the caller keeps the default. */
export function checkedBackupCopiesDirectory(location: unknown): string {
  const chosen = validateBackupLocation(location);
  if (!isAbsoluteBackupLocation(chosen)) {
    throw new Error('Backup copies location must be an absolute path.');
  }
  assertRealDirectory(chosen);
  return chosen;
}

function assertRealDirectory(directory: string): void {
  const root = path.parse(directory).root;
  let current = root;
  const rest = path.relative(root, directory);
  for (const part of rest ? rest.split(path.sep) : []) {
    current = path.join(current, part);
    assertRealEntry(current);
  }
}

/** A missing folder can be created. A link cannot: it would send backups somewhere else later. */
function assertRealEntry(directory: string): void {
  try {
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('Backup location must contain only real directories');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/** Validate on the host, create the destination and verify its OS permissions before saving. */
export function prepareBackupDirectory(instanceId?: string, location: unknown = ''): string {
  const directory = checkedBackupDirectory(instanceId, location);
  fs.mkdirSync(directory, { recursive: true });
  checkedBackupDirectory(instanceId, location);
  fs.accessSync(directory, fs.constants.W_OK | fs.constants.R_OK);
  return directory;
}

/** Create an absolute backup-copies directory and verify it can be read and written. */
export function prepareBackupCopiesDirectory(location: unknown): string {
  const directory = checkedBackupCopiesDirectory(location);
  fs.mkdirSync(directory, { recursive: true });
  checkedBackupCopiesDirectory(location);
  fs.accessSync(directory, fs.constants.W_OK | fs.constants.R_OK);
  return directory;
}
