import { BackupSchedulerService } from './backup-scheduler.service';
import { BackupResult, BackupSettings } from '../../types/backup.types';

jest.mock('../messaging.service', () => ({ messagingService: { sendToAll: jest.fn() } }));
jest.mock('../../utils/ark/instance.utils', () => ({ getInstance: jest.fn(() => ({ name: 'My Server' })) }));

const { messagingService } = jest.requireMock('../messaging.service') as { messagingService: { sendToAll: jest.Mock } };

const HOUR = 60 * 60 * 1000;

const settings = (overrides: Partial<BackupSettings> = {}): BackupSettings => ({
  instanceId: 'inst-1',
  enabled: true,
  frequency: 'daily',
  time: '02:00',
  maxBackupsToKeep: 5,
  ...overrides
});

function channels(): string[] {
  return messagingService.sendToAll.mock.calls.map(([channel]) => channel);
}

describe('BackupSchedulerService', () => {
  let service: BackupSchedulerService;

  beforeEach(() => {
    // Monday 29 September 2025, 10:00 host local time.
    jest.useFakeTimers({ now: new Date(2025, 8, 29, 10, 0, 0) });
    service = new BackupSchedulerService();
  });

  afterEach(() => {
    service.stopBackupSchedulerInternal('inst-1');
    jest.useRealTimers();
  });

  async function status() {
    return service.getSchedulerStatus('inst-1');
  }

  it('arms a daily schedule for the next time of day and reports it', async () => {
    const createBackup = jest.fn().mockResolvedValue({ success: true, backupId: 'b1' });

    service.startBackupSchedulerInternal('inst-1', settings(), createBackup);

    await expect(status()).resolves.toEqual({ success: true, isRunning: true, nextBackup: new Date(2025, 8, 30, 2, 0) });
    await jest.advanceTimersByTimeAsync(16 * HOUR - 1);
    expect(createBackup).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(createBackup).toHaveBeenCalledWith('inst-1', 'scheduled');
    await expect(status()).resolves.toMatchObject({ nextBackup: new Date(2025, 9, 1, 2, 0) });
  });

  it('arms a weekly schedule for its weekday', async () => {
    service.startBackupSchedulerInternal('inst-1', settings({ frequency: 'weekly', time: '03:00', dayOfWeek: 3 }), jest.fn());

    await expect(status()).resolves.toMatchObject({ nextBackup: new Date(2025, 9, 1, 3, 0) });
  });

  // The status used to add 7 days to today's time for weekly and nothing for hourly.
  it('reports the next hourly backup an hour on', async () => {
    service.startBackupSchedulerInternal('inst-1', settings({ frequency: 'hourly' }), jest.fn());

    await expect(status()).resolves.toMatchObject({ nextBackup: new Date(2025, 8, 29, 11, 0) });
  });

  it('stops a schedule', async () => {
    const createBackup = jest.fn();
    service.startBackupSchedulerInternal('inst-1', settings(), createBackup);

    service.stopBackupSchedulerInternal('inst-1');

    await expect(status()).resolves.toEqual({ success: true, isRunning: false, nextBackup: undefined });
    await jest.advanceTimersByTimeAsync(48 * HOUR);
    expect(createBackup).not.toHaveBeenCalled();
  });

  // A schedule stopped while its backup ran used to arm itself again afterwards, for good.
  it('stays stopped when stopped during a scheduled backup', async () => {
    let finishBackup: (result: BackupResult) => void = () => undefined;
    const createBackup = jest.fn(() => new Promise<BackupResult>(resolve => { finishBackup = resolve; }));
    service.startBackupSchedulerInternal('inst-1', settings({ frequency: 'hourly' }), createBackup);

    await jest.advanceTimersByTimeAsync(HOUR);
    service.stopBackupSchedulerInternal('inst-1');
    finishBackup({ success: true, backupId: 'b1' });
    await jest.advanceTimersByTimeAsync(5 * HOUR);

    expect(createBackup).toHaveBeenCalledTimes(1);
    await expect(status()).resolves.toMatchObject({ isRunning: false });
  });

  it('keeps a single schedule when restarted during a scheduled backup', async () => {
    let finishBackup: (result: BackupResult) => void = () => undefined;
    const createBackup = jest.fn()
      .mockImplementationOnce(() => new Promise<BackupResult>(resolve => { finishBackup = resolve; }))
      .mockResolvedValue({ success: true, backupId: 'b2' });
    service.startBackupSchedulerInternal('inst-1', settings({ frequency: 'hourly' }), createBackup);

    await jest.advanceTimersByTimeAsync(HOUR);
    service.startBackupSchedulerInternal('inst-1', settings({ frequency: 'hourly' }), createBackup);
    finishBackup({ success: true, backupId: 'b1' });
    await jest.advanceTimersByTimeAsync(3 * HOUR);

    expect(createBackup).toHaveBeenCalledTimes(4);
  });

  // An hourly backup that ran longer than an hour used to overlap the next one.
  // Neither run back to back for the slots a slow backup missed, nor drifting off the hour.
  it('keeps an hourly schedule on its slots, skipping those a slow backup missed', async () => {
    let finishBackup: (result: BackupResult) => void = () => undefined;
    const createBackup = jest.fn()
      .mockResolvedValueOnce({ success: true, backupId: 'b1' })
      .mockImplementationOnce(() => new Promise<BackupResult>(resolve => { finishBackup = resolve; }))
      .mockResolvedValue({ success: true, backupId: 'b3' });
    service.startBackupSchedulerInternal('inst-1', settings({ frequency: 'hourly' }), createBackup);

    await jest.advanceTimersByTimeAsync(4.5 * HOUR);
    expect(createBackup).toHaveBeenCalledTimes(2);

    finishBackup({ success: true, backupId: 'b2' });
    await jest.advanceTimersByTimeAsync(0);
    await expect(status()).resolves.toMatchObject({ nextBackup: new Date(2025, 8, 29, 15, 0) });
    await jest.advanceTimersByTimeAsync(0.5 * HOUR - 1);
    expect(createBackup).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(createBackup).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['no weekday that exists', { frequency: 'weekly' as const, dayOfWeek: 9 }],
    ['an unknown frequency', { frequency: 'monthly' as unknown as BackupSettings['frequency'] }]
  ])('does not arm a schedule with %s', async (_label, overrides) => {
    service.startBackupSchedulerInternal('inst-1', settings(overrides), jest.fn());

    await expect(status()).resolves.toMatchObject({ isRunning: false });
    expect(jest.getTimerCount()).toBe(0);
  });

  // A malformed `time` used to throw out of here and abort schedule restore at startup, for this
  // instance and every one after it.
  describe('malformed schedule time', () => {
    it.each([undefined, null, '', 'not-a-time', '99:99', '2', {}])('falls back to 02:00 for %p', async time => {
      service.startBackupSchedulerInternal('inst-1', settings({ time: time as unknown as string }), jest.fn());

      await expect(status()).resolves.toMatchObject({ isRunning: true, nextBackup: new Date(2025, 8, 30, 2, 0) });
    });
  });

  describe('failure reporting', () => {
    it('notifies the UI when a scheduled backup returns failure', async () => {
      const createBackup = jest.fn().mockResolvedValue({ success: false, error: 'disk full' });
      service.startBackupSchedulerInternal('inst-1', settings({ frequency: 'hourly' }), createBackup);

      await jest.advanceTimersByTimeAsync(HOUR);

      expect(channels()).toEqual(expect.arrayContaining(['notification', 'server-instance-log']));
      const notification = messagingService.sendToAll.mock.calls.find(([channel]) => channel === 'notification')![1];
      expect(notification.type).toBe('error');
      expect(notification.message).toContain('My Server');
      expect(notification.message).toContain('disk full');
    });

    it('notifies the UI when a scheduled backup throws, and keeps the schedule', async () => {
      const createBackup = jest.fn().mockRejectedValue(new Error('zip exploded'));
      service.startBackupSchedulerInternal('inst-1', settings({ frequency: 'hourly' }), createBackup);

      await jest.advanceTimersByTimeAsync(HOUR);

      const notification = messagingService.sendToAll.mock.calls.find(([channel]) => channel === 'notification')![1];
      expect(notification.message).toContain('zip exploded');
      await expect(status()).resolves.toMatchObject({ isRunning: true });
    });

    it('stays quiet on success and emits backup-created', async () => {
      const createBackup = jest.fn().mockResolvedValue({ success: true, backupId: 'b1', message: 'Backup created successfully' });
      service.startBackupSchedulerInternal('inst-1', settings({ frequency: 'hourly' }), createBackup);

      await jest.advanceTimersByTimeAsync(HOUR);

      expect(messagingService.sendToAll).toHaveBeenCalledWith('backup-created', {
        instanceId: 'inst-1', backupId: 'b1', type: 'scheduled', message: 'Backup created successfully', success: true
      });
      expect(channels()).not.toContain('notification');
    });
  });
});
