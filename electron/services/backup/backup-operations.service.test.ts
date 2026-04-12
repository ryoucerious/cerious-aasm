import { BackupOperationsService, backupOperationsService } from './backup-operations.service';
import { BackupFilenameUtils, BackupPathUtils } from '../../utils/backup.utils';

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  rmdirSync: jest.fn(),
  mkdir: jest.fn((_p: string, _o: any, cb: (...a: any[]) => void) => cb(null)),
  stat: jest.fn((_p: string, cb: (...a: any[]) => void) => cb(null, { size: 1234, isDirectory: () => false, isFile: () => true })),
  readdir: jest.fn((_p: string, cb: (...a: any[]) => void) => cb(null, [])),
  unlink: jest.fn((_p: string, cb: (...a: any[]) => void) => cb(null)),
  readFile: jest.fn((_p: string, cb: (...a: any[]) => void) => cb(null, Buffer.from('data'))),
  writeFile: jest.fn((_p: string, _d: any, cb: (...a: any[]) => void) => cb(null)),
  promises: {
    lstat: jest.fn(),
    readFile: jest.fn(),
  },
}));

jest.mock('path', () => ({
  ...jest.requireActual('path'),
  join: jest.fn((...args: string[]) => args.join('/')),
  dirname: jest.fn((p: string) => {
    const parts = p.split('/');
    parts.pop();
    return parts.join('/');
  }),
  basename: jest.fn((p: string) => {
    const parts = p.split('/');
    return parts[parts.length - 1];
  }),
}));

jest.mock('../../utils/backup.utils');

const mockAdmZipInstance = {
  addFile: jest.fn(),
  writeZip: jest.fn(),
  extractAllTo: jest.fn(),
};

jest.mock('adm-zip', () => {
  return jest.fn().mockImplementation(() => mockAdmZipInstance);
});

const fs = require('fs');

describe('BackupOperationsService', () => {
  let service: BackupOperationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BackupOperationsService();

    // Re-establish default fs mock implementations (clearAllMocks only clears calls, not implementations)
    fs.mkdir.mockImplementation((_p: string, _o: any, cb: (...a: any[]) => void) => cb(null));
    fs.stat.mockImplementation((_p: string, cb: (...a: any[]) => void) =>
      cb(null, { size: 1234, isDirectory: () => false, isFile: () => true })
    );
    fs.readdir.mockImplementation((_p: string, cb: (...a: any[]) => void) => cb(null, []));
    fs.unlink.mockImplementation((_p: string, cb: (...a: any[]) => void) => cb(null));
    fs.readFile.mockImplementation((_p: string, cb: (...a: any[]) => void) => cb(null, Buffer.from('data')));
    fs.writeFile.mockImplementation((_p: string, _d: any, cb: (...a: any[]) => void) => cb(null));
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    (BackupPathUtils.getInstanceBackupDir as jest.Mock).mockImplementation(
      (serverPath: string) => serverPath + '/backups'
    );
    (BackupFilenameUtils.generateFilename as jest.Mock).mockReturnValue('manual_20250927103045_backup.zip');
    (BackupFilenameUtils.parseFilename as jest.Mock).mockReturnValue({
      id: 'manual_20250927103045_backup',
      instanceId: 'inst1',
      name: 'backup',
      createdAt: new Date('2025-09-27T10:30:45Z'),
      size: 0,
      type: 'manual' as const,
      filePath: '/server/backups/manual_20250927103045_backup.zip',
    });
    (BackupFilenameUtils.isBackupFile as jest.Mock).mockImplementation(
      (f: string) => f.endsWith('.zip')
    );
  });

  it('should export a singleton instance', () => {
    expect(backupOperationsService).toBeInstanceOf(BackupOperationsService);
  });

  describe('createBackupInternal', () => {
    it('should create a backup and return metadata', async () => {
      // readdir returns empty so addToZip does nothing
      fs.readdir.mockImplementation((_p: string, cb: (...a: any[]) => void) => cb(null, []));
      fs.stat.mockImplementation((_p: string, cb: (...a: any[]) => void) =>
        cb(null, { size: 5678 })
      );

      const result = await service.createBackupInternal('inst1', '/server', 'manual', 'MyBackup');

      expect(BackupPathUtils.getInstanceBackupDir).toHaveBeenCalledWith('/server');
      expect(BackupFilenameUtils.generateFilename).toHaveBeenCalledWith('manual', 'MyBackup');
      expect(result.size).toBe(5678);
    });

    it('should create backups of scheduled type', async () => {
      fs.readdir.mockImplementation((_p: string, cb: (...a: any[]) => void) => cb(null, []));
      fs.stat.mockImplementation((_p: string, cb: (...a: any[]) => void) =>
        cb(null, { size: 100 })
      );

      await service.createBackupInternal('inst1', '/server', 'scheduled');
      expect(BackupFilenameUtils.generateFilename).toHaveBeenCalledWith('scheduled', undefined);
    });

    it('should throw if parseFilename returns null', async () => {
      fs.readdir.mockImplementation((_p: string, cb: (...a: any[]) => void) => cb(null, []));
      fs.stat.mockImplementation((_p: string, cb: (...a: any[]) => void) =>
        cb(null, { size: 100 })
      );
      (BackupFilenameUtils.parseFilename as jest.Mock).mockReturnValue(null);

      await expect(
        service.createBackupInternal('inst1', '/server', 'manual')
      ).rejects.toThrow('Failed to parse backup filename');
    });

    it('should propagate errors from mkdir', async () => {
      fs.mkdir.mockImplementation((_p: string, _o: any, cb: (...a: any[]) => void) =>
        cb(new Error('mkdir fail'))
      );

      await expect(
        service.createBackupInternal('inst1', '/server', 'manual')
      ).rejects.toThrow('mkdir fail');
    });
  });

  describe('getInstanceBackupsInternal', () => {
    it('should return empty array when backup dir does not exist', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      const result = await service.getInstanceBackupsInternal('/server');
      expect(result).toEqual([]);
    });

    it('should return parsed backup metadata sorted newest first', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      fs.readdir.mockImplementation((_p: string, cb: (...a: any[]) => void) =>
        cb(null, ['backup1.zip', 'backup2.zip'])
      );
      fs.stat.mockImplementation((_p: string, cb: (...a: any[]) => void) =>
        cb(null, { size: 999 })
      );

      const oldDate = new Date('2025-01-01');
      const newDate = new Date('2025-06-01');
      let callCount = 0;
      (BackupFilenameUtils.parseFilename as jest.Mock).mockImplementation(
        (filename: string, filePath: string, instanceId: string) => {
          callCount++;
          return {
            id: filename.replace('.zip', ''),
            instanceId,
            name: filename,
            createdAt: callCount === 1 ? oldDate : newDate,
            size: 0,
            type: 'manual' as const,
            filePath,
          };
        }
      );

      const result = await service.getInstanceBackupsInternal('/server');
      expect(result).toHaveLength(2);
      // Newest first
      expect(result[0].createdAt).toEqual(newDate);
      expect(result[1].createdAt).toEqual(oldDate);
      expect(result[0].size).toBe(999);
    });

    it('should skip files where parseFilename returns null', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      fs.readdir.mockImplementation((_p: string, cb: (...a: any[]) => void) =>
        cb(null, ['good.zip', 'bad.zip'])
      );
      fs.stat.mockImplementation((_p: string, cb: (...a: any[]) => void) =>
        cb(null, { size: 100 })
      );

      let callCount = 0;
      (BackupFilenameUtils.parseFilename as jest.Mock).mockImplementation(() => {
        callCount++;
        if (callCount === 2) return null;
        return {
          id: 'good',
          instanceId: 'inst1',
          name: 'good',
          createdAt: new Date(),
          size: 0,
          type: 'manual' as const,
          filePath: '/path',
        };
      });

      const result = await service.getInstanceBackupsInternal('/server');
      expect(result).toHaveLength(1);
    });

    it('should filter non-backup files via isBackupFile', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      fs.readdir.mockImplementation((_p: string, cb: (...a: any[]) => void) =>
        cb(null, ['backup.zip', 'readme.txt'])
      );
      fs.stat.mockImplementation((_p: string, cb: (...a: any[]) => void) =>
        cb(null, { size: 100 })
      );

      const result = await service.getInstanceBackupsInternal('/server');
      // readme.txt is not a backup file (isBackupFile checks .zip)
      expect(BackupFilenameUtils.parseFilename).toHaveBeenCalledTimes(1);
    });

    it('should return empty array on readdir error', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      fs.readdir.mockImplementation((_p: string, cb: (...a: any[]) => void) =>
        cb(new Error('readdir fail'))
      );

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const result = await service.getInstanceBackupsInternal('/server');
      expect(result).toEqual([]);
      consoleSpy.mockRestore();
    });
  });

  describe('restoreBackupInternal', () => {
    it('should throw if backup dir does not exist', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(
        service.restoreBackupInternal('bk1', '/server')
      ).rejects.toThrow('Backup directory not found');
    });

    it('should throw if backup file is not found', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      fs.readdir.mockImplementation((_p: string, cb: (...a: any[]) => void) =>
        cb(null, ['other.zip'])
      );

      await expect(
        service.restoreBackupInternal('bk1', '/server')
      ).rejects.toThrow('Backup with ID bk1 not found');
    });

    it('should restore backup by extracting and copying', async () => {
      (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        // backup dir and file exist; temp dir exists for removeDirectory
        return true;
      });
      fs.readdir.mockImplementation((_p: string, cb: (...a: any[]) => void) => {
        // First call: find backup file; subsequent calls: empty dirs
        cb(null, ['bk1_backup.zip']);
      });
      fs.stat.mockImplementation((_p: string, cb: (...a: any[]) => void) =>
        cb(null, { size: 100, isDirectory: () => false, isFile: () => true })
      );

      // Override readdir for specific calls (clear, copy, remove)
      const readdirCalls: string[] = [];
      fs.readdir.mockImplementation((p: string, cb: (...a: any[]) => void) => {
        readdirCalls.push(p);
        if (p.includes('backups') && readdirCalls.length === 1) {
          cb(null, ['bk1_backup.zip']);
        } else {
          cb(null, []);
        }
      });

      await service.restoreBackupInternal('bk1', '/server');
      expect(mockAdmZipInstance.extractAllTo).toHaveBeenCalled();
    });
  });

  describe('deleteBackupInternal', () => {
    it('should throw if backup dir does not exist', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(
        service.deleteBackupInternal('bk1', '/server')
      ).rejects.toThrow('Backup directory not found');
    });

    it('should delete backup by exact filename match', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      fs.readdir.mockImplementation((_p: string, cb: (...a: any[]) => void) =>
        cb(null, ['bk1.zip'])
      );

      await service.deleteBackupInternal('bk1', '/server');
      expect(fs.unlink).toHaveBeenCalled();
    });

    it('should delete backup by startsWith match', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      fs.readdir.mockImplementation((_p: string, cb: (...a: any[]) => void) =>
        cb(null, ['bk1_extra_stuff.zip'])
      );

      await service.deleteBackupInternal('bk1', '/server');
      expect(fs.unlink).toHaveBeenCalled();
    });

    it('should delete backup by parseFilename ID match', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      fs.readdir.mockImplementation((_p: string, cb: (...a: any[]) => void) =>
        cb(null, ['completely_different.zip'])
      );
      (BackupFilenameUtils.parseFilename as jest.Mock).mockReturnValue({
        id: 'bk1',
        instanceId: 'inst1',
        name: 'backup',
        createdAt: new Date(),
        size: 0,
        type: 'manual' as const,
        filePath: '/path',
      });

      await service.deleteBackupInternal('bk1', '/server');
      expect(fs.unlink).toHaveBeenCalled();
    });

    it('should throw if backup ID not found by any strategy', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      fs.readdir.mockImplementation((_p: string, cb: (...a: any[]) => void) =>
        cb(null, ['other.zip'])
      );
      (BackupFilenameUtils.isBackupFile as jest.Mock).mockReturnValue(true);
      (BackupFilenameUtils.parseFilename as jest.Mock).mockReturnValue({
        id: 'different_id',
        instanceId: 'inst1',
        name: 'backup',
        createdAt: new Date(),
        size: 0,
        type: 'manual' as const,
        filePath: '/path',
      });

      await expect(
        service.deleteBackupInternal('bk1', '/server')
      ).rejects.toThrow('Backup with ID bk1 not found');
    });

    it('should propagate unlink errors', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      fs.readdir.mockImplementation((_p: string, cb: (...a: any[]) => void) =>
        cb(null, ['bk1.zip'])
      );
      fs.unlink.mockImplementation((_p: string, cb: (...a: any[]) => void) =>
        cb(new Error('unlink fail'))
      );

      await expect(
        service.deleteBackupInternal('bk1', '/server')
      ).rejects.toThrow('unlink fail');
    });
  });
});
