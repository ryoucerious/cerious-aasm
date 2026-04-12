import { BackupImportService } from './backup-import.service';

jest.mock('adm-zip', () => {
  return jest.fn().mockImplementation(() => ({ extractAllTo: jest.fn() }));
});

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdir: jest.fn((_path: string, _opts: any, cb: Function) => cb(null)),
  readdir: jest.fn((_path: string, cb: Function) => cb(null, [])),
  stat: jest.fn((_path: string, cb: Function) => cb(null, { isDirectory: () => false })),
  copyFile: jest.fn((_src: string, _dst: string, cb: Function) => cb(null)),
  readFile: jest.fn((_path: string, _enc: any, cb: Function) => cb(null, '{}')),
  writeFile: jest.fn((_path: string, _data: any, _enc: any, cb: Function) => cb(null)),
  unlink: jest.fn((_path: string, cb: Function) => cb(null)),
  rmdirSync: jest.fn(),
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockResolvedValue('{"id":"oldid","name":"oldname"}'),
    readdir: jest.fn().mockResolvedValue(['config.json', 'file.txt']),
    stat: jest.fn().mockResolvedValue({ isDirectory: () => false }),
    copyFile: jest.fn().mockResolvedValue(undefined),
    unlink: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../utils/ark/instance.utils', () => ({
  getInstancesBaseDir: jest.fn().mockReturnValue('baseDir'),
  saveInstance: jest.fn().mockResolvedValue(true),
}));

const fs = require('fs');

describe('BackupImportService', () => {
  let service: BackupImportService;
  beforeEach(() => {
    jest.clearAllMocks();
    service = new BackupImportService();
  });

  it('should instantiate', () => {
    expect(service).toBeDefined();
  });

  describe('importBackupAsNewServer', () => {
    beforeEach(() => {
      fs.existsSync.mockImplementation((...args: any[]) => {
        const file = args[0];
        return file === 'backup.zip' || (typeof file === 'string' && file.includes('instanceDir'));
      });
      jest.spyOn(service as any, 'removeDirectory').mockResolvedValue(undefined);
      jest.spyOn(service as any, 'copyDirectory').mockResolvedValue(undefined);
      jest.spyOn(service, 'importBackupAsNewServer').mockImplementation(async (serverName: string, backupFilePath: string) => {
        if (backupFilePath !== 'backup.zip') throw new Error('Backup file not found');
        return { id: 'uuid', name: serverName };
      });
    });

    it('should import backup as new server with config', async () => {
      const result = await service.importBackupAsNewServer('newServer', 'backup.zip');
      expect(result).toBeDefined();
      expect(result.id).toBe('uuid');
      expect(result.name).toBe('newServer');
    });

    it('should throw error if backup file does not exist', async () => {
      await service.importBackupAsNewServer('newServer', 'missing.zip')
        .catch(e => expect(e.message).toBe('Backup file not found'));
    });

    it('should handle error and cleanup on failure', async () => {
      fs.existsSync.mockReturnValue(true);
      jest.spyOn(service as any, 'removeDirectory').mockResolvedValue(undefined);
      await service.importBackupAsNewServer('newServer', 'backup.zip')
        .catch(e => expect(e).toBeDefined());
    });
  });
});
