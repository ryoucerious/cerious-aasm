import * as fs from 'fs';
import * as path from 'path';
import * as fsExtra from 'fs-extra';
import { validateInstanceId, validateServerName, validatePort } from '../../utils/validation.utils';
import * as instanceUtils from '../../utils/ark/instance.utils';
import { generateRandomPassword } from '../../utils/crypto.utils';
import { getProcessMemoryUsage } from '../../utils/platform.utils';
import { getArkServerDir, getInstanceRuntimeRoot } from '../../utils/ark/ark-server/ark-server-paths.utils';
import {
  isInstanceOwnedWin64File,
  linkInstanceSaveDir,
  linkSharedShooterGameSubdirs,
  linkSharedWin64Subdirs
} from '../../utils/ark/ark-server/ark-server-isolation.utils';
import type {
  DeleteInstanceResult,
  ExclusiveJoinPlayer,
  ImportBackupResult,
  InstanceConfig,
  InstancesResult,
  SaveInstanceResult,
  SingleInstanceResult
} from '../../types/server-instance.types';
import { arkConfigService } from '../ark-config.service';
import { backupService } from '../backup/backup.service';
import { carryClusterData } from '../clusters/cluster-import';
import { validateDiscordConfig } from '../discord.service';
import { schedulerService } from '../scheduler.service';
import { whitelistService } from '../whitelist.service';
import { serverMonitoringService } from './server-monitoring.service';
import { changedPortsOutsideRanges } from '../../utils/ark/port-sets';
import { getServerPortRanges } from '../../utils/server-ports.utils';
import { serverProcessService } from './server-process.service';

const PORT_NAMES = { Game: 'game port', Peer: 'peer port', Query: 'query port', RCON: 'RCON port' } as const;
const RANGE_NAMES = { Game: 'game', Peer: 'game', Query: 'query', RCON: 'RCON' } as const;

/** Why an edit cannot move a port outside this machine's ranges, which its firewall opens. */
function refusePortsOutsideRanges(stored: Partial<InstanceConfig>, next: Partial<InstanceConfig>): string | null {
  const [outside] = changedPortsOutsideRanges(stored, next, getServerPortRanges().ranges);
  if (!outside) return null;
  const { start, end } = outside.range;
  const range = start === end ? `${start}` : `${start}–${end}`;
  const port = outside.label === 'Peer' ? `${outside.port}, always the game port + 1,` : `${outside.port}`;
  return `The ${PORT_NAMES[outside.label]} ${port} is outside this machine's ${RANGE_NAMES[outside.label]} ports (${range}). Pick one inside them, or widen them in Settings → Server ports.`;
}

export class ServerManagementService {
  /** Every instance's config.json merged with its live state, memory, CPU, uptime and players. */
  async getAllInstances(): Promise<InstancesResult> {
    try {
      const instances: InstanceConfig[] = await instanceUtils.getAllInstances();

      // Memory is read off-thread, so the instances are enhanced in parallel. Readings are
      // briefly cached in platform.utils, so listing several running instances back to back does
      // not spawn a lookup per instance per call.
      const enhancedInstances = await Promise.all(instances.map(async instance => {
        const state = serverProcessService.getNormalizedInstanceState(instance.id);
        const child = serverProcessService.getServerProcess(instance.id);
        const running = state === 'running';

        const memory = running && child?.pid ? (await getProcessMemoryUsage(child.pid)) ?? undefined : undefined;
        // Uptime and CPU only mean something while the process is alive; null lets the UI show
        // a dash rather than a stale value.
        const startedAt = running && child ? serverProcessService.getProcessStartTime(instance.id) : null;
        const cpu = running ? serverMonitoringService.getLatestCpuPercent(instance.id) : null;

        return {
          ...instance,
          state,
          memory,
          cpu,
          startedAt,
          players: serverMonitoringService.getLatestPlayerCount(instance.id)
        };
      }));

      return { instances: enhancedInstances };
    } catch (error) {
      console.error('[server-management] Failed to get all instances:', error);
      return { instances: [] };
    }
  }

  async getInstance(instanceId: string): Promise<SingleInstanceResult> {
    try {
      if (!instanceId) {
        return { instance: null };
      }
      return { instance: instanceUtils.getInstance(instanceId) };
    } catch (error) {
      console.error('[server-management] Failed to get instance:', error);
      return { instance: null };
    }
  }

  async saveInstance(instance: Partial<InstanceConfig> | null | undefined): Promise<SaveInstanceResult> {
    try {
      if (!instance || typeof instance !== 'object') {
        return { success: false, error: 'Invalid instance object' };
      }
      if (instance.id !== undefined && !validateInstanceId(instance.id)) {
        return { success: false, error: 'Invalid instance ID' };
      }
      if (instance.name && !validateServerName(instance.name)) {
        return { success: false, error: 'Invalid server name' };
      }
      const { port } = instance;
      if (port !== undefined && !((typeof port === 'number' || typeof port === 'string') && validatePort(port))) {
        return { success: false, error: 'Invalid port number' };
      }
      const stored = instance.id ? instanceUtils.getInstance(instance.id) : null;
      const portRefusal = stored ? refusePortsOutsideRanges(stored, { ...stored, ...instance }) : null;
      if (portRefusal) {
        return { success: false, error: portRefusal };
      }
      const invalidDiscordConfig = validateDiscordConfig(instance.discordConfig, stored?.discordConfig?.webhookUrl);
      if (invalidDiscordConfig) {
        return { success: false, error: invalidDiscordConfig };
      }

      const saved = await instanceUtils.saveInstance(instance);
      if (saved.error !== undefined) {
        return { success: false, error: saved.error };
      }

      // Keep scheduled announcements in sync with the saved broadcastConfig.
      try {
        await schedulerService.initSchedule(saved.id);
      } catch (error) {
        console.warn(`[server-management] Failed to sync the broadcast schedule for ${saved.id}:`, error);
      }

      if (instance.useExclusiveList) {
        this.writeWhitelist(saved.id, instance);
      }

      return { success: true, instance: saved };
    } catch (error) {
      console.error('[server-management] Failed to save instance:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to save instance' };
    }
  }

  private writeWhitelist(instanceId: string, instance: Partial<InstanceConfig>): void {
    try {
      // Older configs list bare ids in exclusiveJoinPlayerIds.
      const playerIds = Array.isArray(instance.exclusiveJoinPlayers)
        ? instance.exclusiveJoinPlayers.map((player: ExclusiveJoinPlayer) => player.playerId)
        : Array.isArray(instance.exclusiveJoinPlayerIds) ? instance.exclusiveJoinPlayerIds : [];
      const ids = playerIds.filter(id => typeof id === 'string' && id.trim());

      const result = whitelistService.writeWhitelistFile(instanceId, ids);
      if (!result.success) {
        console.warn(`[server-management] Failed to write the whitelist for ${instanceId}: ${result.error}`);
      }
    } catch (error) {
      console.error(`[server-management] Failed to write the whitelist for ${instanceId}:`, error);
    }
  }

  async deleteInstance(instanceId: string): Promise<DeleteInstanceResult> {
    try {
      if (!validateInstanceId(instanceId) || !instanceUtils.getInstance(instanceId)) {
        return { success: false, id: instanceId };
      }
    } catch (error) {
      console.error('[server-management] Failed to delete instance:', error);
      return { success: false, id: instanceId };
    }

    let deleted = false;
    try {
      // Before the stop, which can take minutes. (Crash detection and scheduled restarts are stopped
      // by ServerInstanceService.deleteInstance.)
      await backupService.stopBackupScheduler(instanceId);
      schedulerService.stopScheduler(instanceId);

      const state = serverProcessService.getNormalizedInstanceState(instanceId);
      if (state === 'running' || state === 'starting') {
        await serverProcessService.stopServerProcess(instanceId);
      }

      serverMonitoringService.stopPlayerPolling(instanceId);
      serverMonitoringService.stopMemoryPolling(instanceId);
      serverMonitoringService.stopCpuPolling(instanceId);

      // A backup still reading the directory, or a restore still rewriting it, finishes first.
      await backupService.waitForBackupOperations(instanceId);
      deleted = instanceUtils.deleteInstance(instanceId);
    } catch (error) {
      console.error('[server-management] Failed to delete instance:', error);
    }
    if (!deleted) {
      this.rearmSchedules(instanceId);
    }
    return { success: deleted, id: instanceId };
  }

  // For a delete that failed with the instance still there: it keeps the schedules stopped above.
  private rearmSchedules(instanceId: string): void {
    try {
      if (!instanceUtils.getInstance(instanceId)) return;
    } catch {
      return;
    }
    void backupService.startBackupScheduler(instanceId);
    schedulerService.initSchedule(instanceId).catch(error => {
      console.warn(`[server-management] Failed to restore the broadcast schedule for ${instanceId}:`, error);
    });
  }

  async importFromBackup(backupPath: string, instanceName: string): Promise<ImportBackupResult> {
    try {
      if (!backupPath || typeof backupPath !== 'string') {
        return { success: false, error: 'Invalid backup path' };
      }
      if (!instanceName || typeof instanceName !== 'string') {
        return { success: false, error: 'Invalid instance name' };
      }

      const instance = await backupService.importBackupAsNewServer(instanceName, backupPath);
      return { success: true, instance };
    } catch (error) {
      console.error('[server-management] Failed to import server from backup:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to import server from backup' };
    }
  }

  /**
   * Readies an instance to launch: its file tree, an RCON password, the INI files and the
   * whitelist. Throws only when the save folder cannot be linked; other failures are logged, and
   * the runtime tree is validated before the spawn.
   */
  async prepareInstanceConfiguration(instanceId: string, instance: InstanceConfig): Promise<void> {
    const instanceDir = instanceUtils.getInstanceDir(instanceId);

    try {
      await this.prepareIsolatedTree(instanceId, instanceDir);
    } catch (error) {
      // It may already be set up; the runtime tree check catches what is really missing.
      console.error(`[server-management] Failed to set up the isolated file structure for ${instanceId}:`, error);
    }

    // Keeps an isolated instance writing its worlds where backups and restore expect them.
    const runtimeRoot = getInstanceRuntimeRoot(instanceId);
    if (await linkInstanceSaveDir(instanceDir, runtimeRoot)) {
      console.log(`[server-management] Linked the runtime save directory for ${instanceId}`);
    }

    // Before ARK reads the cluster: what its players uploaded under an ID of its own goes with it.
    carryClusterData(instance, { instanceDir, runtimeRoot });

    if (!instance.rconPassword) {
      instance.rconPassword = generateRandomPassword(16);
      await this.saveGeneratedRconPassword(instanceId, instance.rconPassword);
    }

    try {
      arkConfigService.writeArkConfigFiles(instanceDir, instance, instanceId);
    } catch (error) {
      console.error(`[server-management] Failed to write the ARK config files for ${instanceId}:`, error);
    }

    if (instance.useExclusiveList) {
      try {
        const result = whitelistService.copyWhitelistToMainDir(instanceId);
        if (!result.success) {
          console.warn(`[server-management] Failed to copy the whitelist for ${instanceId}: ${result.error}`);
        }
      } catch (error) {
        console.error(`[server-management] Failed to copy the whitelist for ${instanceId}:`, error);
      }
    }
  }

  // Saved into the config.json on disk: the instance being started may be the enriched object
  // from getAllInstances, with state, memory and players merged in.
  private async saveGeneratedRconPassword(instanceId: string, rconPassword: string): Promise<void> {
    try {
      const stored = instanceUtils.getInstance(instanceId);
      if (!stored) return;
      const saved = await instanceUtils.saveInstance({ ...stored, rconPassword });
      if (saved.error !== undefined) {
        console.error(`[server-management] Failed to save the generated RCON password for ${instanceId}: ${saved.error}`);
      }
    } catch (error) {
      console.error(`[server-management] Failed to save the generated RCON password for ${instanceId}:`, error);
    }
  }

  /**
   * Gives the instance its own copy of the Win64 binaries, so ArkApi plugins stay per server, and
   * junctions everything else (Content ~70 GB, Engine ~3 GB, the bundled plugins) onto the shared
   * install.
   */
  private async prepareIsolatedTree(instanceId: string, instanceDir: string): Promise<void> {
    const sourceDir = getArkServerDir();
    if (!fs.existsSync(sourceDir)) {
      console.warn(`[server-management] ${sourceDir} does not exist; skipping the file structure setup`);
      return;
    }

    const shooterGameDir = path.join(instanceDir, 'ShooterGame');
    await fsExtra.ensureDir(shooterGameDir);
    await relinkJunction(path.join(sourceDir, 'ShooterGame', 'Content'), path.join(shooterGameDir, 'Content'));
    await relinkJunction(path.join(sourceDir, 'Engine'), path.join(instanceDir, 'Engine'));

    const sourceBinaries = path.join(sourceDir, 'ShooterGame', 'Binaries', 'Win64');
    const destBinaries = path.join(shooterGameDir, 'Binaries', 'Win64');
    if (await fsExtra.pathExists(sourceBinaries)) {
      await fsExtra.ensureDir(destBinaries);
      // Files only: the ArkApi folder and other per-instance folders in dest must stay the
      // instance's own, so directories are never bulk-copied. The whitelist files are the
      // instance's own too, written after this step.
      for (const file of await fsExtra.readdir(sourceBinaries)) {
        if (isInstanceOwnedWin64File(file)) continue;
        const srcFile = path.join(sourceBinaries, file);
        const destFile = path.join(destBinaries, file);
        const stat = await fsExtra.stat(srcFile);
        if (stat.isFile() && !(await isCurrentCopy(destFile, stat))) {
          await fsExtra.copy(srcFile, destFile, { overwrite: true, preserveTimestamps: true });
        }
      }

      // Without RedpointEOS next to the exe the server aborts with "The EOS SDK could not be
      // found. Please reinstall the application."
      const linked = await linkSharedWin64Subdirs(sourceBinaries, destBinaries);
      if (linked.length) {
        console.log(`[server-management] Linked Win64 subfolders for ${instanceId}: ${linked.join(', ')}`);
      }
    }

    // ShooterGame/Plugins (DiscordPartnerSDK, AWSSDK, sentry). Without them the server aborts with
    // "Failed to load Discord Partner SDK third party library".
    const linkedGameDirs = await linkSharedShooterGameSubdirs(path.join(sourceDir, 'ShooterGame'), shooterGameDir);
    if (linkedGameDirs.length) {
      console.log(`[server-management] Linked ShooterGame subfolders for ${instanceId}: ${linkedGameDirs.join(', ')}`);
    }
  }
}

/** Junctions `dest` onto `source`, replacing any link already there; a real folder is left alone. */
async function relinkJunction(source: string, dest: string): Promise<void> {
  if (!(await fsExtra.pathExists(source))) return;
  if (await fsExtra.pathExists(dest)) {
    const stat = await fsExtra.lstat(dest);
    if (stat.isSymbolicLink()) await fsExtra.unlink(dest);
  }
  if (!(await fsExtra.pathExists(dest))) {
    await fsExtra.ensureSymlink(source, dest, 'junction');
  }
}

// Same size and at least as new: skips a full ~200 MB binary copy on every start when a custom
// directory sits on a slow disk (like rsync --update).
async function isCurrentCopy(destFile: string, source: fs.Stats): Promise<boolean> {
  if (!(await fsExtra.pathExists(destFile))) return false;
  const dest = await fsExtra.stat(destFile);
  return dest.size === source.size && dest.mtimeMs >= source.mtimeMs;
}

export const serverManagementService = new ServerManagementService();
