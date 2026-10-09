jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('path');
jest.unmock('node:path');
jest.unmock('crypto');
jest.unmock('node:crypto');

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { MeshRepository } from './mesh-repository';
import { openSqliteDatabase, SqliteExecutor, type ExecutorStatus, type SqliteHandle } from './sql-executor';
import { ClusterSync, importClusterData, type ClusterSyncOptions } from './cluster-sync';

const PLAYER = 'clusters/MyCluster/0002a1b2c3d4e5f60718293a4b5c6d7e';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

describe('cluster sync', () => {
  let root: string;
  let db: SqliteHandle;
  let view: ExecutorStatus;
  let repo: MeshRepository;
  const nodes = new Map<string, { sync: ClusterSync; root: (clusterId: string) => string; reachable: boolean }>();

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-cluster-sync-'));
    db = openSqliteDatabase(path.join(root, 'mesh.sqlite'));
    view = { leader: true, voters: 2, hasQuorum: true, leaderNodeId: 'A' };
    repo = new MeshRepository(new SqliteExecutor(db, view));
    await repo.migrate();
    nodes.clear();
    await cluster('c1');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function cluster(clusterId: string): Promise<void> {
    await repo.upsertStorage({
      storageProfileId: `p-${clusterId}`, mode: 'managed', authorityNodeId: null, metadata: {},
      health: { ok: true, degraded: false, detail: '', checkedAt: 0, perNode: {} }
    });
    await repo.upsertCluster({ clusterId, name: clusterId, arkClusterId: 'MyCluster', storageProfileId: `p-${clusterId}`, members: [] });
  }

  /** A machine with its own cluster folders and file store, sharing the mesh record. */
  function machine(nodeId: string, hooks: Pick<ClusterSyncOptions, 'onRecorded' | 'onPlaced'> = {}): ClusterSync {
    const rootOf = (clusterId: string) => path.join(root, nodeId, 'MeshClusters', clusterId);
    const sync = new ClusterSync({
      nodeId,
      repo,
      rootOf,
      workDir: path.join(root, nodeId, 'work'),
      // Copies the contents from whichever reachable machine has them, as the peer API would.
      fetch: async (hash, _origin, dest) => {
        for (const [id, other] of nodes) {
          if (id === nodeId || !other.reachable) continue;
          const source = other.sync.objectPath(hash);
          if (source && fs.existsSync(source)) {
            fs.copyFileSync(source, dest);
            return true;
          }
        }
        return false;
      },
      announce: jest.fn(),
      ...hooks
    });
    nodes.set(nodeId, { sync, root: rootOf, reachable: true });
    return sync;
  }

  function write(nodeId: string, rel: string, text: string, clusterId = 'c1'): void {
    const file = path.join(nodes.get(nodeId)!.root(clusterId), rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    // A rewrite within the same millisecond would look unchanged by mtime alone.
    const later = new Date(Date.now() + Math.floor(Math.random() * 100000));
    fs.utimesSync(file, later, later);
  }

  function read(nodeId: string, rel: string, clusterId = 'c1'): string | null {
    const file = path.join(nodes.get(nodeId)!.root(clusterId), rel);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  }

  /** Every machine checks twice: once to see a finished write, once more to record it. */
  async function settle(...ids: string[]): Promise<void> {
    for (let round = 0; round < 3; round++) {
      for (const id of ids) await nodes.get(id)!.sync.syncOnce();
    }
  }

  describe('the mesh record of cluster files', () => {
    const file = { clusterId: 'c1', path: PLAYER, sha256: sha('a'), size: 1, deleted: false, originNode: 'A' };

    it('records a new file once, as version 1', async () => {
      expect(await repo.commitClusterFile(file, 0)).toBe(1);
      expect(await repo.commitClusterFile({ ...file, originNode: 'B' }, 0)).toBeNull();
      expect(await repo.listClusterFiles('c1')).toEqual([expect.objectContaining({ path: PLAYER, version: 1, originNode: 'A' })]);
    });

    it('records a change only on top of the version it started from', async () => {
      await repo.commitClusterFile(file, 0);

      expect(await repo.commitClusterFile({ ...file, sha256: sha('b') }, 1)).toBe(2);
      expect(await repo.commitClusterFile({ ...file, sha256: sha('c') }, 1)).toBeNull();
      expect((await repo.listClusterFiles('c1'))[0]).toMatchObject({ version: 2, sha256: sha('b') });
    });
  });

  it('records nothing until ARK has finished writing a file', async () => {
    const a = machine('A');
    write('A', PLAYER, 'uploaded');

    await a.syncOnce();
    expect(await repo.listClusterFiles('c1')).toEqual([]);

    await a.syncOnce();
    expect(await repo.listClusterFiles('c1')).toEqual([expect.objectContaining({ path: PLAYER, version: 1, sha256: sha('uploaded') })]);
  });

  it('brings a file written on one machine to the others', async () => {
    machine('A');
    machine('B');
    write('A', PLAYER, 'dino');

    await settle('A', 'B');

    expect(read('B', PLAYER)).toBe('dino');
  });

  it('carries later changes across, either way', async () => {
    machine('A');
    machine('B');
    write('A', PLAYER, 'v1');
    await settle('A', 'B');

    write('A', PLAYER, 'v2 from A');
    await settle('A', 'B');
    expect(read('B', PLAYER)).toBe('v2 from A');

    write('B', PLAYER, 'v3 from B');
    await settle('B', 'A');
    expect(read('A', PLAYER)).toBe('v3 from B');
    expect((await repo.listClusterFiles('c1'))[0]).toMatchObject({ version: 3 });
  });

  it('records a deletion so that an old copy never brings the file back', async () => {
    machine('A');
    machine('B');
    machine('C');
    write('A', PLAYER, 'item');
    await settle('A', 'B', 'C');
    nodes.get('C')!.reachable = false; // C is away while the file is removed

    fs.rmSync(path.join(nodes.get('A')!.root('c1'), PLAYER));
    await settle('A', 'B');
    expect(read('B', PLAYER)).toBeNull();

    nodes.get('C')!.reachable = true;
    await settle('C', 'A', 'B');

    expect(read('C', PLAYER)).toBeNull();
    expect(read('A', PLAYER)).toBeNull();
    expect((await repo.listClusterFiles('c1'))[0]).toMatchObject({ deleted: true, version: 2 });
  });

  it('does not record a file as removed when it is only missing for a moment, as when ARK replaces it', async () => {
    const a = machine('A');
    write('A', PLAYER, 'v1');
    await settle('A');
    const file = path.join(nodes.get('A')!.root('c1'), PLAYER);

    fs.rmSync(file);
    await a.syncOnce();
    write('A', PLAYER, 'v1');
    await settle('A');

    expect((await repo.listClusterFiles('c1'))[0]).toMatchObject({ version: 1, deleted: false });
  });

  // Possible only while one machine has not yet heard of the other's change.
  it('keeps the first of two changes made from the same version, and sets the second aside', async () => {
    const b = machine('B');
    machine('A');
    write('A', PLAYER, 'v1');
    await settle('A', 'B');

    write('A', PLAYER, 'uploaded on A');
    write('B', PLAYER, 'uploaded on B');
    await settle('A');
    await settle('B');

    expect(read('B', PLAYER)).toBe('uploaded on A');
    expect(b.summary().c1.conflicts).toBe(1);
    const kept = fs.readdirSync(path.join(root, 'B', 'work', 'conflicts', 'c1'), { recursive: true }) as string[];
    const copies = kept.map(name => path.join(root, 'B', 'work', 'conflicts', 'c1', name)).filter(file => fs.statSync(file).isFile());
    expect(copies.map(file => fs.readFileSync(file, 'utf8'))).toEqual(['uploaded on B']);
  });

  it('never writes a newer version over a change here that is not recorded yet', async () => {
    const b = machine('B');
    machine('A');
    write('A', PLAYER, 'v1');
    await settle('A', 'B');
    write('A', PLAYER, 'v2 from A');
    await settle('A');

    write('B', PLAYER, 'still being written on B');
    await b.syncOnce();

    expect(read('B', PLAYER)).toBe('still being written on B');
    expect(b.summary().c1.pendingReceive).toBe(1);
  });

  it('does not treat the same file written on two machines as a clash', async () => {
    const a = machine('A');
    const b = machine('B');
    write('A', PLAYER, 'same');
    write('B', PLAYER, 'same');

    await settle('A', 'B');

    expect(await repo.listClusterFiles('c1')).toEqual([expect.objectContaining({ version: 1 })]);
    expect(a.summary().c1.conflicts + b.summary().c1.conflicts).toBe(0);
  });

  it('keeps a change on this machine while the mesh has no quorum, and records it once it does', async () => {
    const a = machine('A');
    write('A', PLAYER, 'offline upload');
    view.hasQuorum = false;
    view.leader = false;

    await settle('A');
    expect(await repo.listClusterFiles('c1')).toEqual([]);
    expect(a.summary().c1.pendingSend).toBe(1);
    expect(read('A', PLAYER)).toBe('offline upload');

    view.hasQuorum = true;
    view.leader = true;
    await settle('A');

    expect((await repo.listClusterFiles('c1'))[0]).toMatchObject({ sha256: sha('offline upload') });
    expect(a.summary().c1.pendingSend).toBe(0);
  });

  it('waits for the contents while no reachable machine has them, then places them', async () => {
    machine('A');
    const b = machine('B');
    write('A', PLAYER, 'tame');
    await settle('A');
    nodes.get('A')!.reachable = false;

    await settle('B');
    expect(read('B', PLAYER)).toBeNull();
    expect(b.summary().c1.pendingReceive).toBe(1);

    nodes.get('A')!.reachable = true;
    await settle('B');
    expect(read('B', PLAYER)).toBe('tame');
    expect(b.summary().c1.pendingReceive).toBe(0);
  });

  it('refuses contents that do not match their fingerprint', async () => {
    machine('A');
    write('A', PLAYER, 'real');
    await settle('A');
    const tampered = new ClusterSync({
      nodeId: 'B',
      repo,
      rootOf: clusterId => path.join(root, 'B', 'MeshClusters', clusterId),
      workDir: path.join(root, 'B', 'work'),
      fetch: async (_hash, _origin, dest) => { fs.writeFileSync(dest, 'forged'); return true; },
      announce: jest.fn()
    });

    await tampered.syncOnce();

    expect(fs.existsSync(path.join(root, 'B', 'MeshClusters', 'c1', PLAYER))).toBe(false);
  });

  it('never records its own half-placed files', async () => {
    const a = machine('A');
    write('A', 'clusters/MyCluster/.aasm-sync-123', 'partial');

    await settle('A');

    expect(await repo.listClusterFiles('c1')).toEqual([]);
    expect(a.summary().c1.pendingSend).toBe(0);
  });

  it('keeps each cluster in its own folder', async () => {
    await cluster('c2');
    machine('A');
    machine('B');
    write('A', PLAYER, 'in one', 'c1');
    write('A', PLAYER, 'in two', 'c2');

    await settle('A', 'B');

    expect(read('B', PLAYER, 'c1')).toBe('in one');
    expect(read('B', PLAYER, 'c2')).toBe('in two');
  });

  it('tells the other machines when it has recorded a change', async () => {
    const a = machine('A');
    write('A', PLAYER, 'upload');

    await settle('A');

    expect((a as unknown as { options: { announce: jest.Mock } }).options.announce).toHaveBeenCalledWith('c1');
  });

  it('carries on from what it last knew after a restart, without sending everything again', async () => {
    machine('A');
    write('A', PLAYER, 'kept');
    await settle('A');
    const committed = await repo.listClusterFiles('c1');

    const restarted = machine('A');
    await settle('A');

    expect(await repo.listClusterFiles('c1')).toEqual(committed);
    expect(restarted.summary().c1).toMatchObject({ pendingSend: 0, pendingReceive: 0, conflicts: 0 });
  });

  it('only syncs clusters whose files the app keeps', async () => {
    await repo.upsertStorage({
      storageProfileId: 'p-shared', mode: 'shared-path', authorityNodeId: null, metadata: { path: '/mnt/share' },
      health: { ok: true, degraded: false, detail: '', checkedAt: 0, perNode: {} }
    });
    await repo.upsertCluster({ clusterId: 'shared', name: 'shared', arkClusterId: 'X', storageProfileId: 'p-shared', members: [] });
    const a = machine('A');
    write('A', PLAYER, 'on a share', 'shared');

    await settle('A');

    expect(await repo.listClusterFiles('shared')).toEqual([]);
    expect(a.summary().shared).toBeUndefined();
  });

  // What a player's upload notice is built on: which machine recorded a change, and which have it.
  // Leaving a mesh let go of the sync without waiting: a pass under way went on writing files into
  // a cluster folder, which on a slow machine was already being deleted.
  describe('stopping', () => {
    it('waits for the pass under way to end, and starts no other', async () => {
      machine('A');
      write('A', PLAYER, 'from A');
      await settle('A');
      let release!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      let fetching!: () => void;
      const fetchStarted = new Promise<void>(resolve => { fetching = resolve; });
      const bRoot = (clusterId: string) => path.join(root, 'B', 'MeshClusters', clusterId);
      const b = new ClusterSync({
        nodeId: 'B', repo, rootOf: bRoot, workDir: path.join(root, 'B', 'work'), announce: jest.fn(),
        fetch: async (hash, _origin, dest) => {
          fetching();
          await held;
          fs.copyFileSync(nodes.get('A')!.sync.objectPath(hash)!, dest);
          return true;
        }
      });

      const pass = b.syncOnce();
      await fetchStarted;
      let stopped = false;
      const stopping = b.stop().then(() => { stopped = true; });
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(stopped).toBe(false);

      release();
      await pass;
      await stopping;
      expect(stopped).toBe(true);

      write('A', 'clusters/MyCluster/later', 'after stopping');
      await settle('A');
      await b.syncOnce();
      expect(fs.existsSync(path.join(bRoot('c1'), 'clusters/MyCluster/later'))).toBe(false);
    });
  });

  describe('saying what happened to a file', () => {
    it('says when it recorded a change made here, with the size before and after', async () => {
      const onRecorded = jest.fn();
      machine('A', { onRecorded });

      write('A', PLAYER, 'one');
      await settle('A');
      write('A', PLAYER, 'one two');
      await settle('A');

      expect(onRecorded.mock.calls.map(([change]) => change)).toEqual([
        { clusterId: 'c1', path: PLAYER, version: 1, size: 3, previousSize: null, deleted: false },
        { clusterId: 'c1', path: PLAYER, version: 2, size: 7, previousSize: 3, deleted: false }
      ]);
    });

    it('says when a file was removed here', async () => {
      const onRecorded = jest.fn();
      machine('A', { onRecorded });
      write('A', PLAYER, 'one');
      await settle('A');

      fs.rmSync(path.join(nodes.get('A')!.root('c1'), PLAYER));
      await settle('A');

      expect(onRecorded).toHaveBeenLastCalledWith({ clusterId: 'c1', path: PLAYER, version: 2, size: 0, previousSize: 3, deleted: true });
    });

    it('says when it has a version another machine recorded, placed or removed', async () => {
      const onPlaced = jest.fn();
      machine('A');
      machine('B', { onPlaced });

      write('A', PLAYER, 'one');
      await settle('A', 'B');
      fs.rmSync(path.join(nodes.get('A')!.root('c1'), PLAYER));
      await settle('A', 'B');

      expect(onPlaced.mock.calls.map(([change]) => change)).toEqual([
        { clusterId: 'c1', path: PLAYER, version: 1 },
        { clusterId: 'c1', path: PLAYER, version: 2 }
      ]);
    });

    it('says nothing of a version it could not get', async () => {
      const onPlaced = jest.fn();
      machine('A');
      machine('B', { onPlaced });
      write('A', PLAYER, 'one');
      await settle('A');
      nodes.get('A')!.reachable = false;

      await settle('B');

      expect(onPlaced).not.toHaveBeenCalled();
    });
  });

  describe('bringing a server\'s earlier transfer data into a cluster', () => {
    it('copies what is not there yet, leaving the original and anything already there alone', () => {
      const old = path.join(root, 'old');
      const managed = path.join(root, 'managed');
      fs.mkdirSync(path.join(old, 'clusters', 'Before'), { recursive: true });
      fs.writeFileSync(path.join(old, 'clusters', 'Before', 'p1'), 'p1 data');
      fs.writeFileSync(path.join(old, 'clusters', 'Before', 'p2'), 'p2 old');
      fs.mkdirSync(path.join(managed, 'clusters', 'After'), { recursive: true });
      fs.writeFileSync(path.join(managed, 'clusters', 'After', 'p2'), 'p2 in the cluster');

      expect(importClusterData(old, 'Before', managed, 'After')).toBe(1);

      expect(fs.readFileSync(path.join(managed, 'clusters', 'After', 'p1'), 'utf8')).toBe('p1 data');
      expect(fs.readFileSync(path.join(managed, 'clusters', 'After', 'p2'), 'utf8')).toBe('p2 in the cluster');
      expect(fs.readFileSync(path.join(old, 'clusters', 'Before', 'p1'), 'utf8')).toBe('p1 data');
    });

    it('does nothing when the server had no transfer data', () => {
      expect(importClusterData(path.join(root, 'nowhere'), 'Before', path.join(root, 'managed'), 'After')).toBe(0);
    });
  });
});
