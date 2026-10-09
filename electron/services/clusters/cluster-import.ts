import * as fs from 'fs';
import * as path from 'path';
import { getDefaultInstallDir } from '../../utils/platform.utils';
import { writeJsonAtomic } from '../../utils/fs.utils';
import type { InstanceConfig } from '../../types/server-instance.types';
import { importClusterData } from '../mesh/cluster-sync';
import { clusterFolder, knownCluster } from './cluster-registry';

/** The folders a server's earlier transfer data was already brought from. */
const MARKER = 'cluster-import.json';

/**
 * A server that had its own cluster ID before it chose a cluster in Settings → Clusters: what its
 * players uploaded under that ID is copied into the cluster, so nobody's dinos or items are left
 * behind. Done once per source folder, before the server first starts in a cluster: a file the
 * cluster later drops is not brought back, and a server that moves on to another cluster does not
 * bring the same uploads into that one too, where they could be downloaded a second time. Never
 * throws; a failed copy is tried again at the next start.
 */
export function carryClusterData(
  instance: Pick<InstanceConfig, 'id' | 'clusterRef' | 'clusterId' | 'clusterDirOverride'>,
  where: { instanceDir: string; runtimeRoot: string }
): void {
  const cluster = knownCluster(instance.clusterRef);
  const oldClusterId = typeof instance.clusterId === 'string' ? instance.clusterId.trim() : '';
  if (!cluster || !oldClusterId) return;

  // Where ARK kept it: the folder the server named, or <runtime root>/ShooterGame/Saved.
  const oldBase = instance.clusterDirOverride
    ? path.resolve(getDefaultInstallDir(), instance.clusterDirOverride)
    : path.join(where.runtimeRoot, 'ShooterGame', 'Saved');
  // Named as the config names it, not by path: the folder moves with the server to another machine.
  const from = `${instance.clusterDirOverride || 'Saved'}|${oldClusterId}`;
  const marker = path.join(where.instanceDir, MARKER);

  try {
    const saved = fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, 'utf8')) as { carried?: unknown } : {};
    const carried = Array.isArray(saved.carried) ? saved.carried.filter((item): item is string => typeof item === 'string') : [];
    if (carried.includes(from)) return;
    const copied = importClusterData(oldBase, oldClusterId, clusterFolder(cluster.clusterId), cluster.arkClusterId);
    writeJsonAtomic(marker, { carried: [...carried, from] });
    if (copied > 0) {
      console.log(`[clusters] Brought ${copied} transfer file(s) of ${instance.id} into the cluster ${cluster.name}.`);
    }
  } catch (error) {
    console.warn(`[clusters] Could not bring the transfer data of ${instance.id} into the cluster ${cluster.name}:`, error);
  }
}
