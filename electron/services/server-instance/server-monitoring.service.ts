import { getProcessCpuSeconds, getProcessMemoryUsage, processCpuPercent } from '../../utils/platform.utils';
import { isRconConnected, isRconConnecting } from '../../utils/rcon.utils';
import { getInstanceLogs } from '../../utils/ark/ark-server/ark-server-logging.utils';
import { getNormalizedInstanceState } from '../../utils/ark/ark-server/ark-server-state.utils';
import type { PlayerCountResult, ServerLogsResult } from '../../types/server-instance.types';
import { messagingService } from '../messaging.service';
import { rconService } from '../rcon.service';
import { serverProcessService } from './server-process.service';

const PLAYER_POLL_MS = 30000;
const MEMORY_POLL_MS = 60000;
const CPU_POLL_MS = 10000;

export class ServerMonitoringService {
  private latestPlayerCounts: Record<string, number> = {};
  private playerPollingIntervals: Record<string, NodeJS.Timeout> = {};
  private memoryPollingIntervals: Record<string, NodeJS.Timeout> = {};
  private cpuPollingIntervals: Record<string, NodeJS.Timeout> = {};
  private cpuSamples: Record<string, { seconds: number; at: number }> = {};
  private latestCpuPercents: Record<string, number> = {};

  getInstanceLogs(instanceId: string, maxLines = 200): ServerLogsResult {
    try {
      return { log: getInstanceLogs(instanceId, maxLines).join('\n'), instanceId };
    } catch (error) {
      console.error(`[server-monitoring] Failed to read logs for ${instanceId}:`, error);
      return { log: '', instanceId };
    }
  }

  /** Reports the player count through `callback` when it changes. */
  startPlayerPolling(instanceId: string, callback: (instanceId: string, count: number) => void): void {
    this.stopPlayerPolling(instanceId);

    this.playerPollingIntervals[instanceId] = setInterval(async () => {
      try {
        // Every poll doubles as a reconnect attempt, so a connection that dropped, or that missed
        // its window on a slow Proton boot, comes back by itself.
        if (!isRconConnected(instanceId)) {
          if (getNormalizedInstanceState(instanceId) === 'running' && !isRconConnecting(instanceId)) {
            this.reconnectRcon(instanceId);
          }
          return;
        }
        const playerCount = await this.getPlayerCountFromRcon(instanceId);
        if (playerCount !== null && playerCount !== this.latestPlayerCounts[instanceId]) {
          this.latestPlayerCounts[instanceId] = playerCount;
          callback(instanceId, playerCount);
        }
      } catch (error) {
        console.debug(`[server-monitoring] Player polling failed for ${instanceId}:`, error);
      }
    }, PLAYER_POLL_MS);
  }

  private reconnectRcon(instanceId: string): void {
    void rconService.connectRcon(instanceId)
      .then(({ connected }) => {
        if (connected) messagingService.sendToAll('rcon-status', { instanceId, connected: true });
      })
      .catch(error => console.debug(`[server-monitoring] RCON reconnect failed for ${instanceId}:`, error));
  }

  /** Stops polling and forgets the count, so a stopped server does not report stale players. */
  stopPlayerPolling(instanceId: string): void {
    clearInterval(this.playerPollingIntervals[instanceId]);
    delete this.playerPollingIntervals[instanceId];
    delete this.latestPlayerCounts[instanceId];
  }

  startMemoryPolling(instanceId: string, callback: (instanceId: string, memory: number) => void): void {
    this.stopMemoryPolling(instanceId);

    this.memoryPollingIntervals[instanceId] = setInterval(async () => {
      try {
        const child = serverProcessService.getServerProcess(instanceId);
        if (!child?.pid) return;
        const memory = await getProcessMemoryUsage(child.pid);
        if (memory !== null) {
          callback(instanceId, memory);
        }
      } catch (error) {
        console.debug(`[server-monitoring] Memory polling failed for ${instanceId}:`, error);
      }
    }, MEMORY_POLL_MS);
  }

  stopMemoryPolling(instanceId: string): void {
    clearInterval(this.memoryPollingIntervals[instanceId]);
    delete this.memoryPollingIntervals[instanceId];
  }

  /**
   * The first tick only records a baseline; each later tick reports the share of the machine used
   * since the previous one, so the number reflects recent load rather than the lifetime average.
   */
  startCpuPolling(instanceId: string, callback: (instanceId: string, cpuPercent: number) => void, intervalMs = CPU_POLL_MS): void {
    this.stopCpuPolling(instanceId);

    this.cpuPollingIntervals[instanceId] = setInterval(async () => {
      try {
        const child = serverProcessService.getServerProcess(instanceId);
        if (!child?.pid) return;

        const seconds = await getProcessCpuSeconds(child.pid);
        if (seconds === null) return;

        const now = Date.now();
        const previous = this.cpuSamples[instanceId];
        this.cpuSamples[instanceId] = { seconds, at: now };
        if (!previous) return;

        const percent = processCpuPercent(previous.seconds, seconds, now - previous.at);
        this.latestCpuPercents[instanceId] = percent;
        callback(instanceId, percent);
      } catch (error) {
        console.debug(`[server-monitoring] CPU polling failed for ${instanceId}:`, error);
      }
    }, intervalMs);
  }

  /** Stops polling and forgets the last reading, so a stopped server does not report stale load. */
  stopCpuPolling(instanceId: string): void {
    clearInterval(this.cpuPollingIntervals[instanceId]);
    delete this.cpuPollingIntervals[instanceId];
    delete this.cpuSamples[instanceId];
    delete this.latestCpuPercents[instanceId];
  }

  /** The last CPU percentage, or null before two samples exist. */
  getLatestCpuPercent(instanceId: string): number | null {
    const value = this.latestCpuPercents[instanceId];
    return typeof value === 'number' ? value : null;
  }

  /** Players from ListPlayers, or null when the command failed. */
  async getPlayerCountFromRcon(instanceId: string): Promise<number | null> {
    try {
      const result = await rconService.executeRconCommand(instanceId, 'ListPlayers');
      if (!result.success || !result.response) return null;
      const response = result.response;

      const match = response.match(/There are (\d+) players? connected/)
        || response.match(/There are (\d+) of a max \d+ players? connected/);
      if (match) {
        return parseInt(match[1], 10);
      }

      // ARK's usual answer: one numbered line per player.
      const playerLines = response.split('\n').filter(line => /^\d+\.\s/.test(line.trim()));
      if (playerLines.length > 0) {
        return playerLines.length;
      }

      if (!response.toLowerCase().includes('no players connected')) {
        console.warn(`[server-monitoring] Could not parse the player count for ${instanceId}`);
      }
      return 0;
    } catch (error) {
      console.debug(`[server-monitoring] Failed to get the player count for ${instanceId}:`, error);
      return null;
    }
  }

  getLatestPlayerCount(instanceId: string): number {
    return this.latestPlayerCounts[instanceId] || 0;
  }

  getPlayerCount(instanceId: string): PlayerCountResult {
    return { instanceId, players: this.getLatestPlayerCount(instanceId) };
  }
}

export const serverMonitoringService = new ServerMonitoringService();
