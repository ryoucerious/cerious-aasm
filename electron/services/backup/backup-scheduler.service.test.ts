import { BackupSchedulerService } from './backup-scheduler.service';
import { BackupSettings } from '../../types/backup.types';

const sendToAll = jest.fn();
jest.mock('../../services/messaging.service', () => ({
  messagingService: { sendToAll: (...args: any[]) => sendToAll(...args) }
}), { virtual: true });
jest.mock('../../utils/ark/instance.utils', () => ({
  getInstance: jest.fn(() => ({ name: 'My Server' }))
}), { virtual: true });

const settings = (overrides: Partial<BackupSettings> = {}): BackupSettings => ({
  instanceId: 'inst-1',
  enabled: true,
  frequency: 'daily',
  time: '02:00',
  maxBackupsToKeep: 5,
  ...overrides
} as BackupSettings);

describe('BackupSchedulerService', () => {
  let service: BackupSchedulerService;

  beforeEach(() => {
    jest.useFakeTimers();
    sendToAll.mockClear();
    service = new BackupSchedulerService();
  });

  afterEach(() => {
    service.cleanup();
    jest.useRealTimers();
  });

  it('should instantiate', () => {
    expect(service).toBeDefined();
  });

  it('arms a schedule and reports it as running', async () => {
    await service.startBackupSchedulerInternal('inst-1', settings(), jest.fn());
    expect(service.isSchedulerRunning('inst-1')).toBe(true);
  });

  it('stops a schedule', async () => {
    await service.startBackupSchedulerInternal('inst-1', settings(), jest.fn());
    service.stopBackupSchedulerInternal('inst-1');
    expect(service.isSchedulerRunning('inst-1')).toBe(false);
  });

  // A malformed `time` used to throw out of here. Startup schedule restore ran every
  // instance through one try/catch, so a single bad settings file left that instance
  // AND every instance after it with no scheduler at all.
  describe('malformed schedule time', () => {
    const badTimes: any[] = [undefined, null, '', 'not-a-time', '99:99', '2', {}];

    for (const time of badTimes) {
      it(`does not throw for time=${JSON.stringify(time)} and still arms the schedule`, async () => {
        await expect(
          service.startBackupSchedulerInternal('inst-1', settings({ time }), jest.fn())
        ).resolves.not.toThrow();
        expect(service.isSchedulerRunning('inst-1')).toBe(true);
      });
    }

    it('falls back to 02:00 so the timer is a sane delay, not immediate', async () => {
      await service.startBackupSchedulerInternal('inst-1', settings({ time: 'garbage' as any }), jest.fn());
      // A NaN delay would collapse to ~1ms and fire a backup instantly
      expect(jest.getTimerCount()).toBe(1);
      jest.advanceTimersByTime(1000);
      expect(sendToAll).not.toHaveBeenCalled();
    });
  });

  describe('failure reporting', () => {
    it('notifies the UI when a scheduled backup returns failure', async () => {
      const createBackup = jest.fn().mockResolvedValue({ success: false, error: 'disk full' });
      await service.startBackupSchedulerInternal('inst-1', settings({ frequency: 'hourly' }), createBackup);

      await jest.advanceTimersByTimeAsync(60 * 60 * 1000);

      const channels = sendToAll.mock.calls.map(c => c[0]);
      expect(channels).toContain('notification');
      expect(channels).toContain('server-instance-log');

      const notification = sendToAll.mock.calls.find(c => c[0] === 'notification')![1];
      expect(notification.type).toBe('error');
      expect(notification.message).toContain('My Server');
      expect(notification.message).toContain('disk full');
    });

    it('notifies the UI when a scheduled backup throws', async () => {
      const createBackup = jest.fn().mockRejectedValue(new Error('zip exploded'));
      await service.startBackupSchedulerInternal('inst-1', settings({ frequency: 'hourly' }), createBackup);

      await jest.advanceTimersByTimeAsync(60 * 60 * 1000);

      const notification = sendToAll.mock.calls.find(c => c[0] === 'notification')![1];
      expect(notification.message).toContain('zip exploded');
    });

    it('stays quiet on success and emits backup-created', async () => {
      const createBackup = jest.fn().mockResolvedValue({ success: true, backupId: 'b1' });
      await service.startBackupSchedulerInternal('inst-1', settings({ frequency: 'hourly' }), createBackup);

      await jest.advanceTimersByTimeAsync(60 * 60 * 1000);

      const channels = sendToAll.mock.calls.map(c => c[0]);
      expect(channels).toContain('backup-created');
      expect(channels).not.toContain('notification');
    });
  });
});
