import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { ClusterFileRecord } from '../../types/mesh.types';
import type { MeshRepository } from './mesh-repository';
import { fileDigest } from './checkpoint';

/**
 * Keeps the transfer files of every cluster whose files the app keeps (storage mode 'managed')
 * the same on every machine, so a server on any member sees what a player uploaded on another.
 *
 * The mesh database is the record: one row per file at its latest version. A change made on a
 * machine is recorded only on top of the version that machine last had, so of two changes made
 * from the same version the first is kept and the second is set aside, never merged and never
 * duplicated. A removed file keeps its row, so an older copy cannot bring it back. The contents
 * travel between machines by their sha256 and are checked against it before they are placed,
 * written beside the target and renamed over it, so ARK never reads half a file.
 */

/** Our own files while placing contents. Never synced. */
const TEMP_PREFIX = '.aasm-sync-';
/** Contents no file here refers to any more are removed after this long. */
const UNUSED_OBJECT_MS = 60 * 60 * 1000;
const SHA256 = /^[0-9a-f]{64}$/;

export interface ClusterSyncOptions {
  nodeId: string;
  repo: Pick<MeshRepository, 'listClusters' | 'listStorage' | 'listClusterFiles' | 'commitClusterFile'>;
  /** This machine's folder for a cluster's transfer files: what ARK is given as its cluster directory. */
  rootOf(clusterId: string): string;
  /** Where this machine keeps file contents by sha256, files it set aside, and what it last had. */
  workDir: string;
  /** Fetches the contents with this sha256 from another machine into `dest`. False when none could. */
  fetch(sha256: string, originNode: string, dest: string): Promise<boolean>;
  /** Tells the other machines this one recorded a change, so they look now rather than at their next check. */
  announce(clusterId: string): void;
  /**
   * A change made here was recorded. `previousSize` is what this machine had before, null for
   * a new file: a file that grew is an upload, one that shrank or went is a download.
   */
  onRecorded?(change: RecordedChange): void;
  /** This machine has a version another machine recorded: placed, or removed for a removal. */
  onPlaced?(change: { clusterId: string; path: string; version: number }): void;
}

export interface RecordedChange {
  clusterId: string;
  path: string;
  version: number;
  size: number;
  previousSize: number | null;
  deleted: boolean;
}

export interface ClusterSyncSummary {
  /** Files this machine has, in step with the mesh. */
  files: number;
  /** Changes made here that are not recorded yet: still being written, or waiting for quorum. */
  pendingSend: number;
  /** Newer versions recorded elsewhere that are not here yet. */
  pendingReceive: number;
  /** Copies set aside because another machine changed the same file first. */
  conflicts: number;
  lastSyncAt: number;
  error: string | null;
}

/** What this machine last had of a file, as recorded in the mesh. */
interface Held {
  version: number;
  sha256: string;
  size: number;
  deleted: boolean;
}

/** The last look at a file here. Stable once two looks in a row saw the same contents. */
interface Seen {
  size: number;
  mtimeMs: number;
  sha256: string;
  stable: boolean;
}

interface SyncState {
  clusters: Record<string, Record<string, Held>>;
}

type Outcome = 'done' | 'pending' | 'conflict';

export class ClusterSync {
  private state: SyncState;
  private readonly seen = new Map<string, Seen>();
  /** How many checks in a row found a file gone that this machine had. */
  private readonly gone = new Map<string, number>();
  private readonly summaries = new Map<string, ClusterSyncSummary>();
  private running = false;
  private again = false;
  private lastCleanup = 0;

  constructor(private readonly options: ClusterSyncOptions) {
    this.state = readState(this.statePath());
  }

  /** Where the contents with this sha256 are kept here, for another machine to fetch. Null for anything else. */
  objectPath(sha256: string): string | null {
    return SHA256.test(sha256) ? path.join(this.objectsDir(), sha256) : null;
  }

  summary(): Record<string, ClusterSyncSummary> {
    return Object.fromEntries(this.summaries);
  }

  /** One pass over every cluster. A pass asked for while one runs follows it. */
  async syncOnce(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.again = false;
        await this.syncAll();
      } while (this.again);
    } finally {
      this.running = false;
    }
  }

  private async syncAll(): Promise<void> {
    const [clusters, storage] = await Promise.all([this.options.repo.listClusters(), this.options.repo.listStorage()]);
    const managed = new Set(storage.filter(profile => profile.mode === 'managed').map(profile => profile.storageProfileId));
    const ids = clusters.filter(cluster => cluster.storageProfileId && managed.has(cluster.storageProfileId)).map(cluster => cluster.clusterId);
    for (const id of ids) {
      try {
        await this.syncCluster(id);
      } catch (error) {
        const previous = this.summaries.get(id);
        this.summaries.set(id, { ...(previous ?? emptySummary()), error: messageOf(error), lastSyncAt: Date.now() });
      }
    }
    // A cluster that is gone stops syncing. Its files stay on this machine.
    for (const id of Object.keys(this.state.clusters)) if (!ids.includes(id)) delete this.state.clusters[id];
    for (const id of [...this.summaries.keys()]) if (!ids.includes(id)) this.summaries.delete(id);
    this.saveState();
    this.cleanUpObjects();
  }

  private async syncCluster(clusterId: string): Promise<void> {
    const root = this.options.rootOf(clusterId);
    fs.mkdirSync(root, { recursive: true });
    const held = (this.state.clusters[clusterId] ??= {});
    const local = scan(root);
    const recorded = new Map((await this.options.repo.listClusterFiles(clusterId)).map(row => [row.path, row]));
    let pendingSend = 0;
    let error: string | null = null;

    // What changed here.
    for (const rel of new Set([...local.keys(), ...Object.keys(held)])) {
      const key = `${clusterId}\n${rel}`;
      const stat = local.get(rel);
      const base = held[rel];
      if (!stat) {
        this.seen.delete(key);
        if (!base || base.deleted) {
          this.gone.delete(key);
          continue;
        }
        // Removed here; counted once it has stayed removed for two checks.
        const checks = (this.gone.get(key) ?? 0) + 1;
        this.gone.set(key, checks);
        if (checks < 2) {
          pendingSend++;
          continue;
        }
        const outcome = await this.commit(clusterId, rel, { sha256: '', size: 0, deleted: true }, base, recorded.get(rel), null);
        if (outcome.result === 'pending') {
          pendingSend++;
          error = outcome.error ?? error;
        }
        if (outcome.result !== 'pending') this.gone.delete(key);
        continue;
      }
      this.gone.delete(key);
      const file = path.join(root, rel);
      const seen = await this.observe(key, file, stat, base);
      if (base && !base.deleted && seen.sha256 === base.sha256) continue;
      if (!seen.stable) {
        pendingSend++;
        continue;
      }
      const outcome = await this.commit(clusterId, rel, { sha256: seen.sha256, size: stat.size, deleted: false }, base, recorded.get(rel), file);
      if (outcome.result === 'pending') {
        pendingSend++;
        error = outcome.error ?? error;
      }
    }

    // What changed elsewhere.
    let pendingReceive = 0;
    for (const row of await this.options.repo.listClusterFiles(clusterId)) {
      const base = held[row.path];
      if (base && base.version >= row.version) continue;
      const key = `${clusterId}\n${row.path}`;
      const file = path.join(root, row.path);
      const exists = fs.existsSync(file);
      // A change here that is not recorded yet goes first; this copy is not overwritten under it.
      const clean = exists
        ? !!base && !base.deleted && this.seen.get(key)?.sha256 === base.sha256
        : !base || base.deleted;
      if (!clean) {
        pendingReceive++;
        continue;
      }
      if (row.deleted) {
        if (exists) fs.rmSync(file, { force: true });
        this.seen.delete(key);
        held[row.path] = heldOf(row);
        this.tell(() => this.options.onPlaced?.({ clusterId, path: row.path, version: row.version }));
        continue;
      }
      if (await this.place(key, file, row)) {
        held[row.path] = heldOf(row);
        this.tell(() => this.options.onPlaced?.({ clusterId, path: row.path, version: row.version }));
      } else {
        pendingReceive++;
      }
    }

    const files = Object.values(held).filter(entry => !entry.deleted).length;
    this.summaries.set(clusterId, {
      files,
      pendingSend,
      pendingReceive,
      conflicts: countFiles(path.join(this.conflictsDir(), clusterId)),
      lastSyncAt: Date.now(),
      error
    });
  }

  /**
   * Looks at a file. Its contents are hashed only when its size or time changed. It is stable
   * when it is what this machine last had, or when two looks in a row saw the same contents:
   * ARK has finished writing it.
   */
  private async observe(key: string, file: string, stat: { size: number; mtimeMs: number }, base: Held | undefined): Promise<Seen> {
    const previous = this.seen.get(key);
    if (previous && previous.size === stat.size && previous.mtimeMs === stat.mtimeMs) {
      previous.stable = true;
      return previous;
    }
    const sha256 = await fileDigest(file);
    const known = !!base && !base.deleted && base.sha256 === sha256;
    const settled = !!previous && previous.size === stat.size && previous.sha256 === sha256;
    const seen = { size: stat.size, mtimeMs: stat.mtimeMs, sha256, stable: known || settled };
    this.seen.set(key, seen);
    return seen;
  }

  /** Records a change made here, on top of what this machine last had. */
  private async commit(
    clusterId: string,
    rel: string,
    change: { sha256: string; size: number; deleted: boolean },
    base: Held | undefined,
    recorded: ClusterFileRecord | undefined,
    file: string | null
  ): Promise<{ result: Outcome; error?: string }> {
    const held = this.state.clusters[clusterId];
    if (recorded && sameAs(recorded, change)) {
      // Already what the mesh has, from another machine: nothing to send.
      held[rel] = heldOf(recorded);
      return { result: 'done' };
    }
    // Kept before it is recorded, so another machine can fetch it as soon as it is.
    if (file && !change.deleted && !this.keepObject(file, change.sha256)) return { result: 'pending' };
    let version: number | null;
    try {
      version = await this.options.repo.commitClusterFile({ clusterId, path: rel, ...change, originNode: this.options.nodeId }, base?.version ?? 0);
    } catch (error) {
      // No quorum: the change stays here and is recorded at a later check.
      return { result: 'pending', error: messageOf(error) };
    }
    if (version !== null) {
      held[rel] = { version, ...change };
      this.options.announce(clusterId);
      const previousSize = base && !base.deleted ? base.size : null;
      this.tell(() => this.options.onRecorded?.({ clusterId, path: rel, version, size: change.size, previousSize, deleted: change.deleted }));
      return { result: 'done' };
    }
    // Another machine recorded a change to this file first.
    const latest = (await this.options.repo.listClusterFiles(clusterId)).find(row => row.path === rel);
    if (latest && sameAs(latest, change)) {
      held[rel] = heldOf(latest);
      return { result: 'done' };
    }
    if (file) this.setAside(clusterId, rel, file);
    // Nothing of this file is here now, so the version that was kept is placed next.
    delete held[rel];
    this.seen.delete(`${clusterId}\n${rel}`);
    return { result: 'conflict' };
  }

  /** A listener that throws never stops the sync. */
  private tell(listener: () => void): void {
    try {
      listener();
    } catch (error) {
      console.warn('[cluster-sync] A listener failed:', messageOf(error));
    }
  }

  /** Copies a file's contents into the store under their sha256, if they are still those contents. */
  private keepObject(file: string, sha256: string): boolean {
    const object = this.objectPath(sha256);
    if (!object) return false;
    if (fs.existsSync(object)) return true;
    fs.mkdirSync(this.objectsDir(), { recursive: true });
    const temp = path.join(this.objectsDir(), `${TEMP_PREFIX}${randomUUID()}`);
    try {
      fs.copyFileSync(file, temp);
      if (digestSync(temp) !== sha256) {
        // Changed again since it was looked at: it is looked at again next time.
        fs.rmSync(temp, { force: true });
        return false;
      }
      fs.renameSync(temp, object);
      return true;
    } catch {
      fs.rmSync(temp, { force: true });
      return false;
    }
  }

  /** Puts a recorded version in place, fetching its contents first if they are not here. */
  private async place(key: string, target: string, row: ClusterFileRecord): Promise<boolean> {
    const object = this.objectPath(row.sha256);
    if (!object) return false;
    try {
      if (!fs.existsSync(object)) {
        fs.mkdirSync(this.objectsDir(), { recursive: true });
        const incoming = path.join(this.objectsDir(), `${TEMP_PREFIX}${randomUUID()}`);
        let fetched = false;
        try {
          fetched = await this.options.fetch(row.sha256, row.originNode, incoming);
        } catch {
          fetched = false;
        }
        if (!fetched || !fs.existsSync(incoming) || await fileDigest(incoming) !== row.sha256) {
          fs.rmSync(incoming, { force: true });
          return false;
        }
        fs.renameSync(incoming, object);
      }
      // Beside the target and renamed over it, so ARK never reads half a file.
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const temp = path.join(path.dirname(target), `${TEMP_PREFIX}${randomUUID()}`);
      fs.copyFileSync(object, temp);
      try {
        fs.renameSync(temp, target);
      } catch (error) {
        fs.rmSync(temp, { force: true });
        throw error;
      }
      const stat = fs.statSync(target);
      this.seen.set(key, { size: stat.size, mtimeMs: stat.mtimeMs, sha256: row.sha256, stable: true });
      return true;
    } catch {
      // ARK may have the file open; it is tried again at the next check.
      return false;
    }
  }

  /** Keeps this machine's copy of a file another machine changed first, out of ARK's folder. */
  private setAside(clusterId: string, rel: string, file: string): void {
    const dest = path.join(this.conflictsDir(), clusterId, `${rel}.${Date.now()}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
      fs.renameSync(file, dest);
    } catch {
      fs.copyFileSync(file, dest);
      fs.rmSync(file, { force: true });
    }
  }

  /** Removes stored contents no file here refers to any more, once they have gone unused for a while. */
  private cleanUpObjects(): void {
    const now = Date.now();
    if (now - this.lastCleanup < UNUSED_OBJECT_MS / 4) return;
    this.lastCleanup = now;
    const used = new Set(Object.values(this.state.clusters).flatMap(files => Object.values(files).map(entry => entry.sha256)));
    const dir = this.objectsDir();
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (used.has(name)) continue;
      const file = path.join(dir, name);
      try {
        if (now - fs.statSync(file).mtimeMs > UNUSED_OBJECT_MS) fs.rmSync(file, { force: true });
      } catch {
        // Already gone.
      }
    }
  }

  private saveState(): void {
    fs.mkdirSync(this.options.workDir, { recursive: true });
    const file = this.statePath();
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.state));
    fs.renameSync(temp, file);
  }

  private statePath(): string {
    return path.join(this.options.workDir, 'state.json');
  }

  private objectsDir(): string {
    return path.join(this.options.workDir, 'objects');
  }

  private conflictsDir(): string {
    return path.join(this.options.workDir, 'conflicts');
  }
}

/**
 * Brings a server's transfer data from its earlier cluster folder into the cluster it joins:
 * `<oldBase>/clusters/<oldClusterId>` into `<newRoot>/clusters/<arkClusterId>`, as ARK lays them
 * out. Only files not there yet are copied; the original is left as it was. Returns how many.
 */
export function importClusterData(oldBase: string, oldClusterId: string, newRoot: string, arkClusterId: string): number {
  const source = path.join(oldBase, 'clusters', oldClusterId);
  if (!oldClusterId || !fs.existsSync(source)) return 0;
  const dest = path.join(newRoot, 'clusters', arkClusterId);
  let copied = 0;
  for (const rel of scan(source).keys()) {
    const target = path.join(dest, rel);
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(source, rel), target);
    copied++;
  }
  return copied;
}

/** Every file under `root` but our own temporary ones, by relative path with forward slashes. */
function scan(root: string): Map<string, { size: number; mtimeMs: number }> {
  const files = new Map<string, { size: number; mtimeMs: number }>();
  const walk = (dir: string): void => {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name.startsWith(TEMP_PREFIX)) continue;
      const full = path.join(dir, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue; // removed while looking
      }
      if (stat.isDirectory()) walk(full);
      else files.set(path.relative(root, full).replace(/\\/g, '/'), { size: stat.size, mtimeMs: stat.mtimeMs });
    }
  };
  walk(root);
  return files;
}

function countFiles(dir: string): number {
  return fs.existsSync(dir) ? scan(dir).size : 0;
}

function digestSync(file: string): string {
  // Small player files; read whole, unlike the streamed digest used for world saves.
  return require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function heldOf(row: ClusterFileRecord): Held {
  return { version: row.version, sha256: row.sha256, size: row.size, deleted: row.deleted };
}

function sameAs(row: ClusterFileRecord, change: { sha256: string; deleted: boolean }): boolean {
  return row.deleted ? change.deleted : !change.deleted && row.sha256 === change.sha256;
}

function readState(file: string): SyncState {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as SyncState;
    if (parsed && typeof parsed.clusters === 'object' && parsed.clusters) return parsed;
  } catch {
    // None yet, or unreadable: every file here is compared with the mesh record again.
  }
  return { clusters: {} };
}

function emptySummary(): ClusterSyncSummary {
  return { files: 0, pendingSend: 0, pendingReceive: 0, conflicts: 0, lastSyncAt: 0, error: null };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
