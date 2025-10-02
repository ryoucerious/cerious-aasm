import { getProcessMemoryUsage } from '../../utils/platform.utils';
import { rconService } from '../rcon.service';
import { ServerStateResult, ServerLogsResult, PlayerCountResult } from '../../types/server-instance.types';
import { setupLogTailing } from '../../utils/ark/ark-server/ark-server-logging.utils';
import { getInstance } from '../../utils/ark/instance.utils';

/**
 * Server Monitoring Service - Handles player polling, memory polling, and log monitoring
 */
export class ServerMonitoringService {
  // Track latest player counts to avoid redundant broadcasts
  private latestPlayerCounts: Record<string, number> = {};

  // Track player polling intervals internally
  private playerPollingIntervals: Record<string, NodeJS.Timeout> = {};

  // Track callbacks for player updates
  private playerUpdateCallbacks: Record<string, (instanceId: string, count: number) => void> = {};

  // Track memory polling intervals internally
  private memoryPollingIntervals: Record<string, NodeJS.Timeout> = {};

  // Track callbacks for memory updates
  private memoryUpdateCallbacks: Record<string, (instanceId: string, memory: number) => void> = {};

  /**
   * Get server instance state (uses backend state utils)
   */
  getInstanceState(instanceId: string): ServerStateResult {
    const { getInstanceState } = require('../../utils/ark/ark-server/ark-server-state.utils');
    const state = getInstanceState(instanceId) || 'unknown';
    return {
      state,
      instanceId
    };
  }

  /**
   * Get server instance logs
   */
  getInstanceLogs(instanceId: string, maxLines = 200): ServerLogsResult {
    try {
      // Only return logs if server is running, starting, or stopping
      const state = this.getInstanceState(instanceId).state.toLowerCase();
      if (state !== 'running' && state !== 'starting' && state !== 'stopping') {
        return {
          log: '',
          instanceId
        };
      }

      // Use the new logging utilities to get instance logs
      const { getInstanceLogs } = require('../../utils/ark/ark-server/ark-server-logging.utils');
      const logLines = getInstanceLogs(instanceId, maxLines);

      return {
        log: logLines.join('\n'),
        instanceId
      };
    } catch (error) {
      console.error(`[server-monitoring-service] Failed to get logs for instance ${instanceId}:`, error);
      return {
        log: '',
        instanceId
      };
    }
  }

  /**
   * Set up log file monitoring and tailing for real-time updates using new backend utils
   */
  setupLogMonitoring(instanceId: string, _instance: any, onLog?: (line: string) => void, onState?: (state: string) => void): void {
    // Use new instance and log tailing utilities
    const instance = getInstance(instanceId);
    if (!instance) {
      console.warn(`[server-monitoring-service] No instance config found for ${instanceId}`);
      return;
    }
    const instanceDir = require('path').join(require('../../utils/ark/instance.utils').getInstancesBaseDir(), instanceId);
    setupLogTailing(instanceId, instanceDir, instance, onLog, onState);
  }

  /**
   * Start tailing a log file for real-time monitoring
   */
  private startLogTailing(instanceId: string, logFilePath: string, onState?: (state: string) => void): void {
    // Deprecated: replaced by setupLogMonitoring using setupLogTailing
  }

  /**
   * Start polling for player count updates
   */
  startPlayerPolling(instanceId: string, callback: (instanceId: string, count: number) => void): void {
    // Clear any existing polling for this instance
    this.stopPlayerPolling(instanceId);

    // Store the callback
    this.playerUpdateCallbacks[instanceId] = callback;

    // Start polling every 30 seconds
    this.playerPollingIntervals[instanceId] = setInterval(async () => {
      try {
        const playerCount = await this.getPlayerCountFromRcon(instanceId);
        if (playerCount !== null && playerCount !== this.latestPlayerCounts[instanceId]) {
          this.latestPlayerCounts[instanceId] = playerCount;
          callback(instanceId, playerCount);
        }
      } catch (error) {
        // Silently handle polling errors to avoid spam
        console.debug(`[server-monitoring-service] Player polling error for ${instanceId}:`, error);
      }
    }, 30000); // 30 seconds
  }

  /**
   * Stop polling for player count updates
   */
  stopPlayerPolling(instanceId: string): void {
    if (this.playerPollingIntervals[instanceId]) {
      clearInterval(this.playerPollingIntervals[instanceId]);
      delete this.playerPollingIntervals[instanceId];
    }
    if (this.playerUpdateCallbacks[instanceId]) {
      delete this.playerUpdateCallbacks[instanceId];
    }
  }

  /**
   * Start polling for memory usage updates
   */
  startMemoryPolling(instanceId: string, callback: (instanceId: string, memory: number) => void): void {
    // Clear any existing polling for this instance
    this.stopMemoryPolling(instanceId);

    // Store the callback
    this.memoryUpdateCallbacks[instanceId] = callback;

    // Start polling every 60 seconds
    this.memoryPollingIntervals[instanceId] = setInterval(async () => {
      try {
        // Get the process from lifecycle service (will be injected)
        const lifecycleService = require('./server-lifecycle.service').serverLifecycleService;
        const process = lifecycleService.getServerProcess(instanceId);

        if (process && process.pid) {
          const memoryUsage = getProcessMemoryUsage(process.pid);
          if (memoryUsage !== null) {
            callback(instanceId, memoryUsage);
          }
        }
      } catch (error) {
        // Silently handle polling errors to avoid spam
        console.debug(`[server-monitoring-service] Memory polling error for ${instanceId}:`, error);
      }
    }, 60000); // 60 seconds
  }

  /**
   * Stop polling for memory usage updates
   */
  stopMemoryPolling(instanceId: string): void {
    if (this.memoryPollingIntervals[instanceId]) {
      clearInterval(this.memoryPollingIntervals[instanceId]);
      delete this.memoryPollingIntervals[instanceId];
    }
    if (this.memoryUpdateCallbacks[instanceId]) {
      delete this.memoryUpdateCallbacks[instanceId];
    }
  }

  /**
   * Get player count for an instance using RCON
   */
  async getPlayerCountFromRcon(instanceId: string): Promise<number | null> {
    try {
      const result = await rconService.executeRconCommand(instanceId, 'ListPlayers');
      if (result.success && result.response) {

        // Parse the response to extract player count
        const match = result.response.match(/There are (\d+) players? connected/);
        if (match) {
          return parseInt(match[1], 10);
        }

        // Try alternative format: "There are X of a max Y players connected"
        const altMatch = result.response.match(/There are (\d+) of a max \d+ players? connected/);
        if (altMatch) {
          return parseInt(altMatch[1], 10);
        }

        // Fallback: count lines that look like player entries (numbered lines)
        const lines = result.response.split('\n').filter(line => line.trim().length > 0);
        const playerLines = lines.filter(line => /^\d+\.\s/.test(line.trim()));
        if (playerLines.length > 0) {
          return playerLines.length;
        }

        // If no players found and response contains "No Players Connected", return 0
        if (result.response.toLowerCase().includes('no players connected')) {
          return 0;
        }

        // Last resort: return 0 if we can't parse it
        console.warn(`[server-monitoring-service] Could not parse player count from response for ${instanceId}`);
        return 0;
      }
      return null;
    } catch (error) {
      console.debug(`[server-monitoring-service] Failed to get player count for ${instanceId}:`, error);
      return null;
    }
  }

  /**
   * Get latest player count for an instance
   */
  getLatestPlayerCount(instanceId: string): number {
    return this.latestPlayerCounts[instanceId] || 0;
  }

  /**
   * Get player count result for an instance
   */
  getPlayerCount(instanceId: string): PlayerCountResult {
    const players = this.getLatestPlayerCount(instanceId);
    return {
      instanceId,
      players
    };
  }

  /**
   * Update player count for an instance
   */
  updatePlayerCount(instanceId: string, players: number): void {
    this.latestPlayerCounts[instanceId] = players;
  }
}

// Export singleton instance
export const serverMonitoringService = new ServerMonitoringService();