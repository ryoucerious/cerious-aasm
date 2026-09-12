import { jest } from '@jest/globals';

jest.mock('./auth/user-database.service', () => ({
  userDatabaseService: {
    recordPlayerCounts: jest.fn(),
    listPlayerHistory: jest.fn(() => [])
  }
}));

import { PlayerHistoryService } from './player-history.service';
import { userDatabaseService } from './auth/user-database.service';

const mockDb = userDatabaseService as jest.Mocked<typeof userDatabaseService>;

describe('PlayerHistoryService', () => {
  let service: PlayerHistoryService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    (mockDb.listPlayerHistory as jest.Mock).mockReturnValue([]);
    service = new PlayerHistoryService();
  });

  afterEach(() => {
    service.stop();
    jest.useRealTimers();
  });

  it('writes a sample to the database with the retention window', () => {
    service.record({ a: 3, b: 0 }, 1000);
    expect(mockDb.recordPlayerCounts).toHaveBeenCalledWith(
      { a: 3, b: 0 },
      1000,
      PlayerHistoryService.RETENTION_MS
    );
  });

  it('samples immediately on start and then once per interval', async () => {
    const getCounts = jest.fn(async () => ({ x: 4 }));
    service.start(getCounts as any);
    await Promise.resolve();
    expect(getCounts).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(PlayerHistoryService.SAMPLE_INTERVAL_MS);
    await Promise.resolve();
    expect(getCounts).toHaveBeenCalledTimes(2);

    service.stop();
    jest.advanceTimersByTime(PlayerHistoryService.SAMPLE_INTERVAL_MS * 3);
    expect(getCounts).toHaveBeenCalledTimes(2);
  });

  it('keeps sampling when a tick throws', async () => {
    const getCounts = jest.fn<() => Promise<Record<string, number>>>()
      .mockRejectedValueOnce(new Error('rcon down'))
      .mockResolvedValue({ x: 1 });
    service.start(getCounts as any);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockDb.recordPlayerCounts).not.toHaveBeenCalled();

    jest.advanceTimersByTime(PlayerHistoryService.SAMPLE_INTERVAL_MS);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockDb.recordPlayerCounts).toHaveBeenCalledTimes(1);
  });

  it('reads samples inside the retention window', () => {
    const now = 10_000_000;
    const rows = [{ t: now - 1000, counts: { a: 2 } }];
    (mockDb.listPlayerHistory as jest.Mock).mockReturnValue(rows);

    expect(service.getSamples(now)).toBe(rows);
    expect(mockDb.listPlayerHistory).toHaveBeenCalledWith(now - PlayerHistoryService.RETENTION_MS);
  });

  it('survives a database that cannot be read or written', () => {
    (mockDb.recordPlayerCounts as jest.Mock).mockImplementation(() => { throw new Error('locked'); });
    (mockDb.listPlayerHistory as jest.Mock).mockImplementation(() => { throw new Error('locked'); });

    expect(() => service.record({ a: 1 })).not.toThrow();
    expect(service.getSamples()).toEqual([]);
  });
});
