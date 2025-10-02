import { BackupSettings, BackupMetadata } from '../types/backup.types';
import {
  BackupFilenameUtils,
  BackupPathUtils
} from '../utils/backup.utils';

// Mock path module
jest.mock('path');

const mockPath = require('path');

describe('backup.utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPath.join.mockImplementation((...args: string[]) => args.join('/'));
  });

  describe('BackupFilenameUtils', () => {
    describe('generateFilename', () => {
      it('should generate manual backup filename with custom name', () => {
        const result = BackupFilenameUtils.generateFilename('manual', 'My Custom Backup');
        expect(result).toBe('My Custom Backup.zip');
      });

      it('should sanitize custom name for manual backups', () => {
        const result = BackupFilenameUtils.generateFilename('manual', 'My<>:|?*Backup');
        expect(result).toBe('MyBackup.zip');
      });

      it('should generate scheduled backup filename with timestamp', () => {
        // Mock Date to return a consistent timestamp
        const mockDate = new Date('2025-09-27T10:30:45.000Z');
        jest.spyOn(global, 'Date').mockImplementation(() => mockDate as any);

        const result = BackupFilenameUtils.generateFilename('scheduled', 'Daily Backup');
        expect(result).toBe('scheduled_20250927103045_Daily Backup.zip');

        (global.Date as any).mockRestore();
      });

      it('should generate scheduled backup filename without custom name', () => {
        const mockDate = new Date('2025-09-27T10:30:45.000Z');
        jest.spyOn(global, 'Date').mockImplementation(() => mockDate as any);

        const result = BackupFilenameUtils.generateFilename('scheduled');
        expect(result).toBe('scheduled_20250927103045_backup.zip');

        (global.Date as any).mockRestore();
      });

      it('should handle manual backup without custom name', () => {
        // Mock Date to return a consistent timestamp
        const mockDate = new Date('2025-09-27T10:30:45.000Z');
        jest.spyOn(global, 'Date').mockImplementation(() => mockDate as any);

        const result = BackupFilenameUtils.generateFilename('manual');
        expect(result).toBe('manual_20250927103045_backup.zip');

        (global.Date as any).mockRestore();
      });
    });

    describe('parseFilename', () => {
      const mockFilePath = '/path/to/backup.zip';
      const instanceId = 'instance1';

      it('should parse simple manual backup filename', () => {
        const result = BackupFilenameUtils.parseFilename('MyBackup.zip', mockFilePath, instanceId);

        expect(result?.id).toBe('MyBackup');
        expect(result?.instanceId).toBe('instance1');
        expect(result?.name).toBe('MyBackup');
        expect(result?.createdAt).toBeInstanceOf(Date);
        expect(result?.size).toBe(0);
        expect(result?.type).toBe('manual');
        expect(result?.filePath).toBe(mockFilePath);
      });

      it('should parse structured manual backup filename', () => {
        const result = BackupFilenameUtils.parseFilename('manual_20250927103045_MyBackup.zip', mockFilePath, instanceId);

        expect(result).toEqual({
          id: 'manual_20250927103045_MyBackup',
          instanceId: 'instance1',
          name: 'MyBackup',
          createdAt: new Date(Date.UTC(2025, 8, 27, 10, 30, 45)), // Month is 0-indexed
          size: 0,
          type: 'manual',
          filePath: mockFilePath
        });
      });

      it('should parse scheduled backup filename', () => {
        const result = BackupFilenameUtils.parseFilename('scheduled_20250927103045_DailyBackup.zip', mockFilePath, instanceId);

        expect(result).toEqual({
          id: 'scheduled_20250927103045_DailyBackup',
          instanceId: 'instance1',
          name: 'DailyBackup',
          createdAt: new Date(Date.UTC(2025, 8, 27, 10, 30, 45)),
          size: 0,
          type: 'scheduled',
          filePath: mockFilePath
        });
      });

      it('should handle custom names with underscores', () => {
        const result = BackupFilenameUtils.parseFilename('scheduled_20250927103045_My_Custom_Backup.zip', mockFilePath, instanceId);

        expect(result).toEqual({
          id: 'scheduled_20250927103045_My_Custom_Backup',
          instanceId: 'instance1',
          name: 'My_Custom_Backup',
          createdAt: new Date(Date.UTC(2025, 8, 27, 10, 30, 45)),
          size: 0,
          type: 'scheduled',
          filePath: mockFilePath
        });
      });

      it('should return null for invalid structured filename with too few parts', () => {
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const result = BackupFilenameUtils.parseFilename('manual_20250927.zip', mockFilePath, instanceId);

        expect(result).toBeNull();
        expect(consoleSpy).toHaveBeenCalledWith('[backup-filename-utils] Invalid structured backup filename format: manual_20250927.zip');

        consoleSpy.mockRestore();
      });

      it('should return null for invalid timestamp format', () => {
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const result = BackupFilenameUtils.parseFilename('scheduled_invalid_MyBackup.zip', mockFilePath, instanceId);

        expect(result).toBeNull();
        expect(consoleSpy).toHaveBeenCalledWith('[backup-filename-utils] Invalid timestamp format in filename: scheduled_invalid_MyBackup.zip');

        consoleSpy.mockRestore();
      });
    });

    describe('isBackupFile', () => {
      it('should return true for valid zip files', () => {
        expect(BackupFilenameUtils.isBackupFile('MyBackup.zip')).toBe(true);
        expect(BackupFilenameUtils.isBackupFile('mybackup.ZIP')).toBe(true);
      });

      it('should return true for structured backup files', () => {
        expect(BackupFilenameUtils.isBackupFile('manual_20250927103045_Backup.zip')).toBe(true);
        expect(BackupFilenameUtils.isBackupFile('scheduled_20250927103045_Backup.zip')).toBe(true);
      });

      it('should return false for non-zip files', () => {
        expect(BackupFilenameUtils.isBackupFile('MyBackup.txt')).toBe(false);
        expect(BackupFilenameUtils.isBackupFile('MyBackup')).toBe(false);
      });

      it('should return false for system files', () => {
        expect(BackupFilenameUtils.isBackupFile('Thumbs.db.zip')).toBe(false);
        expect(BackupFilenameUtils.isBackupFile('desktop.ini.zip')).toBe(false);
        expect(BackupFilenameUtils.isBackupFile('.DS_Store.zip')).toBe(false);
      });

      it('should return false for hidden files', () => {
        expect(BackupFilenameUtils.isBackupFile('.hidden.zip')).toBe(false);
      });

      it('should handle malformed structured filenames', () => {
        // Files that look structured but have issues are still accepted as simple format
        expect(BackupFilenameUtils.isBackupFile('manual_invalid_Backup.zip')).toBe(true);
        expect(BackupFilenameUtils.isBackupFile('scheduled_invalid_Backup.zip')).toBe(true);
      });
    });
  });

  describe('BackupPathUtils', () => {
    const serverPath = '/path/to/server';

    describe('getInstanceBackupDir', () => {
      it('should return the backup directory path', () => {
        const result = BackupPathUtils.getInstanceBackupDir(serverPath);
        expect(mockPath.join).toHaveBeenCalledWith(serverPath, 'backups');
        expect(result).toBe('/path/to/server/backups');
      });
    });

    describe('getSettingsFilePath', () => {
      it('should return the backup settings file path', () => {
        const result = BackupPathUtils.getSettingsFilePath(serverPath);
        expect(mockPath.join).toHaveBeenCalledWith(serverPath, 'backup-settings.json');
        expect(result).toBe('/path/to/server/backup-settings.json');
      });
    });

    describe('getBackupFilePath', () => {
      it('should return the full backup file path', () => {
        const filename = 'MyBackup.zip';
        const result = BackupPathUtils.getBackupFilePath(serverPath, filename);

        expect(mockPath.join).toHaveBeenCalledWith(serverPath, 'backups');
        expect(mockPath.join).toHaveBeenCalledWith('/path/to/server/backups', filename);
        expect(result).toBe('/path/to/server/backups/MyBackup.zip');
      });
    });
  });

  describe('Type Definitions', () => {
    it('should export BackupSettings interface', () => {
      const settings: BackupSettings = {
        instanceId: 'instance1',
        enabled: true,
        frequency: 'daily',
        time: '22:00',
        dayOfWeek: 1,
        maxBackupsToKeep: 10
      };

      expect(settings.instanceId).toBe('instance1');
      expect(settings.enabled).toBe(true);
      expect(settings.frequency).toBe('daily');
      expect(settings.time).toBe('22:00');
      expect(settings.dayOfWeek).toBe(1);
      expect(settings.maxBackupsToKeep).toBe(10);
    });

    it('should export BackupMetadata interface', () => {
      const metadata: BackupMetadata = {
        id: 'backup1',
        instanceId: 'instance1',
        name: 'My Backup',
        createdAt: new Date(),
        size: 1024,
        type: 'manual',
        filePath: '/path/to/backup.zip'
      };

      expect(metadata.id).toBe('backup1');
      expect(metadata.instanceId).toBe('instance1');
      expect(metadata.name).toBe('My Backup');
      expect(metadata.createdAt).toBeInstanceOf(Date);
      expect(metadata.size).toBe(1024);
      expect(metadata.type).toBe('manual');
      expect(metadata.filePath).toBe('/path/to/backup.zip');
    });
  });
});