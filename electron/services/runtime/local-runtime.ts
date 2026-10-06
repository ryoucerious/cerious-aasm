import type { InstanceConfig, ServerInstanceResult, StartServerResult } from '../../types/server-instance.types';
import { getStandardEventCallbacks } from '../server-instance/instance-events';
import { serverInstanceService } from '../server-instance/server-instance.service';
import { serverLifecycleService } from '../server-instance/server-lifecycle.service';
import { serverManagementService } from '../server-instance/server-management.service';
import { serverMonitoringService } from '../server-instance/server-monitoring.service';
import { serverOperationsService } from '../server-instance/server-operations.service';
import { serverProcessService } from '../server-instance/server-process.service';
import { getNormalizedInstanceState } from '../../utils/ark/ark-server/ark-server-state.utils';
import * as instanceUtils from '../../utils/ark/instance.utils';
import { arkConfigService } from '../ark-config.service';
import { messagingService } from '../messaging.service';
import { rconService } from '../rcon.service';

/**
 * The local game plane. Handlers and the mesh reconciler call this instead of the
 * concrete services, so a remote command ends in the same start/stop path as a local click.
 * Nothing here talks to another machine.
 */
export class LocalRuntime {
  listInstances(): Promise<{ instances: InstanceConfig[] }> {
    return serverManagementService.getAllInstances();
  }

  getInstance(id: string): Promise<{ instance: InstanceConfig | null }> {
    return serverManagementService.getInstance(id);
  }

  saveInstance(instance: Partial<InstanceConfig>): Promise<{ success: boolean; instance?: InstanceConfig; error?: string }> {
    return serverManagementService.saveInstance(instance);
  }

  deleteInstance(id: string) {
    return serverInstanceService.deleteInstance(id);
  }

  /**
   * Without callbacks the server's log lines and state changes are broadcast as for a start from
   * the UI: a later stop reports through the callbacks a start registered, so a start that kept
   * them to itself leaves every client, and every other node, showing it as starting.
   */
  start(id: string, onLog?: (line: string) => void, onState?: (state: string) => void): Promise<StartServerResult> {
    const standard = !onLog || !onState ? getStandardEventCallbacks(id) : null;
    return serverInstanceService.startServerInstance(id, onLog || standard!.onLog, onState || standard!.onState);
  }

  stop(id: string) {
    return serverLifecycleService.stopServerInstance(id);
  }

  /** Start All for these servers on this machine, one after another with the configured delay. */
  startAll(ids: string[]): Promise<{ started: string[]; failed: string[] }> {
    return serverLifecycleService.startAllInstances(undefined, ids);
  }

  stopAll(ids: string[]): Promise<{ stopped: string[]; failed: string[] }> {
    return serverLifecycleService.stopAllInstances(ids);
  }

  connectRcon(id: string) {
    return serverOperationsService.connectRcon(id);
  }

  /** Tells every client whether RCON is up and, while it is, reports the player count. */
  announceRcon(id: string, connected: boolean): void {
    messagingService.sendToAll('rcon-status', { instanceId: id, connected });
    if (!connected) return;
    serverMonitoringService.startPlayerPolling(id, (instanceId, players) => {
      messagingService.sendToAll('server-instance-players', { instanceId, players });
    });
  }

  disconnectRcon(id: string) {
    return serverOperationsService.disconnectRcon(id);
  }

  announceRconDown(id: string): void {
    messagingService.sendToAll('rcon-status', { instanceId: id, connected: false });
    serverMonitoringService.stopPlayerPolling(id);
  }

  rconStatus(id: string) {
    return serverOperationsService.getRconStatus(id);
  }

  players(id: string) {
    return serverMonitoringService.getPlayerCount(id);
  }

  onlinePlayers(id: string) {
    return rconService.getOnlinePlayers(id);
  }

  readIni(id: string, filename: string): string {
    return arkConfigService.readIniFile(id, filename);
  }

  /**
   * Writes an INI file and merges it into config.json; every start rewrites the INI files from
   * config.json, which would undo the edit without the merge. Returns the saved config, or null
   * when the merge could not be made (the INI file is written either way).
   */
  async saveIni(id: string, filename: string, content: string): Promise<InstanceConfig | null> {
    arkConfigService.writeIniFile(id, filename, content);
    try {
      const existing = instanceUtils.getInstance(id);
      if (!existing) return null;
      const saved = await instanceUtils.saveInstance({ ...existing, ...arkConfigService.parseIniToConfig(filename, content) });
      if (saved.error) {
        console.warn(`[local-runtime] Could not merge ${filename} into the instance config: ${saved.error}`);
        return null;
      }
      return saved as InstanceConfig;
    } catch {
      // Not the error itself: a JSON syntax error quotes config.json, which holds the RCON password.
      console.warn(`[local-runtime] Could not merge ${filename} into the instance config`);
      return null;
    }
  }

  /** Sets a few fields of a server's config, keeping the rest as they are on disk. */
  async patchConfig(id: string, patch: Partial<InstanceConfig>): Promise<{ instance?: InstanceConfig; error?: string }> {
    const existing = instanceUtils.getInstance(id);
    if (!existing) return { error: 'That server was not found.' };
    const saved = await instanceUtils.saveInstance({ ...existing, ...patch });
    if (saved.error !== undefined) return { error: saved.error };
    return { instance: saved as InstanceConfig };
  }

  forceStop(id: string): Promise<ServerInstanceResult> {
    return serverInstanceService.forceStopInstance(id);
  }

  state(id: string): string {
    return getNormalizedInstanceState(id);
  }

  /** When the running process started; null when it is not running. */
  startedAt(id: string): number | null {
    return serverProcessService.getProcessStartTime(id);
  }

  logs(id: string, maxLines?: number) {
    return serverMonitoringService.getInstanceLogs(id, maxLines);
  }

  rcon(id: string, command: string) {
    return serverOperationsService.executeRconCommand(id, command);
  }

  /**
   * Writes the ARK cluster id and directory when the mesh cluster revision changes.
   * Skips the write when the instance already has those flags, so the reconciler does not loop.
   * Does not start or stop the process.
   */
  async applyCluster(id: string, arkClusterId: string, clusterDirOverride: string): Promise<void> {
    const existing = instanceUtils.getInstance(id);
    if (!existing) return;
    if (existing.clusterId === arkClusterId && (existing.clusterDirOverride || '') === clusterDirOverride) return;
    await this.applyConfig(id, Number(existing.configRevision) || 1, {
      clusterId: arkClusterId,
      clusterDirOverride
    });
  }

  /** Writes a desired config onto this node. Does not start or stop the process. */
  async applyConfig(id: string, revision: number, config: Partial<InstanceConfig>): Promise<void> {
    const existing = instanceUtils.getInstance(id);
    const next = { ...(existing || {}), ...config, id, configRevision: revision };
    const saved = await instanceUtils.saveInstance(next);
    if ('error' in saved && saved.error) {
      throw new Error(saved.error);
    }
  }

  appliedRevision(id: string): number {
    const existing = instanceUtils.getInstance(id);
    const revision = Number(existing?.configRevision);
    return Number.isFinite(revision) ? revision : 0;
  }

  setQueued(id: string): void {
    serverProcessService.setInstanceState(id, 'queued');
  }

  normalized(id: string): string {
    return serverProcessService.getNormalizedInstanceState(id);
  }
}

export const localRuntime = new LocalRuntime();
