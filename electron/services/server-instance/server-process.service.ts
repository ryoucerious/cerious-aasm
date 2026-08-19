import { ChildProcess, spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { validateInstanceId } from '../../utils/validation.utils';
import { ArkPathUtils, buildArkServerArgs, ARK_APP_ID } from '../../utils/ark.utils';
import { ServerInstanceResult } from '../../types/server-instance.types';
import { snapshotLogFiles, detectAndRegisterLogFile, unregisterLogFile } from '../../utils/ark/ark-server/ark-server-logging.utils';

/**
 * Server Process Service - Handles low-level process management and state tracking
 */
export class ServerProcessService {
  private arkServerProcesses: Record<string, ChildProcess> = {};
  private processStartTimes: Record<string, number> = {};

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
   * Get the number of active (tracked) server processes
   */
  getActiveProcessCount(): number {
    return Object.keys(this.arkServerProcesses).length;
  }

  /**
   * Whether a live ChildProcess is still tracked for this instance.
   */
  hasActiveProcess(instanceId: string): boolean {
    const proc = this.arkServerProcesses[instanceId];
    return !!(proc && !proc.killed && proc.exitCode === null);
  }

  /**
   * Aggressively kill a server process, clear tracking, disconnect RCON, and broadcast stopped.
   * Used by cluster-update timeout, pre-SteamCMD verification, and manual force-stop.
   */
  async forceKillServerProcess(
    instanceId: string,
    options?: { broadcast?: boolean }
  ): Promise<void> {
    const broadcast = options?.broadcast !== false;
    const rconService = require('../rcon.service').rconService;

    try {
      await rconService.forceDisconnectRcon(instanceId);
    } catch (e) {
      // Continue — kill must proceed even if RCON disconnect fails
    }

    const proc = this.arkServerProcesses[instanceId];
    if (proc?.pid) {
      const { getPlatform } = require('../../utils/platform.utils');
      const platform = getPlatform();
      try {
        if (platform === 'linux') {
          try {
            process.kill(-proc.pid, 'SIGKILL');
          } catch {
            try { proc.kill('SIGKILL'); } catch { /* already gone */ }
          }
          try {
            execSync(`kill -9 ${proc.pid}`, { stdio: 'ignore' });
          } catch { /* already gone */ }
        } else {
          // Windows: kill the full process tree (Proton/Wine children included when applicable)
          try {
            execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: 'ignore' });
          } catch {
            try { proc.kill('SIGKILL'); } catch { /* already gone */ }
          }
        }
      } catch (e) {
        console.warn(`[server-process-service] forceKill for ${instanceId} encountered an error:`, e);
      }
    } else if (proc && !proc.killed) {
      try { proc.kill('SIGKILL'); } catch { /* already gone */ }
    }

    delete this.arkServerProcesses[instanceId];
    delete this.processStartTimes[instanceId];
    this.setInstanceState(instanceId, 'stopped');

    if (broadcast) {
      try {
        const messagingService = require('../messaging.service').messagingService;
        messagingService.sendToAll('server-instance-state', { state: 'stopped', instanceId });
        messagingService.sendToAll('rcon-status', { instanceId, connected: false });
      } catch (e) {
        console.warn(`[server-process-service] Failed to broadcast stopped state for ${instanceId}:`, e);
      }
    }
  }

  /**
   * Start the actual server process
   */
  async startServerProcess(instanceId: string, instance: any): Promise<ServerInstanceResult> {
    // Set state to starting and record timestamp for crash detection
    this.setInstanceState(instanceId, 'starting');
    const startTimestamp = Date.now();

    // Write ARK config files and set up directories
    const baseDir = require('../../utils/ark/instance.utils').getInstancesBaseDir();
    const instanceDir = path.join(baseDir, instanceId);

    // Set up save directory for this instance.
    // ARK appends AltSaveDirectoryName to <runtimeRoot>/ShooterGame/Saved/, and the runtime
    // root differs between isolated and shared-install instances — resolving it here keeps
    // worlds in the instance's own SavedArks folder either way instead of nesting a second
    // Servers/<id>/ level inside the instance.
    const { getInstanceAltSaveDirName, getInstanceLogsDir } = require('../../utils/ark/ark-server/ark-server-paths.utils');
    const saveDir = getInstanceAltSaveDirName(instanceId);
    const formattedSaveDir = saveDir.replace(/\\/g, '/');
    const formattedConfigDir = instanceDir.replace(/\\/g, '/');
    const formattedLogDir = getInstanceLogsDir(instanceId).replace(/\\/g, '/');
    
    // Build the ARK server command arguments
    const args = buildArkServerArgs({
      ...instance,
      saveDir: formattedSaveDir,
      configDir: formattedConfigDir,
      logDir: formattedLogDir,
      altSaveDirName: saveDir
    });

    // Prefer AsaApiLoader.exe when installed for this instance; otherwise ArkAscendedServer.exe.
    // cwd must be the instance Win64 folder so AsaApi DLLs/plugins resolve correctly.
    const { prepareArkServerCommand, resolveServerLaunch } = require('../../utils/ark/ark-server/ark-server-paths.utils');
    const launch = resolveServerLaunch(instanceId);
    const commandInfo = prepareArkServerCommand(launch.executable, args, instanceId);

    if (launch.usesAsaApiLoader) {
      console.log(`[server-process-service] Launching instance ${instanceId} via AsaApiLoader: ${launch.executable}`);
    }

    // Set up spawn options with proper environment and working directory
    const { getPlatform } = require('../../utils/platform.utils');
    const cwd = launch.cwd;

    // Ensure steam_appid.txt exists in the working directory so the Steam
    // subsystem can initialize for every server instance, not just the first.
    try {
      fs.mkdirSync(cwd, { recursive: true });
      fs.writeFileSync(path.join(cwd, 'steam_appid.txt'), ARK_APP_ID, 'utf8');
    } catch (e) {
      console.warn(`[server-process-service] Could not write steam_appid.txt to ${cwd}:`, e);
    }

    const spawnOptions: any = {
      cwd,
      // Use 'ignore' for stdout/stderr — we tail the log file directly and never
      // read from these pipes.  On Linux, xvfb-run + Proton + Wine are extremely
      // verbose on stderr; if the 64 KB pipe buffer fills up and the parent never
      // drains it, the child process blocks on its next write() call, which freezes
      // ARK and causes it to stop writing to ShooterGame.log.
      //
      // Redirect stderr to a per-instance log file so crash diagnostics are captured
      // without pipe buffer risk (Issue #6).
      stdio: ['ignore', 'ignore', 'ignore'] as any,
      env: {
        ...process.env,
        ...(commandInfo.env || {}), // Add Proton env vars on Linux
        SteamAppId: ARK_APP_ID,
        ARK_SAVE_PATH: formattedSaveDir,
        ARK_CONFIG_PATH: formattedConfigDir,
        ARK_LOG_PATH: formattedLogDir
      },
      detached: getPlatform() === 'linux',
      windowsHide: true
    };

    // Redirect stderr to a per-instance log file for diagnostics on every platform.
    // Writing to a file rather than a pipe keeps the pipe-buffer hazard described above
    // out of play, and it is the only diagnostic available when ARK aborts before it
    // creates ShooterGame.log — previously Windows captured nothing at all, so a server
    // that could not launch reported only "Could not detect log file".
    let stderrFd: number | null = null;
    try {
      const stderrLogPath = path.join(instanceDir, 'stderr.log');
      fs.mkdirSync(instanceDir, { recursive: true });
      stderrFd = fs.openSync(stderrLogPath, 'w');
      spawnOptions.stdio = ['ignore', 'ignore', stderrFd] as any;
    } catch (e) {
      console.warn(`[server-process-service] Could not create stderr log for ${instanceId}:`, e);
    }

    // Snapshot log files BEFORE starting so we can detect which new file belongs to this instance
    const logSnapshot = snapshotLogFiles(instanceId);

    // Start the server process
    let serverProcess;
    try {
      serverProcess = spawn(commandInfo.command, commandInfo.args, spawnOptions);
    } finally {
      // The child has inherited the descriptor by the time spawn() returns, so release the
      // parent's copy. Without this every start/restart leaks an fd for the app's lifetime.
      if (stderrFd !== null) {
        try {
          fs.closeSync(stderrFd);
        } catch {
          // Already closed / never valid — nothing to release
        }
      }
    }

    // Detect and register the log file for this instance (async, retries internally)
    const sessionName = instance.sessionName || instance.serverName || 'My Server';
    detectAndRegisterLogFile(instanceId, sessionName, logSnapshot);

    // Notify Discord
    const { discordService } = require('../discord.service');
    discordService.sendNotification(instanceId, 'start', 'Server is starting up...');

    // Store the process reference
    this.arkServerProcesses[instanceId] = serverProcess;
    this.processStartTimes[instanceId] = startTimestamp;

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
    serverProcess.on('exit', async (code, signal) => {
      const uptimeMs = this.processStartTimes[instanceId] ? Date.now() - this.processStartTimes[instanceId] : 0;
      const uptimeSec = Math.round(uptimeMs / 1000);
      const previousState = this.getInstanceState(instanceId);
      const isRapidCrash = previousState === 'starting' && uptimeSec < 60;

      // Log exit details for diagnostics
      console.log(`[server-process-service] Server ${instanceId} exited — code=${code}, signal=${signal}, uptime=${uptimeSec}s, previousState=${previousState}`);

      // Determine final state: crashed vs stopped
      const finalState = (code !== 0 && code !== null && previousState === 'starting') ? 'crashed' : 'stopped';
      this.setInstanceState(instanceId, finalState);
      unregisterLogFile(instanceId);
      delete this.processStartTimes[instanceId];
      delete this.arkServerProcesses[instanceId];
      onState?.(finalState);

      // On rapid crash, read stderr.log and send diagnostics to UI
      if (isRapidCrash) {
        const baseDir = require('../../utils/ark/instance.utils').getInstancesBaseDir();
        const stderrLogPath = path.join(baseDir, instanceId, 'stderr.log');
        let stderrContents = '';
        try {
          if (fs.existsSync(stderrLogPath)) {
            const raw = fs.readFileSync(stderrLogPath, 'utf8');
            // Send last ~50 lines to avoid flooding
            const lines = raw.split('\n');
            stderrContents = lines.slice(-50).join('\n').trim();
          }
        } catch (e) {
          console.warn(`[server-process-service] Could not read stderr.log for ${instanceId}:`, e);
        }

        console.error(`[server-process-service] Rapid crash detected for ${instanceId} — process exited in ${uptimeSec}s with code ${code}`);
        if (stderrContents) {
          console.error(`[server-process-service] stderr.log tail:\n${stderrContents}`);
        }

        // Send crash notification and stderr log to the UI
        const messagingService = require('../messaging.service').messagingService;
        const instanceConfig = require('../../utils/ark/instance.utils').getInstance(instanceId);
        const instanceName = instanceConfig?.name || instanceId;
        messagingService.sendToAll('notification', {
          type: 'error',
          message: `Server "${instanceName}" crashed during startup (exit code ${code}). Check logs for details.`
        });
        if (stderrContents) {
          messagingService.sendToAll('server-instance-log', {
            log: `[CRASH] Process exited with code ${code} after ${uptimeSec}s. stderr output:\n${stderrContents}`,
            instanceId
          });
        } else {
          messagingService.sendToAll('server-instance-log', {
            log: `[CRASH] Process exited with code ${code} after ${uptimeSec}s. No stderr output captured.`,
            instanceId
          });
        }
      }
      
      // Notify Discord
      const { discordService } = require('../discord.service');
      discordService.sendNotification(instanceId, finalState === 'crashed' ? 'crash' : 'stop',
        finalState === 'crashed' ? `Server crashed during startup (exit code ${code})` : 'Server has stopped');

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
      if (state === 'stopped' || state === 'error' || state === 'crashed') {
        return { success: true, instanceId };
      }
      return { success: false, error: 'Server process not found', instanceId };
    }

    // Set state to stopping
    this.setInstanceState(instanceId, 'stopping');
    const rconService = require('../rcon.service').rconService;

    // 1. Try graceful "SaveWorld" via RCON (bounded — hung RCON must not block the stop path)
    try {
      console.log(`[server-process-service] Stopping instance ${instanceId}: Sending SaveWorld...`);
      const saveResult = await rconService.executeRconCommand(instanceId, 'SaveWorld', 30000);
      if (saveResult?.success) {
        // Wait for save to flush; most servers finish within 5-10 seconds
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        console.warn(`[server-process-service] RCON SaveWorld failed for ${instanceId}:`, saveResult?.error);
      }
    } catch (error) {
      console.warn(`[server-process-service] RCON SaveWorld failed for ${instanceId}:`, error);
    }

    // 2. Try graceful "DoExit" via RCON
    try {
      console.log(`[server-process-service] Stopping instance ${instanceId}: Sending DoExit...`);
      const exitResult = await rconService.executeRconCommand(instanceId, 'DoExit', 15000);
      if (!exitResult?.success) {
        console.warn(`[server-process-service] RCON DoExit failed for ${instanceId}:`, exitResult?.error);
      }
    } catch (error) {
      console.warn(`[server-process-service] RCON DoExit failed for ${instanceId}:`, error);
    }

    // 3. Wait for process exit (max 2 minutes) using Promise.race for hard timeout
    const shutdownTimeoutMs = 120000;
    const checkIntervalMs = 1000;

    const waitForExit = async () => {
      const startTime = Date.now();
      while ((Date.now() - startTime) < shutdownTimeoutMs) {
        try {
          if (process.killed || process.exitCode !== null) return true;
          if (!this.arkServerProcesses[instanceId]) return true;
        } catch (e) {
          return true;
        }
        await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
      }
      return false;
    };

    const hardTimeout = new Promise<boolean>(resolve => setTimeout(() => resolve(false), shutdownTimeoutMs + 5000));
    const exited = await Promise.race([waitForExit(), hardTimeout]);

    // 4. Force kill if still running
    if (this.arkServerProcesses[instanceId]) {
      console.warn(`[server-process-service] Instance ${instanceId} did not stop gracefully (exited=${exited}). Force killing...`);
      try {
        process.kill('SIGTERM');
        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch (e) {
        // SIGTERM may fail if process already gone
      }

      if (this.arkServerProcesses[instanceId]) {
        try {
          process.kill('SIGKILL');
          await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (e) {
          // SIGKILL may fail if process already gone
        }
      }

      // Windows fallback: taskkill by PID if process.kill didn't work
      if (this.arkServerProcesses[instanceId] && process.pid) {
        const { getPlatform } = require('../../utils/platform.utils');
        if (getPlatform() === 'windows') {
          try {
            console.warn(`[server-process-service] Instance ${instanceId}: using taskkill /F /PID ${process.pid}`);
            execSync(`taskkill /F /PID ${process.pid}`, { stdio: 'ignore' });
          } catch (e) {
            // Process may already be gone
          }
        } else {
          try {
            execSync(`kill -9 ${process.pid}`, { stdio: 'ignore' });
          } catch (e) {
            // Process may already be gone
          }
        }
      }
    }

    // Process 'exit' handler (setupProcessMonitoring) will handle cleanup, state update, and RCON disconnect
    // But we manually ensure cleanup + UI broadcast here if the exit handler didn't fire
    if (this.arkServerProcesses[instanceId]) {
      await this.forceKillServerProcess(instanceId);
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
        // Kill any remaining AsaApiLoader / ARK server processes that might have been orphaned
        try {
          require('child_process').execSync('pkill -f AsaApiLoader', { stdio: 'ignore' });
        } catch (e) {
          // Ignore if no processes found
        }

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