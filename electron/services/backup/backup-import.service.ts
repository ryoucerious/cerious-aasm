import AdmZip from 'adm-zip';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { InstanceConfig } from '../../types/server-instance.types';
import * as instanceUtils from '../../utils/ark/instance.utils';
import { removeDirectory } from '../../utils/fs.utils';

const CONFIG_ENTRY = 'config.json';
// Zip bomb limits, checked against the archive's headers before anything is written.
const MAX_ENTRIES = 10000;
const MAX_DECOMPRESSED_BYTES = 50 * 1024 * 1024 * 1024;

const DEFAULT_SETTINGS: Partial<InstanceConfig> = {
  mapName: 'TheIsland_WP',
  gamePort: 7777,
  rconPort: 27020,
  maxPlayers: 70,
  serverPassword: '',
  serverAdminPassword: '',
  crossplay: ['Steam (PC)'],
  xpMultiplier: 1.0,
  installed: false,
  currentVersion: null,
  autoUpdateEnabled: true
};

export class BackupImportService {
  /**
   * Creates a new server from a backup archive, with a new id and the name `serverName`; the
   * archive's config.json supplies its settings. Throws on any failure and leaves nothing behind.
   */
  async importBackupAsNewServer(serverName: string, backupFilePath: string): Promise<InstanceConfig> {
    if (!fs.existsSync(backupFilePath)) {
      throw new Error(`Backup file not found: ${backupFilePath}`);
    }

    const zip = new AdmZip(backupFilePath);
    checkEntries(zip);
    const settings = readArchivedSettings(zip);
    // Only config.json makes a directory list as a server, and the archived one still names the
    // server the backup was taken from: it is never extracted, the new one is written instead.
    zip.deleteFile(CONFIG_ENTRY);

    // crypto.randomUUID, not the uuid package: that is ESM-only and fails to load from app.asar.
    const id = randomUUID();
    const instanceDir = instanceUtils.getInstanceDir(id);
    await fs.promises.mkdir(instanceDir, { recursive: true });
    try {
      zip.extractAllTo(instanceDir, true);
      const saved = await instanceUtils.saveInstance({ ...settings, id, name: serverName, sessionName: serverName });
      if (saved.error !== undefined) {
        throw new Error(saved.error);
      }
      return saved;
    } catch (error) {
      try {
        await removeDirectory(instanceDir);
      } catch (cleanupError) {
        console.error('[backup-import] Failed to remove the half-imported server:', cleanupError);
      }
      throw error;
    }
  }
}

function checkEntries(zip: AdmZip): void {
  const entries = zip.getEntries();
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`Backup archive contains too many entries (${entries.length}). Maximum allowed: ${MAX_ENTRIES}`);
  }

  let totalBytes = 0;
  for (const entry of entries) {
    totalBytes += entry.header.size;
    if (totalBytes > MAX_DECOMPRESSED_BYTES) {
      throw new Error('Backup archive decompressed size exceeds the 50 GB limit');
    }
    const entryName = entry.entryName.replace(/\\/g, '/');
    if (entryName.includes('..') || path.isAbsolute(entryName)) {
      throw new Error(`Unsafe entry detected in backup archive: ${entry.entryName}`);
    }
  }
}

// Not validated, like any hand-edited config; saveInstance drops the runtime fields.
function readArchivedSettings(zip: AdmZip): Partial<InstanceConfig> {
  const entry = zip.getEntry(CONFIG_ENTRY);
  if (!entry) {
    console.warn('[backup-import] The backup has no config.json; using default settings');
    return DEFAULT_SETTINGS;
  }
  try {
    const text = entry.getData().toString('utf8');
    // Notepad and PowerShell 5 save UTF-8 with a byte order mark, which JSON.parse rejects.
    const parsed: unknown = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Partial<InstanceConfig>;
    }
  } catch {
    // The parser's message quotes the file, which holds passwords.
  }
  console.warn('[backup-import] The backup\'s config.json is not valid; using default settings');
  return DEFAULT_SETTINGS;
}