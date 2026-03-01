import { spawn } from 'child_process';
import * as path from 'path';
import { getSteamCmdDir, isSteamCmdInstalled } from '../utils/steamcmd.utils';
import { ARK_APP_ID } from '../utils/ark.utils';
import { MessagingService } from './messaging.service';
import { getCurrentInstalledVersion } from '../utils/ark/ark-server.utils';
import { loadGlobalConfig } from '../utils/global-config.utils';

export class ArkUpdateService {
  private lastKnownBuildId: string | null = null;
  private installedBuildId: string | null = null;
  private updateAvailable = false;
  private latestBuildId: string | null = null;
  private updateScheduled = false;
  
  constructor(private messagingService: MessagingService) {}

  /**
   * Initialize the service by setting the last known build ID to the current installed version
   * and start polling for updates
   */
  async initialize(): Promise<void> {
    try {
      this.installedBuildId = await getCurrentInstalledVersion();
      this.lastKnownBuildId = this.installedBuildId;
      console.log(`[ark-update-service] Installed build ID: ${this.installedBuildId}`);

      // Start background polling
      this.pollAndNotify().catch(() => {});
      setInterval(() => {
        this.pollAndNotify().catch(() => {});
      }, 15 * 60 * 1000); // 15 minutes (SteamCMD call can be heavy)
    } catch (error) {
      console.error('[ark-update-service] Failed to initialize installed version:', error);
    }
  }



  /**
   * Schedule the cluster update sequence
   */
  private async scheduleClusterUpdate(minutes: number): Promise<void> {
      this.updateScheduled = true;
      const { rconService } = require('./rcon.service');
      const { serverManagementService } = require('./server-instance/server-management.service');
      const instances = (await serverManagementService.getAllInstances()).instances;
      const runningInstances = instances.filter((i: any) => 
          require('./server-instance/server-process.service').serverProcessService.getNormalizedInstanceState(i.id) === 'running'
      );

      // Warning Loop
      let remaining = minutes;
      const warningInterval = setInterval(async () => {
         if (remaining <= 0) {
             clearInterval(warningInterval);
             await this.performClusterUpdate(runningInstances);
             this.updateScheduled = false;
             return;
         }

         const msg = `Server will restart for update in ${remaining} minute(s).`;
         console.log(`[ark-update-service] Broadcast: ${msg}`);
         
         // Broadcast to all running servers
         for (const instance of runningInstances) {
             try {
                // Check if still running before broadcasting
                const state = require('./server-instance/server-process.service').serverProcessService.getNormalizedInstanceState(instance.id);
                if (state === 'running') {
                    await rconService.executeRconCommand(instance.id, `Broadcast ${msg}`);
                }
             } catch (e) {}
         }
         
         // Logarithmic warning schedule: 60, 30, 15, 10, 5, 4, 3, 2, 1
         if (remaining > 5 && remaining % 5 !== 0) { 
             // skip unless divisible by 5
         }
         remaining--;
      }, 60000); 
  }

  /**
   * Executive logic to update the entire cluster
   */
  async performClusterUpdate(preRunningInstances?: any[]): Promise<void> {
      console.log('[ark-update-service] Starting cluster update sequence...');
      const { serverLifecycleService } = require('./server-instance/server-lifecycle.service');
      const { serverManagementService } = require('./server-instance/server-management.service');
      const { serverProcessService } = require('./server-instance/server-process.service');
      
      // 1. Identify running servers if not provided
      if (!preRunningInstances) {
          const instances = (await serverManagementService.getAllInstances()).instances;
          preRunningInstances = instances.filter((i: any) => 
            serverProcessService.getNormalizedInstanceState(i.id) === 'running'
          );
      }

      this.messagingService.sendToAll('cluster-update-status', { status: 'stopping', message: 'Stopping all servers...' });

      // 2. Stop ALL servers (parallel)
      await Promise.all(preRunningInstances!.map((inst: any) => serverLifecycleService.stopServerInstance(inst.id)));
      
      this.messagingService.sendToAll('cluster-update-status', { status: 'updating', message: 'Updating ARK server files (via SteamCMD)...' });

      // 3. Update Base Install
      try {
        // Use the install service/handler to trigger update
        // We reuse the update logic from install-handler or similar
        // Since we are in backend service, we can call ArkInstallUtils directly if accessible, or invoke the steamcmd command
        const { installArkServer } = require('../utils/ark/ark-install.utils');
        await installArkServer((progress: any) => {
            this.messagingService.sendToAll('cluster-update-progress', progress);
        });
        
        this.installedBuildId = await getCurrentInstalledVersion(); // Refresh version
      } catch (e) {
         console.error('[ark-update-service] Update failed:', e);
         this.messagingService.sendToAll('cluster-update-status', { status: 'error', message: 'SteamCMD Update Failed' });
         return; // Abort start
      }

      this.messagingService.sendToAll('cluster-update-status', { status: 'configuring', message: 'Updating instance binaries...' });

      // 4. Update Binaries for ALL instances (not just running ones)
      const allInstances = (await serverManagementService.getAllInstances()).instances;
      for (const instance of allInstances) {
          // Re-junction/Re-copy binaries to ensure they match the new version
          await serverManagementService.prepareInstanceConfiguration(instance.id, instance);
      }

      this.messagingService.sendToAll('cluster-update-status', { status: 'starting', message: 'Restarting servers...' });

      // 5. Start servers that were running
      // Stagger start to avoid CPU spike?
      for (const instance of preRunningInstances!) {
          try {
             // 30s delay between starts
             await serverLifecycleService.startServerInstance(instance.id, instance, 
                (log: string) => {}, 
                (state: string) => {}
             );
             await new Promise(resolve => setTimeout(resolve, 30000));
          } catch (e) {
              console.error(`[ark-update-service] Failed to restart ${instance.id}:`, e);
          }
      }
      
      this.messagingService.sendToAll('cluster-update-status', { status: 'complete', message: 'Cluster update complete' });
      this.updateScheduled = false;
  }
  
  /**
   * Check for ARK server updates (used by manual check requests)
   * Always does a fresh comparison of installed vs latest from Steam.
   */
  async checkForUpdate(): Promise<ArkUpdateResult> {
    try {
      // Re-read the installed version in case the server was updated
      this.installedBuildId = await getCurrentInstalledVersion();
      const latest = await this.getLatestServerVersion();
      
      if (!latest) {
        return {
          success: false,
          hasUpdate: false,
          message: 'Could not retrieve latest version from Steam'
        };
      }

      this.latestBuildId = latest;
      const hasUpdate = !!this.installedBuildId && latest !== this.installedBuildId;
      this.updateAvailable = hasUpdate;

      console.log(`[ark-update-service] Check: installed=${this.installedBuildId}, latest=${latest}, hasUpdate=${hasUpdate}`);

      return {
        success: true,
        hasUpdate,
        buildId: latest,
        message: hasUpdate 
          ? `New ARK server build available: ${latest} (installed: ${this.installedBuildId})` 
          : 'ARK server is up to date'
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
   * Poll for ARK server updates (used by background polling)
   * Compares installed build ID against latest from Steam.
   * Returns the latest build ID if an update is available, null otherwise.
   */
  async pollArkServerUpdates(): Promise<string | null> {
    try {
      const buildId = await this.getLatestServerVersion();
      if (!buildId || !this.installedBuildId) {
        return null;
      }

      this.latestBuildId = buildId;
      const hasUpdate = buildId !== this.installedBuildId;
      this.updateAvailable = hasUpdate;

      console.log(`[ark-update-service] Poll: installed=${this.installedBuildId}, latest=${buildId}, hasUpdate=${hasUpdate}`);

      return hasUpdate ? buildId : null;
    } catch (err) {
      console.error('[ark-update-service] Error during ARK update poll:', err);
      return null;
    }
  }

  /**
   * Poll for ARK server updates, notify status, and handle auto-update logic if enabled.
   * @returns Latest build ID if a new update was found, otherwise null
   */
  async pollAndNotify(): Promise<string | null> {
    const result = await this.pollArkServerUpdates();
    this.messagingService.sendToAll('ark-update-status', { hasUpdate: !!result, buildId: result });

    if (result) {
      const config = loadGlobalConfig();
      if (!this.updateScheduled) {
        this.messagingService.sendToAll('ark-update-available', {
          current: this.installedBuildId,
          latest: result,
          autoUpdate: !!config.autoUpdateArkServer
        });
        if (config.autoUpdateArkServer) {
          console.log('[ark-update-service] Auto-update enabled. Scheduling cluster update...');
          this.scheduleClusterUpdate(config.updateWarningMinutes || 15);
        }
      }
    }

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
