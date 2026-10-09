import type { RecordedChange } from './cluster-sync';

const DEFAULT_TIMEOUT_MS = 2 * 60_000;

/**
 * The player a cluster file belongs to. ARK names each player's transfer file after them: their
 * EOS ID, 32 hex characters, in ASA (a Steam ID in ASE). Null for any other file.
 */
export function playerIdOfClusterFile(rel: string): string | null {
  const name = rel.split('/').pop() || '';
  const match = /^([0-9a-f]{32}|\d{17})(?:\.[a-z0-9]+)?$/i.exec(name);
  return match ? match[1].toLowerCase() : null;
}

export interface TransferNoticeOptions {
  /** The other machines that must hold an upload before it is ready: those hosting servers in the cluster, reachable now. */
  machinesFor(clusterId: string): Promise<string[]>;
  /** Whether players in this cluster are told. */
  enabled(clusterId: string): Promise<boolean>;
  /** Tells the player their upload is ready on every server in the cluster. */
  notify(clusterId: string, playerId: string): Promise<void>;
  timeoutMs?: number;
  now?: () => number;
}

interface Waiting {
  clusterId: string;
  path: string;
  version: number;
  playerId: string;
  machines: Set<string>;
  deadline: number;
}

/**
 * Tells a player when what they uploaded on this machine has reached every other machine
 * hosting a server in the cluster, so they can travel to any of them. Upload after upload,
 * they hear once, for the last. A download, or a change from elsewhere, drops the notice; a
 * machine that never confirms lets it lapse rather than tell the player too soon.
 */
export class TransferNotices {
  private readonly waiting = new Map<string, Waiting>();
  /** The latest version each other machine said it has, by file. */
  private readonly held = new Map<string, Map<string, number>>();

  constructor(private readonly options: TransferNoticeOptions) {}

  /** A change this machine recorded. */
  async recorded(change: RecordedChange): Promise<void> {
    const key = keyOf(change.clusterId, change.path);
    const upload = !change.deleted && (change.previousSize === null || change.size > change.previousSize);
    const playerId = upload ? playerIdOfClusterFile(change.path) : null;
    this.waiting.delete(key);
    if (!playerId || !await this.options.enabled(change.clusterId)) return;
    const machines = new Set(await this.options.machinesFor(change.clusterId));
    // ARK reads the folder it was uploaded into at once; there is nothing to wait for.
    if (machines.size === 0) return;
    const notice: Waiting = {
      clusterId: change.clusterId, path: change.path, version: change.version, playerId, machines,
      deadline: this.now() + (this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    };
    for (const [nodeId, version] of this.held.get(key) ?? []) {
      if (version >= notice.version) notice.machines.delete(nodeId);
    }
    this.waiting.set(key, notice);
    this.settle(key, notice);
  }

  /** Another machine says it has this version of a file. */
  placed(nodeId: string, change: { clusterId: string; path: string; version: number }): void {
    const key = keyOf(change.clusterId, change.path);
    const versions = this.held.get(key) ?? new Map<string, number>();
    versions.set(nodeId, Math.max(change.version, versions.get(nodeId) ?? 0));
    this.held.set(key, versions);
    const notice = this.waiting.get(key);
    if (!notice || change.version < notice.version) return;
    notice.machines.delete(nodeId);
    this.settle(key, notice);
  }

  /** This machine placed a newer version from elsewhere: the upload it was waiting on is no longer the file. */
  superseded(change: { clusterId: string; path: string; version: number }): void {
    const key = keyOf(change.clusterId, change.path);
    const notice = this.waiting.get(key);
    if (notice && change.version > notice.version) this.waiting.delete(key);
  }

  /** Lets a notice lapse when a machine has not confirmed in time. */
  expire(): void {
    const now = this.now();
    for (const [key, notice] of this.waiting) {
      if (now <= notice.deadline) continue;
      this.waiting.delete(key);
      console.warn(`[cluster] Did not tell ${notice.playerId} their upload is ready: ${[...notice.machines].join(', ')} did not confirm in time.`);
    }
  }

  private settle(key: string, notice: Waiting): void {
    if (notice.machines.size > 0 || this.waiting.get(key) !== notice) return;
    this.waiting.delete(key);
    void this.options.notify(notice.clusterId, notice.playerId).catch(error => {
      console.warn(`[cluster] Could not tell ${notice.playerId} their upload is ready:`, error instanceof Error ? error.message : error);
    });
  }

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }
}

function keyOf(clusterId: string, rel: string): string {
  return `${clusterId}\n${rel}`;
}
