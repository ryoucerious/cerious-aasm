import { validateInstanceId } from '../../utils/validation.utils';
import { rconService } from '../rcon.service';
import { RconResult } from '../../types/server-instance.types';

/**
 * Server Operations Service - Handles RCON operations and other server operations
 */
export class ServerOperationsService {
  /**
   * Establish an RCON connection to a running server instance
   */
  async connectRcon(instanceId: string): Promise<RconResult> {
    try {
      if (!validateInstanceId(instanceId)) {
        return {
          success: false,
          error: 'Invalid instance ID',
          instanceId,
          connected: false
        };
      }

      const instance = await require('../../utils/ark/instance.utils').getInstance(instanceId);
      if (!instance) {
        return {
          success: false,
          error: 'Instance not found',
          instanceId,
          connected: false
        };
      }

      const result = await rconService.connectRcon(instanceId);
      const connected = result.connected;

      return {
        success: true,
        connected,
        instanceId
      };
    } catch (error) {
      console.error('[server-operations-service] Failed to connect RCON:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to connect RCON',
        instanceId,
        connected: false
      };
    }
  }

  /**
   * Disconnect the RCON connection from a server instance
   */
  async disconnectRcon(instanceId: string): Promise<RconResult> {
    try {
      const result = await rconService.disconnectRcon(instanceId);
      return {
        success: true,
        connected: false,
        instanceId
      };
    } catch (error) {
      console.error('[server-operations-service] Failed to disconnect RCON:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to disconnect RCON',
        instanceId,
        connected: false
      };
    }
  }

  /**
   * Get RCON connection status
   */
  getRconStatus(instanceId: string): RconResult {
    const result = rconService.getRconStatus(instanceId);
    return {
      success: result.success,
      connected: result.connected,
      instanceId: result.instanceId
    };
  }

  /**
   * Execute an RCON command on a server instance
   */
  async executeRconCommand(instanceId: string, command: string): Promise<RconResult> {
    try {
      if (!validateInstanceId(instanceId)) {
        return {
          success: false,
          error: 'Invalid instance ID',
          instanceId
        };
      }

      if (!command || typeof command !== 'string') {
        return {
          success: false,
          error: 'Invalid command',
          instanceId
        };
      }

      const result = await rconService.executeRconCommand(instanceId, command);
      return {
        success: result.success,
        response: result.response,
        error: result.error,
        instanceId
      };
    } catch (error) {
      console.error('[server-operations-service] Failed to execute RCON command:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to execute RCON command',
        instanceId
      };
    }
  }

  /**
   * Send a chat message to the server
   */
  async sendChatMessage(instanceId: string, message: string): Promise<RconResult> {
    return await this.executeRconCommand(instanceId, `ServerChat ${message}`);
  }

  /**
   * Kick a player from the server
   */
  async kickPlayer(instanceId: string, playerName: string): Promise<RconResult> {
    return await this.executeRconCommand(instanceId, `KickPlayer ${playerName}`);
  }

  /**
   * Ban a player from the server
   */
  async banPlayer(instanceId: string, playerName: string): Promise<RconResult> {
    return await this.executeRconCommand(instanceId, `BanPlayer ${playerName}`);
  }

  /**
   * Unban a player from the server
   */
  async unbanPlayer(instanceId: string, playerName: string): Promise<RconResult> {
    return await this.executeRconCommand(instanceId, `UnbanPlayer ${playerName}`);
  }

  /**
   * Save the world
   */
  async saveWorld(instanceId: string): Promise<RconResult> {
    return await this.executeRconCommand(instanceId, 'SaveWorld');
  }

  /**
   * Get server info
   */
  async getServerInfo(instanceId: string): Promise<RconResult> {
    return await this.executeRconCommand(instanceId, 'GetServerInfo');
  }

  /**
   * List all players
   */
  async listPlayers(instanceId: string): Promise<RconResult> {
    return await this.executeRconCommand(instanceId, 'ListPlayers');
  }

  /**
   * Broadcast a message to all players
   */
  async broadcast(instanceId: string, message: string): Promise<RconResult> {
    return await this.executeRconCommand(instanceId, `Broadcast ${message}`);
  }

  /**
   * Set the server message of the day
   */
  async setMessageOfTheDay(instanceId: string, message: string): Promise<RconResult> {
    return await this.executeRconCommand(instanceId, `SetMessageOfTheDay ${message}`);
  }

  /**
   * Force a tribe to be wiped
   */
  async destroyTribe(instanceId: string, tribeId: string): Promise<RconResult> {
    return await this.executeRconCommand(instanceId, `DestroyTribe ${tribeId}`);
  }

  /**
   * Force a player to be wiped
   */
  async destroyPlayer(instanceId: string, playerId: string): Promise<RconResult> {
    return await this.executeRconCommand(instanceId, `DestroyPlayer ${playerId}`);
  }
}

// Export singleton instance
export const serverOperationsService = new ServerOperationsService();