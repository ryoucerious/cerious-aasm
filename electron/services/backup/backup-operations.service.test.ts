// test/setup.ts mocks fs and path; these tests write real archives into a temp directory.
jest.unmock('fs');
jest.unmock('path');

import AdmZip from 'adm-zip';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as fsUtils from '../../utils/fs.utils';
import { BackupCleanupService } from './backup-cleanup.service';
import { BackupOperationsService } from './backup-operations.service';

jest.mock('../../utils/platform.utils', () => ({ getDefaultInstallDir: jest.fn() }));
jest.mock('adm-zip', () => {
  const RealAdmZip = jest.requireActual('adm-zip');
  return jest.fn((...args: unknown[]) => new RealAdmZip(...args));
});

const { getDefaultInstallDir } = jest.requireMock('../../utils/platform.utils') as { getDefaultInstallDir: jest.Mock };
const AdmZipMock = jest.requireMock('adm-zip') as jest.Mock;

describe('BackupOperationsService (real fs)', () => {
  const service = new BackupOperationsService();
  let root: string;
  let serverPath: string;
  let backupDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-backup-ops-test-'));
    getDefaultInstallDir.mockReturnValue(path.join(root, 'install'));
    serverPath = path.join(root, 'Servers', 'a1');
    backupDir = path.join(root, 'install', 'backups', 'a1');
    fs.mkdirSync(path.join(serverPath, 'SavedArks', 'TheIsland_WP'), { recursive: true });
    fs.writeFileSync(path.join(serverPath, 'config.json'), '{"id":"a1","name":"Alpha"}');
    fs.writeFileSync(path.join(serverPath, 'SavedArks', 'TheIsland_WP', 'TheIsland_WP.ark'), 'world v1');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function backupFiles(): string[] {
    return fs.existsSync(backupDir) ? fs.readdirSync(backupDir).sort() : [];
  }

  function world(): string {
    return fs.readFileSync(path.join(serverPath, 'SavedArks', 'TheIsland_WP', 'TheIsland_WP.ark'), 'utf8');
  }

  function archive(name: string, files: Record<string, string>, modifiedAt?: Date): void {
    const zip = new AdmZip();
    for (const [entry, content] of Object.entries(files)) {
      zip.addFile(entry, Buffer.from(content));
    }
    fs.mkdirSync(backupDir, { recursive: true });
    const filePath = path.join(backupDir, name);
    zip.writeZip(filePath);
    if (modifiedAt) fs.utimesSync(filePath, modifiedAt, modifiedAt);
  }

  describe('createBackupInternal', () => {
    it('archives the instance and describes the new backup', async () => {
      const metadata = await service.createBackupInternal('a1', serverPath, 'manual', 'Before update');

      expect(backupFiles()).toEqual(['Before update.zip']);
      expect(metadata).toMatchObject({ id: 'Before update', instanceId: 'a1', name: 'Before update', type: 'manual' });
      expect(metadata.size).toBe(fs.statSync(path.join(backupDir, 'Before update.zip')).size);
      const entries = new AdmZip(path.join(backupDir, 'Before update.zip')).getEntries().map(entry => entry.entryName.replace(/\\/g, '/'));
      expect(entries.sort()).toEqual(['SavedArks/TheIsland_WP/TheIsland_WP.ark', 'config.json']);
    });

    // The second backup used to replace the first without a word.
    it('keeps an earlier manual backup of the same name', async () => {
      await service.createBackupInternal('a1', serverPath, 'manual', 'Before update');
      fs.writeFileSync(path.join(serverPath, 'SavedArks', 'TheIsland_WP', 'TheIsland_WP.ark'), 'world v2');

      const second = await service.createBackupInternal('a1', serverPath, 'manual', 'Before update');

      expect(backupFiles()).toEqual(['Before update (2).zip', 'Before update.zip']);
      expect(second.id).toBe('Before update (2)');
      expect(new AdmZip(path.join(backupDir, 'Before update.zip')).readAsText('SavedArks/TheIsland_WP/TheIsland_WP.ark')).toBe('world v1');
    });

    // A half-written zip used to sit in the list, and count towards retention.
    it('leaves nothing behind when the archive cannot be written', async () => {
      AdmZipMock.mockImplementationOnce(() => ({
        addFile: jest.fn(),
        writeZip: (target: string) => {
          fs.writeFileSync(target, 'partial');
          throw new Error('ENOSPC: no space left on device');
        }
      }));

      await expect(service.createBackupInternal('a1', serverPath, 'manual', 'Full disk')).rejects.toThrow('ENOSPC');

      expect(backupFiles()).toEqual([]);
      await expect(service.getInstanceBackupsInternal(serverPath)).resolves.toEqual([]);
    });

    // moveFile falls back to copying, which can fail halfway through the final file.
    it('removes a partial archive when the move fails', async () => {
      jest.spyOn(fsUtils, 'moveFile').mockImplementation((_from: string, to: string) => {
        fs.writeFileSync(to, 'partial');
        throw new Error('EIO: i/o error, copyfile');
      });

      await expect(service.createBackupInternal('a1', serverPath, 'manual', 'Half')).rejects.toThrow('EIO');

      expect(backupFiles()).toEqual([]);
    });
  });

  describe('removeStaleTempFiles', () => {
    it('removes what an interrupted backup or restore left behind, and nothing else', async () => {
      archive('Keep.zip', { 'config.json': '{}' });
      fs.writeFileSync(path.join(backupDir, 'Half.zip.tmp'), 'partial');
      fs.mkdirSync(path.join(backupDir, '.restore-x1', 'SavedArks'), { recursive: true });
      fs.writeFileSync(path.join(backupDir, '.restore-x1', 'SavedArks', 'w.ark'), 'world');

      await service.removeStaleTempFiles(serverPath);

      expect(backupFiles()).toEqual(['Keep.zip']);
    });

    it('does nothing for an instance without a backup folder', async () => {
      await expect(service.removeStaleTempFiles(serverPath)).resolves.toBeUndefined();
    });
  });

  describe('getInstanceBackupsInternal', () => {
    it('lists nothing for an instance that has no backups yet', async () => {
      await expect(service.getInstanceBackupsInternal(serverPath)).resolves.toEqual([]);
    });

    // Manual backups used to be dated at listing time, so they always looked newest and retention
    // deleted every scheduled backup, the one just made included.
    it('lets retention keep the newest backups whatever their type', async () => {
      archive('Old manual.zip', { 'config.json': '{}' }, new Date('2024-12-01T00:00:00Z'));
      archive('manual_20250101000000_backup.zip', { 'config.json': '{}' });
      archive('scheduled_20250301000000_backup.zip', { 'config.json': '{}' });
      archive('New manual.zip', { 'config.json': '{}' }, new Date('2025-04-01T00:00:00Z'));

      const listed = await service.getInstanceBackupsInternal(serverPath);
      expect(listed.map(backup => backup.id)).toEqual([
        'New manual', 'scheduled_20250301000000_backup', 'manual_20250101000000_backup', 'Old manual'
      ]);

      await new BackupCleanupService().cleanupOldBackups(serverPath, 2, dir => service.getInstanceBackupsInternal(dir));

      expect(backupFiles()).toEqual(['New manual.zip', 'scheduled_20250301000000_backup.zip']);
    });
  });

  describe('restoreBackupInternal', () => {
    // 'My (old).zip' sorts before 'My.zip', so a prefix match restored the wrong archive.
    it('restores exactly the backup asked for', async () => {
      archive('My (old).zip', { 'config.json': '{"id":"a1","name":"Alpha"}', 'SavedArks/TheIsland_WP/TheIsland_WP.ark': 'old world' });
      archive('My.zip', { 'config.json': '{"id":"a1","name":"Alpha"}', 'SavedArks/TheIsland_WP/TheIsland_WP.ark': 'saved world' });

      await service.restoreBackupInternal('My', serverPath);

      expect(world()).toBe('saved world');
      expect(backupFiles()).toEqual(['My (old).zip', 'My.zip']);
    });

    it('refuses a backup id that only prefixes an existing one', async () => {
      archive('MyBackup.zip', { 'config.json': '{}' });

      await expect(service.restoreBackupInternal('My', serverPath)).rejects.toThrow('Backup with ID My not found');
      expect(world()).toBe('world v1');
    });

    it('keeps the instance config when the backup has none', async () => {
      archive('No config.zip', { 'SavedArks/TheIsland_WP/TheIsland_WP.ark': 'saved world' });

      await service.restoreBackupInternal('No config', serverPath);

      expect(fs.readFileSync(path.join(serverPath, 'config.json'), 'utf8')).toBe('{"id":"a1","name":"Alpha"}');
      expect(world()).toBe('saved world');
    });

    it('refuses a server path that is not absolute', async () => {
      await expect(service.restoreBackupInternal('My', 'Servers/a1')).rejects.toThrow('invalid server path');
    });
  });

  describe('deleteBackupInternal', () => {
    it('deletes exactly the backup asked for', async () => {
      archive('My (old).zip', { 'config.json': '{}' });
      archive('My.zip', { 'config.json': '{}' });

      await service.deleteBackupInternal('My', serverPath);

      expect(backupFiles()).toEqual(['My (old).zip']);
    });

    it('refuses a backup id that only prefixes an existing one', async () => {
      archive('My backup.zip', { 'config.json': '{}' });

      await expect(service.deleteBackupInternal('My', serverPath)).rejects.toThrow('Backup with ID My not found');
      expect(backupFiles()).toEqual(['My backup.zip']);
    });
  });

  describe('migrateLegacyBackups', () => {
    it('moves backups out of the instance directory and removes the emptied folder', async () => {
      const legacyDir = path.join(serverPath, 'backups');
      fs.mkdirSync(legacyDir);
      new AdmZip().writeZip(path.join(legacyDir, 'Old.zip'));

      await service.migrateLegacyBackups(serverPath);

      expect(backupFiles()).toEqual(['Old.zip']);
      expect(fs.existsSync(legacyDir)).toBe(false);
    });

    // A manual backup is dated by its file time, so a copy dated today would count as the newest.
    it('keeps the file time when it has to copy across volumes', async () => {
      const legacyDir = path.join(serverPath, 'backups');
      fs.mkdirSync(legacyDir);
      const legacyFile = path.join(legacyDir, 'Old.zip');
      new AdmZip().writeZip(legacyFile);
      const madeAt = new Date('2024-01-02T03:04:05Z');
      fs.utimesSync(legacyFile, madeAt, madeAt);
      jest.spyOn(fs.promises, 'rename').mockRejectedValueOnce(Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' }));
      // As on Linux, where copyFile gives the copy the current time (Windows keeps the source's).
      jest.spyOn(fs.promises, 'copyFile').mockImplementationOnce(async (source, destination) => {
        fs.writeFileSync(destination as string, fs.readFileSync(source as string));
      });

      await service.migrateLegacyBackups(serverPath);

      expect(backupFiles()).toEqual(['Old.zip']);
      expect(Math.round(fs.statSync(path.join(backupDir, 'Old.zip')).mtimeMs / 1000)).toBe(madeAt.getTime() / 1000);
    });
  });
});
