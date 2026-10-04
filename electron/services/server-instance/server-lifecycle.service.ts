import * as fs from 'fs';
import { parsePort, validateInstanceId } from '../../utils/validation.utils';
import { getMultiHomeAddress } from '../../utils/ark/ark-args.utils';
import { getArkExecutablePath, validateInstanceRuntimeTree } from '../../utils/ark/ark-server/ark-server-paths.utils';
import { waitForProcessSweeps } from '../../utils/ark/ark-server/ark-server-cleanup.utils';
import { SERVER_FILES_UPDATING, areServerFilesUpdating } from '../../utils/ark/ark-server/ark-server-state.utils';
import { isTcpPortInUse, isUdpPortInUse } from '../../utils/network.utils';
import { loadGlobalConfig } from '../../utils/global-config.utils';
import type { InstanceConfig, ServerInstanceResult } from '../../types/server-instance.types';
import { getStandardEventCallbacks } from './instance-events';
import { serverManagementService } from './server-management.service';
import { serverProcessService } from './server-process.service';

// ARK's own ports when the config leaves one out (or holds something that is not a port).
const DEFAULT_GAME_PORT = 7777;
const DEFAULT_QUERY_PORT = 27015;
const DEFAULT_RCON_PORT = 27020;
const DEFAULT_START_DELAY_SECONDS = 60;

const ALREADY_UP = 'Instance is already running or starting';

export class ServerLifecycleService {
  private readonly startsInProgress = new Set<string>();

  async startServerInstance(
    instanceId: string,
    instance: InstanceConfig,
    onLog?: (line: string) => void,
    onState?: (state: string) => void
  ): Promise<ServerInstanceResult> {
    // Claimed before the first await: the state only turns 'starting' once the process spawns,
    // after the port checks and file preparation, so a second request could otherwise get through.
    if (this.startsInProgress.has(instanceId)) {
      return { success: false, error: ALREADY_UP, instanceId };
    }
    this.startsInProgress.add(instanceId);
    try {
      return await this.start(instanceId, instance, onLog, onState);
    } finally {
      this.startsInProgress.delete(instanceId);
    }
  }

  /** True from the start request until it has spawned the process or been refused. */
  isStartInProgress(instanceId: string): boolean {
    return this.startsInProgress.has(instanceId);
  }

  private async start(
    instanceId: string,
    instance: InstanceConfig,
    onLog?: (line: string) => void,
    onState?: (state: string) => void
  ): Promise<ServerInstanceResult> {
    try {
      const prerequisites = await this.validateStartPrerequisites(instanceId, instance);
      if (!prerequisites.success) {
        return prerequisites;
      }

      await serverManagementService.prepareInstanceConfiguration(instanceId, instance);

      // Checked again after the last await: an install or update can begin during the port checks,
      // sweeps or preparation. Also ahead of the tree check, which would report files mid-replace.
      if (areServerFilesUpdating()) {
        return { success: false, error: SERVER_FILES_UPDATING, instanceId };
      }

      // Preparation logs its own failures and carries on, so confirm the tree ARK launches from
      // is usable. Otherwise a missing Content/EOS/Engine folder only showed as ARK exiting before
      // it wrote a log: "Could not detect log file".
      const treeCheck = this.validateRuntimeTree(instanceId);
      if (!treeCheck.success) {
        return treeCheck;
      }

      const processResult = await serverProcessService.startServerProcess(instanceId, instance);
      if (!processResult.success) {
        return processResult;
      }

      serverProcessService.setupProcessMonitoring(instanceId, onLog, onState);
      return { success: true, instanceId };
    } catch (error) {
      console.error(`[server-lifecycle] Failed to start ${instanceId}:`, error);
      serverProcessService.setInstanceState(instanceId, 'error');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start server instance',
        instanceId
      };
    }
  }

  private validateRuntimeTree(instanceId: string): ServerInstanceResult {
    let result;
    try {
      result = validateInstanceRuntimeTree(instanceId);
    } catch (error) {
      // A failing check must not block a start.
      console.warn(`[server-lifecycle] Runtime tree check failed for ${instanceId}:`, error);
      return { success: true, instanceId };
    }

    if (result.valid) {
      return { success: true, instanceId };
    }

    const missing = result.missing.join(', ');
    const subject = result.sharedInstallBroken ? 'The ARK installation is' : "This server's game files are";
    const error = `${subject} incomplete - missing or empty: ${missing}. ` +
      'Reinstall/verify the ARK server from the Install tab, then start the server again.';
    console.error(`[server-lifecycle] Refusing to start ${instanceId}: ${error}`);
    return { success: false, error, instanceId };
  }

  private async validateStartPrerequisites(instanceId: string, instance: InstanceConfig): Promise<ServerInstanceResult> {
    if (!validateInstanceId(instanceId)) {
      return { success: false, error: 'Invalid instance ID', instanceId };
    }

    if (!fs.existsSync(getArkExecutablePath())) {
      return { success: false, error: 'ARK server is not installed', instanceId };
    }

    // SteamCMD is replacing the files a new server would load.
    if (areServerFilesUpdating()) {
      return { success: false, error: SERVER_FILES_UPDATING, instanceId };
    }

    const state = serverProcessService.getNormalizedInstanceState(instanceId);
    if (state === 'starting' || state === 'running') {
      return { success: false, error: ALREADY_UP, instanceId };
    }
    if (state === 'stopping' && serverProcessService.hasActiveProcess(instanceId)) {
      return { success: false, error: 'Instance is still stopping', instanceId };
    }

    // A leftover sweep matches by command line: one still running after the spawn would kill the
    // new process. It also frees the ports being checked.
    await waitForProcessSweeps(instanceId);
    return this.validateInstancePorts(instance, instanceId);
  }

  /** Bind tests on the address ARK will bind: UDP for the game and query ports, TCP for RCON. */
  private async validateInstancePorts(instance: InstanceConfig, instanceId: string): Promise<ServerInstanceResult> {
    const address = getMultiHomeAddress(instance) ?? '0.0.0.0';
    const gamePort = parsePort(instance.gamePort) ?? DEFAULT_GAME_PORT;
    const rconPort = parsePort(instance.rconPort) ?? DEFAULT_RCON_PORT;
    const queryPort = parsePort(instance.queryPort) ?? DEFAULT_QUERY_PORT;

    if (await isUdpPortInUse(gamePort, address)) {
      return { success: false, error: `Game port ${gamePort} is already in use`, instanceId };
    }
    if (await isTcpPortInUse(rconPort, address)) {
      return { success: false, error: `RCON port ${rconPort} is already in use`, instanceId };
    }
    if (await isUdpPortInUse(queryPort, address)) {
      return { success: false, error: `Query port ${queryPort} (Steam discovery) is already in use`, instanceId };
    }

    return { success: true, instanceId };
  }

  /** Graceful: SaveWorld, DoExit, then a kill if needed. Can take about 3 minutes. */
  async stopServerInstance(instanceId: string): Promise<ServerInstanceResult> {
    return serverProcessService.stopServerProcess(instanceId);
  }

  /** Starts every server that is not up, one at a time, `delayMs` apart (the configured delay by default). */
  async startAllInstances(delayMs?: number): Promise<{ started: string[]; failed: string[] }> {
    const staggerMs = delayMs ?? (loadGlobalConfig().serverStartDelaySeconds ?? DEFAULT_START_DELAY_SECONDS) * 1000;
    const { instances } = await serverManagementService.getAllInstances();
    const started: string[] = [];
    const failed: string[] = [];

    for (const instance of instances as InstanceConfig[]) {
      const state = serverProcessService.getNormalizedInstanceState(instance.id);
      if (state === 'running' || state === 'starting') continue;

      console.log(`[server-lifecycle] Starting ${instance.id} (Start All)`);
      const callbacks = getStandardEventCallbacks(instance.id);
      const result = await this.startServerInstance(instance.id, instance, callbacks.onLog, callbacks.onState);
      if (!result.success) {
        console.error(`[server-lifecycle] Start All could not start ${instance.id}: ${result.error}`);
        failed.push(instance.id);
        // The request marked it 'queued'; a start refused before spawning leaves that behind.
        if (serverProcessService.getNormalizedInstanceState(instance.id) === 'queued') {
          serverProcessService.setInstanceState(instance.id, 'stopped');
          callbacks.onState('stopped');
        }
        continue;
      }
      started.push(instance.id);
      await new Promise(resolve => setTimeout(resolve, staggerMs));
    }
    return { started, failed };
  }

  async stopAllInstances(): Promise<{ stopped: string[]; failed: string[] }> {
    const { instances } = await serverManagementService.getAllInstances();
    const stopped: string[] = [];
    const failed: string[] = [];

    await Promise.all((instances as InstanceConfig[]).map(async instance => {
      const state = serverProcessService.getNormalizedInstanceState(instance.id);
      if (state !== 'running' && state !== 'starting') return;
      try {
        console.log(`[server-lifecycle] Stopping ${instance.id} (Stop All)`);
        await this.stopServerInstance(instance.id);
        stopped.push(instance.id);
      } catch (error) {
        console.error(`[server-lifecycle] Failed to stop ${instance.id}:`, error);
        failed.push(instance.id);
      }
    }));
    return { stopped, failed };
  }
}

export const serverLifecycleService = new ServerLifecycleService();
