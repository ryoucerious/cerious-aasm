import { RconCommandNotSentError, connectRcon, disconnectRcon, getRconPassword, isRconConnected, sendRconCommand } from '../utils/rcon.utils';
import * as instanceUtils from '../utils/ark/instance.utils';
import { forRcon } from '../utils/ark/started-config.utils';

export interface RconConnectionResult {
  success: boolean;
  connected: boolean;
  instanceId: string;
  error?: string;
}

export interface RconCommandResult {
  success: boolean;
  response?: string;
  instanceId: string;
  error?: string;
  /** Set when the command provably never reached the server: no connection, or it timed out queued. */
  notSent?: true;
}

export interface RconStatusResult {
  success: boolean;
  connected: boolean;
  instanceId: string;
}

/** A player on a server, by name and the ID ARK knows them by: their EOS ID in ASA. */
export interface OnlinePlayer {
  name: string;
  playerId: string;
  /** The same ID, under the name older clients and mesh members read. */
  steamId: string;
}

export class RconService {
  /** Resolves once the connect attempt finishes, which can take up to 90 s while a server boots. */
  async connectRcon(instanceId: string): Promise<RconConnectionResult> {
    try {
      if (!instanceId) {
        return { success: false, connected: false, instanceId: instanceId || '', error: 'Invalid instance ID' };
      }

      const saved = instanceUtils.getInstance(instanceId);
      if (!saved) {
        return { success: false, connected: false, instanceId, error: 'Instance not found' };
      }
      // The port and password it started with: one saved since waits for its next start.
      const instance = forRcon(saved);
      if (!instance.rconPort || !getRconPassword(instance)) {
        return { success: false, connected: false, instanceId, error: 'RCON not configured for this instance' };
      }

      return await new Promise<RconConnectionResult>(resolve => {
        connectRcon(instanceId, instance, connected => resolve({
          success: true,
          connected,
          instanceId,
          error: connected ? undefined : 'Failed to establish RCON connection'
        }));
      });
    } catch (error) {
      console.error('[rcon-service] Failed to connect RCON:', error);
      return {
        success: false,
        connected: false,
        instanceId,
        error: error instanceof Error ? error.message : 'Failed to connect RCON'
      };
    }
  }

  /**
   * A single connect attempt, abandoned after `timeoutMs`: for a stop whose SaveWorld timed out and
   * dropped the connection, so DoExit still reaches the server.
   */
  async reconnectRcon(instanceId: string, timeoutMs: number): Promise<boolean> {
    try {
      const saved = instanceUtils.getInstance(instanceId);
      const instance = saved ? forRcon(saved) : null;
      if (!instance?.rconPort || !getRconPassword(instance)) return false;
      return await new Promise<boolean>(resolve => {
        // Cancelling the attempt answers the callback below with false.
        const timer = setTimeout(() => disconnectRcon(instanceId), timeoutMs);
        connectRcon(instanceId, instance, connected => {
          clearTimeout(timer);
          resolve(connected);
        }, 1);
      });
    } catch (error) {
      console.error(`[rcon-service] Failed to reconnect RCON for ${instanceId}:`, error);
      return false;
    }
  }

  async disconnectRcon(instanceId: string): Promise<RconConnectionResult> {
    try {
      disconnectRcon(instanceId);
      return { success: true, connected: false, instanceId };
    } catch (error) {
      console.error('[rcon-service] Failed to disconnect RCON:', error);
      return {
        success: false,
        connected: false,
        instanceId,
        error: error instanceof Error ? error.message : 'Failed to disconnect RCON'
      };
    }
  }

  getRconStatus(instanceId: string): RconStatusResult {
    return { success: true, connected: isRconConnected(instanceId), instanceId };
  }

  /** Never rejects: failures, including a timeout (`timeoutMs`, default 30 s), come back as `error`. */
  async executeRconCommand(instanceId: string, command: string, timeoutMs?: number): Promise<RconCommandResult> {
    try {
      if (!instanceId || !command) {
        return { success: false, instanceId: instanceId || '', error: 'Invalid instance ID or command' };
      }
      if (!isRconConnected(instanceId)) {
        return { success: false, instanceId, error: 'RCON not connected for this instance', notSent: true };
      }

      const response = await sendRconCommand(instanceId, command, timeoutMs);
      return { success: true, response, instanceId };
    } catch (error) {
      console.error(`[rcon-service] RCON command failed for ${instanceId}:`, error instanceof Error ? error.message : error);
      const result: RconCommandResult = {
        success: false,
        instanceId,
        error: error instanceof Error ? error.message : 'Failed to execute RCON command'
      };
      if (error instanceof RconCommandNotSentError) result.notSent = true;
      return result;
    }
  }

  /**
   * The players on a server, from ListPlayers: "0. Name, 0002a1b2c3d4e5f60718293a4b5c6d7e".
   * ASA names each by their EOS ID, 32 hex characters; the ID is everything after the last comma,
   * so a name with a comma in it stays whole. `steamId` repeats the ID for older clients and
   * mesh members.
   */
  async getOnlinePlayers(instanceId: string): Promise<OnlinePlayer[]> {
    const result = await this.executeRconCommand(instanceId, 'ListPlayers');
    if (!result.success || !result.response || result.response.includes('No Players Connected')) return [];

    const players: OnlinePlayer[] = [];
    for (const line of result.response.split('\n')) {
      const match = line.match(/^\s*\d+\.\s+(.+),\s*([0-9A-Za-z]+)\s*$/);
      if (match) {
        players.push({ name: match[1].trim(), playerId: match[2], steamId: match[2] });
      }
    }
    return players;
  }

  /** Like disconnectRcon, but only logs a failure: for teardown paths that must carry on. */
  async forceDisconnectRcon(instanceId: string): Promise<void> {
    try {
      disconnectRcon(instanceId);
    } catch (error) {
      console.warn(`[rcon-service] Force disconnect of ${instanceId} failed, continuing:`, error);
    }
  }
}

export const rconService = new RconService();
