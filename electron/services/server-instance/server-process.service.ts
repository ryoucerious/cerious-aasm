import { ChildProcess, SpawnOptions, execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { validateInstanceId } from '../../utils/validation.utils';
import { getPlatform } from '../../utils/platform.utils';
import * as instanceUtils from '../../utils/ark/instance.utils';
import { buildArkServerArgs } from '../../utils/ark/ark-args.utils';
import * as stateUtils from '../../utils/ark/ark-server/ark-server-state.utils';
import {
  ARK_APP_ID,
  getInstanceAltSaveDirName,
  getInstanceLogsDir,
  prepareArkServerCommand,
  resolveServerLaunch
} from '../../utils/ark/ark-server/ark-server-paths.utils';
import {
  detectAndRegisterLogFile,
  readLogTail,
  setupLogTailing,
  snapshotLogFiles,
  unregisterLogFile
} from '../../utils/ark/ark-server/ark-server-logging.utils';
import {
  cleanupOrphanedArkProcesses,
  holdStartsUntil,
  killInstanceProcesses,
  rememberInstanceProcessMarker
} from '../../utils/ark/ark-server/ark-server-cleanup.utils';
import type { InstanceConfig, ServerInstanceResult } from '../../types/server-instance.types';
import { discordService } from '../discord.service';
import { messagingService } from '../messaging.service';
import { rconService } from '../rcon.service';

type StateCallback = (state: string) => void;
type LogCallback = (line: string) => void;

const SAVE_WORLD_TIMEOUT_MS = 30000;
// Most servers finish writing the save within 5-10 s of SaveWorld answering.
const SAVE_FLUSH_MS = 5000;
const DO_EXIT_TIMEOUT_MS = 15000;
const STOP_RECONNECT_TIMEOUT_MS = 5000;
const TASKKILL_TIMEOUT_MS = 5000;
const GRACEFUL_EXIT_TIMEOUT_MS = 120000;
const SIGTERM_GRACE_MS = 5000;
// Safety net for a startup line that is never seen (Proton swallowing output, an unknown log
// format): long enough for the slowest first Proton boot, and still a single RCON attempt.
const STARTUP_SAFETY_NET_MS = 15 * 60 * 1000;
const STDERR_TAIL_LINES = 50;

export class ServerProcessService {
  private arkServerProcesses: Record<string, ChildProcess> = {};
  private processStartTimes: Record<string, number> = {};
  // False when the tracked process is ArkAscendedServer.exe itself on Windows: nothing can
  // outlive it, so its exit needs no leftover sweep (a PowerShell run each time).
  private leftoversPossible: Record<string, boolean> = {};
  // The callback the server was started with: a force kill reports through it, since the exit that
  // follows is ignored once the process is untracked.
  private stateCallbacks: Record<string, StateCallback> = {};
  private readonly stopsInProgress = new Set<string>();

  setInstanceState(instanceId: string, state: string): void {
    stateUtils.setInstanceState(instanceId, state);
  }

  getInstanceState(instanceId: string): string | null {
    return stateUtils.getInstanceState(instanceId);
  }

  /** The state, with 'stopped' for an instance that never ran. */
  getNormalizedInstanceState(instanceId: string): string {
    return stateUtils.getNormalizedInstanceState(instanceId);
  }

  getServerProcess(instanceId: string): ChildProcess | null {
    return this.arkServerProcesses[instanceId] || null;
  }

  /** Epoch ms at which the tracked process was spawned; drives the dashboard's uptime. */
  getProcessStartTime(instanceId: string): number | null {
    return this.processStartTimes[instanceId] ?? null;
  }

  getActiveProcessCount(): number {
    return Object.keys(this.arkServerProcesses).length;
  }

  hasActiveProcess(instanceId: string): boolean {
    const child = this.arkServerProcesses[instanceId];
    return !!(child && !child.killed && child.exitCode === null);
  }

  /**
   * Kills the server's whole process tree at once, with no save, and reports it stopped. Used for
   * a manual force stop, a stop that timed out, and before SteamCMD touches the files.
   */
  async forceKillServerProcess(instanceId: string, options?: { broadcast?: boolean }): Promise<void> {
    await rconService.forceDisconnectRcon(instanceId);

    const child = this.arkServerProcesses[instanceId];
    const sweepNeeded = !child || this.leftoversPossible[instanceId] !== false;
    const report = options?.broadcast === false ? null : this.stateCallbacks[instanceId] ?? broadcastStopped(instanceId);
    // Untracked first, so the exit that follows is ignored rather than reported as a crash.
    this.untrack(instanceId);
    // Registered before the first await below: a start arriving during taskkill would otherwise
    // spawn, then have its log tailer torn down and its state set back to stopped by this kill.
    const kill = this.killUntracked(instanceId, child, sweepNeeded, report);
    void holdStartsUntil(instanceId, kill);
    await kill;
  }

  /** `report` is told 'stopped' once the kill is done; null reports nothing. */
  private async killUntracked(instanceId: string, child: ChildProcess | undefined, sweepNeeded: boolean, report: StateCallback | null): Promise<void> {
    // The launcher can go before Wine/ARK, which then still holds the ports.
    const sweep = sweepNeeded ? killInstanceProcesses(instanceId) : undefined;
    if (child) await killProcessTree(child);
    unregisterLogFile(instanceId);
    await sweep;
    stateUtils.setInstanceState(instanceId, 'stopped');

    if (report) {
      report('stopped');
      messagingService.sendToAll('rcon-status', { instanceId, connected: false });
    }
  }

  async startServerProcess(instanceId: string, instance: InstanceConfig): Promise<ServerInstanceResult> {
    stateUtils.setInstanceState(instanceId, 'starting');
    const startedAt = Date.now();
    const instanceDir = instanceUtils.getInstanceDir(instanceId);

    // ARK appends AltSaveDirectoryName to <runtimeRoot>/ShooterGame/Saved/, and the runtime root
    // differs between isolated and shared-install instances; resolving it here keeps worlds in the
    // instance's own SavedArks either way.
    const altSaveDirName = getInstanceAltSaveDirName(instanceId);
    const args = buildArkServerArgs({ ...instance, altSaveDirName });

    // AsaApiLoader.exe when AsaApi is installed for the instance, with cwd its Win64 folder so the
    // AsaApi DLLs and plugins resolve.
    const launch = resolveServerLaunch(instanceId);
    const command = prepareArkServerCommand(launch.executable, args, instanceId);
    if (launch.usesAsaApiLoader) {
      console.log(`[server-process] Launching ${instanceId} via AsaApiLoader: ${launch.executable}`);
    }

    // The Steam subsystem only initialises for every instance, not just the first, when
    // steam_appid.txt sits in the working directory.
    try {
      fs.mkdirSync(launch.cwd, { recursive: true });
      fs.writeFileSync(path.join(launch.cwd, 'steam_appid.txt'), ARK_APP_ID, 'utf8');
    } catch (error) {
      console.warn(`[server-process] Could not write steam_appid.txt to ${launch.cwd}:`, error);
    }

    // stdout is never read: the log file is tailed instead. A pipe nobody drains blocks the child
    // once 64 KB are waiting, which freezes ARK (xvfb-run, Proton and Wine are very chatty under
    // Linux). stderr goes to a file: it is the only diagnostic when ARK aborts before it creates
    // ShooterGame.log.
    const stderrFd = openStderrLog(instanceDir, instanceId);
    const spawnOptions: SpawnOptions = {
      cwd: launch.cwd,
      stdio: ['ignore', 'ignore', stderrFd ?? 'ignore'],
      env: {
        ...process.env,
        ...command.env,
        SteamAppId: ARK_APP_ID,
        ARK_SAVE_PATH: altSaveDirName.replace(/\\/g, '/'),
        ARK_CONFIG_PATH: instanceDir.replace(/\\/g, '/'),
        ARK_LOG_PATH: getInstanceLogsDir(instanceId).replace(/\\/g, '/')
      },
      // Its own process group on Linux, so the group holds xvfb-run, Proton and Wine together.
      detached: getPlatform() === 'linux',
      windowsHide: true
    };

    // Taken before the spawn, to tell this instance's log file from its neighbours'.
    const logSnapshot = snapshotLogFiles(instanceId);
    rememberInstanceProcessMarker(instanceId);

    let child: ChildProcess;
    try {
      child = spawn(command.command, command.args, spawnOptions);
    } finally {
      // The child has its own copy by now. Without this every start leaks a descriptor.
      if (stderrFd !== null) {
        try {
          fs.closeSync(stderrFd);
        } catch {
          // Already closed
        }
      }
    }

    detectAndRegisterLogFile(instanceId, logSnapshot);
    discordService.sendNotification(instanceId, 'start', 'Server is starting up...');

    this.arkServerProcesses[instanceId] = child;
    this.processStartTimes[instanceId] = startedAt;
    this.leftoversPossible[instanceId] = getPlatform() !== 'windows' || launch.usesAsaApiLoader;
    return { success: true, instanceId };
  }

  /** Watches the spawned server: its log, its exit, and RCON once it is up. */
  setupProcessMonitoring(instanceId: string, onLog?: LogCallback, onState?: StateCallback): void {
    const child = this.arkServerProcesses[instanceId];
    if (!child) return;
    if (onState) this.stateCallbacks[instanceId] = onState;

    let rconRequested = false;
    const handleState = (state: string) => {
      onState?.(state);
      if (state === 'running' && !rconRequested && stateUtils.getInstanceState(instanceId) === 'running') {
        rconRequested = true;
        this.connectRcon(instanceId);
      }
    };

    const safetyNet = setTimeout(() => {
      if (rconRequested || this.arkServerProcesses[instanceId] !== child) return;
      if (stateUtils.getInstanceState(instanceId) !== 'starting') return;
      console.log(`[server-process] ${instanceId} still starting after 15 minutes; assuming it is up`);
      stateUtils.setInstanceState(instanceId, 'running');
      handleState('running');
    }, STARTUP_SAFETY_NET_MS);

    child.on('exit', (code, signal) => {
      clearTimeout(safetyNet);
      // A process that was force-killed and replaced: its exit belongs to the old run.
      if (this.arkServerProcesses[instanceId] !== child) return;
      try {
        this.handleExit(instanceId, code, signal, onState);
      } catch (error) {
        console.error(`[server-process] Failed to handle the exit of ${instanceId}:`, error);
      }
    });

    child.on('error', error => {
      if (this.arkServerProcesses[instanceId] !== child) return;
      console.error(`[server-process] ${instanceId} process error:`, error);
      // Other errors are a failed kill of a process that is still running. A spawn failure leaves
      // no process, and 'exit' may never follow it.
      if (child.pid !== undefined) return;
      clearTimeout(safetyNet);
      this.untrack(instanceId);
      unregisterLogFile(instanceId);
      stateUtils.setInstanceState(instanceId, 'error');
      onState?.('error');
      discordService.sendNotification(instanceId, 'crash', `Server process error: ${error.message}`);
    });

    setupLogTailing(instanceId, line => onLog?.(line), handleState);
  }

  private handleExit(instanceId: string, code: number | null, signal: NodeJS.Signals | null, onState?: StateCallback): void {
    const startedAt = this.processStartTimes[instanceId];
    const uptimeSec = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;
    const sweepNeeded = this.leftoversPossible[instanceId] !== false;
    this.untrack(instanceId);

    // Read the rest of the log first: an unread shutdown line decides between stopped and crashed.
    unregisterLogFile(instanceId);
    const previousState = stateUtils.getInstanceState(instanceId);
    // Every stop this app makes marks the instance 'stopping' first or untracks the process, so an
    // exit while starting or running is one nobody asked for.
    const crashed = previousState === 'starting' || previousState === 'running';
    const finalState = crashed ? 'crashed' : 'stopped';
    const exit = describeExit(code, signal);
    console.log(`[server-process] ${instanceId} exited (${exit}) after ${uptimeSec}s while ${previousState}`);

    stateUtils.setInstanceState(instanceId, finalState);
    onState?.(finalState);

    if (crashed && previousState === 'starting') {
      this.reportStartupCrash(instanceId, exit, uptimeSec);
    }
    if (crashed) {
      const during = previousState === 'starting' ? ' during startup' : '';
      discordService.sendNotification(instanceId, 'crash', `Server crashed${during} (${exit})`);
    } else {
      discordService.sendNotification(instanceId, 'stop', 'Server has stopped');
    }

    // The tracked launcher can exit while Wine/ARK is still bound to the RCON port. The next start
    // of this instance waits for the sweep.
    if (sweepNeeded) {
      void killInstanceProcesses(instanceId);
    }

    void rconService.disconnectRcon(instanceId).then(() => {
      messagingService.sendToAll('rcon-status', { instanceId, connected: false });
    });
  }

  /** Shows the end of stderr.log: the only diagnostic when ARK dies before writing its log. */
  private reportStartupCrash(instanceId: string, exit: string, uptimeSec: number): void {
    const stderrTail = readLogTail(path.join(instanceUtils.getInstanceDir(instanceId), 'stderr.log'), STDERR_TAIL_LINES).join('\n');
    console.error(`[server-process] ${instanceId} crashed during startup (${exit}) after ${uptimeSec}s`);
    if (stderrTail) {
      console.error(`[server-process] stderr.log tail:\n${stderrTail}`);
    }

    const name = instanceUtils.getInstance(instanceId)?.name || instanceId;
    messagingService.sendToAll('notification', {
      type: 'error',
      message: `${name} crashed during startup (${exit}). Check the logs for details.`,
      instanceId
    });
    messagingService.sendToAll('server-instance-log', {
      log: stderrTail
        ? `[CRASH] Process exited (${exit}) after ${uptimeSec}s. stderr output:\n${stderrTail}`
        : `[CRASH] Process exited (${exit}) after ${uptimeSec}s. No stderr output captured.`,
      instanceId
    });
  }

  private connectRcon(instanceId: string): void {
    console.log(`[server-process] ${instanceId} is up; connecting RCON`);
    void rconService.connectRcon(instanceId)
      .then(result => {
        if (!result.connected) {
          console.warn(`[server-process] RCON for ${instanceId} did not connect: ${result.error}`);
        }
        messagingService.sendToAll('rcon-status', { instanceId, connected: result.connected });
      })
      .catch(error => console.error(`[server-process] RCON connect for ${instanceId} failed:`, error));
  }

  /**
   * SaveWorld, DoExit, up to 2 minutes for the process to go, then SIGTERM and finally a force kill.
   * Worst case about 190 s.
   */
  async stopServerProcess(instanceId: string): Promise<ServerInstanceResult> {
    if (!validateInstanceId(instanceId)) {
      return { success: false, error: 'Invalid instance ID', instanceId };
    }

    const child = this.arkServerProcesses[instanceId];
    if (!child) {
      const state = stateUtils.getInstanceState(instanceId);
      if (state === 'stopped' || state === 'error' || state === 'crashed') {
        return { success: true, instanceId };
      }
      return { success: false, error: 'Server process not found', instanceId };
    }

    stateUtils.setInstanceState(instanceId, 'stopping');
    this.stopsInProgress.add(instanceId);
    try {
      const hadRcon = rconService.getRconStatus(instanceId).connected;
      if ((await this.sendStopCommand(instanceId, 'SaveWorld', SAVE_WORLD_TIMEOUT_MS)).success) {
        await delay(SAVE_FLUSH_MS);
      }
      // A SaveWorld that timed out drops the connection; DoExit still has to get through.
      if (hadRcon && !rconService.getRconStatus(instanceId).connected) {
        await rconService.reconnectRcon(instanceId, STOP_RECONNECT_TIMEOUT_MS);
      }
      const doExit = await this.sendStopCommand(instanceId, 'DoExit', DO_EXIT_TIMEOUT_MS);

      // Nothing makes a server exit that DoExit never reached (no RCON yet while it starts, say).
      const exited = doExit.notSent ? hasExited(child) : await waitForExit(child, GRACEFUL_EXIT_TIMEOUT_MS);
      if (!exited) {
        console.warn(doExit.notSent
          ? `[server-process] ${instanceId} could not be sent DoExit; terminating it`
          : `[server-process] ${instanceId} did not stop within ${GRACEFUL_EXIT_TIMEOUT_MS / 1000}s; terminating it`);
        try {
          child.kill('SIGTERM');
        } catch {
          // Already gone
        }
        if (!(await waitForExit(child, SIGTERM_GRACE_MS)) && this.arkServerProcesses[instanceId] === child) {
          await this.forceKillServerProcess(instanceId);
        }
      }
    } finally {
      this.stopsInProgress.delete(instanceId);
    }

    return { success: true, instanceId };
  }

  /** True while stopServerProcess runs for the instance: its 'stopping' mark belongs to that stop. */
  isStopInProgress(instanceId: string): boolean {
    return this.stopsInProgress.has(instanceId);
  }

  private async sendStopCommand(instanceId: string, command: string, timeoutMs: number): Promise<{ success: boolean; notSent: boolean }> {
    console.log(`[server-process] Stopping ${instanceId}: sending ${command}`);
    const result = await rconService.executeRconCommand(instanceId, command, timeoutMs);
    if (!result.success) {
      console.warn(`[server-process] ${command} failed for ${instanceId}: ${result.error}`);
    }
    return { success: result.success, notSent: !!result.notSent };
  }

  /** Terminates every tracked server. For app exit: there is no time to save or wait. */
  killAllProcesses(): void {
    for (const [instanceId, child] of Object.entries(this.arkServerProcesses)) {
      // Untracked first: these exits are not crashes.
      this.untrack(instanceId);
      stateUtils.setInstanceState(instanceId, 'stopped');
      try {
        child.kill('SIGTERM');
      } catch (error) {
        console.error(`[server-process] Failed to terminate ${instanceId}:`, error);
      }
    }
    // SIGTERM reaches only the launcher under Linux; Wine keeps running without it. pkill is
    // spawned at once, so it runs even though the app is about to exit.
    if (getPlatform() === 'linux') {
      void cleanupOrphanedArkProcesses();
    }
  }

  private untrack(instanceId: string): void {
    delete this.arkServerProcesses[instanceId];
    delete this.processStartTimes[instanceId];
    delete this.leftoversPossible[instanceId];
    delete this.stateCallbacks[instanceId];
  }
}

function broadcastStopped(instanceId: string): StateCallback {
  return state => messagingService.sendToAll('server-instance-state', { state, instanceId });
}

function openStderrLog(instanceDir: string, instanceId: string): number | null {
  try {
    fs.mkdirSync(instanceDir, { recursive: true });
    return fs.openSync(path.join(instanceDir, 'stderr.log'), 'w');
  } catch (error) {
    console.warn(`[server-process] Could not create stderr.log for ${instanceId}:`, error);
    return null;
  }
}

async function killProcessTree(child: ChildProcess): Promise<void> {
  const { pid } = child;
  try {
    if (pid === undefined) {
      child.kill('SIGKILL');
    } else if (getPlatform() === 'linux') {
      // Detached at spawn, so the pid leads a group holding xvfb-run, Proton and Wine.
      process.kill(-pid, 'SIGKILL');
    } else {
      await new Promise<void>((resolve, reject) => {
        execFile('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true, timeout: TASKKILL_TIMEOUT_MS },
          error => (error ? reject(error) : resolve()));
      });
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already gone
    }
  }
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise(resolve => {
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolve(false);
    }, timeoutMs);
    child.once('exit', onExit);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function describeExit(code: number | null, signal: NodeJS.Signals | null): string {
  return code !== null ? `exit code ${code}` : `signal ${signal}`;
}

export const serverProcessService = new ServerProcessService();
