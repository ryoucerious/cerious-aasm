import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { getDefaultInstallDir } from '../../utils/platform.utils';
import { getInstancesBaseDir } from '../../utils/ark/instance.utils';
import { readJsonOrQuarantine, writeJsonAtomic } from '../../utils/fs.utils';

/**
 * The ARK clusters this machine knows, by the id a server stores to say which one it is in.
 *
 * On a machine on its own this is where clusters are defined. In a mesh the mesh defines them,
 * and this is this machine's copy, refreshed at every check: a server starts with its cluster
 * while the mesh cannot be reached, and leaving the mesh keeps the clusters its servers use.
 */
export interface KnownCluster {
  clusterId: string;
  name: string;
  /** What ARK is given as -ClusterId. Fixed once created: it names a folder on every machine. */
  arkClusterId: string;
}

/** What was last read or written, and from which file. */
let known: { file: string; clusters: KnownCluster[] } | null = null;

function registryFile(): string {
  return path.join(getDefaultInstallDir(), 'data', 'clusters.json');
}

function load(): KnownCluster[] {
  try {
    const saved = readJsonOrQuarantine<{ clusters?: unknown }>(registryFile());
    const list = Array.isArray(saved?.clusters) ? saved!.clusters : [];
    return list
      .filter((entry): entry is KnownCluster => !!entry && typeof entry === 'object'
        && typeof (entry as KnownCluster).clusterId === 'string'
        && typeof (entry as KnownCluster).name === 'string'
        && typeof (entry as KnownCluster).arkClusterId === 'string')
      .map(entry => ({ clusterId: entry.clusterId, name: entry.name, arkClusterId: entry.arkClusterId }));
  } catch (error) {
    console.error('[clusters] Could not read the clusters this machine knows:', error);
    return [];
  }
}

export function knownClusters(): KnownCluster[] {
  const file = registryFile();
  if (!known || known.file !== file) known = { file, clusters: load() };
  return known.clusters.map(cluster => ({ ...cluster }));
}

export function knownCluster(clusterId: string | null | undefined): KnownCluster | null {
  if (!clusterId) return null;
  return knownClusters().find(cluster => cluster.clusterId === clusterId) ?? null;
}

/** Replaces the clusters this machine knows. Written only when they changed; true when they did. */
export function rememberClusters(clusters: KnownCluster[]): boolean {
  const next = clusters.map(cluster => ({ clusterId: cluster.clusterId, name: cluster.name, arkClusterId: cluster.arkClusterId }));
  if (JSON.stringify(next) === JSON.stringify(knownClusters())) return false;
  const file = registryFile();
  known = { file, clusters: next };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, { clusters: next });
  return true;
}

/**
 * Where this machine keeps a cluster's transfer files: ARK's cluster directory for every server
 * of that cluster here. Beside this machine's server data, wherever it keeps that.
 */
export function clusterFolder(clusterId: string): string {
  return path.join(path.dirname(getInstancesBaseDir()), 'AASMClusters', clusterId);
}

export function clusterNameOf(name: string): string {
  const clean = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('Enter a name for the cluster.');
  if (clean.length > 64) throw new Error('A cluster name can be at most 64 characters.');
  return clean;
}

/** ARK takes it on its command line, and it names a folder on every machine. */
export function arkClusterIdOf(id: string): string {
  const clean = String(id ?? '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(clean)) {
    throw new Error('A cluster ID can use letters, digits, dots, dashes and underscores, starts with a letter or digit, and is at most 64 characters.');
  }
  return clean;
}

/** Throws when another cluster than `exceptId` already uses this ARK cluster ID. */
export function assertArkClusterIdFree(clusters: Array<Pick<KnownCluster, 'clusterId' | 'arkClusterId'>>, arkClusterId: string, exceptId?: string): void {
  if (clusters.some(cluster => cluster.clusterId !== exceptId && cluster.arkClusterId === arkClusterId)) {
    throw new Error(`Another cluster already uses the ID ${arkClusterId}.`);
  }
}

/** A machine on its own: a new cluster, kept here. */
export function createLocalCluster(input: { name: string; arkClusterId: string }): KnownCluster {
  const name = clusterNameOf(input.name);
  const arkClusterId = arkClusterIdOf(input.arkClusterId);
  const clusters = knownClusters();
  assertArkClusterIdFree(clusters, arkClusterId);
  const cluster = { clusterId: randomUUID(), name, arkClusterId };
  rememberClusters([...clusters, cluster]);
  return cluster;
}

export function renameLocalCluster(clusterId: string, name: string): KnownCluster {
  const clusters = knownClusters();
  const cluster = clusters.find(item => item.clusterId === clusterId);
  if (!cluster) throw new Error('That cluster was not found.');
  cluster.name = clusterNameOf(name);
  rememberClusters(clusters);
  return cluster;
}

/** Forgets a cluster. Its files stay in its folder. */
export function removeLocalCluster(clusterId: string): void {
  const clusters = knownClusters();
  if (!clusters.some(cluster => cluster.clusterId === clusterId)) throw new Error('That cluster was not found.');
  rememberClusters(clusters.filter(cluster => cluster.clusterId !== clusterId));
}
