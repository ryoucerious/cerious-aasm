// Whitelist Service - Manages ARK server exclusive join/whitelist functionality
import * as fs from 'fs';
import * as path from 'path';
import { ArkPathUtils } from '../utils/ark/ark-path.utils';

export interface WhitelistResult {
  success: boolean;
  message?: string;
  playerIds?: string[];
  error?: string;
}

/**
 * Service for managing ARK server whitelist (exclusive join) functionality
 * Integrates with the config file system to copy whitelist files during server startup
 */
export class WhitelistService {

  /**
   * Get the path to the PlayersExclusiveJoinList.txt file in an instance directory
   */
  private getInstanceWhitelistPath(instanceDir: string): string {
    return path.join(instanceDir, 'PlayersExclusiveJoinList.txt');
  }

  /**
   * Get the path to the PlayersExclusiveJoinList.txt file in the main ARK server directory
   */
  private getMainWhitelistPath(): string {
    const arkServerDir = ArkPathUtils.getArkServerDir();
    return path.join(arkServerDir, 'ShooterGame', 'Binaries', 'Win64', 'PlayersExclusiveJoinList.txt');
  }

  /**
   * Write whitelist file to instance directory and copy to main ARK directory
   * This follows the same pattern as the config files
   */
  writeWhitelistFile(instanceDir: string, playerIds: string[]): WhitelistResult {
    try {
      // Ensure instance directory exists
      if (!fs.existsSync(instanceDir)) {
        fs.mkdirSync(instanceDir, { recursive: true });
      }

      // Create content with header comment
      const content = [
        '# ARK: Survival Ascended Exclusive Join List',
        '# One EOS/Player ID per line',
        '# Lines starting with # are comments and will be ignored',
        '# This file is managed by Cerious AASM',
        '',
        ...playerIds.filter(id => id && id.trim().length > 0)
      ].join('\n');

      // Write to instance directory
      const instanceWhitelistPath = this.getInstanceWhitelistPath(instanceDir);
      fs.writeFileSync(instanceWhitelistPath, content, 'utf8');

      // Copy to main ARK directory (like config files do)
      const mainWhitelistPath = this.getMainWhitelistPath();
      const mainDir = path.dirname(mainWhitelistPath);
      if (!fs.existsSync(mainDir)) {
        fs.mkdirSync(mainDir, { recursive: true });
      }
      fs.copyFileSync(instanceWhitelistPath, mainWhitelistPath);

      return {
        success: true,
        playerIds,
        message: `Saved ${playerIds.length} whitelisted players`
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to write whitelist file: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Load whitelist from instance directory
   */
  loadWhitelistFromInstance(instanceDir: string): WhitelistResult {
    try {
      const whitelistPath = this.getInstanceWhitelistPath(instanceDir);
      
      if (!fs.existsSync(whitelistPath)) {
        return {
          success: true,
          playerIds: [],
          message: 'No whitelist file found (empty whitelist)'
        };
      }

      const content = fs.readFileSync(whitelistPath, 'utf8');
      const playerIds = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#')); // Filter out empty lines and comments

      return {
        success: true,
        playerIds,
        message: `Loaded ${playerIds.length} whitelisted players`
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to load whitelist: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Add a player ID to the whitelist for a specific instance
   */
  addToInstanceWhitelist(instanceDir: string, playerId: string): WhitelistResult {
    try {
      const loadResult = this.loadWhitelistFromInstance(instanceDir);
      if (!loadResult.success) {
        return loadResult;
      }

      const playerIds = loadResult.playerIds || [];
      
      // Check if player is already whitelisted
      if (playerIds.includes(playerId)) {
        return {
          success: true,
          playerIds,
          message: `Player ${playerId} is already whitelisted`
        };
      }

      // Add the player
      playerIds.push(playerId);
      return this.writeWhitelistFile(instanceDir, playerIds);
    } catch (error) {
      return {
        success: false,
        error: `Failed to add player to whitelist: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Remove a player ID from the whitelist for a specific instance
   */
  removeFromInstanceWhitelist(instanceDir: string, playerId: string): WhitelistResult {
    try {
      const loadResult = this.loadWhitelistFromInstance(instanceDir);
      if (!loadResult.success) {
        return loadResult;
      }

      const playerIds = loadResult.playerIds || [];
      const index = playerIds.indexOf(playerId);
      
      if (index === -1) {
        return {
          success: true,
          playerIds,
          message: `Player ${playerId} was not in the whitelist`
        };
      }

      // Remove the player
      playerIds.splice(index, 1);
      return this.writeWhitelistFile(instanceDir, playerIds);
    } catch (error) {
      return {
        success: false,
        error: `Failed to remove player from whitelist: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Check if a player ID is whitelisted for a specific instance
   */
  isPlayerWhitelistedInInstance(instanceDir: string, playerId: string): boolean {
    try {
      const loadResult = this.loadWhitelistFromInstance(instanceDir);
      if (!loadResult.success) {
        return false;
      }
      return (loadResult.playerIds || []).includes(playerId);
    } catch (error) {
      console.error('Failed to check whitelist status:', error);
      return false;
    }
  }

  /**
   * Clear all players from the whitelist for a specific instance
   */
  clearInstanceWhitelist(instanceDir: string): WhitelistResult {
    return this.writeWhitelistFile(instanceDir, []);
  }

  /**
   * Get whitelist statistics for a specific instance
   */
  getInstanceWhitelistStats(instanceDir: string): { playerCount: number; fileExists: boolean; filePath: string } {
    try {
      const whitelistPath = this.getInstanceWhitelistPath(instanceDir);
      const fileExists = fs.existsSync(whitelistPath);
      
      if (!fileExists) {
        return {
          playerCount: 0,
          fileExists: false,
          filePath: whitelistPath
        };
      }

      const loadResult = this.loadWhitelistFromInstance(instanceDir);
      return {
        playerCount: loadResult.playerIds?.length || 0,
        fileExists: true,
        filePath: whitelistPath
      };
    } catch (error) {
      return {
        playerCount: 0,
        fileExists: false,
        filePath: this.getInstanceWhitelistPath(instanceDir)
      };
    }
  }

  /**
   * Copy whitelist file from instance directory to main ARK directory during server startup
   * This is called during server startup to ensure the whitelist is in place
   */
  copyWhitelistToMainDir(instanceDir: string): WhitelistResult {
    try {
      const instanceWhitelistPath = this.getInstanceWhitelistPath(instanceDir);
      const mainWhitelistPath = this.getMainWhitelistPath();
      
      // Ensure main directory exists
      const mainDir = path.dirname(mainWhitelistPath);
      if (!fs.existsSync(mainDir)) {
        fs.mkdirSync(mainDir, { recursive: true });
      }

      if (fs.existsSync(instanceWhitelistPath)) {
        // Copy existing whitelist file
        fs.copyFileSync(instanceWhitelistPath, mainWhitelistPath);
        const loadResult = this.loadWhitelistFromInstance(instanceDir);
        return {
          success: true,
          playerIds: loadResult.playerIds || [],
          message: `Copied whitelist with ${loadResult.playerIds?.length || 0} players to main ARK directory`
        };
      } else {
        // Create empty whitelist file
        fs.writeFileSync(mainWhitelistPath, [
          '# ARK: Survival Ascended Exclusive Join List',
          '# One EOS/Player ID per line',
          '# Lines starting with # are comments and will be ignored',
          '# This file is managed by Cerious AASM',
          ''
        ].join('\n'), 'utf8');
        return {
          success: true,
          playerIds: [],
          message: 'Created empty whitelist file in main ARK directory'
        };
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to copy whitelist to main directory: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}

// Export singleton instance
export const whitelistService = new WhitelistService();