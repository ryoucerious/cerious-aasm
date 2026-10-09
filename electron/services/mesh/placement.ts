import type { NodeCapabilities } from '../../types/mesh.types';

export interface PlacementInput {
  nodeId: string;
  freeMemoryBytes: number;
  cpuPercent: number;
  freeDiskBytes: number;
  capabilities: Pick<NodeCapabilities, 'installPresent' | 'proton' | 'docker'>;
  storageReachable: boolean;
  weight: number;
  asaCount: number;
  maintenance: boolean;
}

/**
 * Higher is a better place for a new server. Maintenance and a missing game install are
 * ineligible. This score is only used when an operator asks for Auto-select or runs Move.
 */
export function scoreNode(node: PlacementInput): number | null {
  if (node.maintenance) return null;
  if (node.capabilities.installPresent === false) return null;
  const memoryGiB = node.freeMemoryBytes / (1024 ** 3);
  const diskGiB = node.freeDiskBytes / (1024 ** 3);
  const idleCpu = Math.max(0, 100 - node.cpuPercent);
  const storage = node.storageReachable ? 20 : 0;
  const weight = node.weight > 0 ? node.weight : 1;
  return (memoryGiB * 10 + diskGiB * 2 + idleCpu + storage) * weight - node.asaCount * 15;
}

export function chooseNode(nodes: PlacementInput[]): string | null {
  let best: { id: string; score: number } | null = null;
  for (const node of nodes) {
    const score = scoreNode(node);
    if (score === null) continue;
    if (!best || score > best.score) best = { id: node.nodeId, score };
  }
  return best?.id ?? null;
}

/** The steps of a move, all run on the source node. */
export interface MoveHooks {
  isRunning(serverId: string): boolean;
  saveWorld(serverId: string): Promise<void>;
  stop(serverId: string): Promise<void>;
  checkpoint(serverId: string): Promise<{ checksum: string }>;
  /** Sends the checkpoint; resolves with the checksum the destination computed. */
  transfer(serverId: string, checksum: string): Promise<string>;
  /** One placement write, only if the server is still placed on the source. Throws otherwise. */
  commitPlacement(serverId: string, destinationNodeId: string, keepRunning: boolean): Promise<void>;
  /** Takes the source's copy out of its server list once the destination owns the server. */
  release(serverId: string): Promise<void>;
  restart(serverId: string): Promise<void>;
}

/**
 * Runs on the source node: save and stop, checkpoint, send, compare checksums, then one
 * placement write. The destination's reconciler starts the server once it sees that write, so
 * nothing here starts it there. Any failure before the write leaves the placement alone and
 * starts the server here again if it was running; after the write there is no rollback.
 * The checkpoint is the instance config and saves. It does not include the shared SteamCMD tree
 * or a Proton prefix; the destination recreates the prefix from the instance id.
 */
export async function moveServer(
  serverId: string,
  sourceNodeId: string,
  destinationNodeId: string,
  hooks: MoveHooks
): Promise<{ success: boolean; error?: string; warning?: string }> {
  if (sourceNodeId === destinationNodeId) {
    return { success: false, error: 'That server is already on this node.' };
  }
  const running = hooks.isRunning(serverId);
  try {
    if (running) {
      await hooks.saveWorld(serverId);
      await hooks.stop(serverId);
    }
    const checkpoint = await hooks.checkpoint(serverId);
    const received = await hooks.transfer(serverId, checkpoint.checksum);
    if (received !== checkpoint.checksum) throw new Error('Destination checksum did not match the checkpoint.');
    await hooks.commitPlacement(serverId, destinationNodeId, running);
  } catch (error) {
    if (running) {
      try { await hooks.restart(serverId); } catch { /* reported by the start itself */ }
    }
    return { success: false, error: error instanceof Error ? error.message : 'Move failed' };
  }
  try {
    await hooks.release(serverId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    return { success: true, warning: `The server moved, but its old files here could not be set aside: ${reason}` };
  }
  return { success: true };
}
