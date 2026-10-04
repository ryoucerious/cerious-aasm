import * as fs from 'fs';
import * as path from 'path';
import { getArkServerDir, getInstanceWhitelistPath } from '../utils/ark/ark-server/ark-server-paths.utils';
import { getInstanceDir } from '../utils/ark/instance.utils';

export interface WhitelistResult {
  success: boolean;
  message?: string;
  playerIds?: string[];
  error?: string;
}

const LIST_FILE = 'PlayersExclusiveJoinList.txt';
const HEADER_LINES = [
  '# ARK: Survival Ascended Exclusive Join List',
  '# One EOS/Player ID per line',
  '# Lines starting with # are comments and will be ignored',
  '# This file is managed by Cerious AASM',
];

function renderList(playerIds: string[]): string {
  return [...HEADER_LINES, '', ...playerIds].join('\n');
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The exclusive-join list. The instance folder holds the user's copy; ARK reads another copy next
 * to the executable it runs, which is refreshed on every save and before every start.
 */
export class WhitelistService {
  private getListPath(instanceId: string): string {
    return path.join(getInstanceDir(instanceId), LIST_FILE);
  }

  /**
   * An instance with isolated binaries reads the list from its own Win64 folder, not the shared
   * install's. Falls back to the shared install when the instance cannot be resolved.
   */
  private getRuntimeListPath(instanceId: string): string {
    try {
      return getInstanceWhitelistPath(instanceId);
    } catch (error) {
      console.warn(`[whitelist] Could not resolve the whitelist path ARK reads for ${instanceId}; using the shared one:`, error);
      return path.join(getArkServerDir(), 'ShooterGame', 'Binaries', 'Win64', LIST_FILE);
    }
  }

  private writeRuntimeList(instanceId: string, write: (runtimePath: string) => void): void {
    const runtimePath = this.getRuntimeListPath(instanceId);
    fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
    write(runtimePath);
  }

  /** Replaces the list. Fails, creating nothing, when the instance folder does not exist. */
  writeWhitelistFile(instanceId: string, playerIds: string[]): WhitelistResult {
    try {
      const listPath = this.getListPath(instanceId);
      fs.writeFileSync(listPath, renderList(playerIds.filter(id => id && id.trim().length > 0)), 'utf8');
      this.writeRuntimeList(instanceId, runtimePath => fs.copyFileSync(listPath, runtimePath));
      return { success: true, playerIds, message: `Saved ${playerIds.length} whitelisted players` };
    } catch (error) {
      return { success: false, error: `Failed to write whitelist file: ${describeError(error)}` };
    }
  }

  loadWhitelistFromInstance(instanceId: string): WhitelistResult {
    try {
      const listPath = this.getListPath(instanceId);
      if (!fs.existsSync(listPath)) {
        return { success: true, playerIds: [], message: 'No whitelist file found (empty whitelist)' };
      }

      const playerIds = fs.readFileSync(listPath, 'utf8')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'));
      return { success: true, playerIds, message: `Loaded ${playerIds.length} whitelisted players` };
    } catch (error) {
      return { success: false, error: `Failed to load whitelist: ${describeError(error)}` };
    }
  }

  addToInstanceWhitelist(instanceId: string, playerId: string): WhitelistResult {
    const loaded = this.loadWhitelistFromInstance(instanceId);
    if (!loaded.success) return loaded;

    const playerIds = loaded.playerIds || [];
    if (playerIds.includes(playerId)) {
      return { success: true, playerIds, message: `Player ${playerId} is already whitelisted` };
    }
    return this.writeWhitelistFile(instanceId, [...playerIds, playerId]);
  }

  removeFromInstanceWhitelist(instanceId: string, playerId: string): WhitelistResult {
    const loaded = this.loadWhitelistFromInstance(instanceId);
    if (!loaded.success) return loaded;

    const playerIds = loaded.playerIds || [];
    if (!playerIds.includes(playerId)) {
      return { success: true, playerIds, message: `Player ${playerId} was not in the whitelist` };
    }
    return this.writeWhitelistFile(instanceId, playerIds.filter(id => id !== playerId));
  }

  clearInstanceWhitelist(instanceId: string): WhitelistResult {
    return this.writeWhitelistFile(instanceId, []);
  }

  /** Puts the instance's list where ARK reads it before a start: an empty one when it has none. */
  copyWhitelistToMainDir(instanceId: string): WhitelistResult {
    try {
      const listPath = this.getListPath(instanceId);
      if (!fs.existsSync(listPath)) {
        this.writeRuntimeList(instanceId, runtimePath => fs.writeFileSync(runtimePath, renderList([]), 'utf8'));
        return { success: true, playerIds: [], message: 'Created empty whitelist file in main ARK directory' };
      }

      this.writeRuntimeList(instanceId, runtimePath => fs.copyFileSync(listPath, runtimePath));
      const playerIds = this.loadWhitelistFromInstance(instanceId).playerIds || [];
      return { success: true, playerIds, message: `Copied whitelist with ${playerIds.length} players to main ARK directory` };
    } catch (error) {
      return { success: false, error: `Failed to copy whitelist to main directory: ${describeError(error)}` };
    }
  }
}

export const whitelistService = new WhitelistService();