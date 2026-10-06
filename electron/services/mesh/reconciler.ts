import type { DesiredState } from '../../types/mesh.types';

export interface DesiredServer {
  serverId: string;
  nodeId: string;
  desiredState: DesiredState;
  configRevision: number;
  configJson?: string;
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
}

/** The desired state this node last acted on, per server placed here. Empty after a restart. */
export type ReconcileMemory = Map<string, DesiredState>;

const STOPPED = new Set(['stopped', 'offline', 'unknown', '']);
const UP = new Set(['running', 'starting', 'queued']);

/**
 * Acts on a change of desired state, once. The first time it sees a server placed here (after
 * a restart, or a move onto this node) it starts one that should be running; it never stops
 * one on first sight. Between changes it leaves the process alone, so a scheduled restart, an
 * update or a crash is left to the local policies. A leadership change is not an input: the
 * same desired rows produce no start and no stop.
 */
export async function reconcile(
  localNodeId: string,
  desired: DesiredServer[],
  runtime: RuntimePort,
  memory: ReconcileMemory = new Map()
): Promise<void> {
  const placedHere = new Set<string>();
  for (const server of desired) {
    if (server.nodeId !== localNodeId) continue;
    placedHere.add(server.serverId);
    try {
      if (server.configJson && server.configRevision > runtime.appliedRevision(server.serverId)) {
        await runtime.applyConfig(server.serverId, server.configRevision, server.configJson);
      }
    } catch (error) {
      console.error(`[mesh] Could not apply the configuration for ${server.serverId}:`, error);
    }
    const previous = memory.get(server.serverId);
    if (previous === server.desiredState) continue;
    memory.set(server.serverId, server.desiredState);
    const state = runtime.state(server.serverId);
    try {
      if (server.desiredState === 'running' && STOPPED.has(state)) {
        await runtime.start(server.serverId);
      } else if (server.desiredState === 'stopped' && previous !== undefined && UP.has(state)) {
        await runtime.stop(server.serverId);
      }
    } catch (error) {
      console.error(`[mesh] Could not move ${server.serverId} to ${server.desiredState}:`, error);
    }
  }
  for (const serverId of [...memory.keys()]) {
    if (!placedHere.has(serverId)) memory.delete(serverId);
  }
}
