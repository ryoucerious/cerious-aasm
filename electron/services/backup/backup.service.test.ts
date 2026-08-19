import { BackupService } from './backup.service';
import * as instanceUtils from '../../utils/ark/instance.utils';

jest.mock('../../utils/ark/instance.utils');

describe('BackupService', () => {
  it('should instantiate', () => {
    const service = new BackupService();
    expect(service).toBeDefined();
  });

  // Schedule restore used to run every instance inside a single try/catch, so one
  // instance with an unreadable or malformed backup-settings.json aborted the loop and
  // left every instance after it with no scheduler — reported by users as "automatic
  // backups are not running".
  describe('restoreActiveSchedules', () => {
    let service: any;
    let started: string[];

    beforeEach(() => {
      service = new BackupService();
      started = [];

      // Skip migration; it is exercised elsewhere
      service.migrateLegacyBackups = jest.fn().mockResolvedValue(undefined);

      service.schedulerService = {
        startBackupSchedulerInternal: jest.fn(async (instanceId: string) => {
          started.push(instanceId);
        })
      };

      jest.mocked(instanceUtils).getInstancesBaseDir = jest.fn(() => '/instances') as any;
      jest.mocked(instanceUtils).getAllInstances = jest.fn(async () => [
        { id: 'good-1' },
        { id: 'broken' },
        { id: 'good-2' }
      ]) as any;
    });

    it('still schedules later instances when one throws', async () => {
      service.settingsService = {
        getBackupSettingsInternal: jest.fn(async (instanceId: string) => {
          if (instanceId === 'broken') throw new Error('corrupt settings file');
          return { enabled: true, frequency: 'daily', time: '02:00', maxBackupsToKeep: 5 };
        })
      };

      await service.initializeBackupSystem();

      expect(started).toEqual(['good-1', 'good-2']);
    });

    it('schedules every instance when all settings are readable', async () => {
      service.settingsService = {
        getBackupSettingsInternal: jest.fn(async () => ({
          enabled: true, frequency: 'daily', time: '02:00', maxBackupsToKeep: 5
        }))
      };

      await service.initializeBackupSystem();

      expect(started).toEqual(['good-1', 'broken', 'good-2']);
    });

    it('skips instances whose schedule is disabled or unconfigured', async () => {
      service.settingsService = {
        getBackupSettingsInternal: jest.fn(async (instanceId: string) => {
          if (instanceId === 'good-1') return null;
          if (instanceId === 'broken') return { enabled: false };
          return { enabled: true, frequency: 'daily', time: '02:00', maxBackupsToKeep: 5 };
        })
      };

      await service.initializeBackupSystem();

      expect(started).toEqual(['good-2']);
    });

    it('does not throw when instances cannot be enumerated', async () => {
      jest.mocked(instanceUtils).getAllInstances = jest.fn(async () => {
        throw new Error('base dir missing');
      }) as any;
      service.settingsService = { getBackupSettingsInternal: jest.fn() };

      await expect(service.initializeBackupSystem()).resolves.toBeUndefined();
      expect(started).toEqual([]);
    });
  });
});
