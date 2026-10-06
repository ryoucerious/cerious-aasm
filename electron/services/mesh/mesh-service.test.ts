jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('path');
jest.unmock('node:path');
jest.unmock('crypto');
jest.unmock('node:crypto');

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash, X509Certificate } from 'crypto';
import { Readable } from 'stream';
import { MeshRepository } from './mesh-repository';
import { openSqliteDatabase, SqliteExecutor, type ExecutorStatus, type SqliteHandle } from './sql-executor';
import { hashArgon2id } from './passwords';
import { meshServer } from './mesh-hooks';
import { certificateCoversHost, createMeshCa, generateKeyPair, signNodeCertificate } from './certificates';
import { PROTOCOL_VERSION, type NodeRecord } from '../../types/mesh.types';

jest.mock('../../utils/platform.utils', () => ({
  getDefaultInstallDir: jest.fn(),
  getFreeMemory: jest.fn(() => 8 * 1024 ** 3),
  getPlatform: jest.fn(() => 'linux'),
  isRunningInDocker: jest.fn(() => false)
}));
jest.mock('./rqlite-supervisor', () => ({ RqliteSupervisor: jest.fn() }));
jest.mock('./rqlite-client', () => ({ RqliteClient: jest.fn() }));
jest.mock('./peer-server', () => ({ startPeerServer: jest.fn(), peerRequest: jest.fn(), peerUpload: jest.fn(), subscribeEvents: jest.fn() }));
jest.mock('../runtime/local-runtime', () => ({
  localRuntime: {
    listInstances: jest.fn(),
    getInstance: jest.fn(),
    saveInstance: jest.fn(),
    startAll: jest.fn(),
    stopAll: jest.fn(),
    saveIni: jest.fn(),
    readIni: jest.fn(),
    patchConfig: jest.fn(),
    connectRcon: jest.fn(),
    announceRcon: jest.fn(),
    disconnectRcon: jest.fn(),
    announceRconDown: jest.fn(),
    rconStatus: jest.fn(),
    players: jest.fn(),
    onlinePlayers: jest.fn(),
    logs: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    forceStop: jest.fn(),
    state: jest.fn(),
    appliedRevision: jest.fn(),
    applyConfig: jest.fn(),
    applyCluster: jest.fn(),
    deleteInstance: jest.fn(),
    rcon: jest.fn()
  }
}));
jest.mock('../server-instance/server-instance.service', () => ({
  serverInstanceService: { broadcastInstances: jest.fn(async () => undefined) },
  setInventoryMerge: jest.fn()
}));
jest.mock('../messaging.service', () => ({ messagingService: { sendToAll: jest.fn() } }));
jest.mock('../auth/user-database.service', () => ({
  userDatabaseService: { exportCredentialRows: jest.fn(() => []), listRoles: jest.fn(() => []) }
}));
jest.mock('../auto-update.service', () => ({ autoUpdateService: { applyAvailableUpdate: jest.fn(), quitAndInstall: jest.fn() } }));
jest.mock('../ark-update.service', () => ({ beginClusterUpdate: jest.fn() }));
jest.mock('../docker-runtime-update', () => ({ relaunchInPlace: jest.fn() }));

import { getDefaultInstallDir } from '../../utils/platform.utils';
import { RqliteSupervisor } from './rqlite-supervisor';
import { RqliteClient } from './rqlite-client';
import { peerRequest, peerUpload, startPeerServer, subscribeEvents } from './peer-server';
import { messagingService } from '../messaging.service';
import { localRuntime } from '../runtime/local-runtime';
import { MeshService } from './mesh-service';

const LOCAL = '11111111-1111-4111-8111-111111111111';

/** rqlited as the mesh sees it: strong writes need a leader, `none` reads come from the local copy. */
class FakeRqlite {
  readonly executor: SqliteExecutor;
  constructor(db: SqliteHandle, readonly view: ExecutorStatus) {
    this.executor = new SqliteExecutor(db, view);
  }
  exec(sql: string, params?: unknown[], consistency?: 'strong' | 'none') { return this.executor.exec(sql, params, consistency); }
  query<T extends Record<string, unknown>>(sql: string, params?: unknown[], consistency?: 'strong' | 'none') {
    return this.executor.query<T>(sql, params, consistency);
  }
  status() { return this.executor.status(); }
  async ready(options: { requireLeader?: boolean } = {}) { return this.view.hasQuorum || options.requireLeader === false; }
  async removeMember() { /* not used here */ }
  async backup() { return Buffer.alloc(0); }
}

describe('MeshService', () => {
  let root: string;
  let db: SqliteHandle;
  let view: ExecutorStatus;
  let rqlite: FakeRqlite;
  let repo: MeshRepository;
  let supervisorFailure: string | null;
  let service: MeshService;

  beforeEach(async () => {
    jest.useFakeTimers();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-mesh-svc-'));
    jest.mocked(getDefaultInstallDir).mockReturnValue(root);
    const meshDir = path.join(root, 'mesh');
    fs.mkdirSync(meshDir, { recursive: true });
    fs.writeFileSync(path.join(meshDir, 'node.json'), JSON.stringify({ nodeId: LOCAL, name: 'A', meshId: 'mesh-1', createdAt: 1 }));
    fs.writeFileSync(path.join(meshDir, 'rqlite-auth.json'), JSON.stringify({ httpUser: 'aasm', httpPass: 'p', peerPort: 4747, advertiseHost: '127.0.0.1' }));
    for (const name of ['node.key', 'node.crt', 'ca.crt']) fs.writeFileSync(path.join(meshDir, name), 'pem');

    db = openSqliteDatabase(path.join(root, 'mesh.sqlite'));
    view = { leader: true, voters: 3, hasQuorum: true, leaderNodeId: LOCAL };
    rqlite = new FakeRqlite(db, view);
    repo = new MeshRepository(rqlite);
    await repo.migrate();

    supervisorFailure = null;
    jest.mocked(RqliteSupervisor).mockImplementation(() => ({
      start: jest.fn(async () => undefined),
      stop: jest.fn(async () => undefined),
      failure: jest.fn(() => supervisorFailure),
      detail: jest.fn(() => supervisorFailure)
    }) as unknown as RqliteSupervisor);
    jest.mocked(RqliteClient).mockImplementation(() => rqlite as unknown as RqliteClient);
    jest.mocked(subscribeEvents).mockImplementation(() => ({ close: jest.fn() }));
    jest.mocked(startPeerServer).mockResolvedValue({ close: (done?: () => void) => done?.(), broadcast: jest.fn() } as never);
    jest.mocked(localRuntime.listInstances).mockResolvedValue({ instances: [] });
    jest.mocked(localRuntime.state).mockReturnValue('stopped');
    jest.mocked(localRuntime.appliedRevision).mockReturnValue(1);

    service = new MeshService();
  });

  afterEach(async () => {
    await service.stop();
    jest.useRealTimers();
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function nodeRow(nodeId: string, certSerial = '1', peerUrl = 'https://127.0.0.1:4747'): NodeRecord {
    return {
      nodeId, meshId: 'mesh-1', name: nodeId.slice(0, 4), endpoints: { peerUrl, raftAddr: '127.0.0.1:4002', httpAddr: '' },
      capabilities: { platform: 'linux', docker: false, proton: true, installPresent: true, freeMemoryBytes: 1, freeDiskBytes: 1, cpuPercent: 0 },
      leaderEligible: true, status: 'alive', lastSeen: 1, version: '1', protocolVersion: PROTOCOL_VERSION, certSerial,
      maintenance: false, weight: 1
    };
  }

  async function addUser(username: string, password: string): Promise<void> {
    const verifier = await hashArgon2id(password);
    await repo.upsertRole({ roleId: 'admin', name: 'Admin', permissions: [], securityVersion: 1 });
    await repo.upsertUser({
      userId: 'u1', username, displayName: username, passwordHash: verifier.hash, passwordParameters: verifier.parameters,
      hashAlg: 'argon2id', enabled: true, securityVersion: 1, roleId: 'admin', ownerUserId: null, createdAt: 1, updatedAt: 1
    });
  }

  describe('desired state', () => {
    let states: Map<string, string>;

    beforeEach(() => {
      states = new Map();
      jest.mocked(localRuntime.state).mockImplementation(id => states.get(id) || 'stopped');
      jest.mocked(localRuntime.start).mockImplementation(async id => {
        states.set(id, 'running');
        return { started: true, instanceName: id } as never;
      });
      jest.mocked(localRuntime.stop).mockImplementation(async id => {
        states.set(id, 'stopped');
        return { success: true, instanceId: id } as never;
      });
    });

    async function place(serverId: string, desiredState: 'running' | 'stopped', nodeId = LOCAL): Promise<void> {
      await repo.upsertServer({
        serverId, name: serverId, nodeId, mapName: '', desiredState, configRevision: 1, configJson: '{}',
        clusterId: null, operatorUserId: null, managerUserId: null
      });
    }

    function command(operation: 'start' | 'stop', serverId: string, targetNode = LOCAL) {
      return {
        commandId: `cmd-${operation}-${serverId}`, correlationId: 'c', actor: 'ada', targetNode, operation, serverId,
        expiry: Date.now() + 60_000, issuedAt: Date.now(), expectedRevision: 1
      };
    }

    async function tick(): Promise<void> {
      await jest.advanceTimersByTimeAsync(5_000);
    }

    it('keeps a server started by a remote command running', async () => {
      await place('s1', 'stopped');
      await service.resumeIfJoined();
      await tick();

      expect(await service.executeLocalCommand(command('start', 's1'))).toMatchObject({ success: true });
      await tick();
      await tick();

      expect(localRuntime.stop).not.toHaveBeenCalled();
      expect(states.get('s1')).toBe('running');
      expect((await repo.getServer('s1'))?.desiredState).toBe('running');
    });

    it('does not restart a server that stopped outside the reconciler', async () => {
      await place('s1', 'running');
      states.set('s1', 'running');
      await service.resumeIfJoined();
      await tick();

      states.set('s1', 'stopped'); // a crash, a scheduled restart, an update
      await tick();

      expect(localRuntime.start).not.toHaveBeenCalled();
    });

    it('holds a stop made during a partition and stores it once quorum returns', async () => {
      await place('s1', 'running');
      states.set('s1', 'running');
      await service.resumeIfJoined();
      await tick();
      view.hasQuorum = false;
      view.leaderNodeId = null;

      states.set('s1', 'stopped');
      await service.noteDesired('s1', 'stopped');
      await tick();
      expect(localRuntime.start).not.toHaveBeenCalled();
      expect((await repo.getServer('s1'))?.desiredState).toBe('running');

      view.hasQuorum = true;
      view.leaderNodeId = LOCAL;
      await tick();
      expect((await repo.getServer('s1'))?.desiredState).toBe('stopped');
    });

    it('does not start a server stopped during a partition when the app restarts in it', async () => {
      await place('s1', 'running');
      states.set('s1', 'running');
      await service.resumeIfJoined();
      await tick();
      view.hasQuorum = false;
      view.leaderNodeId = null;
      states.set('s1', 'stopped');
      await service.noteDesired('s1', 'stopped');

      await service.stop();
      jest.mocked(localRuntime.start).mockClear();
      service = new MeshService();
      await service.resumeIfJoined();
      await tick();

      expect(localRuntime.start).not.toHaveBeenCalled();
    });

    it('refuses a command addressed to another node', async () => {
      await place('s1', 'stopped');
      await service.resumeIfJoined();

      const result = await service.executeLocalCommand(command('start', 's1', '22222222-2222-4222-8222-222222222222'));

      expect(result.success).toBe(false);
      expect(localRuntime.start).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    const REMOTE = '22222222-2222-4222-8222-222222222222';

    async function place(serverId: string, nodeId = LOCAL): Promise<void> {
      await repo.upsertServer({
        serverId, name: serverId, nodeId, mapName: '', desiredState: 'running', configRevision: 3, configJson: '{"name":"x"}',
        clusterId: null, operatorUserId: null, managerUserId: null
      });
    }

    it('takes a server hosted here out of the mesh before deleting its files, so it is not re-created', async () => {
      await place('s1');
      await service.resumeIfJoined();
      await jest.advanceTimersByTimeAsync(5_000);
      let rowWhenFilesWent: unknown = 'not called';

      const result = await service.deleteHostedServer('s1', async () => {
        rowWhenFilesWent = await repo.getServer('s1');
        jest.mocked(localRuntime.appliedRevision).mockReturnValue(0); // the instance is gone from disk
        return { success: true, id: 's1' };
      });
      jest.mocked(localRuntime.applyConfig).mockClear();
      await jest.advanceTimersByTimeAsync(10_000);

      expect(result.success).toBe(true);
      expect(rowWhenFilesWent).toBeNull();
      expect(await repo.getServer('s1')).toBeNull();
      expect(localRuntime.applyConfig).not.toHaveBeenCalled();
    });

    it('puts the server back in the mesh when deleting its files fails', async () => {
      await place('s1');
      await service.resumeIfJoined();

      const result = await service.deleteHostedServer('s1', async () => ({ success: false, id: 's1', error: 'still running' }));

      expect(result.success).toBe(false);
      expect((await repo.getServer('s1'))?.nodeId).toBe(LOCAL);
    });

    it('refuses to delete a mesh server while partitioned', async () => {
      await place('s1');
      await service.resumeIfJoined();
      view.hasQuorum = false;
      view.leaderNodeId = null;
      await jest.advanceTimersByTimeAsync(5_000);
      const deleteLocal = jest.fn(async () => ({ success: true, id: 's1' }));

      const result = await service.deleteHostedServer('s1', deleteLocal);

      expect(result.success).toBe(false);
      expect(deleteLocal).not.toHaveBeenCalled();
    });

    it('deletes a server on the host when a delete command arrives', async () => {
      await place('s1');
      await service.resumeIfJoined();
      jest.mocked(localRuntime.deleteInstance).mockResolvedValue({ success: true, id: 's1' } as never);

      const result = await service.executeLocalCommand({
        commandId: 'del-1', correlationId: 'c', actor: 'ada', targetNode: LOCAL, operation: 'delete', serverId: 's1',
        expiry: Date.now() + 60_000, issuedAt: Date.now(), expectedRevision: null
      });

      expect(result.success).toBe(true);
      expect(localRuntime.deleteInstance).toHaveBeenCalledWith('s1');
      expect(await repo.getServer('s1')).toBeNull();
    });

    it('sends a delete for a server hosted elsewhere to its host', async () => {
      await repo.upsertNode(nodeRow(REMOTE, '2', 'https://10.0.0.2:4747'));
      await place('s2', REMOTE);
      await service.resumeIfJoined();
      jest.mocked(peerRequest).mockResolvedValue({ status: 200, body: { success: true } });

      const result = await service.forwardIfRemote('delete', 's2', 'ada');

      expect(result).toEqual({ success: true });
      expect(jest.mocked(peerRequest).mock.calls[0][0]).toMatchObject({
        url: 'https://10.0.0.2:4747/v1/command',
        body: { operation: 'delete', serverId: 's2', targetNode: REMOTE, actor: 'ada' }
      });
    });

    it('forgets a server whose host has been removed from the mesh', async () => {
      await repo.upsertNode({ ...nodeRow(REMOTE, '2'), status: 'removed' });
      await place('s2', REMOTE);
      await service.resumeIfJoined();

      const result = await service.forwardIfRemote('delete', 's2', 'ada');

      expect(result).toEqual({ success: true });
      expect(await repo.getServer('s2')).toBeNull();
      expect(peerRequest).not.toHaveBeenCalled();
    });
  });

  describe('move', () => {
    const REMOTE = '22222222-2222-4222-8222-222222222222';
    const THIRD = '33333333-3333-4333-8333-333333333333';
    const SAVE = 'SavedArks/TheIsland_WP/TheIsland_WP.ark';
    let servers: string;
    let states: Map<string, string>;

    beforeEach(() => {
      servers = path.join(root, 'AASMServer', 'ShooterGame', 'Saved', 'Servers');
      states = new Map();
      jest.mocked(localRuntime.state).mockImplementation(id => states.get(id) || 'stopped');
      jest.mocked(localRuntime.stop).mockImplementation(async id => {
        states.set(id, 'stopped');
        return { success: true, instanceId: id } as never;
      });
      jest.mocked(localRuntime.start).mockImplementation(async id => {
        states.set(id, 'running');
        return { started: true, instanceName: id } as never;
      });
    });

    function writeInstance(serverId: string): void {
      fs.mkdirSync(path.join(servers, serverId, 'SavedArks', 'TheIsland_WP'), { recursive: true });
      fs.writeFileSync(path.join(servers, serverId, 'config.json'), `{"id":"${serverId}"}`);
      fs.writeFileSync(path.join(servers, serverId, SAVE), 'world');
    }

    async function place(serverId: string, nodeId: string, desiredState: 'running' | 'stopped' = 'running'): Promise<void> {
      await repo.upsertServer({
        serverId, name: serverId, nodeId, mapName: '', desiredState, configRevision: 1, configJson: '{}',
        clusterId: null, operatorUserId: null, managerUserId: null
      });
    }

    /**
     * The checkpoint checksum worked out by hand: sha256 over each path then its bytes, paths in
     * code-point order.
     */
    function checksumOf(files: Array<[string, string]>): string {
      const hash = createHash('sha256');
      for (const [rel, text] of [...files].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
        hash.update(rel);
        hash.update(Buffer.from(text));
      }
      return hash.digest('hex');
    }

    function checkpointCalls(): string[] {
      return [
        ...jest.mocked(peerRequest).mock.calls.map(([options]) => options.url),
        ...jest.mocked(peerUpload).mock.calls.map(([options]) => options.url)
      ].filter(url => url.includes('/v1/checkpoint'));
    }

    /** A destination that stages each streamed file and checksums what it received. */
    function destination(answer?: string): Map<string, string> {
      const uploaded = new Map<string, string>();
      jest.mocked(peerUpload).mockImplementation(async options => {
        uploaded.set(new URL(options.url).searchParams.get('rel') || '', fs.readFileSync(options.file, 'utf8'));
        return { status: 200, body: { ok: true } };
      });
      jest.mocked(peerRequest).mockImplementation(async options => {
        if (options.url.endsWith('/v1/checkpoint/finish')) {
          return { status: 200, body: { checksum: answer ?? checksumOf([...uploaded.entries()]) } };
        }
        return { status: 200, body: { ok: true } };
      });
      return uploaded;
    }

    it('moves a running server off this node: stops it, streams its files, commits, and sets its copy aside', async () => {
      await repo.upsertNode(nodeRow(REMOTE, '2', 'https://10.0.0.2:4747'));
      await place('isle', LOCAL);
      writeInstance('isle');
      states.set('isle', 'running');
      await service.resumeIfJoined();
      await jest.advanceTimersByTimeAsync(5_000);
      const uploaded = destination();

      const result = await service.move('isle', REMOTE, 'ada');
      await jest.advanceTimersByTimeAsync(5_000);

      expect(result).toMatchObject({ success: true });
      expect(localRuntime.stop).toHaveBeenCalledWith('isle');
      expect(checkpointCalls()[0]).toBe('https://10.0.0.2:4747/v1/checkpoint/begin');
      expect(checkpointCalls()).toContain('https://10.0.0.2:4747/v1/checkpoint/finish');
      expect(Object.fromEntries(uploaded)).toEqual({ 'config.json': '{"id":"isle"}', [SAVE]: 'world' });
      expect(await repo.getServer('isle')).toMatchObject({ nodeId: REMOTE, desiredState: 'running' });
      expect(fs.existsSync(path.join(servers, 'isle'))).toBe(false);
      expect(localRuntime.start).not.toHaveBeenCalled();
    });

    it('keeps the server here and starts it again when the destination computes a different checksum', async () => {
      await repo.upsertNode(nodeRow(REMOTE, '2', 'https://10.0.0.2:4747'));
      await place('isle', LOCAL);
      writeInstance('isle');
      states.set('isle', 'running');
      await service.resumeIfJoined();
      destination('not-the-same');

      const result = await service.move('isle', REMOTE, 'ada');

      expect(result.success).toBe(false);
      expect((await repo.getServer('isle'))?.nodeId).toBe(LOCAL);
      expect(fs.existsSync(path.join(servers, 'isle', 'config.json'))).toBe(true);
      expect(localRuntime.start).toHaveBeenCalledWith('isle', expect.any(Function), expect.any(Function));
    });

    it('asks the node hosting a server to run its move', async () => {
      await repo.upsertNode(nodeRow(REMOTE, '2', 'https://10.0.0.2:4747'));
      await repo.upsertNode(nodeRow(THIRD, '3', 'https://10.0.0.3:4747'));
      await place('isle', REMOTE);
      await service.resumeIfJoined();
      jest.mocked(peerRequest).mockResolvedValue({ status: 200, body: { success: true } });

      const result = await service.move('isle', THIRD, 'ada');

      expect(result).toEqual({ success: true });
      const sent = jest.mocked(peerRequest).mock.calls.map(([options]) => options).find(options => options.url.endsWith('/v1/command'))!;
      expect(sent.url).toBe('https://10.0.0.2:4747/v1/command');
      expect(sent.body).toMatchObject({ operation: 'move', serverId: 'isle', destinationNodeId: THIRD, targetNode: REMOTE, actor: 'ada' });
      expect(localRuntime.stop).not.toHaveBeenCalled();
    });

    it('takes in a moved server only once its placement arrives, then starts it', async () => {
      await service.resumeIfJoined();
      await jest.advanceTimersByTimeAsync(5_000);
      const peer = jest.mocked(startPeerServer).mock.calls[0][1];
      const contents: Array<[string, string]> = [['config.json', '{"id":"isle"}'], [SAVE, 'world']];

      await peer.onCheckpointBegin!({ serverId: 'isle' });
      for (const [rel, text] of contents) await peer.onCheckpointFile!('isle', rel, Readable.from(Buffer.from(text)));
      expect(await peer.onCheckpointFinish!({ serverId: 'isle', rels: contents.map(([rel]) => rel) })).toEqual({ checksum: checksumOf(contents) });
      await jest.advanceTimersByTimeAsync(5_000);
      expect(fs.existsSync(path.join(servers, 'isle'))).toBe(false);

      await place('isle', LOCAL); // the source commits the placement
      await jest.advanceTimersByTimeAsync(5_000);

      expect(fs.readFileSync(path.join(servers, 'isle', SAVE), 'utf8')).toBe('world');
      expect(localRuntime.start).toHaveBeenCalledWith('isle', expect.any(Function), expect.any(Function));
    });

    it('clears out the files of a move that was abandoned hours ago', async () => {
      const stale = path.join(root, 'AASMServer', 'ShooterGame', 'Saved', 'MeshIncoming', 'isle');
      fs.mkdirSync(stale, { recursive: true });
      fs.writeFileSync(path.join(stale, 'config.json'), '{}');
      const hoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
      fs.utimesSync(path.join(stale, 'config.json'), hoursAgo, hoursAgo);
      fs.utimesSync(stale, hoursAgo, hoursAgo);

      await service.resumeIfJoined();
      await jest.advanceTimersByTimeAsync(5_000);

      expect(fs.existsSync(stale)).toBe(false);
    });

    it('refuses a destination in maintenance', async () => {
      await repo.upsertNode({ ...nodeRow(REMOTE, '2', 'https://10.0.0.2:4747'), maintenance: true, status: 'maintenance' });
      await place('isle', LOCAL);
      writeInstance('isle');
      await service.resumeIfJoined();

      const result = await service.move('isle', REMOTE, 'ada');

      expect(result.success).toBe(false);
      expect(checkpointCalls()).toEqual([]);
    });
  });

  describe('nodes on an older version', () => {
    const OLD = '44444444-4444-4444-8444-444444444444';

    function commandCalls() {
      return jest.mocked(peerRequest).mock.calls.map(([options]) => options).filter(options => options.url.endsWith('/v1/command'));
    }

    async function placeOn(serverId: string, nodeId: string): Promise<void> {
      await repo.upsertServer({
        serverId, name: serverId, nodeId, mapName: '', desiredState: 'stopped', configRevision: 1, configJson: '{}',
        clusterId: null, operatorUserId: null, managerUserId: null
      });
    }

    beforeEach(async () => {
      await repo.upsertNode({ ...nodeRow(OLD, '4', 'https://10.0.0.4:4747'), name: 'Old box', protocolVersion: 1 });
      jest.mocked(peerRequest).mockResolvedValue({ status: 200, body: { success: true } });
    });

    it('asks for an update instead of sending a command the node cannot run', async () => {
      await placeOn('s4', OLD);
      await service.resumeIfJoined();

      const result = await service.forwardIfRemote('delete', 's4', 'ada');

      expect(result?.success).toBe(false);
      expect(result?.error).toMatch(/Old box/);
      expect(result?.error).toMatch(/update/i);
      expect(commandCalls()).toEqual([]);
    });

    it('still sends start and stop to it', async () => {
      await placeOn('s4', OLD);
      await service.resumeIfJoined();

      await service.forwardIfRemote('start', 's4', 'ada');

      expect(commandCalls().map(call => (call.body as { operation: string }).operation)).toEqual(['start']);
    });

    it('will not move a server onto it', async () => {
      await placeOn('isle', LOCAL);
      await service.resumeIfJoined();

      const result = await service.move('isle', OLD, 'ada');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/update/i);
      expect(localRuntime.stop).not.toHaveBeenCalled();
    });

    it('records its own protocol version and fresh capabilities when it announces', async () => {
      await repo.upsertNode({
        ...nodeRow(LOCAL), protocolVersion: 1,
        capabilities: { platform: 'linux', docker: false, proton: false, installPresent: false, freeMemoryBytes: 0, freeDiskBytes: 0, cpuPercent: 0 }
      });
      await service.resumeIfJoined();
      await jest.advanceTimersByTimeAsync(5_000);

      const self = await repo.getNode(LOCAL);
      expect(self?.protocolVersion).toBe(PROTOCOL_VERSION);
      expect(self?.capabilities.freeMemoryBytes).toBe(8 * 1024 ** 3);
    });
  });

  describe('config saves', () => {
    const REMOTE = '22222222-2222-4222-8222-222222222222';
    let servers: string;

    beforeEach(async () => {
      servers = path.join(root, 'AASMServer', 'ShooterGame', 'Saved', 'Servers');
      await repo.upsertNode({
        ...nodeRow(REMOTE, '2', 'https://10.0.0.2:4747'),
        capabilities: { platform: 'linux', docker: false, proton: true, installPresent: true, freeMemoryBytes: 64 * 1024 ** 3, freeDiskBytes: 0, cpuPercent: 0 }
      });
      jest.mocked(peerRequest).mockImplementation(async options => {
        const body = options.body as { operation?: string; instance?: Record<string, unknown> } | undefined;
        if (body?.operation === 'save-config') {
          return { status: 200, body: { success: true, detail: { instance: { ...body.instance, configRevision: 2 } } } };
        }
        return { status: 200, body: { ok: true } };
      });
    });

    async function place(serverId: string, nodeId: string, configRevision = 1): Promise<void> {
      await repo.upsertServer({
        serverId, name: serverId, nodeId, mapName: '', desiredState: 'stopped', configRevision, configJson: '{}',
        clusterId: null, operatorUserId: null, managerUserId: null
      });
    }

    function sentSaves() {
      return jest.mocked(peerRequest).mock.calls.map(([options]) => options)
        .filter(options => (options.body as { operation?: string })?.operation === 'save-config');
    }

    function partition(): Promise<void> {
      view.hasQuorum = false;
      view.leaderNodeId = null;
      return jest.advanceTimersByTimeAsync(5_000);
    }

    function heal(): Promise<void> {
      view.hasQuorum = true;
      view.leaderNodeId = LOCAL;
      return jest.advanceTimersByTimeAsync(5_000);
    }

    it('saves a server hosted on another node there and keeps no copy here', async () => {
      await place('isle', REMOTE);
      await service.resumeIfJoined();

      const result = await service.saveElsewhere({ id: 'isle', name: 'Renamed', configRevision: 1, nodeId: REMOTE }, 'ada');

      expect(result).toMatchObject({ success: true, instance: { id: 'isle', name: 'Renamed', configRevision: 2, nodeId: REMOTE } });
      expect(sentSaves()).toHaveLength(1);
      expect(sentSaves()[0].url).toBe('https://10.0.0.2:4747/v1/command');
      expect(sentSaves()[0].body).toMatchObject({ targetNode: REMOTE, serverId: 'isle', actor: 'ada', instance: { id: 'isle', name: 'Renamed' } });
      expect((sentSaves()[0].body as { instance: Record<string, unknown> }).instance).not.toHaveProperty('nodeId');
      expect(localRuntime.saveInstance).not.toHaveBeenCalled();
    });

    it('creates a new server on the node chosen for it', async () => {
      await service.resumeIfJoined();

      const result = await service.saveElsewhere({ name: 'Fresh', nodeId: REMOTE }, 'ada');

      expect(result?.success).toBe(true);
      const sent = sentSaves()[0].body as { serverId: string; instance: { id: string; name: string } };
      expect(sent.instance.name).toBe('Fresh');
      expect(sent.instance.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(sent.serverId).toBe(sent.instance.id);
    });

    it('decides where an auto-selected new server goes before anything is saved', async () => {
      await service.resumeIfJoined();
      await jest.advanceTimersByTimeAsync(5_000); // a heartbeat answer marks the other node reachable

      await service.saveElsewhere({ name: 'Fresh' }, 'ada');

      expect(sentSaves()).toHaveLength(1);
      expect(sentSaves()[0].body).toMatchObject({ targetNode: REMOTE });
    });

    it('leaves a server hosted here to be saved here', async () => {
      await place('isle', LOCAL);
      await service.resumeIfJoined();

      expect(await service.saveElsewhere({ id: 'isle', name: 'Renamed', nodeId: REMOTE }, 'ada')).toBeNull();
      expect(sentSaves()).toEqual([]);
    });

    it('will not create a server on another node during a partition', async () => {
      await service.resumeIfJoined();
      await partition();

      const result = await service.saveElsewhere({ name: 'Fresh', nodeId: REMOTE }, 'ada');

      expect(result?.success).toBe(false);
      expect(sentSaves()).toEqual([]);
    });

    it('saves the config on the host when a save-config command arrives, and records it as hosted here', async () => {
      await place('isle', LOCAL, 4);
      await service.resumeIfJoined();
      jest.mocked(localRuntime.saveInstance).mockImplementation(async instance => ({
        success: true, instance: { ...instance, configRevision: 5 } as never
      }));

      const result = await service.executeLocalCommand({
        commandId: 'save-1', correlationId: 'c', actor: 'ada', targetNode: LOCAL, operation: 'save-config', serverId: 'isle',
        instance: { id: 'isle', name: 'Renamed', configRevision: 4 }, expiry: Date.now() + 60_000, issuedAt: Date.now(), expectedRevision: 4
      });

      expect(result).toMatchObject({ success: true, detail: { instance: { id: 'isle', name: 'Renamed', configRevision: 5 } } });
      expect(await repo.getServer('isle')).toMatchObject({ nodeId: LOCAL, name: 'Renamed', configRevision: 5 });
    });

    it('keeps a config saved here during a partition and records it once quorum returns', async () => {
      await place('isle', LOCAL);
      await service.resumeIfJoined();
      await partition();

      await service.recordServer({ id: 'isle', name: 'Renamed', configRevision: 2 });
      expect((await repo.getServer('isle'))?.configRevision).toBe(1);

      jest.mocked(localRuntime.getInstance).mockResolvedValue({ instance: { id: 'isle', name: 'Renamed', configRevision: 2 } } as never);
      await heal();
      expect(await repo.getServer('isle')).toMatchObject({ name: 'Renamed', configRevision: 2, nodeId: LOCAL });
    });

    it('records a server created here during a partition once quorum returns', async () => {
      await service.resumeIfJoined();
      await partition();

      await service.recordServer({ id: 'fresh', name: 'Fresh', configRevision: 1 });

      jest.mocked(localRuntime.getInstance).mockResolvedValue({ instance: { id: 'fresh', name: 'Fresh', configRevision: 1 } } as never);
      await heal();
      expect((await repo.getServer('fresh'))?.nodeId).toBe(LOCAL);
    });

    it('never changes which node hosts a server through a config save', async () => {
      await place('isle', LOCAL);
      await service.resumeIfJoined();

      await service.recordServer({ id: 'isle', name: 'Renamed', configRevision: 2, nodeId: REMOTE });

      expect((await repo.getServer('isle'))?.nodeId).toBe(LOCAL);
    });

    it('sets aside a copy of a server another node hosts', async () => {
      await place('isle', REMOTE);
      fs.mkdirSync(path.join(servers, 'isle'), { recursive: true });
      fs.writeFileSync(path.join(servers, 'isle', 'config.json'), '{}');
      jest.mocked(localRuntime.listInstances).mockResolvedValue({ instances: [{ id: 'isle' }] } as never);

      await service.resumeIfJoined();
      await jest.advanceTimersByTimeAsync(5_000);

      expect(fs.existsSync(path.join(servers, 'isle'))).toBe(false);
      expect(fs.readdirSync(path.join(root, 'AASMServer', 'ShooterGame', 'Saved', 'MeshMoved'))).toHaveLength(1);
    });

    it('keeps the copy of a server whose node has left the mesh', async () => {
      await repo.upsertNode({ ...nodeRow(REMOTE, '2', 'https://10.0.0.2:4747'), status: 'removed' });
      await place('isle', REMOTE);
      fs.mkdirSync(path.join(servers, 'isle'), { recursive: true });
      fs.writeFileSync(path.join(servers, 'isle', 'config.json'), '{}');
      jest.mocked(localRuntime.listInstances).mockResolvedValue({ instances: [{ id: 'isle' }] } as never);

      await service.resumeIfJoined();
      await jest.advanceTimersByTimeAsync(5_000);

      expect(fs.existsSync(path.join(servers, 'isle', 'config.json'))).toBe(true);
    });
  });

  describe('start all and stop all', () => {
    const REMOTE = '22222222-2222-4222-8222-222222222222';
    const GONE = '88888888-8888-4888-8888-888888888888';

    async function place(serverId: string, nodeId: string): Promise<void> {
      await repo.upsertServer({
        serverId, name: serverId, nodeId, mapName: '', desiredState: 'stopped', configRevision: 1, configJson: '{}',
        clusterId: null, operatorUserId: null, managerUserId: null
      });
    }

    function commands() {
      return jest.mocked(peerRequest).mock.calls.map(([options]) => options).filter(options => options.url.endsWith('/v1/command'));
    }

    beforeEach(async () => {
      await repo.upsertNode(nodeRow(REMOTE, '2', 'https://10.0.0.2:4747'));
      await repo.upsertNode({ ...nodeRow(GONE, '8', 'https://10.0.0.8:4747'), status: 'removed' });
      jest.mocked(peerRequest).mockResolvedValue({ status: 200, body: { success: true } });
    });

    it('splits servers by the node that hosts them', async () => {
      await place('here', LOCAL);
      await place('there', REMOTE);
      await place('orphan', GONE);
      await service.resumeIfJoined();

      const hosts = await service.hostsOf(['here', 'there', 'orphan', 'unknown']);

      expect(hosts.local).toEqual(['here', 'unknown']);
      expect([...hosts.remote.entries()]).toEqual([[REMOTE, ['there']]]);
    });

    it('sends each other node one command for its servers', async () => {
      await service.resumeIfJoined();

      const results = await service.commandHosts('start-all', new Map([[REMOTE, ['b', 'd']]]), 'ada');

      expect(results).toEqual([{ nodeId: REMOTE, nodeName: nodeRow(REMOTE).name, result: { success: true } }]);
      expect(commands()).toHaveLength(1);
      expect(commands()[0].url).toBe('https://10.0.0.2:4747/v1/command');
      expect(commands()[0].body).toMatchObject({ operation: 'start-all', serverIds: ['b', 'd'], targetNode: REMOTE, actor: 'ada' });
    });

    it('sends nothing to other nodes during a partition', async () => {
      await service.resumeIfJoined();
      view.hasQuorum = false;
      view.leaderNodeId = null;
      await jest.advanceTimersByTimeAsync(5_000);

      const results = await service.commandHosts('stop-all', new Map([[REMOTE, ['b']]]), 'ada');

      expect(results[0].result.success).toBe(false);
      expect(commands()).toEqual([]);
    });

    it('starts the listed servers on the host and records the ones that started', async () => {
      await place('a', LOCAL);
      await place('b', LOCAL);
      await service.resumeIfJoined();
      jest.mocked(localRuntime.startAll).mockResolvedValue({ started: ['a'], failed: ['b'] });

      const result = await service.executeLocalCommand({
        commandId: 'all-1', correlationId: 'c', actor: 'ada', targetNode: LOCAL, operation: 'start-all', serverId: LOCAL,
        serverIds: ['a', 'b'], expiry: Date.now() + 60_000, issuedAt: Date.now(), expectedRevision: null
      });

      expect(localRuntime.startAll).toHaveBeenCalledWith(['a', 'b']);
      expect(result).toMatchObject({ success: false, detail: { started: ['a'], failed: ['b'] } });
      expect((await repo.getServer('a'))?.desiredState).toBe('running');
      expect((await repo.getServer('b'))?.desiredState).toBe('stopped');
    });

    it('stops the listed servers on the host and records the ones that stopped', async () => {
      await place('a', LOCAL);
      await repo.setDesiredState('a', LOCAL, 'running');
      await service.resumeIfJoined();
      jest.mocked(localRuntime.stopAll).mockResolvedValue({ stopped: ['a'], failed: [] });

      const result = await service.executeLocalCommand({
        commandId: 'all-2', correlationId: 'c', actor: 'ada', targetNode: LOCAL, operation: 'stop-all', serverId: LOCAL,
        serverIds: ['a'], expiry: Date.now() + 60_000, issuedAt: Date.now(), expectedRevision: null
      });

      expect(result.success).toBe(true);
      expect((await repo.getServer('a'))?.desiredState).toBe('stopped');
    });
  });

  describe('servers on other nodes', () => {
    const REMOTE = '22222222-2222-4222-8222-222222222222';

    async function place(serverId: string, nodeId: string): Promise<void> {
      await repo.upsertServer({
        serverId, name: serverId, nodeId, mapName: '', desiredState: 'running', configRevision: 1, configJson: '{}',
        clusterId: null, operatorUserId: 'op1', managerUserId: null
      });
    }

    function command(operation: 'rcon' | 'save-ini' | 'set-ownership' | 'connect-rcon', args: Record<string, unknown>) {
      return {
        commandId: `cmd-${operation}`, correlationId: 'c', actor: 'ada', targetNode: LOCAL, operation, serverId: 'isle', args,
        expiry: Date.now() + 60_000, issuedAt: Date.now(), expectedRevision: null
      };
    }

    beforeEach(async () => {
      await repo.upsertNode(nodeRow(REMOTE, '2', 'https://10.0.0.2:4747'));
    });

    it('asks the hosting node for what a remote server is doing', async () => {
      await place('isle', REMOTE);
      await service.resumeIfJoined();
      jest.mocked(peerRequest).mockImplementation(async options => (
        options.url.endsWith('/v1/query') ? { status: 200, body: { log: 'Server started', instanceId: 'isle' } } : { status: 200, body: {} }
      ));

      const answer = await service.queryRemote('isle', 'logs', { maxLines: 200 });

      expect(answer).toEqual({ log: 'Server started', instanceId: 'isle' });
      const sent = jest.mocked(peerRequest).mock.calls.map(([options]) => options).find(options => options.url.endsWith('/v1/query'))!;
      expect(sent.url).toBe('https://10.0.0.2:4747/v1/query');
      expect(sent.body).toEqual({ serverId: 'isle', query: 'logs', args: { maxLines: 200 } });
    });

    it('leaves a server hosted here to be answered here', async () => {
      await place('isle', LOCAL);
      await service.resumeIfJoined();

      expect(await service.queryRemote('isle', 'state')).toBeNull();
    });

    it('fails with a reason when the hosting node does not answer', async () => {
      await place('isle', REMOTE);
      await service.resumeIfJoined();
      jest.mocked(peerRequest).mockRejectedValue(new Error('connect ECONNREFUSED'));

      await expect(service.queryRemote('isle', 'state')).rejects.toThrow(/ECONNREFUSED/);
    });

    it('answers queries only about servers it hosts', async () => {
      await place('isle', LOCAL);
      await place('far', REMOTE);
      jest.mocked(localRuntime.state).mockReturnValue('running');
      await service.resumeIfJoined();
      const peer = jest.mocked(startPeerServer).mock.calls[0][1];

      expect(await peer.onQuery!({ serverId: 'isle', query: 'state', args: {} })).toEqual({ state: 'running', instanceId: 'isle' });
      await expect(peer.onQuery!({ serverId: 'far', query: 'state', args: {} })).rejects.toThrow(/not hosted/);
    });

    it('sends an RCON command for a remote server to its host', async () => {
      await place('isle', REMOTE);
      await service.resumeIfJoined();
      jest.mocked(peerRequest).mockResolvedValue({ status: 200, body: { success: true, detail: { response: 'No Players Connected' } } });

      const result = await service.forwardIfRemote('rcon', 'isle', 'ada', { command: 'ListPlayers' });

      expect(result).toEqual({ success: true, detail: { response: 'No Players Connected' } });
      const sent = jest.mocked(peerRequest).mock.calls.map(([options]) => options).find(options => options.url.endsWith('/v1/command'))!;
      expect(sent.body).toMatchObject({ operation: 'rcon', serverId: 'isle', targetNode: REMOTE, args: { command: 'ListPlayers' } });
    });

    it('runs an RCON command on the host and returns the answer', async () => {
      await place('isle', LOCAL);
      await service.resumeIfJoined();
      jest.mocked(localRuntime.rcon).mockResolvedValue({ instanceId: 'isle', response: 'No Players Connected' } as never);

      const result = await service.executeLocalCommand(command('rcon', { command: 'ListPlayers' }));

      expect(localRuntime.rcon).toHaveBeenCalledWith('isle', 'ListPlayers');
      expect(result).toEqual({ success: true, detail: { response: 'No Players Connected' } });
    });

    it('saves an INI file on the host and records the merged config', async () => {
      await place('isle', LOCAL);
      await service.resumeIfJoined();
      jest.mocked(localRuntime.saveIni).mockResolvedValue({ id: 'isle', name: 'isle', configRevision: 3 } as never);

      const result = await service.executeLocalCommand(command('save-ini', { filename: 'Game.ini', content: '[x]' }));

      expect(localRuntime.saveIni).toHaveBeenCalledWith('isle', 'Game.ini', '[x]');
      expect(result).toMatchObject({ success: true, detail: { instance: { id: 'isle', configRevision: 3 } } });
      expect((await repo.getServer('isle'))?.configRevision).toBe(3);
    });

    it('changes only the ownership of a server on the host', async () => {
      await place('isle', LOCAL);
      await service.resumeIfJoined();
      jest.mocked(localRuntime.patchConfig).mockResolvedValue({ instance: { id: 'isle', name: 'isle', operatorUserId: 'op2', managerUserId: null, configRevision: 2 } as never });

      const result = await service.executeLocalCommand(command('set-ownership', { operatorUserId: 'op2', managerUserId: null, name: 'renamed' }));

      expect(localRuntime.patchConfig).toHaveBeenCalledWith('isle', { operatorUserId: 'op2', managerUserId: null });
      expect(result.success).toBe(true);
      expect((await repo.getServer('isle'))?.operatorUserId).toBe('op2');
    });

    it('connects RCON on the host and announces it', async () => {
      await place('isle', LOCAL);
      await service.resumeIfJoined();
      jest.mocked(localRuntime.connectRcon).mockResolvedValue({ success: true, connected: true, instanceId: 'isle' } as never);

      const result = await service.executeLocalCommand(command('connect-rcon', {}));

      expect(result).toEqual({ success: true, detail: { connected: true } });
      expect(localRuntime.announceRcon).toHaveBeenCalledWith('isle', true);
    });

    it('refuses a command about a server another node hosts', async () => {
      await place('isle', REMOTE);
      await service.resumeIfJoined();

      const result = await service.executeLocalCommand(command('rcon', { command: 'DoExit' }));

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not hosted/);
      expect(localRuntime.rcon).not.toHaveBeenCalled();
    });
  });

  describe('live events', () => {
    const REMOTE = '22222222-2222-4222-8222-222222222222';
    let subscriptions: Array<{ url: string; onEvent(event: unknown): void; onClose?(code: number): void; close: jest.Mock }>;

    async function place(serverId: string, nodeId: string): Promise<void> {
      await repo.upsertServer({
        serverId, name: serverId, nodeId, mapName: '', desiredState: 'stopped', configRevision: 1, configJson: '{}',
        clusterId: null, operatorUserId: null, managerUserId: null
      });
    }

    async function peerBroadcast(): Promise<jest.Mock> {
      return (await jest.mocked(startPeerServer).mock.results[0].value as { broadcast: jest.Mock }).broadcast;
    }

    beforeEach(async () => {
      subscriptions = [];
      jest.mocked(subscribeEvents).mockImplementation(options => {
        const subscription = { ...options, close: jest.fn() };
        subscriptions.push(subscription);
        return subscription;
      });
      await repo.upsertNode(nodeRow(REMOTE, '2', 'https://10.0.0.2:4747'));
      await place('isle', LOCAL);
      await place('far', REMOTE);
      await service.resumeIfJoined();
      await jest.advanceTimersByTimeAsync(5_000);
    });

    it('relays the live events of a server it hosts to the other nodes', async () => {
      messagingService.broadcastTap!('server-instance-log', { instanceId: 'isle', log: 'Server started' });

      expect(await peerBroadcast()).toHaveBeenCalledWith({
        type: 'server-event', nodeId: LOCAL, channel: 'server-instance-log', data: { instanceId: 'isle', log: 'Server started' }
      });
    });

    it('keeps other broadcasts, and events of servers it does not host, to itself', async () => {
      messagingService.broadcastTap!('server-instances', [{ id: 'isle' }]);
      messagingService.broadcastTap!('server-instance-log', { instanceId: 'far', log: 'not mine' });

      expect((await peerBroadcast()).mock.calls.filter(([frame]) => frame.type === 'server-event')).toEqual([]);
    });

    it('subscribes to each other node and shows its servers\' live events here', async () => {
      expect(subscriptions.map(subscription => subscription.url)).toEqual(['wss://10.0.0.2:4747/v1/events']);

      subscriptions[0].onEvent({ type: 'server-event', nodeId: REMOTE, channel: 'server-instance-state', data: { instanceId: 'far', state: 'running' } });

      expect(messagingService.sendToAll).toHaveBeenCalledWith('server-instance-state', { instanceId: 'far', state: 'running' });
    });

    it('ignores what a node sends about a server it does not host', async () => {
      jest.mocked(messagingService.sendToAll).mockClear();

      subscriptions[0].onEvent({ type: 'server-event', nodeId: REMOTE, channel: 'server-instance-state', data: { instanceId: 'isle', state: 'stopped' } });
      subscriptions[0].onEvent({ type: 'server-event', nodeId: LOCAL, channel: 'server-instance-state', data: { instanceId: 'isle', state: 'stopped' } });
      subscriptions[0].onEvent({ type: 'server-event', nodeId: REMOTE, channel: 'notification', data: { instanceId: 'far', message: 'x' } });

      expect(messagingService.sendToAll).not.toHaveBeenCalled();
    });

    it('greets a node that subscribes with the state of each server it hosts', async () => {
      jest.mocked(localRuntime.state).mockImplementation(id => (id === 'isle' ? 'running' : 'stopped'));
      const peer = jest.mocked(startPeerServer).mock.calls[0][1];

      expect(peer.onSubscribe!()).toEqual([
        { type: 'server-event', nodeId: LOCAL, channel: 'server-instance-state', data: { instanceId: 'isle', state: 'running' } }
      ]);
    });

    it('lists a remote server with the state its host last reported', async () => {
      subscriptions[0].onEvent({ type: 'server-event', nodeId: REMOTE, channel: 'server-instance-state', data: { instanceId: 'far', state: 'running' } });

      const listed = await service.withMeshServers([]);

      expect(listed.find(instance => instance.id === 'far')?.state).toBe('running');
    });

    it('goes back to the stored state once it stops hearing from that node', async () => {
      subscriptions[0].onEvent({ type: 'server-event', nodeId: REMOTE, channel: 'server-instance-state', data: { instanceId: 'far', state: 'running' } });

      subscriptions[0].onClose?.(1006);

      expect((await service.withMeshServers([])).find(instance => instance.id === 'far')?.state).toBe('stopped');
    });

    it('subscribes again after the connection drops, and closes it when the mesh stops', async () => {
      subscriptions[0].onClose?.(1006);
      await jest.advanceTimersByTimeAsync(5_000);
      expect(subscriptions).toHaveLength(2);

      await service.stop();

      expect(subscriptions[1].close).toHaveBeenCalled();
      expect(messagingService.broadcastTap).toBeNull();
    });
  });

  describe('configs changed here', () => {
    const REMOTE = '22222222-2222-4222-8222-222222222222';

    async function place(serverId: string, nodeId: string): Promise<void> {
      await repo.upsertServer({
        serverId, name: serverId, nodeId, mapName: '', desiredState: 'stopped', configRevision: 1, configJson: '{}',
        clusterId: null, operatorUserId: null, managerUserId: null
      });
    }

    it('records a newer config of a server hosted here, whatever saved it', async () => {
      await place('isle', LOCAL);
      jest.mocked(localRuntime.listInstances).mockResolvedValue({
        instances: [{ id: 'isle', name: 'Renamed', configRevision: 4, operatorUserId: 'op2' }]
      } as never);

      await service.resumeIfJoined();
      await jest.advanceTimersByTimeAsync(5_000);

      expect(await repo.getServer('isle')).toMatchObject({ name: 'Renamed', configRevision: 4, operatorUserId: 'op2', nodeId: LOCAL });
    });

    it('leaves the record alone when the config here is not newer', async () => {
      await place('isle', LOCAL);
      jest.mocked(localRuntime.listInstances).mockResolvedValue({ instances: [{ id: 'isle', name: 'Stale', configRevision: 1 }] } as never);

      await service.resumeIfJoined();
      await jest.advanceTimersByTimeAsync(5_000);

      expect((await repo.getServer('isle'))?.name).toBe('isle');
    });

    it('never records a copy here of a server another node hosts', async () => {
      await repo.upsertNode(nodeRow(REMOTE, '2', 'https://10.0.0.2:4747'));
      await place('isle', REMOTE);
      jest.mocked(localRuntime.listInstances).mockResolvedValue({ instances: [{ id: 'isle', name: 'Stray', configRevision: 9 }] } as never);

      await service.resumeIfJoined();
      await jest.advanceTimersByTimeAsync(5_000);

      expect(await repo.getServer('isle')).toMatchObject({ nodeId: REMOTE, configRevision: 1 });
    });
  });

  describe('the servers it knows', () => {
    it('shares their placement and pool with the permission gate, and forgets them when it stops', async () => {
      await repo.upsertServer({
        serverId: 'isle', name: 'isle', nodeId: '22222222-2222-4222-8222-222222222222', mapName: '', desiredState: 'stopped',
        configRevision: 1, configJson: '{}', clusterId: null, operatorUserId: 'op1', managerUserId: null
      });
      await service.resumeIfJoined();
      await jest.advanceTimersByTimeAsync(5_000);

      expect(meshServer('isle')).toEqual({
        serverId: 'isle', nodeId: '22222222-2222-4222-8222-222222222222', operatorUserId: 'op1', managerUserId: null
      });

      await service.stop();
      expect(meshServer('isle')).toBeNull();
    });
  });

  describe('auto-select', () => {
    const NEAR = '55555555-5555-4555-8555-555555555555';
    const FAR = '66666666-6666-4666-8666-666666666666';
    const OLD = '77777777-7777-4777-8777-777777777777';

    function roomy(nodeId: string, url: string, gib: number, protocolVersion = PROTOCOL_VERSION): NodeRecord {
      const row = nodeRow(nodeId, '9', url);
      return { ...row, protocolVersion, capabilities: { ...row.capabilities, freeMemoryBytes: gib * 1024 ** 3 } };
    }

    it('only places a new server on a node it can reach and that can take it', async () => {
      await repo.upsertNode(roomy(NEAR, 'https://10.0.0.5:4747', 64));
      await repo.upsertNode(roomy(FAR, 'https://10.0.0.6:4747', 512));
      await repo.upsertNode(roomy(OLD, 'https://10.0.0.7:4747', 512, 1));
      jest.mocked(peerRequest).mockImplementation(async options => {
        if (options.url.startsWith('https://10.0.0.6')) throw new Error('connect ETIMEDOUT');
        return { status: 200, body: { ok: true } };
      });
      await service.resumeIfJoined();
      await jest.advanceTimersByTimeAsync(5_000);

      expect(await service.suggestPlacement()).toBe(NEAR);
    });
  });

  describe('resume after a restart', () => {
    it('rejoins and signs in a known user while it cannot see a leader', async () => {
      await addUser('ada', 'correct horse');
      view.hasQuorum = false;
      view.leaderNodeId = null;

      await service.resumeIfJoined();

      expect(service.isEnabled()).toBe(true);
      expect((await service.verifyLogin('ada', 'correct horse'))?.username).toBe('ada');
      expect((await service.status()).degraded).toBe(true);
    });

    /** A certificate for another address, so resuming has to re-sign it. */
    async function staleCertificate(): Promise<string> {
      const ca = createMeshCa('mesh');
      const keys = generateKeyPair();
      const stale = signNodeCertificate(ca.certPem, ca.keyPem, keys.publicKeyPem, LOCAL, ['10.9.9.9']);
      fs.writeFileSync(path.join(root, 'mesh', 'node.key'), keys.privateKeyPem);
      fs.writeFileSync(path.join(root, 'mesh', 'node.crt'), stale.certPem);
      fs.writeFileSync(path.join(root, 'mesh', 'ca.crt'), ca.certPem);
      await repo.saveMesh({ meshId: 'mesh-1', name: 'Test', schemaVersion: 1, securityEpoch: 1, caCert: ca.certPem, caKey: ca.keyPem, createdAt: 1 });
      await repo.upsertNode(nodeRow(LOCAL, stale.serial));
      return stale.serial;
    }

    it('rejoins while it cannot see a leader even when its certificate has to be re-signed', async () => {
      await staleCertificate();
      view.hasQuorum = false;
      view.leaderNodeId = null;

      await service.resumeIfJoined();

      expect(service.isEnabled()).toBe(true);
      expect(certificateCoversHost(fs.readFileSync(path.join(root, 'mesh', 'node.crt'), 'utf8'), '127.0.0.1')).toBe(true);
    }, 30_000);

    it('records the re-signed certificate serial once quorum returns, so removal revokes it', async () => {
      const staleSerial = await staleCertificate();
      view.hasQuorum = false;
      view.leaderNodeId = null;
      await service.resumeIfJoined();

      view.hasQuorum = true;
      view.leaderNodeId = LOCAL;
      await jest.advanceTimersByTimeAsync(5_000);

      const presented = new X509Certificate(fs.readFileSync(path.join(root, 'mesh', 'node.crt'), 'utf8'))
        .serialNumber.toLowerCase().replace(/^0+/, '');
      expect(presented).not.toBe(staleSerial);
      expect((await repo.getNode(LOCAL))?.certSerial).toBe(presented);
    }, 30_000);

    it('tries again later when its identity file cannot be read yet', async () => {
      const file = path.join(root, 'mesh', 'node.json');
      const whole = fs.readFileSync(file, 'utf8');
      fs.writeFileSync(file, whole.slice(0, 10)); // locked, or caught half-written

      await service.resumeIfJoined();
      expect(service.isEnabled()).toBe(false);

      fs.writeFileSync(file, whole);
      await jest.advanceTimersByTimeAsync(30_000);
      expect(service.isEnabled()).toBe(true);
    });

    it('tries again later when its rqlite credentials cannot be read yet', async () => {
      const file = path.join(root, 'mesh', 'rqlite-auth.json');
      const whole = fs.readFileSync(file, 'utf8');
      fs.writeFileSync(file, '{');

      await service.resumeIfJoined();
      expect(service.isEnabled()).toBe(false);

      fs.writeFileSync(file, whole);
      await jest.advanceTimersByTimeAsync(30_000);
      expect(service.isEnabled()).toBe(true);
    });

    it('does not forget who it is when its identity file is briefly unreadable', async () => {
      await service.resumeIfJoined();
      fs.writeFileSync(path.join(root, 'mesh', 'node.json'), '{');

      expect(service.isEnabled()).toBe(true);
      expect((await service.status()).nodeId).toBe(LOCAL);
    });

    it('stays out of a mesh it was never in', async () => {
      fs.rmSync(path.join(root, 'mesh', 'node.json'));

      await service.resumeIfJoined();
      await jest.advanceTimersByTimeAsync(60_000);

      expect(service.isEnabled()).toBe(false);
      expect(jest.mocked(RqliteSupervisor).mock.results.every(result =>
        jest.mocked((result.value as { start: jest.Mock }).start).mock.calls.length === 0)).toBe(true);
    });

    it('tries again later when rqlited does not start', async () => {
      supervisorFailure = 'rqlited exited before it was ready';
      await service.resumeIfJoined();
      expect(service.isEnabled()).toBe(false);

      supervisorFailure = null;
      await jest.advanceTimersByTimeAsync(30_000);

      expect(service.isEnabled()).toBe(true);
    });

    it('does not try again after the app stops the mesh', async () => {
      supervisorFailure = 'rqlited exited before it was ready';
      await service.resumeIfJoined();
      await service.stop();

      supervisorFailure = null;
      await jest.advanceTimersByTimeAsync(60_000);

      expect(service.isEnabled()).toBe(false);
      expect(jest.mocked(RqliteSupervisor).mock.results.every(result =>
        jest.mocked((result.value as { start: jest.Mock }).start).mock.calls.length <= 1)).toBe(true);
    });
  });
});
