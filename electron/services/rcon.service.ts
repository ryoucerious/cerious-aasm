import { connectRcon, disconnectRcon, sendRconCommand, isRconConnected } from '../utils/rcon.utils';
import * as instanceUtils from '../utils/ark/instance.utils';

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
}

export interface RconStatusResult {
  success: boolean;
  connected: boolean;
  instanceId: string;
}

/**
 * RCON Service - Handles all RCON-related operations
 * Encapsulates RCON connection management, command execution, and status tracking
 */
export class RconService {

  /**
   * Connect RCON for a server instance
   * @param instanceId - The unique identifier of the server instance
   * @returns A promise resolving to an object indicating the result of the connection attempt
   */
  async connectRcon(instanceId: string): Promise<RconConnectionResult> {
    try {
      if (!instanceId) {
        return {
          success: false,
          connected: false,
          instanceId: instanceId || '',
          error: 'Invalid instance ID'
        };
      }

      const instance = await instanceUtils.getInstance(instanceId);
      if (!instance) {
        return {
          success: false,
          connected: false,
          instanceId,
          error: 'Instance not found'
        };
      }

      if (!instance.rconPort || !instance.rconPassword) {
        return {
          success: false,
          connected: false,
          instanceId,
          error: 'RCON not configured for this instance'
        };
      }

      return new Promise<RconConnectionResult>((resolve) => {
        connectRcon(instanceId, instance, (isConnected: boolean) => {
          resolve({
            success: true,
            connected: isConnected,
            instanceId,
            error: isConnected ? undefined : 'Failed to establish RCON connection'
          });
        });
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
   * Disconnect RCON for a server instance
   * @param instanceId - The unique identifier of the server instance
   * @returns A promise resolving to an object indicating the result of the disconnection attempt
   */
  async disconnectRcon(instanceId: string): Promise<RconConnectionResult> {
    try {
      await disconnectRcon(instanceId);
      return {
        success: true,
        connected: false,
        instanceId
      };
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

  /**
   * Get RCON connection status for a server instance
   * @param instanceId - The unique identifier of the server instance
   * @returns A promise resolving to an object containing the RCON status
   */
  getRconStatus(instanceId: string): RconStatusResult {
    const connected = isRconConnected(instanceId);
    return {
      success: true,
      connected,
      instanceId
    };
  }

  /**
   * Execute an RCON command on a server instance
   * @param instanceId - The unique identifier of the server instance
   * @param command - The RCON command to execute
   * @returns A promise resolving to an object indicating the result of the command execution
   */
  async executeRconCommand(instanceId: string, command: string): Promise<RconCommandResult> {
    try {
      if (!instanceId || !command) {
        return {
          success: false,
          instanceId: instanceId || '',
          error: 'Invalid instance ID or command'
        };
      }

      if (!isRconConnected(instanceId)) {
        return {
          success: false,
          instanceId,
          error: 'RCON not connected for this instance'
        };
      }

      const response = await sendRconCommand(instanceId, command);
      return {
        success: true,
        response,
        instanceId
      };
    } catch (error) {
      console.error('[rcon-service] Failed to execute RCON command:', error);
      return {
        success: false,
        instanceId,
        error: error instanceof Error ? error.message : 'Failed to execute RCON command'
      };
    }
  }

  /**
   * Get list of online players
   */
  async getOnlinePlayers(instanceId: string): Promise<{name: string, steamId: string}[]> {
    const result = await this.executeRconCommand(instanceId, 'ListPlayers');
    if (!result.success || !result.response) return [];

    // Parse ARK Check format: "No Players Connected" or "0. Name, SteamID"
    if (result.response.includes('No Players Connected')) return [];

    const lines = result.response.split('\n');
    const players: {name: string, steamId: string}[] = [];

    for (const line of lines) {
      // Regex for "0. PlayerName, 12345678"
      const match = line.match(/\d+\.\s+(.+),\s+(\d+)/);
      if (match) {
        players.push({
          name: match[1],
          steamId: match[2]
        });
      }
    }
    return players;
  }

  /**
   * Auto-connect RCON with callback for status updates
   * @param instanceId - The unique identifier of the server instance
   * @param onStatusChange - Optional callback to receive connection status updates
   */
  async autoConnectRcon(instanceId: string, onStatusChange?: (connected: boolean) => void): Promise<void> {
    try {
      const instance = await instanceUtils.getInstance(instanceId);
      if (instance && instance.rconPort && instance.rconPassword) {
        connectRcon(instanceId, instance, (connected: boolean) => {
          if (onStatusChange) {
            onStatusChange(connected);
          }
        });
      }
    } catch (error) {
      console.warn('[rcon-service] Auto-connect RCON failed:', error);
      if (onStatusChange) {
        onStatusChange(false);
      }
    }
  }

 /**
  * 
  * @param instanceId - The unique identifier of the server instance
  * @returns A promise that resolves when the force disconnect attempt is complete
  * Force disconnect RCON without throwing errors
  */
  async forceDisconnectRcon(instanceId: string): Promise<void> {
    try {
      await disconnectRcon(instanceId);
    } catch (error) {
      console.warn('[rcon-service] Force disconnect RCON failed, continuing...', error);
    }
  }
}

// Export singleton instance
export const rconService = new RconService();