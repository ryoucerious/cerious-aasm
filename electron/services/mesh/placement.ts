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

export interface MoveHooks {
  saveWorld(serverId: string): Promise<void>;
  stop(nodeId: string, serverId: string): Promise<void>;
  checkpoint(serverId: string): Promise<{ checksum: string }>;
  transfer(serverId: string, checksum: string): Promise<void>;
  verify(serverId: string, checksum: string): Promise<boolean>;
  commitPlacement(serverId: string, destinationNodeId: string): Promise<void>;
  rollbackPlacement(serverId: string, sourceNodeId: string): Promise<void>;
  start(nodeId: string, serverId: string): Promise<void>;
}

/**
 * Save, checkpoint, checksum, then one placement revision. The destination starts only after
 * that commit. A failed verify rolls the revision back and starts the source again.
 * The checkpoint is the instance config and saves. It does not include the shared SteamCMD tree
 * or a Proton prefix; the destination recreates the prefix from the instance id.
 */
export async function moveServer(
  serverId: string,
  sourceNodeId: string,
  destinationNodeId: string,
  hooks: MoveHooks
): Promise<{ success: boolean; error?: string }> {
  if (sourceNodeId === destinationNodeId) {
    return { success: false, error: 'That server is already on this node.' };
  }
  let committed = false;
  try {
    await hooks.saveWorld(serverId);
    await hooks.stop(sourceNodeId, serverId);
    const checkpoint = await hooks.checkpoint(serverId);
    await hooks.transfer(serverId, checkpoint.checksum);
    const verified = await hooks.verify(serverId, checkpoint.checksum);
    if (!verified) throw new Error('Destination checksum did not match the checkpoint.');
    await hooks.commitPlacement(serverId, destinationNodeId);
    committed = true;
    await hooks.start(destinationNodeId, serverId);
    return { success: true };
  } catch (error) {
    if (committed) {
      try { await hooks.rollbackPlacement(serverId, sourceNodeId); } catch { /* best effort */ }
    }
    try { await hooks.start(sourceNodeId, serverId); } catch { /* source may already be up */ }
    return { success: false, error: error instanceof Error ? error.message : 'Move failed' };
  }
}
