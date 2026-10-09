import { BackupService } from './backup.service';
import * as instanceUtils from '../../utils/ark/instance.utils';
import { getNormalizedInstanceState, setInstanceState } from '../../utils/ark/ark-server/ark-server-state.utils';
import { messagingService } from '../messaging.service';
import { serverProcessService } from '../server-instance/server-process.service';
import { serverLifecycleService } from '../server-instance/server-lifecycle.service';
import { BackupMetadata, BackupSettings } from '../../types/backup.types';

jest.mock('../../utils/ark/instance.utils');
jest.mock('../../utils/ark/ark-server/ark-server-state.utils', () => ({
  getNormalizedInstanceState: jest.fn(() => 'stopped'),
  setInstanceState: jest.fn()
}));
jest.mock('../messaging.service', () => ({ messagingService: { sendToAll: jest.fn() } }));
jest.mock('../server-instance/server-process.service', () => ({
  serverProcessService: { hasActiveProcess: jest.fn(() => false) }
}));
jest.mock('../server-instance/server-lifecycle.service', () => ({
  serverLifecycleService: { isStartInProgress: jest.fn(() => false) }
}));

const mockInstanceUtils = jest.mocked(instanceUtils);

interface Internals {
  operationsService: Record<string, jest.Mock>;
  cleanupService: Record<string, jest.Mock>;
  settingsService: Record<string, jest.Mock>;
  schedulerService: Record<string, jest.Mock>;
  migrateLegacyBackups: jest.Mock;
}

function metadata(id: string, instanceId = 'a1'): BackupMetadata {
  return { id, instanceId, name: id, createdAt: new Date(), size: 1, type: 'manual', filePath: `/backups/${instanceId}/${id}.zip` };
}

const savedSettings: BackupSettings = { instanceId: 'a1', enabled: true, frequency: 'daily', time: '02:00', maxBackupsToKeep: 5 };

describe('BackupService', () => {
  let service: BackupService;
  let internals: Internals;

  beforeEach(() => {
    service = new BackupService();
    internals = service as unknown as Internals;
    internals.operationsService = {
      createBackupInternal: jest.fn(async (instanceId: string) => metadata('b1', instanceId)),
      getInstanceBackupsInternal: jest.fn(async () => []),
      restoreBackupInternal: jest.fn(async () => undefined),
      deleteBackupInternal: jest.fn(async () => undefined),
      migrateLegacyBackups: jest.fn(async () => undefined),
      removeStaleTempFiles: jest.fn(async () => undefined)
    };
    internals.cleanupService = { cleanupOldBackups: jest.fn(async () => undefined), cleanupArkSaveFiles: jest.fn(async () => undefined) };
    internals.settingsService = {
      getBackupSettingsInternal: jest.fn(async () => savedSettings),
      saveBackupSettingsInternal: jest.fn(async () => undefined)
    };
    internals.schedulerService = {
      startBackupSchedulerInternal: jest.fn(),
      stopBackupSchedulerInternal: jest.fn(),
      getSchedulerStatus: jest.fn(async () => ({ success: true, isRunning: false }))
    };
    mockInstanceUtils.getInstance.mockImplementation((id: string) => ({ id }));
    mockInstanceUtils.getInstanceDir.mockImplementation((id: string) => `/servers/${id}`);
    mockInstanceUtils.getAllInstances.mockResolvedValue([{ id: 'a1' }, { id: 'b2' }]);
  });

  // Schedule restore used to run every instance inside a single try/catch, so one instance with
  // an unreadable backup-settings.json left every instance after it with no scheduler.
  describe('schedule restore at startup', () => {
    let started: string[];

    beforeEach(() => {
      started = [];
      internals.schedulerService.startBackupSchedulerInternal.mockImplementation((instanceId: string) => started.push(instanceId));
      mockInstanceUtils.getAllInstances.mockResolvedValue([{ id: 'good-1' }, { id: 'broken' }, { id: 'good-2' }]);
    });

    it('still schedules later instances when one throws', async () => {
      internals.settingsService.getBackupSettingsInternal.mockImplementation(async (serverPath: string) => {
        if (serverPath === '/servers/broken') throw new Error('corrupt settings file');
        return savedSettings;
      });

      await service.initializeBackupSystem();

      expect(started).toEqual(['good-1', 'good-2']);
    });

    it('skips instances whose schedule is disabled or unconfigured', async () => {
      internals.settingsService.getBackupSettingsInternal.mockImplementation(async (serverPath: string) => {
        if (serverPath === '/servers/good-1') return null;
        if (serverPath === '/servers/broken') return { ...savedSettings, enabled: false };
        return savedSettings;
      });

      await service.initializeBackupSystem();

      expect(started).toEqual(['good-2']);
    });

    // A backup or restore cut short by an exit leaves its temporary archive or extraction behind.
    it('clears what interrupted backups left in the backup folder of every instance', async () => {
      internals.settingsService.getBackupSettingsInternal.mockResolvedValue(null);

      await service.initializeBackupSystem();

      expect(internals.operationsService.removeStaleTempFiles.mock.calls).toEqual([['/servers/good-1'], ['/servers/broken'], ['/servers/good-2']]);
    });

    it('does not throw when instances cannot be enumerated', async () => {
      mockInstanceUtils.getAllInstances.mockRejectedValue(new Error('base dir missing'));

      await expect(service.initializeBackupSystem()).resolves.toBeUndefined();
      expect(started).toEqual([]);
    });
  });

  describe('createBackup', () => {
    it('backs up, then applies the retention setting', async () => {
      await expect(service.createBackup('a1', 'manual', 'Before update'))
        .resolves.toEqual({ success: true, backupId: 'b1', message: 'Backup created successfully' });

      expect(internals.operationsService.createBackupInternal).toHaveBeenCalledWith('a1', '/servers/a1', 'manual', 'Before update');
      expect(internals.cleanupService.cleanupOldBackups).toHaveBeenCalledWith('/servers/a1', 5, expect.any(Function));
      expect(internals.cleanupService.cleanupArkSaveFiles).not.toHaveBeenCalled();
    });

    // A mesh keeps a copy of each server's latest backup on another machine.
    it('tells its listeners about each backup it makes, after making it', async () => {
      const heard: unknown[] = [];
      const stop = service.onBackupCreated(backup => heard.push(backup));

      await service.createBackup('a1', 'manual');
      stop();
      await service.createBackup('a1', 'manual');

      expect(heard).toEqual([expect.objectContaining({ id: 'b1' })]);
    });

    it('makes the backup even when a listener fails', async () => {
      service.onBackupCreated(() => { throw new Error('boom'); });

      await expect(service.createBackup('a1', 'manual')).resolves.toEqual(expect.objectContaining({ success: true }));
    });

    it('also prunes ARK\'s own world copies after a scheduled backup', async () => {
      await service.createBackup('a1', 'scheduled');

      expect(internals.cleanupService.cleanupArkSaveFiles).toHaveBeenCalledWith('/servers/a1', 5);
    });

    // The type went into the file name as given: '../../x' wrote the archive outside the backups.
    it.each(['../../../Startup/x', 'weekly', 42])('treats a type of %p as a manual backup', async type => {
      await service.createBackup('a1', type as never, 'Name');

      expect(internals.operationsService.createBackupInternal).toHaveBeenCalledWith('a1', '/servers/a1', 'manual', 'Name');
    });

    it('ignores a name that is not text', async () => {
      await service.createBackup('a1', 'manual', { length: 1 } as never);

      expect(internals.operationsService.createBackupInternal).toHaveBeenCalledWith('a1', '/servers/a1', 'manual', undefined);
    });

    it('reports an instance that does not exist', async () => {
      mockInstanceUtils.getInstance.mockReturnValue(null);

      await expect(service.createBackup('a1')).resolves.toEqual({ success: false, error: 'Instance not found' });
    });

    // A manual and a scheduled backup of one instance used to run at once.
    it('runs one backup of an instance at a time', async () => {
      let finishFirst: (value: BackupMetadata) => void = () => undefined;
      internals.operationsService.createBackupInternal
        .mockImplementationOnce(() => new Promise<BackupMetadata>(resolve => { finishFirst = resolve; }));

      const manual = service.createBackup('a1', 'manual', 'Mine');
      const scheduled = service.createBackup('a1', 'scheduled');
      const otherInstance = service.createBackup('b2', 'scheduled');
      await flush();
      expect(internals.operationsService.createBackupInternal.mock.calls.map(([id, , type]) => [id, type]))
        .toEqual([['a1', 'manual'], ['b2', 'scheduled']]);

      finishFirst(metadata('b1'));
      await Promise.all([manual, scheduled, otherInstance]);
      expect(internals.operationsService.createBackupInternal).toHaveBeenCalledTimes(3);
    });

    it('lets a delete wait until the running backup has finished', async () => {
      let finishBackup: (value: BackupMetadata) => void = () => undefined;
      internals.operationsService.createBackupInternal
        .mockImplementationOnce(() => new Promise<BackupMetadata>(resolve => { finishBackup = resolve; }));
      const idle = jest.fn();

      const backup = service.createBackup('a1', 'scheduled');
      void service.waitForBackupOperations('a1').then(idle);
      await flush();
      expect(idle).not.toHaveBeenCalled();

      finishBackup(metadata('b1'));
      await backup;
      await flush();
      expect(idle).toHaveBeenCalled();
      await expect(service.waitForBackupOperations('b2')).resolves.toBeUndefined();
    });

    it('lets the next backup run after one that failed', async () => {
      internals.operationsService.createBackupInternal.mockRejectedValueOnce(new Error('ENOSPC'));

      await expect(service.createBackup('a1')).resolves.toEqual({ success: false, error: 'ENOSPC' });
      await expect(service.createBackup('a1')).resolves.toMatchObject({ success: true });
    });
  });

  describe('restoreBackup', () => {
    beforeEach(() => {
      internals.operationsService.getInstanceBackupsInternal.mockResolvedValue([metadata('b1')]);
    });

    it('restores a backup of a stopped server', async () => {
      await expect(service.restoreBackup('a1', 'b1')).resolves.toEqual({ success: true, message: 'Backup restored successfully' });
      expect(internals.operationsService.restoreBackupInternal).toHaveBeenCalledWith('b1', '/servers/a1');
    });

    it('refuses while the server runs', async () => {
      jest.mocked(getNormalizedInstanceState).mockReturnValueOnce('running');

      await expect(service.restoreBackup('a1', 'b1')).resolves.toEqual({ success: false, error: 'The server must be stopped before restoring a backup.' });
      expect(internals.operationsService.restoreBackupInternal).not.toHaveBeenCalled();
    });

    it.each(['starting', 'stopping', 'queued'])('refuses while the server is %s', async state => {
      jest.mocked(getNormalizedInstanceState).mockReturnValueOnce(state);

      await expect(service.restoreBackup('a1', 'b1')).resolves.toEqual({ success: false, error: 'The server must be stopped before restoring a backup.' });
      expect(internals.operationsService.restoreBackupInternal).not.toHaveBeenCalled();
    });

    it.each(['crashed', 'error'])('restores a server whose last run ended %s, marked stopped first', async state => {
      // Crash detection restarts a 'crashed' server, which would then run on half-restored files.
      jest.mocked(getNormalizedInstanceState).mockReturnValueOnce(state);

      await expect(service.restoreBackup('a1', 'b1')).resolves.toEqual({ success: true, message: 'Backup restored successfully' });

      expect(setInstanceState).toHaveBeenCalledWith('a1', 'stopped');
      expect(messagingService.sendToAll).toHaveBeenCalledWith('server-instance-state', { state: 'stopped', instanceId: 'a1' });
      expect(jest.mocked(setInstanceState).mock.invocationCallOrder[0])
        .toBeLessThan(internals.operationsService.restoreBackupInternal.mock.invocationCallOrder[0]);
    });

    it('leaves the state of a stopped server alone', async () => {
      await service.restoreBackup('a1', 'b1');

      expect(setInstanceState).not.toHaveBeenCalled();
      expect(messagingService.sendToAll).not.toHaveBeenCalled();
    });

    it('refuses while a server process is still running, whatever the state says', async () => {
      jest.mocked(getNormalizedInstanceState).mockReturnValueOnce('error');
      jest.mocked(serverProcessService.hasActiveProcess).mockReturnValueOnce(true);

      await expect(service.restoreBackup('a1', 'b1')).resolves.toEqual({ success: false, error: 'The server must be stopped before restoring a backup.' });
      expect(setInstanceState).not.toHaveBeenCalled();
      expect(internals.operationsService.restoreBackupInternal).not.toHaveBeenCalled();
    });

    // A crash-detection restart leaves the state 'crashed' with no process until it spawns.
    it('refuses while a start of the instance is in progress', async () => {
      jest.mocked(getNormalizedInstanceState).mockReturnValueOnce('crashed');
      jest.mocked(serverLifecycleService.isStartInProgress).mockReturnValueOnce(true);

      await expect(service.restoreBackup('a1', 'b1')).resolves.toEqual({ success: false, error: 'The server must be stopped before restoring a backup.' });
      expect(serverLifecycleService.isStartInProgress).toHaveBeenCalledWith('a1');
      expect(setInstanceState).not.toHaveBeenCalled();
      expect(internals.operationsService.restoreBackupInternal).not.toHaveBeenCalled();
    });

    it('marks a crashed server stopped before looking up its backups', async () => {
      let finishLookup: (value: BackupMetadata[]) => void = () => undefined;
      internals.operationsService.getInstanceBackupsInternal
        .mockImplementationOnce(() => new Promise<BackupMetadata[]>(resolve => { finishLookup = resolve; }));
      jest.mocked(getNormalizedInstanceState).mockReturnValueOnce('crashed');

      const restore = service.restoreBackup('a1', 'b1');

      expect(setInstanceState).toHaveBeenCalledWith('a1', 'stopped');
      expect(messagingService.sendToAll).toHaveBeenCalledWith('server-instance-state', { state: 'stopped', instanceId: 'a1' });
      expect(internals.operationsService.restoreBackupInternal).not.toHaveBeenCalled();

      finishLookup([metadata('b1')]);
      await expect(restore).resolves.toEqual({ success: true, message: 'Backup restored successfully' });
    });

    it('waits for a backup of the instance that is still being written', async () => {
      let finishBackup: (value: BackupMetadata) => void = () => undefined;
      internals.operationsService.createBackupInternal
        .mockImplementationOnce(() => new Promise<BackupMetadata>(resolve => { finishBackup = resolve; }));

      const backup = service.createBackup('a1', 'scheduled');
      const restore = service.restoreBackup('a1', 'b1');
      await flush();
      expect(internals.operationsService.restoreBackupInternal).not.toHaveBeenCalled();

      finishBackup(metadata('b2'));
      await Promise.all([backup, restore]);
      expect(internals.operationsService.restoreBackupInternal).toHaveBeenCalled();
    });

    it('reports a backup it does not have', async () => {
      await expect(service.restoreBackup('a1', 'nope')).resolves.toEqual({ success: false, error: 'Backup not found' });
    });
  });

  describe('deleteBackup', () => {
    // Two instances backed up in the same second share a scheduled backup id.
    it('deletes the backup of the instance given', async () => {
      internals.operationsService.getInstanceBackupsInternal.mockResolvedValue([metadata('scheduled_20250101020000_backup')]);

      await service.deleteBackup('scheduled_20250101020000_backup', 'b2');

      expect(internals.operationsService.deleteBackupInternal).toHaveBeenCalledWith('scheduled_20250101020000_backup', '/servers/b2');
    });

    it('searches every instance when none is given', async () => {
      internals.operationsService.getInstanceBackupsInternal.mockImplementation(async (serverPath: string) =>
        serverPath === '/servers/b2' ? [metadata('b9', 'b2')] : []);

      await expect(service.deleteBackup('b9')).resolves.toEqual({ success: true, message: 'Backup deleted successfully' });
      expect(internals.operationsService.deleteBackupInternal).toHaveBeenCalledWith('b9', '/servers/b2');
    });

    it.each([undefined, '', 42])('refuses a backup id of %p', async backupId => {
      await expect(service.deleteBackup(backupId as never)).resolves.toEqual({ success: false, error: 'Backup ID is required' });
    });
  });

  describe('saveBackupSettings', () => {
    // The UI allows 1-50. A 0 used to make retention delete every backup.
    it.each([
      [0, 1],
      [-3, 1],
      [2.6, 3],
      [51, 50],
      [1000, 50],
      [NaN, 5],
      [null, 5],
      ['10', 5],
      [undefined, 5]
    ])('stores a backup count of %p as %p', async (maxBackupsToKeep, stored) => {
      await service.saveBackupSettings('a1', { ...savedSettings, maxBackupsToKeep: maxBackupsToKeep as number });

      expect(internals.settingsService.saveBackupSettingsInternal)
        .toHaveBeenCalledWith({ ...savedSettings, maxBackupsToKeep: stored }, '/servers/a1');
    });

    it('stores the instance the settings were saved for', async () => {
      await service.saveBackupSettings('a1', { ...savedSettings, instanceId: 'someone-else' });

      expect(internals.settingsService.saveBackupSettingsInternal).toHaveBeenCalledWith(savedSettings, '/servers/a1');
    });

    it('starts the schedule it saved', async () => {
      await service.saveBackupSettings('a1', savedSettings);

      expect(internals.schedulerService.startBackupSchedulerInternal).toHaveBeenCalledWith('a1', savedSettings, expect.any(Function));
    });

    it('stops the schedule when disabled', async () => {
      await service.saveBackupSettings('a1', { ...savedSettings, enabled: false });

      expect(internals.schedulerService.stopBackupSchedulerInternal).toHaveBeenCalledWith('a1');
    });

    it.each([undefined, 'daily', [1]])('refuses settings of %p', async settings => {
      await expect(service.saveBackupSettings('a1', settings as never))
        .resolves.toEqual({ success: false, error: 'Instance ID and settings are required' });
      expect(internals.settingsService.saveBackupSettingsInternal).not.toHaveBeenCalled();
    });
  });

  it('reports the schedule of an instance', async () => {
    internals.schedulerService.getSchedulerStatus.mockResolvedValue({ success: true, isRunning: true, nextBackup: new Date(0) });

    await expect(service.getSchedulerStatus('a1')).resolves.toEqual({ success: true, isRunning: true, nextBackup: new Date(0) });
    expect(internals.schedulerService.getSchedulerStatus).toHaveBeenCalledWith('a1');
  });
});

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
