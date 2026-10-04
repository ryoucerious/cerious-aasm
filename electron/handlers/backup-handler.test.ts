import { shell } from 'electron';
import { messagingService } from '../services/messaging.service';
import { backupService } from '../services/backup/backup.service';
import { applicationService } from '../services/application.service';
import { initializeBackupSystem } from './backup-handler';

jest.mock('electron', () => ({ shell: { showItemInFolder: jest.fn() } }));
jest.mock('../services/application.service', () => ({ applicationService: { isHeadless: jest.fn() } }));
jest.mock('../services/messaging.service', () => ({
  messagingService: { on: jest.fn(), sendToOriginator: jest.fn() }
}));
jest.mock('../services/backup/backup.service', () => ({
  backupService: {
    initializeBackupSystem: jest.fn(),
    createBackup: jest.fn(),
    getBackupList: jest.fn(),
    restoreBackup: jest.fn(),
    deleteBackup: jest.fn(),
    getBackupSettings: jest.fn(),
    saveBackupSettings: jest.fn(),
    startBackupScheduler: jest.fn(),
    stopBackupScheduler: jest.fn(),
    getSchedulerStatus: jest.fn(),
    downloadBackup: jest.fn()
  }
}));

const mockMessaging = jest.mocked(messagingService);
const mockBackup = jest.mocked(backupService);

type Listener = (payload: unknown, sender: unknown) => Promise<void>;

const settings = { instanceId: 'a1', enabled: true, frequency: 'daily' as const, time: '03:00', maxBackupsToKeep: 5 };
const nextBackup = new Date(1790000000000);

describe('backup-handler', () => {
  const sender = { send: jest.fn() };
  let handlers: Record<string, Listener>;

  beforeAll(() => {
    handlers = Object.fromEntries(mockMessaging.on.mock.calls.map(([channel, listener]) => [channel, listener as Listener]));
  });

  beforeEach(() => {
    jest.mocked(applicationService.isHeadless).mockReturnValue(false);
  });

  function replies(channel: string): unknown[] {
    return mockMessaging.sendToOriginator.mock.calls.filter(([replyChannel]) => replyChannel === channel).map(call => call[1]);
  }

  it('initializes the backup system', async () => {
    await initializeBackupSystem();

    expect(mockBackup.initializeBackupSystem).toHaveBeenCalled();
  });

  describe.each([
    {
      channel: 'create-backup', method: mockBackup.createBackup, fallback: 'Failed to create backup',
      payload: { type: 'manual', name: 'Before update' }, args: ['a1', 'manual', 'Before update'],
      result: { success: true, backupId: 'b1', message: 'Backup created' }, reply: { backupId: 'b1', message: 'Backup created' }
    },
    {
      channel: 'get-backup-list', method: mockBackup.getBackupList, fallback: 'Failed to get backup list',
      payload: {}, args: ['a1'], result: { success: true, backups: [] }, reply: { backups: [] }
    },
    {
      channel: 'restore-backup', method: mockBackup.restoreBackup, fallback: 'Failed to restore backup',
      payload: { backupId: 'b1' }, args: ['a1', 'b1'], result: { success: true, message: 'Restored' }, reply: { message: 'Restored' }
    },
    {
      channel: 'get-backup-settings', method: mockBackup.getBackupSettings, fallback: 'Failed to get backup settings',
      payload: {}, args: ['a1'], result: { success: true, settings }, reply: { settings }
    },
    {
      channel: 'save-backup-settings', method: mockBackup.saveBackupSettings, fallback: 'Failed to save backup settings',
      payload: { settings }, args: ['a1', settings], result: { success: true, message: 'Saved' }, reply: { message: 'Saved' }
    },
    {
      channel: 'start-backup-scheduler', method: mockBackup.startBackupScheduler, fallback: 'Failed to start backup scheduler',
      payload: {}, args: ['a1'], result: { success: true, message: 'Started' }, reply: { message: 'Started' }
    },
    {
      channel: 'stop-backup-scheduler', method: mockBackup.stopBackupScheduler, fallback: 'Failed to stop backup scheduler',
      payload: {}, args: ['a1'], result: { success: true, message: 'Stopped' }, reply: { message: 'Stopped' }
    },
    {
      channel: 'get-scheduler-status', method: mockBackup.getSchedulerStatus, fallback: 'Failed to get scheduler status',
      payload: {}, args: ['a1'], result: { success: true, isRunning: true, nextBackup }, reply: { isRunning: true, nextBackup }
    },
    {
      channel: 'download-backup', method: mockBackup.downloadBackup, fallback: 'Failed to prepare backup download',
      payload: { backupId: 'b1' }, args: ['a1', 'b1'], result: { success: true, filePath: '/backups/b1.zip', fileName: 'b1.zip' },
      reply: { filePath: '/backups/b1.zip', fileName: 'b1.zip', message: 'Backup file revealed in file explorer' }
    }
  ])('$channel', ({ channel, method, fallback, payload, args, result, reply }) => {
    const service = method as jest.Mock;

    it('passes the request on and replies with the result fields', async () => {
      service.mockResolvedValue(result);

      await handlers[channel]({ instanceId: 'a1', ...payload, requestId: 'r1' }, sender);

      expect(service).toHaveBeenCalledWith(...args);
      expect(replies(channel)).toEqual([{ success: true, ...reply, requestId: 'r1' }]);
    });

    it.each(['Backup not found', undefined])('replies only the error of a failed result (%p)', async error => {
      service.mockResolvedValue({ success: false, error, backupId: 'ignored', message: 'ignored' });

      await handlers[channel]({ instanceId: 'a1', ...payload, requestId: 'r1' }, sender);

      expect(replies(channel)).toEqual([{ success: false, error, requestId: 'r1' }]);
    });

    it.each([
      ['an Error', new Error('Disk full'), 'Disk full'],
      ['a number', 42, fallback]
    ])('replies a failure when the service throws %s', async (_label, thrown, error) => {
      service.mockRejectedValue(thrown);

      await handlers[channel]({ instanceId: 'a1', ...payload, requestId: 'r1' }, sender);

      expect(replies(channel)).toEqual([{ success: false, error, requestId: 'r1' }]);
    });

    it.each([[{ instanceId: '../x', requestId: 'r1' }, 'r1'], [undefined, undefined]])(
      'refuses an invalid instance id without calling the service (payload %p)',
      async (request, requestId) => {
        await handlers[channel](request, sender);

        expect(service).not.toHaveBeenCalled();
        expect(replies(channel)).toEqual([{ success: false, error: 'Invalid instance ID', requestId }]);
      }
    );
  });

  describe('delete-backup', () => {
    it('deletes the backup and replies with the message', async () => {
      mockBackup.deleteBackup.mockResolvedValue({ success: true, message: 'Deleted' });

      await handlers['delete-backup']({ backupId: 'b1', requestId: 'r1' }, sender);

      expect(mockBackup.deleteBackup).toHaveBeenCalledWith('b1', undefined);
      expect(replies('delete-backup')).toEqual([{ success: true, message: 'Deleted', requestId: 'r1' }]);
    });

    it('deletes from the instance given, when there is one', async () => {
      mockBackup.deleteBackup.mockResolvedValue({ success: true, message: 'Deleted' });

      await handlers['delete-backup']({ backupId: 'b1', instanceId: 'a1', requestId: 'r1' }, sender);

      expect(mockBackup.deleteBackup).toHaveBeenCalledWith('b1', 'a1');
    });

    it('refuses an invalid instance id', async () => {
      await handlers['delete-backup']({ backupId: 'b1', instanceId: '../x', requestId: 'r1' }, sender);

      expect(mockBackup.deleteBackup).not.toHaveBeenCalled();
      expect(replies('delete-backup')).toEqual([{ success: false, error: 'Invalid instance ID', requestId: 'r1' }]);
    });

    it('replies only the error of a failed delete', async () => {
      mockBackup.deleteBackup.mockResolvedValue({ success: false, error: 'Backup not found' });

      await handlers['delete-backup']({ backupId: 'b1', requestId: 'r1' }, sender);

      expect(replies('delete-backup')).toEqual([{ success: false, error: 'Backup not found', requestId: 'r1' }]);
    });

    it.each([
      ['an Error', new Error('Delete failed'), 'Delete failed'],
      ['a number', 42, 'Failed to delete backup']
    ])('replies a failure when deleting throws %s', async (_label, thrown, error) => {
      mockBackup.deleteBackup.mockRejectedValue(thrown);

      await handlers['delete-backup']({ backupId: 'b1', requestId: 'r1' }, sender);

      expect(replies('delete-backup')).toEqual([{ success: false, error, requestId: 'r1' }]);
    });

    it('answers a request without a payload', async () => {
      mockBackup.deleteBackup.mockResolvedValue({ success: false, error: 'Backup ID is required' });

      await handlers['delete-backup'](undefined, sender);

      expect(mockBackup.deleteBackup).toHaveBeenCalledWith(undefined, undefined);
      expect(replies('delete-backup')).toEqual([{ success: false, error: 'Backup ID is required', requestId: undefined }]);
    });
  });

  describe('download-backup on the desktop', () => {
    const request = { instanceId: 'a1', backupId: 'b1', requestId: 'r1' };

    it('reveals the file in the file explorer', async () => {
      mockBackup.downloadBackup.mockResolvedValue({ success: true, filePath: '/backups/b1.zip', fileName: 'b1.zip' });

      await handlers['download-backup'](request, sender);

      expect(shell.showItemInFolder).toHaveBeenCalledWith('/backups/b1.zip');
    });

    it('reveals nothing when headless', async () => {
      jest.mocked(applicationService.isHeadless).mockReturnValue(true);
      mockBackup.downloadBackup.mockResolvedValue({ success: true, filePath: '/backups/b1.zip', fileName: 'b1.zip' });

      await handlers['download-backup'](request, sender);

      expect(shell.showItemInFolder).not.toHaveBeenCalled();
      expect(replies('download-backup')).toEqual([
        { success: true, filePath: '/backups/b1.zip', fileName: 'b1.zip', message: undefined, requestId: 'r1' }
      ]);
    });

    it('still replies with the file when revealing it fails', async () => {
      jest.mocked(shell.showItemInFolder).mockImplementationOnce(() => { throw new Error('no explorer'); });
      mockBackup.downloadBackup.mockResolvedValue({ success: true, filePath: '/backups/b1.zip', fileName: 'b1.zip' });

      await handlers['download-backup'](request, sender);

      expect(replies('download-backup')).toEqual([
        { success: true, filePath: '/backups/b1.zip', fileName: 'b1.zip', message: undefined, requestId: 'r1' }
      ]);
    });
  });
});
