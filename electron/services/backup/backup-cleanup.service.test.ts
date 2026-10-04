// test/setup.ts mocks fs and path; retention is checked against real files.
jest.unmock('fs');
jest.unmock('path');

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BackupMetadata } from '../../types/backup.types';
import { BackupCleanupService } from './backup-cleanup.service';

describe('BackupCleanupService', () => {
  const service = new BackupCleanupService();
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-cleanup-test-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function file(relativePath: string, modifiedAt = new Date()): string {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'x');
    fs.utimesSync(filePath, modifiedAt, modifiedAt);
    return filePath;
  }

  function remaining(dir = root): string[] {
    return fs.readdirSync(dir, { withFileTypes: true })
      .flatMap(entry => entry.isDirectory()
        ? remaining(path.join(dir, entry.name))
        : [path.relative(root, path.join(dir, entry.name)).split(path.sep).join('/')])
      .sort();
  }

  describe('cleanupOldBackups', () => {
    function backup(name: string, createdAt: string): BackupMetadata {
      return { id: name, instanceId: 'a1', name, createdAt: new Date(createdAt), size: 1, type: 'manual', filePath: file(`${name}.zip`) };
    }

    it('deletes the oldest backups beyond the number to keep', async () => {
      const backups = [backup('b', '2025-01-02'), backup('c', '2025-01-03'), backup('a', '2025-01-01')];

      await service.cleanupOldBackups(root, 2, async () => backups);

      expect(remaining()).toEqual(['b.zip', 'c.zip']);
    });

    it('keeps everything when there are no more than the number to keep', async () => {
      const backups = [backup('a', '2025-01-01'), backup('b', '2025-01-02')];

      await service.cleanupOldBackups(root, 2, async () => backups);

      expect(remaining()).toEqual(['a.zip', 'b.zip']);
    });

    // slice(0, length - 0) used to select every backup for deletion; a negative or NaN count was
    // no better.
    it.each([0, -1, NaN, null, undefined, 2.5, '1'])('deletes nothing for a count of %p', async maxBackupsToKeep => {
      const backups = [backup('a', '2025-01-01'), backup('b', '2025-01-02'), backup('c', '2025-01-03')];

      await service.cleanupOldBackups(root, maxBackupsToKeep, async () => backups);

      expect(remaining()).toEqual(['a.zip', 'b.zip', 'c.zip']);
    });

    it('logs a listing that fails instead of throwing', async () => {
      await expect(service.cleanupOldBackups(root, 2, async () => { throw new Error('EACCES'); })).resolves.toBeUndefined();
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('cleanupArkSaveFiles', () => {
    const day = (n: number) => new Date(2025, 0, n);

    it('keeps the newest world copies of each map', async () => {
      file('SavedArks/TheIsland_WP/TheIsland_WP_1.ark.bak', day(1));
      file('SavedArks/TheIsland_WP/TheIsland_WP_2.ark.bak', day(2));
      file('SavedArks/TheIsland_WP/TheIsland_WP_3.ark.bak', day(3));
      file('SavedArks/ScorchedEarth_WP/ScorchedEarth_WP_1.ark.bak', day(10));
      file('SavedArks/ScorchedEarth_WP/ScorchedEarth_WP_2.ark.bak', day(11));

      await service.cleanupArkSaveFiles(root, 2);

      expect(remaining()).toEqual([
        'SavedArks/ScorchedEarth_WP/ScorchedEarth_WP_1.ark.bak',
        'SavedArks/ScorchedEarth_WP/ScorchedEarth_WP_2.ark.bak',
        'SavedArks/TheIsland_WP/TheIsland_WP_2.ark.bak',
        'SavedArks/TheIsland_WP/TheIsland_WP_3.ark.bak'
      ]);
    });

    it('leaves every other .bak file alone', async () => {
      file('SavedArks/TheIsland_WP/1.ark.bak', day(1));
      file('SavedArks/TheIsland_WP/2.ark.bak', day(2));
      file('SavedArks/TheIsland_WP/76561198000000000.arkprofile.bak', day(1));
      file('SavedArks/TheIsland_WP/1234.arktribe.bak', day(1));

      await service.cleanupArkSaveFiles(root, 1);

      expect(remaining()).toEqual([
        'SavedArks/TheIsland_WP/1234.arktribe.bak',
        'SavedArks/TheIsland_WP/2.ark.bak',
        'SavedArks/TheIsland_WP/76561198000000000.arkprofile.bak'
      ]);
    });

    // ARK rotates its copies while the server runs; one vanishing mid-walk used to end the prune.
    it('skips a copy that disappears while it looks at the folder', async () => {
      file('SavedArks/TheIsland_WP/1.ark.bak', day(1));
      file('SavedArks/TheIsland_WP/2.ark.bak', day(2));
      file('SavedArks/TheIsland_WP/3.ark.bak', day(3));
      const gone = file('SavedArks/TheIsland_WP/rotated.ark.bak', day(4));
      const realStat = fs.promises.stat;
      jest.spyOn(fs.promises, 'stat').mockImplementation(((target: fs.PathLike, ...rest: unknown[]) => {
        if (target === gone) {
          return Promise.reject(Object.assign(new Error(`ENOENT: no such file or directory, stat '${gone}'`), { code: 'ENOENT' }));
        }
        return (realStat as (...args: unknown[]) => Promise<fs.Stats>)(target, ...rest);
      }) as typeof fs.promises.stat);

      await service.cleanupArkSaveFiles(root, 1);

      expect(remaining()).toEqual(['SavedArks/TheIsland_WP/3.ark.bak', 'SavedArks/TheIsland_WP/rotated.ark.bak']);
      expect(console.error).not.toHaveBeenCalled();
    });

    it.each([0, -1, NaN, null])('deletes nothing for a count of %p', async maxBackupsToKeep => {
      file('SavedArks/TheIsland_WP/1.ark.bak', day(1));
      file('SavedArks/TheIsland_WP/2.ark.bak', day(2));

      await service.cleanupArkSaveFiles(root, maxBackupsToKeep);

      expect(remaining()).toEqual(['SavedArks/TheIsland_WP/1.ark.bak', 'SavedArks/TheIsland_WP/2.ark.bak']);
    });

    it('does nothing for an instance without saves', async () => {
      await expect(service.cleanupArkSaveFiles(root, 2)).resolves.toBeUndefined();
      expect(console.error).not.toHaveBeenCalled();
    });
  });
});
