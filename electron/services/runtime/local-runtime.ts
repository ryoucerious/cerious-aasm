import type { InstanceConfig, ServerInstanceResult, StartServerResult } from '../../types/server-instance.types';
import { serverInstanceService } from '../server-instance/server-instance.service';
import { serverLifecycleService } from '../server-instance/server-lifecycle.service';
import { serverManagementService } from '../server-instance/server-management.service';
import { serverMonitoringService } from '../server-instance/server-monitoring.service';
import { serverOperationsService } from '../server-instance/server-operations.service';
import { serverProcessService } from '../server-instance/server-process.service';
import { getNormalizedInstanceState } from '../../utils/ark/ark-server/ark-server-state.utils';
import * as instanceUtils from '../../utils/ark/instance.utils';

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

  start(id: string, onLog: (line: string) => void, onState: (state: string) => void): Promise<StartServerResult> {
    return serverInstanceService.startServerInstance(id, onLog, onState);
  }

  stop(id: string) {
    return serverLifecycleService.stopServerInstance(id);
  }

  forceStop(id: string): Promise<ServerInstanceResult> {
    return serverInstanceService.forceStopInstance(id);
  }

  state(id: string): string {
    return getNormalizedInstanceState(id);
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
