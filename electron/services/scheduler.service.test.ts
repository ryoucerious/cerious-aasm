import { jest } from '@jest/globals';

jest.mock('./rcon.service', () => ({
  rconService: {
    executeRconCommand: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('../utils/ark/instance.utils', () => ({
  getInstance: jest.fn(),
}));

import { rconService } from './rcon.service';
import * as instanceUtils from '../utils/ark/instance.utils';

const mockRcon = rconService as jest.Mocked<typeof rconService>;
const mockInstanceUtils = instanceUtils as jest.Mocked<typeof instanceUtils>;

describe('SchedulerService', () => {
  let SchedulerService: any;
  let service: any;

  beforeAll(() => {
    const mod = require('./scheduler.service');
    SchedulerService = mod.SchedulerService;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    service = new SchedulerService();
  });

  afterEach(() => {
    // Clean up any running intervals
    service.stopScheduler('inst1');
    service.stopScheduler('inst2');
    jest.useRealTimers();
  });

  describe('initSchedule', () => {
    it('should initialize broadcasts from instance config', async () => {
      const broadcasts = [
        { id: 'b1', message: 'Hello', intervalMinutes: 5, enabled: true },
        { id: 'b2', message: 'World', intervalMinutes: 10, enabled: false },
      ];
      (mockInstanceUtils.getInstance as jest.Mock<any>).mockResolvedValue({
        broadcasts,
      });

      await service.initSchedule('inst1');

      // Should have stored the broadcasts and started the scheduler
      expect(mockInstanceUtils.getInstance).toHaveBeenCalledWith('inst1');
    });

    it('should skip when instance not found', async () => {
      (mockInstanceUtils.getInstance as jest.Mock<any>).mockResolvedValue(null);

      await service.initSchedule('missing');

      // Should not throw
    });

    it('should skip when instance has no broadcasts', async () => {
      (mockInstanceUtils.getInstance as jest.Mock<any>).mockResolvedValue({ name: 'Server' });

      await service.initSchedule('inst1');

      // Should not throw
    });
  });

  describe('startScheduler / stopScheduler', () => {
    it('should start checking every minute', async () => {
      service.updateBroadcasts('inst1', [
        { id: 'b1', message: 'Test', intervalMinutes: 1, enabled: true },
      ]);

      service.startScheduler('inst1');

      // Advance 1 minute - should trigger check
      await jest.advanceTimersByTimeAsync(60 * 1000);

      // The broadcast has no nextRun, so it should execute
      expect(mockRcon.executeRconCommand).toHaveBeenCalledWith('inst1', 'Broadcast Test');
    });

    it('should stop the scheduler', async () => {
      service.updateBroadcasts('inst1', [
        { id: 'b1', message: 'Test', intervalMinutes: 1, enabled: true },
      ]);

      service.startScheduler('inst1');
      service.stopScheduler('inst1');

      await jest.advanceTimersByTimeAsync(120 * 1000);

      // Should not have been called since we stopped
      expect(mockRcon.executeRconCommand).not.toHaveBeenCalled();
    });

    it('should replace existing scheduler on restart', async () => {
      service.updateBroadcasts('inst1', [
        { id: 'b1', message: 'Test', intervalMinutes: 1, enabled: true },
      ]);

      service.startScheduler('inst1');
      service.startScheduler('inst1'); // Should clear first interval

      await jest.advanceTimersByTimeAsync(60 * 1000);
      // Should only be called once, not twice
      expect(mockRcon.executeRconCommand).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkBroadcasts', () => {
    it('should not execute disabled broadcasts', async () => {
      service.updateBroadcasts('inst1', [
        { id: 'b1', message: 'Disabled', intervalMinutes: 1, enabled: false },
      ]);

      service.startScheduler('inst1');
      await jest.advanceTimersByTimeAsync(60 * 1000);

      expect(mockRcon.executeRconCommand).not.toHaveBeenCalled();
    });

    it('should schedule next run after executing', async () => {
      service.updateBroadcasts('inst1', [
        { id: 'b1', message: 'Hello', intervalMinutes: 5, enabled: true },
      ]);

      service.startScheduler('inst1');

      // First minute - should execute (no nextRun set)
      await jest.advanceTimersByTimeAsync(60 * 1000);
      expect(mockRcon.executeRconCommand).toHaveBeenCalledTimes(1);

      // Second minute - should NOT execute (nextRun is 5 min from now)
      await jest.advanceTimersByTimeAsync(60 * 1000);
      expect(mockRcon.executeRconCommand).toHaveBeenCalledTimes(1);

      // 3rd-5th minutes
      await jest.advanceTimersByTimeAsync(3 * 60 * 1000);
      expect(mockRcon.executeRconCommand).toHaveBeenCalledTimes(1);

      // 6th minute (5 minutes after first) - should execute again
      await jest.advanceTimersByTimeAsync(60 * 1000);
      expect(mockRcon.executeRconCommand).toHaveBeenCalledTimes(2);
    });

    it('should handle no broadcasts for instance', async () => {
      service.startScheduler('inst1');
      await jest.advanceTimersByTimeAsync(60 * 1000);

      expect(mockRcon.executeRconCommand).not.toHaveBeenCalled();
    });
  });

  describe('updateBroadcasts', () => {
    it('should update the broadcasts list', () => {
      const newBroadcasts = [
        { id: 'b1', message: 'Updated', intervalMinutes: 10, enabled: true },
      ];

      service.updateBroadcasts('inst1', newBroadcasts);

      // Verify by starting scheduler and checking behavior
      expect(() => service.startScheduler('inst1')).not.toThrow();
    });
  });
});
