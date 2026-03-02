import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import { validateInstanceId } from '../../utils/validation.utils';
import { ArkPathUtils, buildArkServerArgs } from '../../utils/ark.utils';
import { ServerInstanceResult } from '../../types/server-instance.types';
import { snapshotLogFiles, detectAndRegisterLogFile, unregisterLogFile } from '../../utils/ark/ark-server/ark-server-logging.utils';

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
      // Use 'ignore' for stdout/stderr — we tail the log file directly and never
      // read from these pipes.  On Linux, xvfb-run + Proton + Wine are extremely
      // verbose on stderr; if the 64 KB pipe buffer fills up and the parent never
      // drains it, the child process blocks on its next write() call, which freezes
      // ARK and causes it to stop writing to ShooterGame.log.
      stdio: 'ignore',
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

    // Snapshot log files BEFORE starting so we can detect which new file belongs to this instance
    const logSnapshot = snapshotLogFiles();

    // Start the server process
    const serverProcess = spawn(commandInfo.command, commandInfo.args, spawnOptions);

    // Detect and register the log file for this instance (async, retries internally)
    const sessionName = instance.sessionName || instance.serverName || 'My Server';
    detectAndRegisterLogFile(instanceId, sessionName, logSnapshot);

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

    // Set up process event handlers
    serverProcess.on('exit', async (code) => {
      this.setInstanceState(instanceId, 'stopped');
      unregisterLogFile(instanceId);
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
      unregisterLogFile(instanceId);
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

    // ---- RCON: connect when server signals it is fully started ----
    // Log tailing fires onState('running') the moment the startup-complete log line
    // is seen.  We intercept that here and connect RCON immediately — no polling,
    // no time-based delay.
    //
    // Safety net: if log tailing never finds/parses the startup line (e.g. Proton
    // swallows all stdout) we attempt RCON once after 15 minutes — long enough to
    // cover even the slowest first-boot Proton load, but still a single attempt
    // rather than a wall of retries.
    let rconTriggered = false;

    const triggerRconConnect = () => {
      rconTriggered = true;
      const rconSvc = require('../rcon.service').rconService;
      const instanceConfig = require('../../utils/ark/instance.utils').getInstance(instanceId);
      if (!instanceConfig?.rconPort || !instanceConfig?.rconPassword) {
        console.log(`[server-process-service] RCON not configured for ${instanceId} — skipping connect`);
        return;
      }
      console.log(`[server-process-service] Server ${instanceId} is up — attempting RCON connection`);
      rconSvc.connectRcon(instanceId).catch(() => {
        // rcon.utils already logs failures
      });
    };

    const wrappedOnState = (state: string) => {
      onState?.(state);
      if (state === 'running' && !rconTriggered) {
        triggerRconConnect();
      }
    };

    const safetyNetTimer = setTimeout(() => {
      if (rconTriggered) return;
      const currentState = this.getInstanceState(instanceId);
      if (currentState === 'starting' && serverProcess && !serverProcess.killed && serverProcess.exitCode === null) {
        console.log(`[server-process-service] Safety net: server ${instanceId} still 'starting' after 15 min — forcing 'running' and attempting RCON`);
        this.setInstanceState(instanceId, 'running');
        onState?.('running');
        triggerRconConnect();
      }
    }, 15 * 60 * 1000);

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
        // onState callback — triggers RCON connect when 'running' is detected
        wrappedOnState
      );
    }, 500); // Wait 500ms for log file to be created

    // Clean up safety-net timer on process exit / error
    serverProcess.once('exit', () => {
      clearTimeout(safetyNetTimer);
    });
    serverProcess.once('error', () => {
      clearTimeout(safetyNetTimer);
    });
  }

  /**
   * Stop server process with graceful shutdown
   */
  async stopServerProcess(instanceId: string): Promise<ServerInstanceResult> {
    if (!validateInstanceId(instanceId)) {
      return { success: false, error: 'Invalid instance ID', instanceId };
    }

    const process = this.arkServerProcesses[instanceId];
    if (!process) {
      // Check if it's already stopped according to state
      const state = this.getInstanceState(instanceId);
      if (state === 'stopped' || state === 'error') {
        return { success: true, instanceId };
      }
      return { success: false, error: 'Server process not found', instanceId };
    }

    // Set state to stopping
    this.setInstanceState(instanceId, 'stopping');
    const rconService = require('../rcon.service').rconService;

    // 1. Try graceful "SaveWorld" via RCON
    try {
      console.log(`[server-process-service] Stopping instance ${instanceId}: Sending SaveWorld...`);
      await rconService.executeRconCommand(instanceId, 'SaveWorld');
      
      // Wait up to 60s for save to complete (simple delay for now, ideally watch logs)
      // Most servers save within 5-10 seconds
      await new Promise(resolve => setTimeout(resolve, 5000)); 
    } catch (error) {
      console.warn(`[server-process-service] RCON SaveWorld failed for ${instanceId}:`, error);
    }

    // 2. Try graceful "DoExit" via RCON
    try {
      console.log(`[server-process-service] Stopping instance ${instanceId}: Sending DoExit...`);
      await rconService.executeRconCommand(instanceId, 'DoExit');
    } catch (error) {
      console.warn(`[server-process-service] RCON DoExit failed for ${instanceId}:`, error);
    }

    // 3. Wait for process exit (max 2 minutes)
    const shutdownTimeoutMs = 120000; 
    const checkIntervalMs = 1000;
    const startTime = Date.now();

    while (!process.killed && (Date.now() - startTime) < shutdownTimeoutMs) {
      // Check if process is still running
      try {
        if (process.exitCode !== null) break;
        // On Windows checking .killed property isn't always enough
        // but the 'exit' handler above will clean up this.arkServerProcesses[instanceId]
        if (!this.arkServerProcesses[instanceId]) break;
      } catch (e) {
        break; 
      }
      await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
    }

    // 4. Force kill if still running
    if (this.arkServerProcesses[instanceId]) {
      console.warn(`[server-process-service] Instance ${instanceId} did not stop gracefully. Force killing...`);
      try {
        process.kill('SIGTERM');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        if (this.arkServerProcesses[instanceId]) {
           process.kill('SIGKILL');
        }
      } catch (e) {
        console.error(`[server-process-service] Error killing process for ${instanceId}:`, e);
      }
    }

    // Process 'exit' handler (setupProcessMonitoring) will handle cleanup, state update, and RCON disconnect
    // But we manually ensure cleanup here just in case the exit handler didn't fire (e.g. if we killed it aggressively)
    if (this.arkServerProcesses[instanceId]) {
       delete this.arkServerProcesses[instanceId];
       this.setInstanceState(instanceId, 'stopped');
       try {
         await rconService.disconnectRcon(instanceId);
       } catch (e) {}
    }

    return { success: true, instanceId };
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