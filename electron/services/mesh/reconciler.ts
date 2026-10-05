import type { DesiredState } from '../../types/mesh.types';

export interface DesiredServer {
  serverId: string;
  nodeId: string;
  desiredState: DesiredState;
  configRevision: number;
  configJson?: string;
  /** ARK `-ClusterId` string from the logical mesh cluster. Absent when this server is not a member. */
  arkClusterId?: string | null;
  clusterDirOverride?: string | null;
}

/**
 * What the hosting node can do to a local ARK process. The reconciler is the only caller
 * that turns desired state into a start or stop.
 */
export interface RuntimePort {
  state(id: string): string;
  start(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  appliedRevision(id: string): number;
  applyConfig(id: string, revision: number, configJson: string): Promise<void>;
  /** Writes the ARK cluster flags. Must not start or stop the process. */
  applyCluster?(id: string, arkClusterId: string, clusterDirOverride: string): Promise<void>;
}

const STOPPED = new Set(['stopped', 'offline', 'unknown', '']);
const UP = new Set(['running', 'starting', 'queued']);

/**
 * Converges this node's processes to desired state. A leadership change is not an input:
 * the same desired rows produce no start and no stop.
 */
export async function reconcile(localNodeId: string, desired: DesiredServer[], runtime: RuntimePort): Promise<void> {
  for (const server of desired) {
    if (server.nodeId !== localNodeId) continue;
    if (server.configJson && server.configRevision > runtime.appliedRevision(server.serverId)) {
      await runtime.applyConfig(server.serverId, server.configRevision, server.configJson);
    }
    if (server.arkClusterId && runtime.applyCluster) {
      await runtime.applyCluster(server.serverId, server.arkClusterId, server.clusterDirOverride || '');
    }
    const state = runtime.state(server.serverId);
    if (server.desiredState === 'running' && STOPPED.has(state)) {
      await runtime.start(server.serverId);
    } else if (server.desiredState === 'stopped' && UP.has(state)) {
      await runtime.stop(server.serverId);
    }
  }
}
