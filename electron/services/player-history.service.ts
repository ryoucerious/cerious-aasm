import { userDatabaseService } from './auth/user-database.service';

/**
 * One point on the dashboard's player-activity chart: the epoch-ms timestamp and the
 * player count of every known instance at that moment (0 for stopped servers).
 */
export interface PlayerHistorySample {
  t: number;
  counts: Record<string, number>;
}

/**
 * Keeps a rolling 24-hour record of player counts across all server instances.
 *
 * The renderer could sample this itself, but a browser tab on the web UI is not always open
 * and the desktop app is often minimised for days, so the record lives here where the servers
 * are. It is stored in the application database rather than a JSON file so every client sees
 * the same history and the rows can be queried per server.
 */
export class PlayerHistoryService {
  static readonly SAMPLE_INTERVAL_MS = 60 * 1000;
  static readonly RETENTION_MS = 24 * 60 * 60 * 1000;

  private timer: NodeJS.Timeout | null = null;

  /**
   * Begin sampling once a minute. `getCounts` is injected so this service does not have to
   * know how instances are enumerated; it should return the current player count per
   * instance id.
   */
  start(getCounts: () => Promise<Record<string, number>>): void {
    this.stop();

    const tick = async () => {
      try {
        const counts = await getCounts();
        this.record(counts);
      } catch (error) {
        console.debug('[player-history] Sampling failed:', error);
      }
    };

    this.timer = setInterval(tick, PlayerHistoryService.SAMPLE_INTERVAL_MS);
    // Take one sample immediately so a freshly started app has a point on the chart.
    tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Append a sample and drop anything past the retention window. */
  record(counts: Record<string, number>, at: number = Date.now()): void {
    try {
      userDatabaseService.recordPlayerCounts(counts || {}, at, PlayerHistoryService.RETENTION_MS);
    } catch (error) {
      console.debug('[player-history] Could not write sample:', error);
    }
  }

  /** Samples within the retention window, oldest first. */
  getSamples(now: number = Date.now()): PlayerHistorySample[] {
    try {
      return userDatabaseService.listPlayerHistory(now - PlayerHistoryService.RETENTION_MS);
    } catch (error) {
      console.debug('[player-history] Could not read samples:', error);
      return [];
    }
  }
}

export const playerHistoryService = new PlayerHistoryService();
