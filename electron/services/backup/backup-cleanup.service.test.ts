import { BackupCleanupService } from './backup-cleanup.service';

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  unlink: jest.fn((_path: string, cb: (...args: any[]) => void) => cb(null)),
  readdir: jest.fn((_path: string, cb: (...args: any[]) => void) => cb(null, [])),
  stat: jest.fn((_path: string, cb: (...args: any[]) => void) => cb(null, { isDirectory: () => false, isFile: () => false, mtime: new Date() })),
}));

jest.mock('path', () => ({
  ...jest.requireActual('path'),
  join: jest.fn((...args: string[]) => args.join('/')),
}));

const fs = require('fs');

describe('BackupCleanupService', () => {
  let service: BackupCleanupService;
  beforeEach(() => {
    jest.clearAllMocks();
    service = new BackupCleanupService();
  });

  it('should instantiate', () => {
    expect(service).toBeDefined();
  });

  describe('cleanupOldBackups', () => {
    it('should do nothing if backups <= maxBackupsToKeep', async () => {
      const getInstanceBackupsInternal = jest.fn().mockResolvedValue([
        { createdAt: '2023-01-01', filePath: 'a.zip' },
        { createdAt: '2023-01-02', filePath: 'b.zip' }
      ]);
      await service.cleanupOldBackups('serverPath', 2, getInstanceBackupsInternal);
      expect(getInstanceBackupsInternal).toHaveBeenCalled();
      expect(fs.unlink).not.toHaveBeenCalled();
    });

    it('should delete oldest backups if backups > maxBackupsToKeep', async () => {
      const backups = [
        { createdAt: '2023-01-01', filePath: 'a.zip' },
        { createdAt: '2023-01-02', filePath: 'b.zip' },
        { createdAt: '2023-01-03', filePath: 'c.zip' }
      ];
      const getInstanceBackupsInternal = jest.fn().mockResolvedValue(backups);
      await service.cleanupOldBackups('serverPath', 2, getInstanceBackupsInternal);
      expect(fs.unlink).toHaveBeenCalledWith('a.zip', expect.any(Function));
    });

    it('should handle errors from getInstanceBackupsInternal', async () => {
      const getInstanceBackupsInternal = jest.fn().mockRejectedValue(new Error('fail'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await service.cleanupOldBackups('serverPath', 2, getInstanceBackupsInternal);
      expect(consoleSpy.mock.calls.some(call => call[0].includes('Failed to cleanup old backups:'))).toBe(true);
      consoleSpy.mockRestore();
    });
  });

  describe('cleanupArkSaveFiles', () => {
    it('should do nothing if SavedArks dir does not exist', async () => {
      fs.existsSync.mockReturnValue(false);
      await service.cleanupArkSaveFiles('serverPath', 2);
    });

    it('should delete oldest .bak files if more than maxBackupsToKeep', async () => {
      fs.existsSync.mockReturnValue(true);
      const bakFiles = [
        { filePath: 'file1.bak', modifiedTime: new Date('2023-01-01') },
        { filePath: 'file2.bak', modifiedTime: new Date('2023-01-02') },
        { filePath: 'file3.bak', modifiedTime: new Date('2023-01-03') }
      ];
      jest.spyOn(service as any, 'collectBakFiles').mockImplementation(async (...args: any[]) => {
        const arr = args[1];
        bakFiles.forEach(f => arr.push(f));
      });
      await service.cleanupArkSaveFiles('serverPath', 2);
      expect(fs.unlink).toHaveBeenCalledWith('file1.bak', expect.any(Function));
    });

    it('should handle errors in cleanupArkSaveFiles', async () => {
      fs.existsSync.mockImplementation(() => { throw new Error('fail'); });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      await service.cleanupArkSaveFiles('serverPath', 2);
      expect(consoleSpy.mock.calls.some(call => call[0].includes('Failed to cleanup ARK save files:'))).toBe(true);
      consoleSpy.mockRestore();
    });
  });

  describe('collectBakFiles', () => {
    it('should collect .bak files recursively', async () => {
      fs.readdir.mockImplementation((...args: any[]) => {
        const dir = args[0];
        const cb = args[1];
        if (dir.endsWith('root')) cb(null, ['sub', 'file1.bak']);
        else cb(null, ['file2.bak']);
      });
      fs.stat.mockImplementation((...args: any[]) => {
        const file = args[0];
        const cb = args[1];
        cb(null, {
          isDirectory: () => file.endsWith('sub'),
          isFile: () => file.endsWith('.bak'),
          mtime: new Date('2023-01-01')
        });
      });
      const bakFiles: any[] = [];
      await (service as any).collectBakFiles('root', bakFiles);
      expect(bakFiles.some((f: any) => f.filePath.endsWith('file1.bak'))).toBe(true);
      expect(bakFiles.some((f: any) => f.filePath.endsWith('file2.bak'))).toBe(true);
    });

    it('should handle errors in collectBakFiles', async () => {
      fs.readdir.mockImplementation((...args: any[]) => {
        const cb = args[1];
        cb(new Error('fail'));
      });
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      await (service as any).collectBakFiles('root', []);
      expect(consoleSpy.mock.calls.some(call => call[0].includes('Could not read directory'))).toBe(true);
      consoleSpy.mockRestore();
    });
  });
});
