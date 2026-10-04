import { spawn } from 'child_process';
import { getCurrentInstalledVersion, installArkServer } from '../utils/ark/ark-install.utils';
import { ARK_APP_ID } from '../utils/ark/ark-server/ark-server-paths.utils';
import { whileServerFilesUpdate } from '../utils/ark/ark-server/ark-server-state.utils';
import { loadGlobalConfig } from '../utils/global-config.utils';
import { acquireInstallLock, INSTALL_IN_PROGRESS, isInstallLocked, releaseInstallLock } from '../utils/installer.utils';
import { getPlatform } from '../utils/platform.utils';
import { getSteamCmdDir, getSteamCmdExecutable, isSteamCmdInstalled } from '../utils/steamcmd.utils';
import type { InstanceConfig } from '../types/server-instance.types';
import type { MessagingService } from './messaging.service';
import { rconService } from './rcon.service';
import { getStandardEventCallbacks } from './server-instance/instance-events';
import { serverInstanceService } from './server-instance/server-instance.service';
import { serverLifecycleService } from './server-instance/server-lifecycle.service';
import { serverManagementService } from './server-instance/server-management.service';
import { serverProcessService } from './server-instance/server-process.service';

// Each check runs SteamCMD, which is heavy.
const POLL_INTERVAL_MS = 15 * 60 * 1000;
const UPDATE_COOLDOWN_MS = 60 * 60 * 1000;
const STEAMCMD_QUERY_TIMEOUT_MS = 2 * 60 * 1000;
// After 'exit', how long to wait for 'close' (the pipes) before reading what arrived.
const EXIT_GRACE_MS = 1000;
// The servers stay down while SteamCMD updates, so it has a ceiling on top of its stall check.
const STEAMCMD_UPDATE_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const STOP_ALL_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_WARNING_MINUTES = 15;
const DEFAULT_START_DELAY_SECONDS = 60;

type ClusterUpdateStatus = 'stopping' | 'updating' | 'warning' | 'error' | 'configuring' | 'starting' | 'complete';

export interface ArkUpdateResult {
  success: boolean;
  hasUpdate: boolean;
  buildId?: string | null;
  message?: string;
  error?: string;
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function mergeById(first: InstanceConfig[], second: InstanceConfig[]): InstanceConfig[] {
  const ids = new Set(first.map(({ id }) => id));
  return [...first, ...second.filter(({ id }) => !ids.has(id))];
}

/** The public branch is the live build; other branches carry build ids of their own. */
function parsePublicBuildId(appInfo: string): string | null {
  const publicBranch = /"public"\s*\{[\s\S]*?"buildid"\s+"(\d+)"/i.exec(appInfo);
  return publicBranch?.[1] ?? /"buildid"\s+"(\d+)"/i.exec(appInfo)?.[1] ?? null;
}

/** Stops the build check that is running, if any; readAppInfo then resolves with what it has. */
let stopRunningQuery: (() => void) | null = null;

/** For app exit: the build check runs in a process group of its own, which would outlive the app. */
export function stopSteamCmdQuery(): void {
  stopRunningQuery?.();
}

/** SteamCMD's app info for ARK. Never rejects: a failure or a hang yields what was printed so far. */
function readAppInfo(): Promise<string> {
  return new Promise(resolve => {
    // On Linux steamcmd.sh starts the real SteamCMD as a child that holds the pipes open. In a
    // group of its own, the whole tree can be stopped at once.
    const ownGroup = getPlatform() === 'linux';
    const child = spawn(
      getSteamCmdExecutable(),
      ['+login', 'anonymous', '+app_info_update', '1', '+app_info_print', ARK_APP_ID, '+quit'],
      { cwd: getSteamCmdDir(), detached: ownGroup }
    );

    let output = '';
    let finished = false;
    let exitTimer: NodeJS.Timeout | undefined;
    const finish = () => {
      if (finished) return;
      finished = true;
      stopRunningQuery = null;
      clearTimeout(timer);
      clearTimeout(exitTimer);
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve(output);
    };

    const stop = () => {
      if (ownGroup && child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
          return;
        } catch (error) {
          console.warn('[ark-update] Could not stop the SteamCMD process group:', (error as Error).message);
        }
      }
      try {
        child.kill();
      } catch (error) {
        console.warn('[ark-update] Could not stop SteamCMD:', (error as Error).message);
      }
    };

    // Stopping it may produce no event at all, so the query ends here rather than on 'close'.
    const timer = setTimeout(() => {
      console.warn('[ark-update] SteamCMD did not answer within 2 minutes; stopping it');
      stop();
      finish();
    }, STEAMCMD_QUERY_TIMEOUT_MS);

    child.stdout?.on('data', data => { output += data.toString(); });
    child.stderr?.on('data', data => { output += data.toString(); });
    child.on('error', error => {
      console.error('[ark-update] Could not run SteamCMD:', error.message);
      finish();
    });
    // Whatever still holds the pipes after 'exit' is left over from this run, and goes with it.
    child.on('exit', () => {
      exitTimer = setTimeout(() => {
        stop();
        finish();
      }, EXIT_GRACE_MS);
    });
    child.on('close', finish);

    stopRunningQuery = () => {
      stop();
      finish();
    };
  });
}

export class ArkUpdateService {
  private installedBuildId: string | null = null;
  private latestBuildId: string | null = null;
  /** When the background poll last compared the installed build against Steam. */
  private lastCheckedAt: number | null = null;
  private updateAvailable = false;
  private updateScheduled = false;
  /** Start of the last cluster update, successful or not; auto-updates wait out a cooldown after it. */
  private lastUpdateAttemptTime = 0;
  private pollTimer: NodeJS.Timeout | null = null;
  private updateCountdown: NodeJS.Timeout | null = null;

  constructor(private readonly messagingService: MessagingService) {}

  /** Reads the installed build and starts the background poll. */
  async initialize(): Promise<void> {
    this.installedBuildId = await getCurrentInstalledVersion();
    console.log(`[ark-update] Installed build: ${this.installedBuildId}`);
    if (this.pollTimer) return;

    this.pollInBackground();
    this.pollTimer = setInterval(() => this.pollInBackground(), POLL_INTERVAL_MS);
    this.pollTimer.unref();
  }

  /** For app exit: stops the poll and a pending update countdown. An update already running carries on. */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.updateCountdown) {
      clearInterval(this.updateCountdown);
      this.updateCountdown = null;
      this.updateScheduled = false;
    }
  }

  private pollInBackground(): void {
    this.pollAndNotify().catch(error => console.error('[ark-update] Update poll failed:', error));
  }

  /** A fresh comparison of the installed build against Steam, for the manual check. */
  async checkForUpdate(): Promise<ArkUpdateResult> {
    try {
      this.installedBuildId = await getCurrentInstalledVersion();
      const latest = await this.getLatestServerVersion();
      if (!latest) {
        return { success: false, hasUpdate: false, message: 'Could not retrieve latest version from Steam' };
      }

      this.latestBuildId = latest;
      const hasUpdate = !!this.installedBuildId && latest !== this.installedBuildId;
      this.updateAvailable = hasUpdate;
      console.log(`[ark-update] Check: installed=${this.installedBuildId}, latest=${latest}, hasUpdate=${hasUpdate}`);

      return {
        success: true,
        hasUpdate,
        buildId: latest,
        message: hasUpdate
          ? `New ARK server build available: ${latest} (installed: ${this.installedBuildId})`
          : 'ARK server is up to date'
      };
    } catch (error) {
      console.error('[ark-update] Update check failed:', error);
      return {
        success: false,
        hasUpdate: false,
        error: error instanceof Error ? error.message : String(error),
        message: 'Failed to check for ARK server updates'
      };
    }
  }

  /** The latest build id when it differs from the installed one, otherwise null. */
  async pollArkServerUpdates(): Promise<string | null> {
    try {
      // Re-read from disk to pick up a finished SteamCMD run or a manual update.
      this.installedBuildId = await getCurrentInstalledVersion();

      const buildId = await this.getLatestServerVersion();
      if (!buildId || !this.installedBuildId) {
        return null;
      }

      this.latestBuildId = buildId;
      const hasUpdate = buildId !== this.installedBuildId;
      this.updateAvailable = hasUpdate;
      console.log(`[ark-update] Poll: installed=${this.installedBuildId}, latest=${buildId}, hasUpdate=${hasUpdate}`);
      return hasUpdate ? buildId : null;
    } catch (error) {
      console.error('[ark-update] Update poll failed:', error);
      return null;
    }
  }

  /**
   * A snapshot of the installation for the settings page: what is installed, what Steam has,
   * and when that was last compared. Never throws.
   */
  getStatus(): {
    installedBuildId: string | null;
    latestBuildId: string | null;
    updateAvailable: boolean;
    lastCheckedAt: number | null;
  } {
    return {
      installedBuildId: this.installedBuildId,
      latestBuildId: this.latestBuildId,
      updateAvailable: this.updateAvailable,
      lastCheckedAt: this.lastCheckedAt
    };
  }

  /**
   * Re-read the installed build and compare it against the last build Steam reported, without
   * another SteamCMD call. An install or update started from the settings page runs through the
   * installer rather than performClusterUpdate, so without this the update flag stays set until
   * the next poll. Broadcasts only when the answer changes, so repeated calls stay quiet.
   */
  async refreshInstalledBuild(): Promise<ReturnType<ArkUpdateService['getStatus']>> {
    // Keep the last known build if the manifest is briefly missing mid-install.
    this.installedBuildId = (await getCurrentInstalledVersion()) ?? this.installedBuildId;

    if (this.installedBuildId && this.latestBuildId) {
      const hasUpdate = this.installedBuildId !== this.latestBuildId;
      if (hasUpdate !== this.updateAvailable) {
        this.updateAvailable = hasUpdate;
        this.messagingService.sendToAll('ark-update-status', {
          hasUpdate,
          buildId: hasUpdate ? this.latestBuildId : null
        });
      }
    }

    return this.getStatus();
  }

  /** Polls Steam, broadcasts the result, and schedules an auto-update when one is due. */
  async pollAndNotify(): Promise<string | null> {
    // An install, or an update already on its way, runs SteamCMD against the same files.
    if (this.updateScheduled || isInstallLocked()) {
      return null;
    }

    const result = await this.pollArkServerUpdates();
    this.lastCheckedAt = Date.now();
    this.messagingService.sendToAll('ark-update-status', { hasUpdate: !!result, buildId: result });
    if (!result || this.updateScheduled) {
      return result;
    }

    const config = loadGlobalConfig();
    this.messagingService.sendToAll('ark-update-available', {
      current: this.installedBuildId,
      latest: result,
      autoUpdate: !!config.autoUpdateArkServer
    });
    if (config.autoUpdateArkServer) {
      if (Date.now() - this.lastUpdateAttemptTime < UPDATE_COOLDOWN_MS) {
        console.log('[ark-update] Update found, but the last attempt was under an hour ago; not updating yet');
      } else {
        console.log('[ark-update] Auto-update is on; scheduling a cluster update');
        await this.scheduleClusterUpdate(config.updateWarningMinutes || DEFAULT_WARNING_MINUTES);
      }
    }
    return result;
  }

  /** Warns the running servers once a minute (every five while more than five remain), then updates. */
  private async scheduleClusterUpdate(minutes: number): Promise<void> {
    this.updateScheduled = true;
    let running: InstanceConfig[];
    try {
      running = await this.findRunningInstances();
    } catch (error) {
      this.updateScheduled = false;
      throw error;
    }

    let remaining = minutes;
    const countdown = setInterval(() => {
      if (remaining <= 0) {
        clearInterval(countdown);
        this.updateCountdown = null;
        void this.performClusterUpdate(running);
        return;
      }
      if (remaining <= 5 || remaining % 5 === 0) {
        void this.broadcastWarning(running, remaining);
      }
      remaining--;
    }, 60 * 1000);
    countdown.unref();
    this.updateCountdown = countdown;
  }

  private async broadcastWarning(instances: InstanceConfig[], minutes: number): Promise<void> {
    const message = `Server will restart for update in ${minutes} minute(s).`;
    console.log(`[ark-update] Broadcast: ${message}`);
    for (const { id } of instances) {
      if (serverProcessService.getNormalizedInstanceState(id) === 'running') {
        await rconService.executeRconCommand(id, `Broadcast ${message}`);
      }
    }
  }

  /**
   * Stops the running servers, updates the shared install with SteamCMD, prepares every instance
   * and starts the stopped servers again. They are restarted even when the update fails. Never
   * rejects.
   */
  async performClusterUpdate(runningInstances?: InstanceConfig[]): Promise<void> {
    this.lastUpdateAttemptTime = Date.now();
    try {
      await this.runClusterUpdate(runningInstances);
    } catch (error) {
      console.error('[ark-update] Cluster update failed:', error);
    } finally {
      this.updateScheduled = false;
    }
  }

  private async runClusterUpdate(runningInstances?: InstanceConfig[]): Promise<void> {
    if (!acquireInstallLock()) {
      console.warn('[ark-update] Not updating: an install or update is already running');
      this.sendStatus('error', INSTALL_IN_PROGRESS);
      return;
    }

    console.log('[ark-update] Starting the cluster update');
    let stopped: InstanceConfig[] = [];
    let updated = false;
    try {
      await whileServerFilesUpdate(async () => {
        // Re-read: a server can have been started during the warning countdown.
        stopped = mergeById(runningInstances ?? [], await this.findRunningInstances());
        await this.stopAll(stopped);

        this.sendStatus('updating', 'Updating ARK server files (via SteamCMD)...');
        await this.updateInstall();
        updated = true;

        this.sendStatus('configuring', 'Updating instance binaries...');
        await this.prepareAllInstances();
      });
    } catch (error) {
      console.error('[ark-update] Update failed:', error);
      this.sendStatus('error', 'SteamCMD Update Failed');
    } finally {
      releaseInstallLock();
    }

    await this.restartInstances(stopped);
    if (updated) {
      this.sendStatus('complete', 'Cluster update complete');
    }
  }

  private sendStatus(status: ClusterUpdateStatus, message: string): void {
    this.messagingService.sendToAll('cluster-update-status', { status, message });
  }

  private async findRunningInstances(): Promise<InstanceConfig[]> {
    const { instances } = await serverManagementService.getAllInstances();
    return (instances as InstanceConfig[]).filter(({ id }) => {
      const state = serverProcessService.getNormalizedInstanceState(id);
      return state === 'running' || state === 'starting';
    });
  }

  private async stopAll(instances: InstanceConfig[]): Promise<void> {
    this.sendStatus('stopping', 'Stopping all servers...');
    for (const { id } of instances) {
      this.messagingService.sendToAll('server-instance-state', { state: 'stopping', instanceId: id });
    }

    // Each stop saves and force-kills on its own after about 3 minutes; this cap keeps one stuck
    // stop from holding the whole update.
    const stops = Promise.all(instances.map(({ id }) =>
      serverLifecycleService.stopServerInstance(id).catch(error => console.error(`[ark-update] Error stopping ${id}:`, error))
    ));
    let timer: NodeJS.Timeout | undefined;
    const timedOut = await Promise.race([
      stops.then(() => false),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(true), STOP_ALL_TIMEOUT_MS); })
    ]);
    clearTimeout(timer);
    if (timedOut) {
      console.warn('[ark-update] Servers still running after 5 minutes; force-killing them');
    }

    // SteamCMD cannot replace files a server still holds open. A state still reading 'stopping'
    // with no process left is cleared the same way, so the UI does not stay stuck on it.
    let killed = false;
    for (const { id } of instances) {
      const state = serverProcessService.getNormalizedInstanceState(id);
      if (serverProcessService.getServerProcess(id) || state !== 'stopped') {
        console.warn(`[ark-update] ${id} is still '${state}' before SteamCMD; force-killing it`);
        await serverProcessService.forceKillServerProcess(id);
        killed = true;
      }
    }
    if (killed) {
      // Lets the OS release the ports and file handles.
      await delay(2000);
    }
  }

  private async updateInstall(): Promise<void> {
    const priorBuildId = this.installedBuildId;
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), STEAMCMD_UPDATE_TIMEOUT_MS);
    try {
      // Awaited so the manifest is read, and the servers started, only once SteamCMD has finished.
      await new Promise<void>((resolve, reject) => {
        installArkServer(
          error => (error ? reject(error) : resolve()),
          progress => this.messagingService.sendToAll('cluster-update-progress', progress),
          deadline.signal
        );
      });
    } catch (error) {
      if (deadline.signal.aborted) {
        throw new Error(`SteamCMD did not finish the update within ${STEAMCMD_UPDATE_TIMEOUT_MS / 60000} minutes.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    this.installedBuildId = await getCurrentInstalledVersion();
    if (priorBuildId && this.installedBuildId === priorBuildId) {
      console.warn(`[ark-update] Build unchanged after the SteamCMD update (still ${priorBuildId})`);
      this.sendStatus('warning', `Update completed but version unchanged (${priorBuildId}). SteamCMD may have failed.`);
      // SteamCMD validated the install and found nothing to change, so it is current. Taking
      // Steam's build id keeps the next poll from starting another update.
      if (this.latestBuildId) {
        this.installedBuildId = this.latestBuildId;
      }
    } else {
      console.log(`[ark-update] Updated ${priorBuildId} -> ${this.installedBuildId}`);
    }
  }

  /** Every instance, running or not, so each starts from the new files. */
  private async prepareAllInstances(): Promise<void> {
    const { instances } = await serverManagementService.getAllInstances();
    for (const instance of instances as InstanceConfig[]) {
      // One instance that cannot be prepared must not strand the rest; its own start refuses
      // with the reason.
      try {
        await serverManagementService.prepareInstanceConfiguration(instance.id, instance);
      } catch (error) {
        console.error(`[ark-update] Could not prepare ${instance.id} after the update:`, error);
      }
    }
  }

  private async restartInstances(instances: InstanceConfig[]): Promise<void> {
    this.sendStatus('starting', 'Restarting servers...');
    const delayMs = (loadGlobalConfig().serverStartDelaySeconds ?? DEFAULT_START_DELAY_SECONDS) * 1000;
    for (const [index, { id }] of instances.entries()) {
      if (index > 0) {
        await delay(delayMs);
      }
      try {
        const { onLog, onState } = getStandardEventCallbacks(id);
        const result = await serverInstanceService.startServerInstance(id, onLog, onState);
        if (!result.started) {
          console.error(`[ark-update] Could not restart ${id}: ${result.portError}`);
        }
      } catch (error) {
        console.error(`[ark-update] Could not restart ${id}:`, error);
      }
    }
  }

  /** Asks Steam for the live build. Null when SteamCMD is missing or gives no answer; throws while an install holds the lock. */
  private async getLatestServerVersion(): Promise<string | null> {
    if (!isSteamCmdInstalled()) {
      console.error('[ark-update] SteamCMD is not installed');
      return null;
    }
    if (!acquireInstallLock()) {
      throw new Error(INSTALL_IN_PROGRESS);
    }
    try {
      const buildId = parsePublicBuildId(await readAppInfo());
      if (!buildId) {
        console.error('[ark-update] SteamCMD reported no build id');
      }
      return buildId;
    } finally {
      releaseInstallLock();
    }
  }
}
