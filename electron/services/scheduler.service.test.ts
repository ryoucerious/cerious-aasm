import { jest } from '@jest/globals';

jest.mock('./rcon.service', () => ({
  rconService: {
    executeRconCommand: jest.fn(() => Promise.resolve({ success: true })),
  },
}));

jest.mock('../utils/ark/instance.utils', () => ({
  getInstance: jest.fn(),
  getAllInstances: jest.fn(),
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
    jest.useFakeTimers({ now: new Date('2024-01-01T00:00:00.000Z') });
    service = new SchedulerService();
    (mockRcon.executeRconCommand as jest.Mock<any>).mockResolvedValue({ success: true });
  });

  afterEach(() => {
    // Clean up any running intervals
    service.stopScheduler('inst1');
    service.stopScheduler('inst2');
    jest.useRealTimers();
  });

  describe('initSchedule', () => {
    it('should initialize from broadcastConfig', async () => {
      (mockInstanceUtils.getInstance as jest.Mock<any>).mockReturnValue({
        broadcastConfig: {
          enabled: true,
          messages: [
            { id: 'b1', message: 'Hello', interval: 5, enabled: true },
            { id: 'b2', message: 'World', interval: 10, enabled: false },
          ],
        },
      });

      await service.initSchedule('inst1');

      expect(mockInstanceUtils.getInstance).toHaveBeenCalledWith('inst1');

      await jest.advanceTimersByTimeAsync(5 * 1000);
      expect(mockRcon.executeRconCommand).toHaveBeenCalledWith('inst1', 'Broadcast Hello');
      expect(mockRcon.executeRconCommand).not.toHaveBeenCalledWith('inst1', 'Broadcast World');
    });

    it('should fall back to legacy instance.broadcasts', async () => {
      (mockInstanceUtils.getInstance as jest.Mock<any>).mockReturnValue({
        broadcasts: [
          { id: 'b1', message: 'Legacy', intervalMinutes: 5, enabled: true },
        ],
      });

      await service.initSchedule('inst1');
      await jest.advanceTimersByTimeAsync(5 * 1000);

      expect(mockRcon.executeRconCommand).toHaveBeenCalledWith('inst1', 'Broadcast Legacy');
    });

    it('should stop scheduler when broadcastConfig is disabled', async () => {
      (mockInstanceUtils.getInstance as jest.Mock<any>).mockReturnValue({
        broadcastConfig: {
          enabled: false,
          messages: [{ id: 'b1', message: 'Nope', interval: 1, enabled: true }],
        },
      });

      await service.initSchedule('inst1');
      await jest.advanceTimersByTimeAsync(120 * 1000);

      expect(mockRcon.executeRconCommand).not.toHaveBeenCalled();
    });

    it('should skip when instance not found', async () => {
      (mockInstanceUtils.getInstance as jest.Mock<any>).mockReturnValue(null);

      await service.initSchedule('missing');

      // Should not throw
    });

    it('should skip when instance has no broadcasts', async () => {
      (mockInstanceUtils.getInstance as jest.Mock<any>).mockReturnValue({ name: 'Server' });

      await service.initSchedule('inst1');

      // Should not throw
    });
  });

  describe('initAllSchedules', () => {
    it('should init schedules for all instances', async () => {
      (mockInstanceUtils.getAllInstances as jest.Mock<any>).mockResolvedValue([
        { id: 'inst1' },
        { id: 'inst2' },
      ]);
      (mockInstanceUtils.getInstance as jest.Mock<any>).mockImplementation((id: string) => ({
        id,
        broadcastConfig: {
          enabled: true,
          messages: [{ id: 'b1', message: `Hi ${id}`, interval: 5, enabled: true }],
        },
      }));

      await service.initAllSchedules();
      await jest.advanceTimersByTimeAsync(5 * 1000);

      expect(mockRcon.executeRconCommand).toHaveBeenCalledWith('inst1', 'Broadcast Hi inst1');
      expect(mockRcon.executeRconCommand).toHaveBeenCalledWith('inst2', 'Broadcast Hi inst2');
    });
  });

  describe('startScheduler / stopScheduler', () => {
    it('should start checking and fire an initial check', async () => {
      service.updateBroadcasts('inst1', [
        { id: 'b1', message: 'Test', interval: 1, enabled: true },
      ]);

      service.startScheduler('inst1');

      await jest.advanceTimersByTimeAsync(5 * 1000);

      expect(mockRcon.executeRconCommand).toHaveBeenCalledWith('inst1', 'Broadcast Test');
    });

    it('should stop the scheduler', async () => {
      service.updateBroadcasts('inst1', [
        { id: 'b1', message: 'Test', interval: 1, enabled: true },
      ]);

      service.startScheduler('inst1');
      service.stopScheduler('inst1');

      await jest.advanceTimersByTimeAsync(120 * 1000);

      expect(mockRcon.executeRconCommand).not.toHaveBeenCalled();
    });

    it('should replace existing scheduler on restart', async () => {
      service.updateBroadcasts('inst1', [
        { id: 'b1', message: 'Test', interval: 1, enabled: true },
      ]);

      service.startScheduler('inst1');
      service.startScheduler('inst1'); // Should clear first timers

      await jest.advanceTimersByTimeAsync(5 * 1000);
      expect(mockRcon.executeRconCommand).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkBroadcasts', () => {
    it('should not execute disabled broadcasts', async () => {
      service.updateBroadcasts('inst1', [
        { id: 'b1', message: 'Disabled', interval: 1, enabled: false },
      ]);

      service.startScheduler('inst1');
      await jest.advanceTimersByTimeAsync(60 * 1000);

      expect(mockRcon.executeRconCommand).not.toHaveBeenCalled();
    });

    it('should schedule next run after executing using interval', async () => {
      service.updateBroadcasts('inst1', [
        { id: 'b1', message: 'Hello', interval: 5, enabled: true },
      ]);

      service.startScheduler('inst1');

      // Initial 5s check
      await jest.advanceTimersByTimeAsync(5 * 1000);
      expect(mockRcon.executeRconCommand).toHaveBeenCalledTimes(1);

      // Still inside the 5-minute window (interval ticks at 60s boundaries)
      await jest.advanceTimersByTimeAsync(4 * 60 * 1000);
      expect(mockRcon.executeRconCommand).toHaveBeenCalledTimes(1);

      // Advance past nextRun and to the next 60s interval tick
      await jest.advanceTimersByTimeAsync(2 * 60 * 1000);
      expect(mockRcon.executeRconCommand).toHaveBeenCalledTimes(2);
    });

    it('should retry later when RCON is not connected', async () => {
      (mockRcon.executeRconCommand as jest.Mock<any>).mockResolvedValue({
        success: false,
        error: 'RCON not connected for this instance',
      });

      service.updateBroadcasts('inst1', [
        { id: 'b1', message: 'Hello', interval: 5, enabled: true },
      ]);

      service.startScheduler('inst1');
      await jest.advanceTimersByTimeAsync(5 * 1000);
      expect(mockRcon.executeRconCommand).toHaveBeenCalledTimes(1);

      (mockRcon.executeRconCommand as jest.Mock<any>).mockResolvedValue({ success: true });
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
        { id: 'b1', message: 'Updated', interval: 10, enabled: true },
      ];

      service.updateBroadcasts('inst1', newBroadcasts);

      expect(() => service.startScheduler('inst1')).not.toThrow();
    });
  });
});
