import * as fs from 'fs';
import * as path from 'path';
import { getDefaultInstallDir } from './platform.utils';

/** Portable relative folders only. No drive names, ADS, UNC, traversal or Windows aliases. */
export function validateBackupLocation(value: unknown): string {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.length > 160) throw new Error('Invalid backup location');
  const parts = value.split('/');
  if (parts.some(part => !/^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,49}$/.test(part)
    || part.endsWith(' ') || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(part))) {
    throw new Error('Backup location must use relative folders with letters, numbers, spaces, hyphens or underscores (separated by /).');
  }
  return value;
}

/** Rechecked on every resolution, including reads. The app data directory is the trusted anchor. */
export function checkedBackupDirectory(instanceId?: string, location: unknown = ''): string {
  const relative = validateBackupLocation(location);
  if (instanceId !== undefined && (!/^[a-zA-Z0-9_-]+$/.test(instanceId))) {
    throw new Error('Invalid backup instance ID');
  }
  let directory = getDefaultInstallDir();
  const parts = ['backups', ...(instanceId ? [instanceId] : []), ...relative.split('/').filter(Boolean)];
  for (const part of parts) {
    directory = path.join(directory, part);
    try {
      const stat = fs.lstatSync(directory);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error('Backup location must contain only real directories inside the app backup area');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return directory;
}

/** Validate on the host, create the destination and verify its OS permissions before saving. */
export function prepareBackupDirectory(instanceId?: string, location: unknown = ''): string {
  const directory = checkedBackupDirectory(instanceId, location);
  fs.mkdirSync(directory, { recursive: true });
  checkedBackupDirectory(instanceId, location);
  fs.accessSync(directory, fs.constants.W_OK | fs.constants.R_OK);
  return directory;
}
