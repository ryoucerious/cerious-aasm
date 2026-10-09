import { spawn } from 'child_process';
import * as path from 'path';
import { getCurrentInstalledVersion, installArkServer, isArkServerInstalled } from '../utils/ark/ark-install.utils';
import { ARK_APP_ID, getArkServerDir } from '../utils/ark/ark-server/ark-server-paths.utils';
import {
  changesBetween, freeBytes, listGameFiles, putInPlace, removeStaging, roomForStaging, seedStaging, stagingDirFor,
  type GameFileChanges
} from '../utils/ark/ark-update-staging.utils';
import { warningMarks } from '../utils/warning-marks.utils';
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
// A ceiling on top of SteamCMD's stall check: a run that never ends would hold the install lock.
const STEAMCMD_UPDATE_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const STOP_ALL_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_WARNING_MINUTES = 15;
const DEFAULT_START_DELAY_SECONDS = 60;

/** copying and downloading run while the servers are up; updating is SteamCMD on the install itself. */
type ClusterUpdateStatus = 'copying' | 'downloading' | 'stopping' | 'updating' | 'warning' | 'error' | 'configuring' | 'starting' | 'complete';

/** How an ARK update on this machine is going: what each mesh member reports in its heartbeat. */
export interface ArkUpdateProgress {
  phase: ClusterUpdateStatus;
  message: string;
  /** While players are being warned. */
  minutesLeft?: number;
  /** While the install is copied, or SteamCMD downloads. */
  percent?: number;
  at: number;
}

/** How long the end of an update (done, or failed) stays on show. */
const UPDATE_RESULT_SHOWN_MS = 10 * 60 * 1000;

export interface ArkUpdateResult {
  success: boolean;
  hasUpdate: boolean;
  buildId?: string | null;
  message?: string;
  error?: string;
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Resolves at `at`, or as soon as `cancelled` aborts. Never holds the process open. */
function waitUntil(at: number, cancelled: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const done = () => {
      clearTimeout(timer);
      cancelled.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, Math.max(0, at - Date.now()));
    timer.unref?.();
    cancelled.addEventListener('abort', done);
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function gigabytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

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
  /** Ends the update under way while it is still downloading or warning: app exit. */
  private cancel: AbortController | null = null;
  private updateProgress: ArkUpdateProgress | null = null;

  constructor(private readonly messagingService: MessagingService) {}

  /** How the update on this machine is going; null when none is under way or recently ended. */
  progress(): ArkUpdateProgress | null {
    const current = this.updateProgress;
    if (!current) return null;
    const ended = current.phase === 'complete' || current.phase === 'error';
    return ended && Date.now() - current.at > UPDATE_RESULT_SHOWN_MS ? null : { ...current };
  }

  /**
   * An update asked for on this machine (Settings → Mesh, Update ARK). It downloads at once while
   * the servers keep running; once the new build is there, the players of the servers then running
   * are warned for the configured minutes (the answer says how long), and the servers stop, take
   * the new files and start again.
   */
  async requestUpdate(): Promise<{ success: boolean; error?: string; warningMinutes?: number }> {
    if (this.updateScheduled || isInstallLocked()) {
      return { success: false, error: 'An ARK update is already under way on this machine.' };
    }
    const running = await this.findRunningInstances();
    this.updateScheduled = true;
    void this.performClusterUpdate();
    return { success: true, warningMinutes: running.length ? loadGlobalConfig().updateWarningMinutes || DEFAULT_WARNING_MINUTES : 0 };
  }

  /** Reads the installed build and starts the background poll. */
  async initialize(): Promise<void> {
    this.installedBuildId = await getCurrentInstalledVersion();
    console.log(`[ark-update] Installed build: ${this.installedBuildId}`);
    if (this.pollTimer) return;

    this.pollInBackground();
    this.pollTimer = setInterval(() => this.pollInBackground(), POLL_INTERVAL_MS);
    this.pollTimer.unref();
  }

  /**
   * For app exit: stops the poll, and ends an update that is still downloading or warning players,
   * so no server is stopped for it. One that has begun stopping servers carries on.
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.cancel?.abort();
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
        console.log('[ark-update] Auto-update is on; downloading the update while the servers run');
        this.updateScheduled = true;
        void this.performClusterUpdate();
      }
    }
    return result;
  }

  /**
   * Updates ARK on this machine with as little downtime as it can: the update is downloaded into a
   * copy of the install while the servers keep running, and only once the new build is there are
   * players warned, the servers stopped and the changed files moved into the install. Manual and
   * automatic updates both come here. Never rejects.
   */
  async performClusterUpdate(): Promise<void> {
    this.lastUpdateAttemptTime = Date.now();
    this.updateScheduled = true;
    const cancel = new AbortController();
    this.cancel = cancel;
    try {
      await this.runClusterUpdate(cancel.signal);
    } catch (error) {
      console.error('[ark-update] Cluster update failed:', error);
    } finally {
      this.updateScheduled = false;
      if (this.cancel === cancel) this.cancel = null;
    }
  }

  private async runClusterUpdate(cancelled: AbortSignal): Promise<void> {
    if (!acquireInstallLock()) {
      console.warn('[ark-update] Not updating: an install or update is already running');
      this.sendStatus('error', INSTALL_IN_PROGRESS);
      return;
    }

    console.log('[ark-update] Starting the cluster update');
    const installDir = getArkServerDir();
    const stagingDir = stagingDirFor(installDir);
    try {
      const { stopped, updated, failure } = await this.updateWhileServersRun(installDir, stagingDir, cancelled);
      if (stopped) await this.restartInstances(stopped);
      if (updated) this.sendStatus('complete', `ARK updated to build ${this.installedBuildId ?? 'unknown'}.`);
      // Said again once the servers are back, or the machine's card would stay on "starting".
      else if (failure && stopped) this.sendStatus('error', failure);
    } finally {
      // After the restarts: a copy of the whole install can take a while to delete.
      await removeStaging(stagingDir).catch(error => console.warn(`[ark-update] Could not remove ${stagingDir}:`, messageOf(error)));
      releaseInstallLock();
    }
  }

  /**
   * Downloads beside the install, warns, then stops the servers, puts the new files in place and
   * prepares every instance. The servers it stopped, null when it stopped none; never rejects.
   */
  private async updateWhileServersRun(
    installDir: string,
    stagingDir: string,
    cancelled: AbortSignal
  ): Promise<{ stopped: InstanceConfig[] | null; updated: boolean; failure?: string }> {
    let stopped: InstanceConfig[] | null = null;
    let updated = false;
    try {
      const download = await this.downloadBesideInstall(installDir, stagingDir, cancelled);
      if (download.outcome !== 'ready' && download.outcome !== 'no-room') return { stopped, updated };

      await this.warnPlayers(cancelled);
      if (cancelled.aborted) {
        console.log('[ark-update] The update ended before any server was stopped');
        return { stopped, updated };
      }

      stopped = [];
      await whileServerFilesUpdate(async () => {
        // Re-read: servers can have been started during the download or the warning.
        stopped = await this.findRunningInstances();
        await this.stopAll(stopped);

        if (download.outcome === 'ready') {
          this.sendStatus('configuring', 'Putting the new ARK files in place...');
          await this.putNewFilesInPlace(stagingDir, installDir, download.changes);
        } else {
          this.sendStatus('updating', 'Updating ARK server files (via SteamCMD)...');
          await this.runSteamCmd(installDir, 'update');
        }
        await this.readInstalledBuild();
        updated = true;

        this.sendStatus('configuring', 'Updating instance binaries...');
        await this.prepareAllInstances();
      });
    } catch (error) {
      console.error('[ark-update] Update failed:', error);
      // The node card says "ARK update failed:" itself.
      const failure = stopped ? `${messageOf(error)} The servers were started again on the files they had.` : messageOf(error);
      this.sendStatus('error', failure);
      return { stopped, updated, failure };
    }
    return { stopped, updated };
  }

  /**
   * Copies the install's game files beside it and lets SteamCMD update the copy, while the servers
   * keep running. Ready with what the update changed; no-room when the disk cannot hold the copy,
   * so the update runs in place instead; otherwise it ended here and nobody was stopped.
   */
  private async downloadBesideInstall(installDir: string, stagingDir: string, cancelled: AbortSignal): Promise<
    | { outcome: 'ready'; changes: GameFileChanges }
    | { outcome: 'no-room' | 'failed' | 'unchanged' | 'cancelled' }
  > {
    const room = roomForStaging(await listGameFiles(installDir), freeBytes(path.dirname(installDir)));
    if (!room.enough) {
      console.warn(
        `[ark-update] Not enough free disk space to download the update beside the install (needs ${gigabytes(room.needed)}, ` +
        `${gigabytes(room.free ?? 0)} free). Updating in place while the servers are stopped, as before.`
      );
      return { outcome: 'no-room' };
    }

    try {
      this.sendStatus('copying', 'Copying the install to download the update beside it. The servers keep running.');
      const skipped = await seedStaging(installDir, stagingDir, percent => this.noteCopyProgress(percent));
      if (skipped.length) console.warn(`[ark-update] ${skipped.length} file(s) could not be copied; SteamCMD fetches them`);
    } catch (error) {
      console.error('[ark-update] Could not copy the install:', error);
      this.sendStatus('error', `Could not copy the install to download the update: ${messageOf(error)}. No server was stopped.`);
      return { outcome: 'failed' };
    }
    if (cancelled.aborted) return { outcome: 'cancelled' };

    const before = await listGameFiles(stagingDir);
    try {
      this.sendStatus('downloading', 'Downloading the update. The servers keep running.');
      await this.runSteamCmd(stagingDir, 'download', cancelled);
    } catch (error) {
      if (cancelled.aborted) return { outcome: 'cancelled' };
      console.error('[ark-update] The download failed:', error);
      this.sendStatus('error', `SteamCMD could not download the update: ${messageOf(error)} No server was stopped.`);
      return { outcome: 'failed' };
    }

    const installed = (await getCurrentInstalledVersion()) ?? this.installedBuildId;
    const downloaded = await getCurrentInstalledVersion(stagingDir);
    if (!downloaded || downloaded === installed) {
      this.noteUnchanged(installed);
      return { outcome: 'unchanged' };
    }
    console.log(`[ark-update] Downloaded build ${downloaded} beside the install (${installed})`);
    return { outcome: 'ready', changes: changesBetween(before, await listGameFiles(stagingDir)) };
  }

  /** The download found no newer build; the servers were left running. */
  private noteUnchanged(installed: string | null): void {
    if (this.latestBuildId && installed && this.latestBuildId !== installed) {
      console.warn(`[ark-update] SteamCMD found nothing newer than ${installed}, though Steam lists ${this.latestBuildId}`);
      this.sendStatus('error', `SteamCMD found nothing newer than build ${installed}, though Steam lists ${this.latestBuildId}. No server was restarted.`);
      // SteamCMD validated a copy of the install and found nothing to change, so it is current.
      // Taking Steam's build id keeps the next poll from starting another update.
      this.installedBuildId = this.latestBuildId;
      return;
    }
    this.sendStatus('complete', `ARK is already up to date (build ${installed ?? 'unknown'}). No server was restarted.`);
  }

  /**
   * Moves the files the update changed into the install. When that fails part way the install is
   * repaired in place with SteamCMD before any server starts; that throws when it fails too.
   */
  private async putNewFilesInPlace(stagingDir: string, installDir: string, changes: GameFileChanges): Promise<void> {
    try {
      await putInPlace(stagingDir, installDir, changes);
      console.log(`[ark-update] Put ${changes.changed.length} changed file(s) in place and removed ${changes.removed.length}`);
    } catch (error) {
      console.error('[ark-update] Could not put the new files in place; repairing the install with SteamCMD:', error);
      this.sendStatus('updating', 'Repairing the ARK install with SteamCMD...');
      await this.runSteamCmd(installDir, 'repair');
    }
  }

  /**
   * Warns the running servers at each mark of the warning time, ending at 0, when they stop. Returns
   * at once when none is running, and early when the update is cancelled (app exit).
   */
  private async warnPlayers(cancelled: AbortSignal): Promise<void> {
    if ((await this.findRunningInstances()).length === 0) return;
    const marks = warningMarks(loadGlobalConfig().updateWarningMinutes || DEFAULT_WARNING_MINUTES);
    const stopAt = Date.now() + marks[0] * MINUTE_MS;
    for (const minutes of marks) {
      const markAt = stopAt - minutes * MINUTE_MS;
      if (markAt > Date.now()) await waitUntil(markAt, cancelled);
      if (cancelled.aborted) return;
      this.updateProgress = { phase: 'warning', message: `Warning players: update in ${minutes} min`, minutesLeft: minutes, at: Date.now() };
      await this.broadcastWarning(minutes);
    }
  }

  private async broadcastWarning(minutes: number): Promise<void> {
    const message = minutes > 0
      ? `Server will restart for an update in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}!`
      : 'Server restarting for an update now!';
    console.log(`[ark-update] Broadcast: ${message}`);
    for (const { id } of await this.findRunningInstances()) {
      if (serverProcessService.getNormalizedInstanceState(id) !== 'running') continue;
      const sent = await rconService.executeRconCommand(id, `Broadcast ${message}`).catch(() => null);
      if (!sent?.success) console.warn(`[ark-update] Could not warn the players on ${id}`);
    }
  }

  private sendStatus(status: ClusterUpdateStatus, message: string): void {
    this.updateProgress = { phase: status, message, at: Date.now() };
    this.messagingService.sendToAll('cluster-update-status', { status, message });
  }

  /** How far the copy or the download has got. */
  private noteProgress(phase: ClusterUpdateStatus, percent: number): void {
    if (this.updateProgress?.phase === phase) {
      this.updateProgress = { ...this.updateProgress, percent: Math.round(percent), at: Date.now() };
    }
  }

  /** The copy reports as SteamCMD does, so a page following the update sees both. */
  private noteCopyProgress(percent: number): void {
    this.noteProgress('copying', percent);
    this.messagingService.sendToAll('cluster-update-progress', { percent, step: 'copying', message: `Copying the install (${percent}%)` });
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

    // The install's files cannot be replaced while a server holds them open. A state still reading
    // 'stopping' with no process left is cleared the same way, so the UI does not stay stuck on it.
    let killed = false;
    for (const { id } of instances) {
      const state = serverProcessService.getNormalizedInstanceState(id);
      if (serverProcessService.getServerProcess(id) || state !== 'stopped') {
        console.warn(`[ark-update] ${id} is still '${state}' before the new files go in; force-killing it`);
        await serverProcessService.forceKillServerProcess(id);
        killed = true;
      }
    }
    if (killed) {
      // Lets the OS release the ports and file handles.
      await delay(2000);
    }
  }

  /**
   * Runs SteamCMD against `installDir`: the copy beside the install (download), or the install
   * itself (update in place, repair). Aborting `cancelled` stops it; so does the two-hour ceiling.
   */
  private async runSteamCmd(installDir: string, purpose: 'download' | 'update' | 'repair', cancelled?: AbortSignal): Promise<void> {
    const phase: ClusterUpdateStatus = purpose === 'download' ? 'downloading' : 'updating';
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), STEAMCMD_UPDATE_TIMEOUT_MS);
    const cancel = () => deadline.abort();
    cancelled?.addEventListener('abort', cancel);
    try {
      // Awaited so the build is read only once SteamCMD has finished.
      await new Promise<void>((resolve, reject) => {
        installArkServer(
          error => (error ? reject(error) : resolve()),
          progress => {
            if (typeof progress.percent === 'number') this.noteProgress(phase, progress.percent);
            this.messagingService.sendToAll('cluster-update-progress', progress);
          },
          deadline.signal,
          installDir
        );
      });
    } catch (error) {
      if (deadline.signal.aborted && !cancelled?.aborted) {
        throw new Error(`SteamCMD did not finish the ${purpose} within ${STEAMCMD_UPDATE_TIMEOUT_MS / 60000} minutes.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      cancelled?.removeEventListener('abort', cancel);
    }
  }

  private async readInstalledBuild(): Promise<void> {
    const prior = this.installedBuildId;
    this.installedBuildId = (await getCurrentInstalledVersion()) ?? prior;
    if (prior && this.installedBuildId === prior) {
      console.warn(`[ark-update] Build unchanged after the update (still ${prior})`);
      // SteamCMD validated the install and found nothing to change, so it is current. Taking
      // Steam's build id keeps the next poll from starting another update.
      if (this.latestBuildId) this.installedBuildId = this.latestBuildId;
      return;
    }
    console.log(`[ark-update] Updated ${prior} -> ${this.installedBuildId}`);
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

let boundArkUpdate: ArkUpdateService | null = null;

export function bindArkUpdateService(service: ArkUpdateService): void {
  boundArkUpdate = service;
}

/** Starts the local SteamCMD update and returns. The node stops its own servers, updates, then starts them. */
/**
 * Settle an ARK update on this machine, asked for from Settings → Mesh: players are warned first
 * when servers are running (see ArkUpdateService.requestUpdate).
 */
export async function beginClusterUpdate(): Promise<{ success: boolean; error?: string; detail?: { warningMinutes: number } }> {
  if (!boundArkUpdate) return { success: false, error: 'Update service not initialized' };
  if (!isArkServerInstalled()) return { success: false, error: 'ARK is not installed on this machine.' };
  if (isInstallLocked()) return { success: false, error: 'An install or update is already running on this machine.' };
  const result = await boundArkUpdate.requestUpdate();
  return result.success ? { success: true, detail: { warningMinutes: result.warningMinutes ?? 0 } } : { success: false, error: result.error };
}

/** How the ARK update on this machine is going, for its heartbeat. */
export function arkUpdateProgress(): ArkUpdateProgress | null {
  return boundArkUpdate?.progress() ?? null;
}

/** ARK on this machine against Steam's latest build, for its heartbeat; null before the service starts. */
export function arkBuildStatus(): ReturnType<ArkUpdateService['getStatus']> | null {
  return boundArkUpdate?.getStatus() ?? null;
}
