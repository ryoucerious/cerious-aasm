import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import { validateInstanceId } from '../../utils/validation.utils';
import { ArkPathUtils, buildArkServerArgs } from '../../utils/ark.utils';
import { ServerInstanceResult } from '../../types/server-instance.types';

/**
 * Server Process Service - Handles low-level process management and state tracking
 */
export class ServerProcessService {
  private arkServerProcesses: Record<string, ChildProcess> = {};

  /**
   * Set instance state
   */
  setInstanceState(instanceId: string, state: string): void {
  const { setInstanceState } = require('../../utils/ark/ark-server/ark-server-state.utils');
  setInstanceState(instanceId, state);
  }

  /**
   * Get instance state
   */
  getInstanceState(instanceId: string): string | null {
  const { getInstanceState } = require('../../utils/ark/ark-server/ark-server-state.utils');
  return getInstanceState(instanceId);
  }

  /**
   * Get normalized instance state, mapping unknown/null to 'stopped'
   */
  getNormalizedInstanceState(instanceId: string): string {
  const { getNormalizedInstanceState } = require('../../utils/ark/ark-server/ark-server-state.utils');
  return getNormalizedInstanceState(instanceId);
  }

  /**
   * Get server process reference
   */
  getServerProcess(instanceId: string): ChildProcess | null {
    return this.arkServerProcesses[instanceId] || null;
  }

  /**
   * Start the actual server process
   */
  async startServerProcess(instanceId: string, instance: any): Promise<ServerInstanceResult> {
    // Set state to starting
    this.setInstanceState(instanceId, 'starting');

    // Write ARK config files and set up directories
    const baseDir = require('../../utils/ark/instance.utils').getInstancesBaseDir();
    const instanceDir = path.join(baseDir, instanceId);

    // Set up save directory for this instance
    const saveDir = path.join('Servers', instanceId, 'SavedArks');
    const formattedSaveDir = saveDir.replace(/\\/g, '/');
    const formattedConfigDir = instanceDir.replace(/\\/g, '/');
    const formattedLogDir = path.join(ArkPathUtils.getArkServerDir(), 'ShooterGame', 'Saved', 'Logs').replace(/\\/g, '/');
    
    // Build the ARK server command arguments
    const args = buildArkServerArgs({
      ...instance,
      saveDir: formattedSaveDir,
      configDir: formattedConfigDir,
      logDir: formattedLogDir,
      altSaveDirName: saveDir
    });

    // Use cross-platform command preparation for Proton support on Linux
    const { prepareArkServerCommand } = require('../../utils/ark/ark-server/ark-server-paths.utils');
    const commandInfo = prepareArkServerCommand(ArkPathUtils.getArkExecutablePath(), args);

    // Set up spawn options with proper environment and working directory
    const { getPlatform } = require('../../utils/platform.utils');
    const spawnOptions: any = {
      cwd: getPlatform() === 'windows' ? instanceDir : ArkPathUtils.getArkServerDir(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...(commandInfo.env || {}), // Add Proton env vars on Linux
        ARK_SAVE_PATH: formattedSaveDir,
        ARK_CONFIG_PATH: formattedConfigDir,
        ARK_LOG_PATH: formattedLogDir
      },
      detached: getPlatform() === 'linux',
      windowsHide: true
    };

    // Start the server process
    const serverProcess = spawn(commandInfo.command, commandInfo.args, spawnOptions);

    // Notify Discord
    const { discordService } = require('../discord.service');
    discordService.sendNotification(instanceId, 'start', 'Server is starting up...');

    // Store the process reference
    this.arkServerProcesses[instanceId] = serverProcess;

    return { success: true, instanceId };
  }

  /**
   * Set up process monitoring, event handlers, and log tailing
   */
  setupProcessMonitoring(
    instanceId: string,
    instance: any,
    onLog?: (data: string) => void,
    onState?: (state: string) => void
  ): void {
    const serverProcess = this.arkServerProcesses[instanceId];
    if (!serverProcess) return;

    let hasAdvertised = false;

    // Set up process event handlers
    serverProcess.on('exit', async (code) => {
      this.setInstanceState(instanceId, 'stopped');
      onState?.('stopped');
      
      // Notify Discord
      const { discordService } = require('../discord.service');
      discordService.sendNotification(instanceId, 'stop', 'Server has stopped');

      // Disconnect RCON connection since server has exited
      try {
        const rconService = require('../rcon.service').rconService;
        await rconService.disconnectRcon(instanceId);
        
        // Notify UI that RCON is now disconnected
        const messagingService = require('../messaging.service').messagingService;
        messagingService.sendToAll('rcon-status', { instanceId, connected: false });
      } catch (error) {
        console.warn(`[server-process-service] Failed to disconnect RCON for ${instanceId} on exit:`, error);
      }
    });

    serverProcess.on('error', async (err) => {
      console.error('[server-process-service] ARK server process error:', err);
      this.setInstanceState(instanceId, 'error');
      onState?.('error');

      // Notify Discord
      const { discordService } = require('../discord.service');
      discordService.sendNotification(instanceId, 'crash', `Server Process Error: ${err.message || err}`);
      
      // Disconnect RCON connection since server has errored
      try {
        const rconService = require('../rcon.service').rconService;
        await rconService.disconnectRcon(instanceId);
        
        // Notify UI that RCON is now disconnected
        const messagingService = require('../messaging.service').messagingService;
        messagingService.sendToAll('rcon-status', { instanceId, connected: false });
      } catch (error) {
        console.warn(`[server-process-service] Failed to disconnect RCON for ${instanceId} on error:`, error);
      }
    });

    // Set up log monitoring after a brief delay
    setTimeout(() => {
      if (!serverProcess || serverProcess.killed) return;

      const monitoringService = require('./server-monitoring.service').serverMonitoringService;
      monitoringService.setupLogMonitoring(instanceId, instance, 
        // onLog callback - forward log lines to messaging service
        (line: string) => {
          const messagingService = require('../messaging.service').messagingService;
          messagingService.sendToAll('server-instance-log', { log: line, instanceId });
        },
        // onState callback
        onState
      );
    }, 500); // Wait 500ms for log file to be created
  }

  /**
   * Stop server process
   */
  async stopServerProcess(instanceId: string): Promise<ServerInstanceResult> {
    if (!validateInstanceId(instanceId)) {
      return {
        success: false,
        error: 'Invalid instance ID',
        instanceId
      };
    }

    const process = this.arkServerProcesses[instanceId];
    if (!process) {
      return {
        success: false,
        error: 'Server instance is not running',
        instanceId
      };
    }

    // Set state to stopping
    this.setInstanceState(instanceId, 'stopping');

    // Try graceful shutdown via RCON first
    try {
      const rconService = require('../rcon.service').rconService;
      await rconService.executeRconCommand(instanceId, 'DoExit');
      // Wait a bit for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 10000));
    } catch (error) {
      console.warn(`[server-process-service] RCON shutdown failed for ${instanceId}, forcing kill:`, error);
    }

    // Force kill if still running
    if (!process.killed) {
      process.kill('SIGTERM');
      // Wait a bit more
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Force kill if still not dead
      if (!process.killed) {
        process.kill('SIGKILL');
      }
    }

    // Clean up process reference
    delete this.arkServerProcesses[instanceId];

    // Set final state
    this.setInstanceState(instanceId, 'stopped');

    // Disconnect RCON connection since server is stopped
    try {
      const rconService = require('../rcon.service').rconService;
      await rconService.disconnectRcon(instanceId);
      
      // Notify UI that RCON is now disconnected
      const messagingService = require('../messaging.service').messagingService;
      messagingService.sendToAll('rcon-status', { instanceId, connected: false });
    } catch (error) {
      console.warn(`[server-process-service] Failed to disconnect RCON for ${instanceId}:`, error);
    }

    return {
      success: true,
      instanceId
    };
  }

  /**
   * Clean up orphaned processes on application shutdown
   */
  cleanupOrphanedProcesses(): void {
    // Clean up all tracked processes
    for (const [instanceId, process] of Object.entries(this.arkServerProcesses)) {
      if (process && !process.killed) {
        try {
          process.kill('SIGTERM');
        } catch (e) {
          console.error(`[server-process-service] Failed to cleanup process ${instanceId}:`, e);
        }
      }
    }

    // On Linux, also perform system-level cleanup for any orphaned processes
    const { getPlatform } = require('../../utils/platform.utils');
    if (getPlatform() === 'linux') {
      try {
        // Kill any remaining ARK server processes that might have been orphaned
        try {
          require('child_process').execSync('pkill -f ArkAscendedServer', { stdio: 'ignore' });
        } catch (e) {
          // Ignore if no processes found
        }

        // Kill any remaining Proton processes running ARK
        try {
          require('child_process').execSync('pkill -f "proton.*ArkAscendedServer"', { stdio: 'ignore' });
        } catch (e) {
          // Ignore if no processes found
        }

        // Kill any remaining xvfb processes that might be stuck
        try {
          require('child_process').execSync('pkill -f "Xvfb.*ArkAscendedServer"', { stdio: 'ignore' });
        } catch (e) {
          // Ignore if no processes found
        }
      } catch (e) {
        console.error('[server-process-service] System-level cleanup failed:', e);
      }
    }
  }
}

// Export singleton instance
export const serverProcessService = new ServerProcessService();