import { spawn } from 'child_process';
import * as path from 'path';
import { getSteamCmdDir, isSteamCmdInstalled } from '../utils/steamcmd.utils';
import { ARK_APP_ID } from '../utils/ark.utils';
import { MessagingService } from './messaging.service';
import { getCurrentInstalledVersion } from '../utils/ark/ark-server.utils';

export class ArkUpdateService {
  private lastKnownBuildId: string | null = null;
  
  constructor(private messagingService: MessagingService) {}

  /**
   * Initialize the service by setting the last known build ID to the current installed version
   * and start polling for updates
   */
  async initialize(): Promise<void> {
    try {
      this.lastKnownBuildId = await getCurrentInstalledVersion();

      // Start background polling
      this.pollAndNotify().catch(() => {});
      setInterval(() => {
        this.pollAndNotify().catch(() => {});
      }, 5 * 60 * 1000); // 5 minutes
    } catch (error) {
      console.error('[ark-update-service] Failed to initialize installed version:', error);
    }
  }
  
  /**
   * Check for ARK server updates
   * @returns Result of the update check
   * 
   * Checks for ARK server updates and returns an object indicating whether an update is available,
   */
  async checkForUpdate(): Promise<ArkUpdateResult> {
    try {
      const result = await this.pollArkServerUpdates();
      
      return {
        success: true,
        hasUpdate: result !== null,
        buildId: result,
        message: result ? `New ARK server build available: ${result}` : 'No update available'
      };
    } catch (error) {
      console.error('[ARK Update Service] Error checking for updates:', error);
      
      return {
        success: false,
        hasUpdate: false,
        error: error instanceof Error ? error.message : String(error),
        message: 'Failed to check for ARK server updates'
      };
    }
  }

  /**
   * Poll for ARK server updates
   * @returns Latest build ID if updated, otherwise null
   * 
   * Polls SteamCMD to get the latest ARK server build ID. If the build ID has changed since the last check,
   * it updates the internal state and returns the new build ID. If no update is found, it returns null.
   * In case of errors during the process, it logs the error and returns null.
   */
  async pollArkServerUpdates(): Promise<string | null> {
    try {
      const buildId = await this.getLatestServerVersion();
      if (buildId && buildId !== this.lastKnownBuildId) {
        const prev = this.lastKnownBuildId;
        this.lastKnownBuildId = buildId;
        return prev !== null ? buildId : null;
      }
      return null;
    } catch (err) {
      console.error('[ark-update-service] Error during ARK update poll:', err);
      return null;
    }
  }

  /**
   * Poll for ARK server updates and notify status
   * @returns Latest build ID if updated, otherwise null
   */
  async pollAndNotify(): Promise<string | null> {
    const result = await this.pollArkServerUpdates();
    this.messagingService.sendToAll('ark-update-status', { hasUpdate: !!result, buildId: result });
    return result;
  }

  /**
   * Get latest server version from Steam
   */
  private async getLatestServerVersion(): Promise<string | null> {
    if (!isSteamCmdInstalled()) {
      console.error('[ark-update-service] SteamCMD not installed');
      return null;
    }
    
    const steamcmdPath = getSteamCmdDir();
    const steamcmdExe = process.platform === 'win32' ? 'steamcmd.exe' : 'steamcmd.sh';
    const steamcmdExecutable = path.join(steamcmdPath, steamcmdExe);
    
    return new Promise((resolve) => {
      let latestBuildId: string | null = null;
      let output = '';
      
      const proc = spawn(steamcmdExecutable, [
        '+login', 'anonymous',
        '+app_info_update', '1',
        '+app_info_print', ARK_APP_ID.toString(),
        '+quit'
      ], { cwd: steamcmdPath });
      
      proc.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      proc.stderr.on('data', (data) => {
        output += data.toString();
      });
      
      proc.on('close', () => {
        // Look for the "public" branch buildid which indicates the live version
        // The structure is usually "branches" { "public" { "buildid" "123456" ... } }
        // We use [\s\S] to match across newlines
        const publicMatch = output.match(/"public"\s*\{[\s\S]*?"buildid"\s+"(\d+)"/i);
        
        if (publicMatch) {
          latestBuildId = publicMatch[1];
        } else {
          // Fallback: looking for basic buildid if structure parsing fails, but this is less reliable
          // Only do this if strictly necessary, but sticking to public branch is safer.
          const fallbackMatch = output.match(/"buildid"\s+"(\d+)"/i);
          if (fallbackMatch) {
            latestBuildId = fallbackMatch[1];
          }
        }
        
        if (!latestBuildId) {
          console.error('[ark-update-service] Could not find legitimate buildid in SteamCMD output'); // Don't spam full output unless debug needed
        }
        resolve(latestBuildId);
      });
    });
  }
}

export interface ArkUpdateResult {
  success: boolean;
  hasUpdate: boolean;
  buildId?: string | null;
  message?: string;
  error?: string;
}
