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
import { hashArgon2id, hashToken } from './passwords';
import { meshServer, meshSignInRequired, setMeshMember } from './mesh-hooks';
import { meshDesktopIdentity, setMeshDesktopMode } from '../auth/desktop-session';
import { isServerMoving } from '../../utils/ark/ark-server/ark-server-state.utils';
import { knownClusters, rememberClusters } from '../clusters/cluster-registry';
import { certificateCoversHost, certificateSerial, createMeshCa, generateKeyPair, signNodeCertificate } from './certificates';
import { PROTOCOL_VERSION, type NodeRecord } from '../../types/mesh.types';

jest.mock('../../utils/platform.utils', () => ({
  getDefaultInstallDir: jest.fn(),
  getFreeMemory: jest.fn(() => 8 * 1024 ** 3),
  getPlatform: jest.fn(() => 'linux'),
  isRunningInDocker: jest.fn(() => false)
}));
jest.mock('./rqlite-supervisor', () => ({ RqliteSupervisor: jest.fn(), rqliteProblem: jest.fn(() => null) }));
jest.mock('./rqlite-client', () => ({ RqliteClient: jest.fn() }));
jest.mock('./peer-server', () => ({ startPeerServer: jest.fn(), peerRequest: jest.fn(), peerUpload: jest.fn(), peerDownload: jest.fn(), subscribeEvents: jest.fn(), probeTls: jest.fn() }));
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
    startedAt: jest.fn(),
    appliedRevision: jest.fn(),
    applyConfig: jest.fn(),
    deleteInstance: jest.fn(),
    rcon: jest.fn(),
    takeFreePortsIfNeeded: jest.fn(async () => null)
  }
}));
jest.mock('../server-instance/server-instance.service', () => ({
  serverInstanceService: { broadcastInstances: jest.fn(async () => undefined) },
  setInventoryMerge: jest.fn()
}));
jest.mock('../messaging.service', () => ({ messagingService: { sendToAll: jest.fn(), invalidateWebSessions: jest.fn(), noteForwardedAction: jest.fn() } }));
jest.mock('../auth/user-database.service', () => ({
  userDatabaseService: {
    exportCredentialRows: jest.fn(() => []),
    listRoles: jest.fn(() => []),
    applyMeshAccounts: jest.fn(() => ({ changedUserIds: [], changedRoleIds: [] })),
    snapshotTo: jest.fn(),
    verifyCredentials: jest.fn(async () => null)
  }
}));
jest.mock('../auto-update.service', () => ({ autoUpdateService: { applyAvailableUpdate: jest.fn(), quitAndInstall: jest.fn() } }));
// The reachability probe opens a real connection; the clock arithmetic stays real.
jest.mock('./diagnostics', () => ({ ...jest.requireActual('./diagnostics'), probeTcp: jest.fn(async () => ({ ok: true, rttMs: 1 })) }));
jest.mock('../ark-update.service', () => ({ beginClusterUpdate: jest.fn(), arkUpdateProgress: jest.fn(() => null), arkBuildStatus: jest.fn(() => null) }));
jest.mock('../docker-runtime-update', () => ({ relaunchInPlace: jest.fn() }));
jest.mock('../host-resources', () => ({ sampleHostResources: jest.fn() }));
jest.mock('../../utils/ark/started-config.utils', () => ({ readStartedConfig: jest.fn(() => ({ id: 'isle', maxPlayers: 70 })) }));
jest.mock('../backup/backup.service', () => ({ backupService: { onBackupCreated: jest.fn(() => () => undefined) } }));
jest.mock('../backup/backup-copies.service', () => ({
  backupCopies: {
    hold: jest.fn(async () => ({ success: true })), drop: jest.fn(), heldPath: jest.fn(() => null), recordSent: jest.fn(),
    sent: jest.fn(() => null), list: jest.fn(() => [])
  }
}));
import { backupService } from '../backup/backup.service';
import { backupCopies } from '../backup/backup-copies.service';
import { BackupPathUtils } from '../../utils/backup.utils';
import { registerForwardable, routeToHost } from '../host-routing';
import { meshListenPorts } from './mesh-hooks';
jest.mock('../automation/restart-countdown.service', () => ({
  restartCountdowns: { begin: jest.fn(() => 900_000), cancel: jest.fn(() => true), cancelAll: jest.fn(() => ['a']), pending: jest.fn(() => []) }
}));
import { restartCountdowns } from '../automation/restart-countdown.service';
jest.mock('../ark-api-actions', () => ({
  runArkApiAction: jest.fn(),
  isReadOnlyArkApiAction: jest.fn((action: string) => action === 'status' || action === 'list')
}));

import { getDefaultInstallDir } from '../../utils/platform.utils';
import { RqliteSupervisor, rqliteProblem } from './rqlite-supervisor';
import { RqliteClient } from './rqlite-client';
import { peerDownload, peerRequest, peerUpload, probeTls, startPeerServer, subscribeEvents } from './peer-server';
import { messagingService } from '../messaging.service';
import { localRuntime } from '../runtime/local-runtime';
import { runArkApiAction } from '../ark-api-actions';
import { userDatabaseService } from '../auth/user-database.service';
import { serverInstanceService } from '../server-instance/server-instance.service';
import { sampleHostResources } from '../host-resources';
import { arkUpdateProgress, beginClusterUpdate } from '../ark-update.service';
import { MeshService } from './mesh-service';

const LOCAL = '11111111-1111-4111-8111-111111111111';

/** rqlited as the mesh sees it: strong writes need a leader, `none` reads come from the local copy. */
class FakeRqlite {
  readonly executor: SqliteExecutor;
  /** False for a restarted node whose copy no leader has filled in yet: it has no tables. */
  loaded = true;
  /** The Raft members, at the addresses the cluster holds for them. */
  raftMembers: Array<{ id: string; addr: string; voter: boolean }> = [];
  constructor(db: SqliteHandle, readonly view: ExecutorStatus) {
    this.executor = new SqliteExecutor(db, view);
  }
  exec(sql: string, params?: unknown[], consistency?: 'strong' | 'none') {
    if (!this.loaded) return Promise.reject(new Error('no such table: nodes'));
    return this.executor.exec(sql, params, consistency);
  }
  query<T extends Record<string, unknown>>(sql: string, params?: unknown[], consistency?: 'strong' | 'none') {
    if (!this.loaded) return /sqlite_master/.test(sql) ? Promise.resolve([] as T[]) : Promise.reject(new Error('no such table: nodes'));
    return this.executor.query<T>(sql, params, consistency);
  }
  status() { return this.executor.status(); }
  /** False while a restarted node is still applying what the others agreed: its reads can be old. */
  synced = true;
  async caughtUp() { return this.synced; }
  async ready(options: { requireLeader?: boolean } = {}) { return this.view.hasQuorum || options.requireLeader === false; }
  removed: string[] = [];
  async removeMember(nodeId: string) { this.removed.push(nodeId); this.raftMembers = this.raftMembers.filter(member => member.id !== nodeId); }
  async members() { return this.raftMembers.map(member => ({ ...member })); }
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
    jest.mocked(startPeerServer).mockResolvedValue({ close: (done?: () => void) => done?.(), broadcast: jest.fn(), useCertificate: jest.fn() } as never);
    jest.mocked(localRuntime.listInstances).mockResolvedValue({ instances: [] });
    jest.mocked(localRuntime.state).mockReturnValue('stopped');
    jest.mocked(localRuntime.appliedRevision).mockReturnValue(1);
    jest.mocked(sampleHostResources).mockResolvedValue({ cpuPercent: 0, memory: { used: 1, total: 2 }, disk: null });

    service = new MeshService();
  });

  afterEach(async () => {
    await service.stop();
    // clearMocks keeps a return value; a machine's accounts must not leak into the next test.
    jest.mocked(userDatabaseService.exportCredentialRows).mockReturnValue([]);
    setMeshMember(false);
    setMeshDesktopMode(false);
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

  describe('mesh accounts', () => {
    const verifier = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';

    async function meshUser(overrides: Partial<Parameters<MeshRepository['upsertUser']>[0]> = {}): Promise<void> {
      await repo.upsertUser({
        userId: 'u1', username: 'ada', displayName: 'Ada', passwordHash: verifier, passwordParameters: 'argon2id', hashAlg: 'argon2id',
        enabled: true, securityVersion: 3, roleId: 'moderators', ownerUserId: null, createdAt: 1, updatedAt: 2, ...overrides
      });
    }

    function localRow(overrides: Partial<ReturnType<typeof userDatabaseService.exportCredentialRows>[number]> = {}) {
      return {
        id: 'u1', username: 'ada', displayName: 'Ada', passwordHash: verifier, roleId: 'moderators', active: true, ownerUserId: null,
        cliLocked: false, machineNodeId: null, updatesAnyMachine: false, ...overrides
      };
    }

    describe('a machine admin', () => {
      it('signs in with the machine it looks after, and cannot add machines', async () => {
        const password = await hashArgon2id('correct horse');
        await meshUser({ roleId: 'machine-admin', passwordHash: password.hash });
        await repo.setMachineAdmin('u1', 'n7', false);
        await service.resumeIfJoined();

        const user = await service.verifyLogin('ada', 'correct horse');

        expect(user).toMatchObject({ roleId: 'machine-admin', machineNodeId: 'n7', updatesAnyMachine: false });
        expect(user!.permissions).toEqual(expect.arrayContaining(['servers.move', 'app.install']));
        expect(user!.permissions).not.toContain('nodes.enroll');
      });

      it('is mirrored with its machine', async () => {
        await meshUser({ roleId: 'machine-admin' });
        await repo.setMachineAdmin('u1', 'n7', true);

        await service.resumeIfJoined();
        await jest.advanceTimersByTimeAsync(5_000);

        expect(jest.mocked(userDatabaseService.applyMeshAccounts).mock.calls[0][0].users)
          .toEqual([expect.objectContaining({ userId: 'u1', machineNodeId: 'n7', updatesAnyMachine: true })]);
      });

      it('keeps its machine in the mesh as it changes, and signs it out when that changes', async () => {
        await meshUser();
        await service.resumeIfJoined();

        jest.mocked(userDatabaseService.exportCredentialRows).mockReturnValue([localRow({ roleId: 'machine-admin', machineNodeId: 'n2' })]);
        await service.syncUser('u1');
        expect(await repo.listMachineAdmins()).toEqual([{ userId: 'u1', nodeId: 'n2', updatesAny: false }]);
        const version = (await repo.getUser('u1'))!.securityVersion;

        jest.mocked(userDatabaseService.exportCredentialRows).mockReturnValue([localRow({ roleId: 'machine-admin', machineNodeId: 'n2', updatesAnyMachine: true })]);
        await service.syncUser('u1');
        expect(await repo.listMachineAdmins()).toEqual([{ userId: 'u1', nodeId: 'n2', updatesAny: true }]);
        expect((await repo.getUser('u1'))!.securityVersion).toBe(version + 1);

        jest.mocked(userDatabaseService.exportCredentialRows).mockReturnValue([localRow({ roleId: 'viewer' })]);
        await service.syncUser('u1');
        expect(await repo.listMachineAdmins()).toEqual([]);
      });

      it('leaves with its account', async () => {
        await meshUser({ roleId: 'machine-admin' });
        await repo.setMachineAdmin('u1', 'n7', false);
        await service.resumeIfJoined();

        await service.forgetUser('u1');

        expect(await repo.listMachineAdmins()).toEqual([]);
      });
    });

    // A member that joined before machine admins existed: its own login stopped working, or (where
    // it was the command line's or the web login) worked as an admin of every machine.
    describe('carried over from a machine already in the mesh', () => {
      const cliHash = '$2b$12$' + 'c'.repeat(53);

      async function machineAdmins() {
        const scopes = await repo.listMachineAdmins();
        return Promise.all(scopes.map(async scope => ({ ...scope, user: await repo.getUser(scope.userId) })));
      }

      it('makes its admin password a machine admin for it, once', async () => {
        jest.mocked(userDatabaseService.exportCredentialRows).mockReturnValue([
          localRow({ id: 'mirror', username: 'admin', roleId: 'admin', passwordHash: verifier }),
          localRow({ id: 'cli', username: 'root', roleId: 'admin', passwordHash: cliHash, cliLocked: true })
        ]);
        await repo.upsertNode(nodeRow(LOCAL));

        await service.resumeIfJoined();
        await jest.advanceTimersByTimeAsync(5_000);
        await jest.advanceTimersByTimeAsync(5_000);

        const made = await machineAdmins();
        expect(made).toEqual([expect.objectContaining({ nodeId: LOCAL, updatesAny: false })]);
        expect(made[0].user).toMatchObject({ roleId: 'machine-admin', passwordHash: cliHash, hashAlg: 'bcrypt' });
        expect(made[0].user!.username).toMatch(/^admin2-/);
      });

      it('does not bring it back once a mesh admin has deleted it', async () => {
        jest.mocked(userDatabaseService.exportCredentialRows).mockReturnValue([
          localRow({ id: 'cli', username: 'root', roleId: 'admin', passwordHash: cliHash, cliLocked: true })
        ]);
        await service.resumeIfJoined();
        await jest.advanceTimersByTimeAsync(5_000);
        const [made] = await repo.listMachineAdmins();

        await service.forgetUser(made.userId);
        await jest.advanceTimersByTimeAsync(10_000);

        expect(await repo.listMachineAdmins()).toEqual([]);
      });

      it('takes the web login when that is all it had', async () => {
        fs.mkdirSync(path.join(root, 'data'), { recursive: true });
        fs.writeFileSync(path.join(root, 'data', 'auth-config.json'), JSON.stringify({ enabled: true, username: 'web', passwordHash: cliHash }));
        await repo.upsertNode(nodeRow(LOCAL));

        await service.resumeIfJoined();
        await jest.advanceTimersByTimeAsync(5_000);

        expect((await machineAdmins())[0]?.user).toMatchObject({ passwordHash: cliHash });
      });

      it('adds nothing for a password the mesh already has', async () => {
        jest.mocked(userDatabaseService.exportCredentialRows).mockReturnValue([
          localRow({ id: 'cli', username: 'root', roleId: 'admin', passwordHash: verifier, cliLocked: true })
        ]);
        await meshUser({ roleId: 'admin', passwordHash: verifier });

        await service.resumeIfJoined();
        await jest.advanceTimersByTimeAsync(5_000);

        expect(await repo.listMachineAdmins()).toEqual([]);
        expect(await repo.listUsers()).toHaveLength(1);
      });

      it('waits for quorum, then carries it', async () => {
        jest.mocked(userDatabaseService.exportCredentialRows).mockReturnValue([
          localRow({ id: 'cli', username: 'root', roleId: 'admin', passwordHash: cliHash, cliLocked: true })
        ]);
        view.hasQuorum = false;
        view.leader = false;
        await service.resumeIfJoined();
        await jest.advanceTimersByTimeAsync(5_000);
        expect(await repo.listMachineAdmins()).toEqual([]);

        view.hasQuorum = true;
        view.leader = true;
        await jest.advanceTimersByTimeAsync(5_000);

        expect(await repo.listMachineAdmins()).toHaveLength(1);
      });
    });

    it('mirrors the mesh\'s accounts and roles into this machine\'s account database', async () => {
      await repo.upsertRole({ roleId: 'moderators', name: 'Moderators', permissions: ['servers.view'], securityVersion: 1 });
      await meshUser();
      jest.mocked(userDatabaseService.applyMeshAccounts).mockReturnValue({ changedUserIds: ['u1'], changedRoleIds: [] });

      await service.resumeIfJoined();
      await jest.advanceTimersByTimeAsync(5_000);

      expect(userDatabaseService.applyMeshAccounts).toHaveBeenCalledWith({
        users: [{
          userId: 'u1', username: 'ada', displayName: 'Ada', passwordHash: verifier, enabled: true, roleId: 'moderators', ownerUserId: null,
          createdAt: 1, updatedAt: 2, machineNodeId: null, updatesAnyMachine: false
        }],
        roles: [{ roleId: 'moderators', name: 'Moderators', permissions: ['servers.view'] }]
      });
      expect(messagingService.invalidateWebSessions).toHaveBeenCalledWith({ userId: 'u1', roleId: undefined });
      expect(messagingService.sendToAll).toHaveBeenCalledWith('users-changed', { userId: 'u1', roleId: undefined });
    });

    // The first sign-in stored the password better (bcrypt to Argon2id), and the account sync took
    // that for a new password: the session that had just signed in was ended.
    it('ends no session over a change that leaves access as it was', async () => {
      await meshUser();
      jest.mocked(userDatabaseService.applyMeshAccounts).mockReturnValue({ changedUserIds: ['u1'], changedRoleIds: [] });
      await service.resumeIfJoined();
      await jest.advanceTimersByTimeAsync(5_000);
      jest.mocked(messagingService.invalidateWebSessions).mockClear();

      await meshUser({ passwordHash: 'stored-better', displayName: 'Ada L.', updatedAt: 3 });
      await jest.advanceTimersByTimeAsync(5_000);

      expect(messagingService.invalidateWebSessions).not.toHaveBeenCalled();
      expect(messagingService.sendToAll).toHaveBeenCalledWith('users-changed', { userId: 'u1', roleId: undefined });
    });

    it('ends the sessions of an account whose access changed, or that is gone', async () => {
      await meshUser();
      await repo.upsertUser({
        userId: 'u2', username: 'bo', displayName: 'Bo', passwordHash: verifier, passwordParameters: 'argon2id', hashAlg: 'argon2id',
        enabled: true, securityVersion: 1, roleId: 'moderators', ownerUserId: null, createdAt: 1, updatedAt: 2
      });
      await service.resumeIfJoined();
      await jest.advanceTimersByTimeAsync(5_000);
      jest.mocked(messagingService.invalidateWebSessions).mockClear();

      jest.mocked(userDatabaseService.applyMeshAccounts).mockReturnValue({ changedUserIds: ['u1', 'u2'], changedRoleIds: [] });
      await meshUser({ securityVersion: 4, roleId: 'admin', updatedAt: 3 });
      await repo.deleteUser('u2');
      await jest.advanceTimersByTimeAsync(5_000);

      expect(jest.mocked(messagingService.invalidateWebSessions).mock.calls.map(([change]) => change.userId)).toEqual(['u1', 'u2']);
    });

    it('rewrites the account database only when the mesh accounts change', async () => {
      await meshUser();
      await service.resumeIfJoined();
      await jest.advanceTimersByTimeAsync(10_000);
      expect(userDatabaseService.applyMeshAccounts).toHaveBeenCalledTimes(1);

      await meshUser({ displayName: 'Ada L.', updatedAt: 3 });
      await jest.advanceTimersByTimeAsync(5_000);

      expect(userDatabaseService.applyMeshAccounts).toHaveBeenCalledTimes(2);
    });

    it('labels a stored password by the algorithm its hash names', async () => {
      await meshUser();
      await service.resumeIfJoined();
      // Changed on this machine: a fresh bcrypt hash replaces the Argon2id one the mesh held.
      jest.mocked(userDatabaseService.exportCredentialRows).mockReturnValue([localRow({ passwordHash: '$2b$10$abcdefghijklmnopqrstuuMx1XQYZ6EyuX5w0rBgk0gbtV2tNxk7i' })]);

      await service.syncUser('u1');

      expect(await repo.getUser('u1')).toMatchObject({ hashAlg: 'bcrypt', passwordHash: '$2b$10$abcdefghijklmnopqrstuuMx1XQYZ6EyuX5w0rBgk0gbtV2tNxk7i' });
    });

    it('signs a user out everywhere only for a change to their password, access or pool', async () => {
      await meshUser();
      await service.resumeIfJoined();

      jest.mocked(userDatabaseService.exportCredentialRows).mockReturnValue([localRow({ displayName: 'Ada L.' })]);
      await service.syncUser('u1');
      expect(await repo.getUser('u1')).toMatchObject({ displayName: 'Ada L.', securityVersion: 3 });

      jest.mocked(userDatabaseService.exportCredentialRows).mockReturnValue([localRow({ displayName: 'Ada L.', roleId: 'viewer' })]);
      await service.syncUser('u1');
      expect(await repo.getUser('u1')).toMatchObject({ roleId: 'viewer', securityVersion: 4 });
    });

    it('deletes a deleted user or role from the mesh, so the name is free again', async () => {
      await meshUser();
      await repo.upsertRole({ roleId: 'moderators', name: 'Moderators', permissions: [], securityVersion: 1 });
      await service.resumeIfJoined();

      await service.forgetUser('u1');
      await service.forgetRole('moderators');

      expect(await repo.getUser('u1')).toBeNull();
      expect(await repo.getRole('moderators')).toBeNull();
    });

    it('does not sign a user out elsewhere when it upgrades their stored hash at login', async () => {
      await repo.upsertRole({ roleId: 'moderators', name: 'Moderators', permissions: [], securityVersion: 1 });
      await meshUser({ passwordHash: '$2b$10$abcdefghijklmnopqrstuuMx1XQYZ6EyuX5w0rBgk0gbtV2tNxk7i', hashAlg: 'bcrypt', passwordParameters: 'bcrypt' });
      await service.resumeIfJoined();

      expect(await service.verifyLogin('ada', 'correct horse')).not.toBeNull();

      expect(await repo.getUser('u1')).toMatchObject({ hashAlg: 'argon2id', securityVersion: 3 });
    });
  });

  describe('the shared database password', () => {
    const REMOTE = '22222222-2222-4222-8222-222222222222';

    function supervisorStarts() {
      return jest.mocked(RqliteSupervisor).mock.results
        .flatMap(result => jest.mocked((result.value as { start: jest.Mock }).start).mock.calls.map(([options]) => options));
    }

    beforeEach(async () => {
      await repo.upsertNode(nodeRow(LOCAL));
    });

    it('gets a new value once a removed node is out of Raft, so that node never learns it', async () => {
      await repo.upsertNode(nodeRow(REMOTE, '2', 'https://10.0.0.2:4747'));
      await service.resumeIfJoined();
      const seenWhenRemoved: Array<string | null> = [];
      jest.spyOn(rqlite, 'removeMember').mockImplementation(async () => {
        seenWhenRemoved.push((await repo.getClusterCredential())?.pass ?? null);
      });

      await service.removeNode(REMOTE);

      expect(seenWhenRemoved).toEqual([null]);
      const credential = await repo.getClusterCredential();
      expect(credential?.pass).toBeTruthy();
      expect(credential?.pass).not.toBe('p');
    });

    it('is picked up by every node on its next tick', async () => {
      await service.resumeIfJoined();
      await repo.setClusterCredential({ user: 'aasm', pass: 'rotated' });

      await jest.advanceTimersByTimeAsync(5_000);

      expect(supervisorStarts().at(-1)).toMatchObject({ authUser: 'aasm', authPass: 'rotated' });
      expect(JSON.parse(fs.readFileSync(path.join(root, 'mesh', 'rqlite-auth.json'), 'utf8')).httpPass).toBe('rotated');
      expect(service.isEnabled()).toBe(true);
    });

    it('stays as it is when this node leaves on its own', async () => {
      await service.resumeIfJoined();

      await service.removeNode(LOCAL);

      expect(await repo.getClusterCredential()).toBeNull();
    });

    it('lets this machine\'s own sign-in setting apply again once it has left', async () => {
      await service.resumeIfJoined();
      expect(meshSignInRequired()).toBe(true);

      await service.removeNode(LOCAL);

      expect(meshSignInRequired()).toBe(false);
      expect(meshDesktopIdentity()).toBe('standalone');
    });
  });

  // Below quorum the mesh cannot agree to remove anyone, so a machine that is gone for good kept
  // it degraded. The machines that can be reached take a new member list without it instead.
  describe('force-removing machines that cannot be reached', () => {
    const PEER = '22222222-2222-4222-8222-222222222222';
    const GONE = '33333333-3333-4333-8333-333333333333';
    const GONE2 = '44444444-4444-4444-8444-444444444444';
    const GONE3 = '55555555-5555-4555-8555-555555555555';
    /** What was sent to /v1/force-remove, and to which machine. */
    let sent: Array<{ host: string; phase: string; body: Record<string, unknown> }>;
    /** The phase at which the other machine refuses, if any. */
    let refuseAt: string | null;
    /** The other machine does not answer at all. */
    let silent: boolean;

    const peersFile = () => path.join(root, 'mesh', 'rqlite', 'raft', 'peers.json');
    const member = (nodeId: string, name: string, host: string, serial: string): NodeRecord => ({
      ...nodeRow(nodeId, serial, `https://${host}:4747`), name, endpoints: { peerUrl: `https://${host}:4747`, raftAddr: `${host}:4002`, httpAddr: '' }
    });
    const peer = () => jest.mocked(startPeerServer).mock.calls[0][1];
    const heard = (nodeId: string) => peer().onHeartbeat(nodeId, Date.now());
    const supervisorStarts = () => jest.mocked(RqliteSupervisor).mock.results
      .flatMap(result => jest.mocked((result.value as { start: jest.Mock }).start).mock.calls.length)
      .reduce((sum, count) => sum + count, 0);

    async function settle<T>(work: Promise<T>): Promise<T> {
      await jest.advanceTimersByTimeAsync(10_000);
      return work;
    }

    beforeEach(async () => {
      await repo.upsertNode(member(LOCAL, 'Docker 1', '10.0.0.1', '1'));
      await repo.upsertNode(member(PEER, 'PC 1', '10.0.0.2', '2'));
      await repo.upsertNode(member(GONE, 'asa-1', '10.0.0.3', '3'));
      await repo.upsertNode(member(GONE2, 's001', '10.0.0.4', '4'));
      view.hasQuorum = false;
      view.leader = false;
      sent = [];
      refuseAt = null;
      silent = false;
      jest.mocked(peerRequest).mockImplementation(async options => {
        if (options.url.endsWith('/v1/force-remove')) {
          if (silent) throw new Error('connect ETIMEDOUT');
          const body = options.body as Record<string, unknown>;
          sent.push({ host: new URL(options.url).hostname, phase: String(body.phase), body });
          return body.phase === refuseAt ? { status: 409, body: { error: 'PC 1 can still reach asa-1.' } } : { status: 200, body: { ok: true } };
        }
        throw new Error('connect ETIMEDOUT');
      });
      await service.resumeIfJoined();
      heard(PEER);
      // Once the machines that stay restart on the new member list, they agree again.
      jest.mocked(RqliteSupervisor).mock.results.forEach(result => {
        jest.mocked((result.value as { start: jest.Mock }).start).mockImplementation(async () => {
          if (fs.existsSync(peersFile())) {
            view.hasQuorum = true;
            view.leader = true;
          }
        });
      });
    });

    it('has every machine that stays and can be reached agree, then all take the new member list', async () => {
      const result = await settle(service.forceRemoveNodes([GONE, GONE2], 'ada'));

      expect(result).toEqual({ success: true });
      const members = [{ id: LOCAL, address: '10.0.0.1:4002' }, { id: PEER, address: '10.0.0.2:4002' }];
      expect(sent.map(item => [item.host, item.phase])).toEqual([['10.0.0.2', 'prepare'], ['10.0.0.2', 'apply']]);
      expect(sent[0].body).toMatchObject({ removing: [GONE, GONE2], members });
      expect(JSON.parse(fs.readFileSync(peersFile(), 'utf8'))).toEqual(members.map(item => ({ ...item, non_voter: false })));
    });

    it('forgets the servers of the machines it forces out', async () => {
      // A write: the mesh here cannot agree until the machines are forced out.
      view.hasQuorum = true;
      await repo.upsertServer({
        serverId: 'on-asa', name: 'on-asa', nodeId: GONE, mapName: '', desiredState: 'running', configRevision: 1, configJson: '{}',
        clusterId: null, operatorUserId: null, managerUserId: null
      });
      view.hasQuorum = false;

      await settle(service.forceRemoveNodes([GONE, GONE2], 'ada'));

      expect((await repo.listServers()).map(server => server.serverId)).not.toContain('on-asa');
    });

    it('then removes them as Remove does: marked removed, certificates revoked, a new database password', async () => {
      await settle(service.forceRemoveNodes([GONE, GONE2], 'ada'));

      expect((await repo.getNode(GONE))?.status).toBe('removed');
      expect((await repo.getNode(GONE2))?.status).toBe('removed');
      expect(await repo.isRevoked('3')).toBe(true);
      expect(await repo.isRevoked('4')).toBe(true);
      expect((await repo.getClusterCredential())?.pass).toBeTruthy();
    });

    // s001 stays in the new list; it takes it from the others when it comes back.
    it('keeps a machine that cannot be reached when it is not being removed, once enough remain', async () => {
      const result = await settle(service.forceRemoveNodes([GONE], 'ada'));

      expect(result).toEqual({ success: true });
      expect(JSON.parse(fs.readFileSync(peersFile(), 'utf8')).map((item: { id: string }) => item.id)).toEqual([LOCAL, PEER, GONE2]);
      expect((await repo.getNode(GONE2))?.status).toBe('alive');
    });

    it('changes nothing when a machine that stays will not agree', async () => {
      refuseAt = 'prepare';
      const before = supervisorStarts();

      const result = await settle(service.forceRemoveNodes([GONE], 'ada'));

      expect(result).toEqual({ success: false, error: 'PC 1 would not take part: PC 1 can still reach asa-1. Nothing was changed.' });
      expect(sent.map(item => item.phase)).toEqual(['prepare']);
      expect(fs.existsSync(peersFile())).toBe(false);
      expect(supervisorStarts()).toBe(before);
      expect((await repo.getNode(GONE))?.status).toBe('alive');
    });

    it('changes nothing when a machine that stays does not answer', async () => {
      silent = true;

      const result = await settle(service.forceRemoveNodes([GONE], 'ada'));

      expect(result.success).toBe(false);
      expect(result.error).toContain('PC 1 did not answer');
      expect(fs.existsSync(peersFile())).toBe(false);
    });

    it('is only for a mesh that cannot agree: with quorum, Remove does it', async () => {
      view.hasQuorum = true;

      expect(await settle(service.forceRemoveNodes([GONE], 'ada')))
        .toEqual({ success: false, error: 'The mesh can agree on removing machines now: use Remove.' });
    });

    it('does not force out a machine that can be reached, or this one', async () => {
      expect(await settle(service.forceRemoveNodes([PEER], 'ada')))
        .toEqual({ success: false, error: 'PC 1 can be reached. Only machines that cannot be reached can be forced out.' });
      expect((await settle(service.forceRemoveNodes([LOCAL], 'ada'))).success).toBe(false);
    });

    it('does nothing when the machines left would still be too few to agree', async () => {
      view.hasQuorum = true;
      await repo.upsertNode(member(GONE3, 'old box', '10.0.0.5', '5'));
      view.hasQuorum = false;

      expect(await settle(service.forceRemoveNodes([GONE], 'ada'))).toEqual({
        success: false,
        error: 'That would still leave too few: 2 of the 4 machines left can be reached, and they would need 3. Remove more of the machines that cannot be reached.'
      });
      expect(sent).toEqual([]);
    });

    describe('as a machine asked to take part', () => {
      const members = [{ id: PEER, address: '10.0.0.2:4002' }, { id: LOCAL, address: '10.0.0.1:4002' }];

      it('agrees only while it too cannot agree, cannot reach those machines, and stays', async () => {
        await expect(peer().onForceRemove!(PEER, { phase: 'prepare', removing: [GONE], members })).resolves.toEqual({ ok: true });

        heard(GONE);
        await expect(peer().onForceRemove!(PEER, { phase: 'prepare', removing: [GONE], members })).rejects.toThrow('This machine can still reach asa-1.');
        await expect(peer().onForceRemove!(PEER, { phase: 'prepare', removing: [GONE2], members: [members[0]] })).rejects.toThrow('not in the new member list');
        view.hasQuorum = true;
        await expect(peer().onForceRemove!(PEER, { phase: 'prepare', removing: [GONE2], members })).rejects.toThrow('can agree on removing machines now');
      });

      it('takes the new member list when told to', async () => {
        await peer().onForceRemove!(PEER, { phase: 'prepare', removing: [GONE], members });

        await expect(peer().onForceRemove!(PEER, { phase: 'apply', removing: [GONE], members })).resolves.toEqual({ ok: true });

        expect(JSON.parse(fs.readFileSync(peersFile(), 'utf8'))).toEqual(members.map(item => ({ ...item, non_voter: false })));
      });

      it('does not take a member list it was not first asked to agree to', async () => {
        await expect(peer().onForceRemove!(PEER, { phase: 'apply', removing: [GONE], members })).rejects.toThrow('was not agreed');
        expect(fs.existsSync(peersFile())).toBe(false);
      });
    });
  });

  // The machine that was forced out, back again: the others refuse it, and Leave works without them.
  // The mesh page said Connected or Unreachable, but not since when.
  describe('last contact with each machine', () => {
    const PEER = '22222222-2222-4222-8222-222222222222';
    const QUIET = '33333333-3333-4333-8333-333333333333';
    const quietRecordedAt = 1_700_000_000_000;

    beforeEach(async () => {
      await repo.upsertNode(nodeRow(LOCAL));
      await repo.upsertNode({ ...nodeRow(PEER, '2', 'https://10.0.0.2:4747'), lastSeen: quietRecordedAt - 60_000 });
      await repo.upsertNode({ ...nodeRow(QUIET, '3', 'https://10.0.0.3:4747'), lastSeen: quietRecordedAt });
      jest.mocked(peerRequest).mockRejectedValue(new Error('connect ETIMEDOUT'));
      await service.resumeIfJoined();
    });

    it('is now for this machine, its last heartbeat for one heard from, and its last record for one not heard from', async () => {
      jest.mocked(startPeerServer).mock.calls[0][1].onHeartbeat(PEER, Date.now());
      const heardAt = Date.now();
      await jest.advanceTimersByTimeAsync(5_000);

      const nodes = (await service.status()).nodes as Array<NodeRecord & { lastContactAt?: number | null }>;
      const lastContact = (nodeId: string) => nodes.find(node => node.nodeId === nodeId)?.lastContactAt;

      expect(lastContact(LOCAL)).toBe(Date.now());
      expect(lastContact(PEER)).toBe(heardAt);
      expect(lastContact(QUIET)).toBe(quietRecordedAt);
    });
  });

  // PC 1 removed Docker 1, which only learned of it when PC 1 began refusing it, and then sat on a
  // banner asking it to leave. Remove tells the machine now, and it goes standalone on its own.
  describe('telling a machine it was removed', () => {
    const PEER = '22222222-2222-4222-8222-222222222222';
    const peer = () => jest.mocked(startPeerServer).mock.calls[0][1];
    const sentTo = (suffix: string) => jest.mocked(peerRequest).mock.calls.map(([options]) => options).filter(options => options.url.endsWith(suffix));

    beforeEach(async () => {
      await repo.upsertNode(nodeRow(LOCAL));
      await repo.upsertNode(nodeRow(PEER, '2', 'https://10.0.0.2:4747'));
      jest.mocked(peerRequest).mockResolvedValue({ status: 200, body: { ok: true } });
      await service.resumeIfJoined();
    });

    it('tells the machine it removes, so it goes standalone without being asked to leave', async () => {
      await service.removeNode(PEER);

      expect(sentTo('/v1/removed').map(options => options.url)).toEqual(['https://10.0.0.2:4747/v1/removed']);
      expect((await repo.getNode(PEER))?.status).toBe('removed');
    });

    it('still removes a machine that cannot be told', async () => {
      jest.mocked(peerRequest).mockImplementation(async options => {
        if (options.url.endsWith('/v1/removed')) throw new Error('connect ETIMEDOUT');
        return { status: 200, body: { ok: true } };
      });

      await expect(service.removeNode(PEER)).resolves.toBeUndefined();

      expect((await repo.getNode(PEER))?.status).toBe('removed');
    });

    it('goes standalone, keeping its servers, when a member says it was removed', async () => {
      await peer().onRemoved!(PEER);
      // Just after the reply: leaving stops the peer server the word came in on.
      await jest.advanceTimersByTimeAsync(0);

      expect(service.isEnabled()).toBe(false);
      expect(JSON.parse(fs.readFileSync(path.join(root, 'mesh', 'node.json'), 'utf8')).meshId).toBe('');
    });

    it('takes that word only from a member', async () => {
      await repo.upsertNode({ ...nodeRow(PEER, '2', 'https://10.0.0.2:4747'), status: 'removed' });

      await expect(peer().onRemoved!(PEER)).rejects.toThrow(/not a member/);
      expect(service.isEnabled()).toBe(true);
    });
  });

  // A removed machine's servers stay on that machine; the mesh went on holding them, hidden but in
  // the way of the machine joining again and of the clusters they were in.
  describe('forgetting a removed machine\'s servers', () => {
    const PEER = '22222222-2222-4222-8222-222222222222';
    const GONE = '33333333-3333-4333-8333-333333333333';
    const serverRow = (serverId: string, nodeId: string) => ({
      serverId, name: serverId, nodeId, mapName: '', desiredState: 'running' as const, configRevision: 1, configJson: '{}',
      clusterId: null, operatorUserId: null, managerUserId: null
    });
    const serverIds = async () => (await repo.listServers()).map(server => server.serverId).sort();

    beforeEach(async () => {
      await repo.upsertNode(nodeRow(LOCAL));
      await repo.upsertNode(nodeRow(PEER, '2', 'https://10.0.0.2:4747'));
      await repo.upsertServer(serverRow('here', LOCAL));
      await repo.upsertServer(serverRow('there-1', PEER));
      await repo.upsertServer(serverRow('there-2', PEER));
      jest.mocked(peerRequest).mockResolvedValue({ status: 200, body: { ok: true } });
    });

    it('forgets the servers of the machine it removes, and keeps its own', async () => {
      await service.resumeIfJoined();

      await service.removeNode(PEER);

      expect(await serverIds()).toEqual(['here']);
    });

    it('forgets what is left on a machine removed earlier, once the mesh can agree', async () => {
      await repo.upsertNode({ ...nodeRow(GONE, '3', 'https://10.0.0.3:4747'), status: 'removed' });
      await repo.upsertServer(serverRow('left-behind', GONE));
      await service.resumeIfJoined();

      await jest.advanceTimersByTimeAsync(5_000);

      expect(await serverIds()).toEqual(['here', 'there-1', 'there-2']);
    });
  });

  describe('a machine the others removed', () => {
    const PEER = '22222222-2222-4222-8222-222222222222';

    beforeEach(async () => {
      await repo.upsertNode(nodeRow(LOCAL));
      await repo.upsertNode(nodeRow(PEER, '2', 'https://10.0.0.2:4747'));
      view.hasQuorum = false;
      view.leader = false;
    });

    it('says so when every machine it reaches refuses it as no longer a member', async () => {
      // As the peer API refuses a certificate it no longer trusts.
      jest.mocked(peerRequest).mockResolvedValue({ status: 401, body: { error: 'This certificate does not belong to a member of the mesh.' } });

      await service.resumeIfJoined();
      await jest.advanceTimersByTimeAsync(5_000);

      expect((await service.status()).removedFromMesh).toBe(true);
    });

    it('does not say so while any machine still takes it', async () => {
      view.hasQuorum = true;
      await repo.upsertNode(nodeRow('33333333-3333-4333-8333-333333333333', '3', 'https://10.0.0.3:4747'));
      view.hasQuorum = false;
      // One machine refuses it, as a machine that did not hear of it would never do; another takes it.
      jest.mocked(peerRequest).mockImplementation(async options => (options.url.includes('10.0.0.3')
        ? { status: 401, body: { error: 'This certificate does not belong to a member of the mesh.' } }
        : { status: 200, body: { ok: true } }));

      await service.resumeIfJoined();
      await jest.advanceTimersByTimeAsync(5_000);

      expect((await service.status()).removedFromMesh).toBeFalsy();
    });

    it('leaves without the others, keeping its servers', async () => {
      await service.resumeIfJoined();

      await service.leaveWithoutQuorum();

      expect(service.isEnabled()).toBe(false);
      expect(meshSignInRequired()).toBe(false);
      expect(JSON.parse(fs.readFileSync(path.join(root, 'mesh', 'node.json'), 'utf8')).meshId).toBe('');
    });
  });

  describe('which certificates it trusts', () => {
    it('trusts only the certificate a current member is recorded with', async () => {
      const MEMBER = '22222222-2222-4222-8222-222222222222';
      const GONE = '33333333-3333-4333-8333-333333333333';
      const REVOKED = '44444444-4444-4444-8444-444444444444';
      await repo.upsertNode(nodeRow(MEMBER, 'abc123'));
      await repo.upsertNode({ ...nodeRow(GONE, 'def456'), status: 'removed' });
      await repo.upsertNode(nodeRow(REVOKED, 'f0f'));
      await repo.revokeSerial('f0f', Date.now());
      await service.resumeIfJoined();
      const peer = jest.mocked(startPeerServer).mock.calls[0][1];

      expect(await peer.isTrusted('abc123', MEMBER)).toBe(true);
      expect(await peer.isTrusted('999999', MEMBER)).toBe(false); // minted with the CA key
      expect(await peer.isTrusted('abc123', 'someone-else')).toBe(false); // another member's serial
      expect(await peer.isTrusted('def456', GONE)).toBe(false); // removed from the mesh
      expect(await peer.isTrusted('f0f', REVOKED)).toBe(false); // revoked
    });
  });

  describe('joining', () => {
    const MEMBER = 'https://10.0.0.9:4747';
    let ca: ReturnType<typeof createMeshCa>;
    let token: string;

    /** The CA fingerprint worked out here: sha256 of the certificate's DER bytes, base64url. */
    function fingerprintOf(certPem: string): string {
      return createHash('sha256').update(new X509Certificate(certPem).raw).digest('base64url');
    }

    function calls(suffix: string) {
      return jest.mocked(peerRequest).mock.calls.map(([options]) => options).filter(options => options.url.endsWith(suffix));
    }

    beforeAll(() => {
      ca = createMeshCa('member mesh');
    });

    beforeEach(() => {
      token = `${'ab'.repeat(32)}.${fingerprintOf(ca.certPem)}`;
      // A member: it shows its CA, then signs the joiner's key.
      jest.mocked(peerRequest).mockImplementation(async options => {
        if (options.url.endsWith('/v1/ca')) return { status: 200, body: { caCert: ca.certPem } };
        if (options.url.endsWith('/v1/join')) {
          const body = options.body as { publicKeyPem: string };
          return {
            status: 200,
            body: {
              meshId: 'mesh-2', nodeId: LOCAL, caCert: ca.certPem,
              nodeCert: signNodeCertificate(ca.certPem, ca.keyPem, body.publicKeyPem, LOCAL, ['127.0.0.1']).certPem,
              httpAuthUser: 'aasm', httpAuthPass: 'p2', raftAddr: '10.0.0.9:4002'
            }
          };
        }
        return { status: 200, body: { ok: true } };
      });
    });

    it('checks the member\'s CA against the token before sending the token, then verifies against that CA', async () => {
      await service.joinMesh({ memberUrl: MEMBER, token });

      const [shown] = calls('/v1/ca');
      const [join] = calls('/v1/join');
      expect(jest.mocked(peerRequest).mock.calls[0][0].url).toBe(`${MEMBER}/v1/ca`);
      expect(shown.method).toBe('GET');
      expect(join.pinnedCa).toBe(ca.certPem);
      expect(join.insecure).toBeFalsy();
      expect((join.body as { token: string }).token).toBe('ab'.repeat(32));
      expect(service.isEnabled()).toBe(true);
    }, 30_000);

    it('will not send the token to a member whose CA does not match it', async () => {
      const impostor = createMeshCa('impostor');
      jest.mocked(peerRequest).mockResolvedValue({ status: 200, body: { caCert: impostor.certPem } });

      await expect(service.joinMesh({ memberUrl: MEMBER, token })).rejects.toThrow(/does not match/);
      expect(calls('/v1/join')).toEqual([]);
    }, 30_000);

    it('refuses a token that does not name the mesh CA', async () => {
      await expect(service.joinMesh({ memberUrl: MEMBER, token: 'ab'.repeat(32) })).rejects.toThrow(/new token/);
      expect(peerRequest).not.toHaveBeenCalled();
    });

    it('asks the member to take it back out when the join cannot finish', async () => {
      supervisorFailure = 'failed to join cluster';

      await expect(service.joinMesh({ memberUrl: MEMBER, token })).rejects.toThrow(/failed to join/);

      const [abort] = calls('/v1/abort-join');
      expect(abort.url).toBe(`${MEMBER}/v1/abort-join`);
      expect(abort.pinnedCa).toBe(ca.certPem);
      expect(abort.cert).toContain('BEGIN CERTIFICATE');
    }, 30_000);

    it('joins at the address typed in, for a machine outside the member\'s network', async () => {
      await service.joinMesh({ memberUrl: MEMBER, token, address: { host: 'mesh-b.example.org', peerPort: 4747, raftPort: 4002 } });

      const [join] = calls('/v1/join');
      expect(join.body).toMatchObject({ peerUrl: 'https://mesh-b.example.org:4747', raftAddr: 'mesh-b.example.org:4002' });
      expect(JSON.parse(fs.readFileSync(path.join(root, 'mesh', 'rqlite-auth.json'), 'utf8')))
        .toMatchObject({ peerUrl: 'https://mesh-b.example.org:4747', raftAddr: 'mesh-b.example.org:4002' });
    }, 30_000);

    // Germany's rqlited could not run: the member recorded a machine that never arrived.
    it('will not join from a machine that cannot run the mesh database, before sending the token', async () => {
      jest.mocked(rqliteProblem).mockReturnValueOnce('rqlited at /opt/aasm/rqlited is not executable, and this app could not make it so. Run: chmod +x "/opt/aasm/rqlited"');

      await expect(service.joinMesh({ memberUrl: MEMBER, token })).rejects.toThrow('rqlited at /opt/aasm/rqlited is not executable');
      expect(peerRequest).not.toHaveBeenCalled();
    });

    it('refuses an address that is not one before sending the token', async () => {
      await expect(service.joinMesh({ memberUrl: MEMBER, token, address: { host: 'not an address', peerPort: 4747, raftPort: 4002 } }))
        .rejects.toThrow('is not an IPv4 address or a host name');
      expect(peerRequest).not.toHaveBeenCalled();
    });

    // Germany's own password stopped working after it joined; Dallas's kept working as an admin of
    // every machine. Now each joining machine's password signs in as that machine's admin.
    it('brings this machine\'s admin password along as a numbered machine admin for it', async () => {
      const hash = '$2b$12$' + 'g'.repeat(53);
      jest.mocked(userDatabaseService.exportCredentialRows).mockReturnValue([{
        id: 'a1', username: 'admin', displayName: 'admin', passwordHash: hash, roleId: 'admin', active: true, ownerUserId: null,
        cliLocked: false, machineNodeId: null, updatesAnyMachine: false
      }]);

      const joined = await service.joinMesh({ memberUrl: MEMBER, token, name: 'Germany01' });

      expect(joined.machineAdmin).toMatch(/^admin2-germany01/);
      const user = await repo.getUserByUsername(joined.machineAdmin!);
      expect(user).toMatchObject({ roleId: 'machine-admin', passwordHash: hash, hashAlg: 'bcrypt', enabled: true });
      expect(await repo.listMachineAdmins()).toEqual([{ userId: user!.userId, nodeId: LOCAL, updatesAny: false }]);
    }, 30_000);

    // Joining sends the desktop to its sign-in page, and the name was only shown on the page it left.
    it('names that account to the sign-in page for as long as it can sign in', async () => {
      jest.mocked(userDatabaseService.exportCredentialRows).mockReturnValue([{
        id: 'a1', username: 'admin', displayName: 'admin', passwordHash: '$2b$12$' + 'h'.repeat(53), roleId: 'admin', active: true,
        ownerUserId: null, cliLocked: false, machineNodeId: null, updatesAnyMachine: false
      }]);
      const joined = await service.joinMesh({ memberUrl: MEMBER, token, name: 'Germany01' });

      expect((await service.status()).ownLogin).toBe(joined.machineAdmin);

      const user = await repo.getUserByUsername(joined.machineAdmin!);
      await repo.upsertUser({ ...user!, enabled: false });
      expect((await service.status()).ownLogin).toBeUndefined();
    }, 30_000);

    // PC 1 joined a mesh that already had its password, under an account it had before: no new
    // account was made, and the sign-in page named none.
    it('names the account that already has this machine\'s password, and makes no other', async () => {
      const hash = '$2b$12$' + 'k'.repeat(53);
      jest.mocked(userDatabaseService.exportCredentialRows).mockReturnValue([{
        id: 'a1', username: 'admin', displayName: 'admin', passwordHash: hash, roleId: 'admin', active: true,
        ownerUserId: null, cliLocked: false, machineNodeId: null, updatesAnyMachine: false
      }]);
      await repo.upsertUser({
        userId: 'existing', username: 'admin1', displayName: 'Admin 1', passwordHash: hash, passwordParameters: 'bcrypt', hashAlg: 'bcrypt',
        enabled: true, securityVersion: 1, roleId: 'admin', ownerUserId: null, createdAt: 1, updatedAt: 1
      });

      const joined = await service.joinMesh({ memberUrl: MEMBER, token, name: 'Germany01' });

      expect(joined.machineAdmin).toBeUndefined();
      expect((await service.status()).ownLogin).toBe('admin1');
      expect(await repo.listMachineAdmins()).toEqual([]);
    }, 30_000);

    it('keeps a copy of this machine\'s accounts before the mesh\'s replace them', async () => {
      await service.joinMesh({ memberUrl: MEMBER, token });

      const [dest] = jest.mocked(userDatabaseService.snapshotTo).mock.calls[0] ?? [''];
      expect(path.dirname(dest)).toBe(path.join(root, 'mesh'));
      expect(path.basename(dest)).toMatch(/^accounts-before-join-\d+\.db$/);
    }, 30_000);

    it('creates tokens that name the mesh CA', async () => {
      fs.writeFileSync(path.join(root, 'mesh', 'ca.crt'), ca.certPem);
      await service.resumeIfJoined();

      const { token: issued } = await service.createEnrollmentToken();
      const [secret, named] = issued.split('.');

      expect(named).toBe(fingerprintOf(ca.certPem));
      expect(await repo.consumeToken(hashToken(secret), Date.now())).toBe(true);
    });

    it('will not join a second mesh while it is in one', async () => {
      await service.resumeIfJoined();

      await expect(service.joinMesh({ memberUrl: MEMBER, token })).rejects.toThrow(/already in a mesh/);
      expect(peerRequest).not.toHaveBeenCalledWith(expect.objectContaining({ url: `${MEMBER}/v1/ca` }));
    });
  });

  describe('addresses behind a proxy or port forward', () => {
    afterEach(() => {
      delete process.env.AASM_ADVERTISE_PEER_URL;
      delete process.env.AASM_ADVERTISE_RAFT_ADDR;
    });

    function supervisorStarts() {
      return jest.mocked(RqliteSupervisor).mock.results
        .flatMap(result => jest.mocked((result.value as { start: jest.Mock }).start).mock.calls.map(([options]) => options));
    }

    it('advertises the configured peer URL and Raft address while listening on its own ports', async () => {
      process.env.AASM_ADVERTISE_PEER_URL = 'https://mesh-a.example.com';
      process.env.AASM_ADVERTISE_RAFT_ADDR = 'mesh-a.example.com:14002';

      await service.createMesh({ name: 'Proxied' });

      expect((await repo.getNode(LOCAL))?.endpoints).toMatchObject({
        peerUrl: 'https://mesh-a.example.com', raftAddr: 'mesh-a.example.com:14002'
      });
      expect(supervisorStarts()[0]).toMatchObject({
        raftAddr: 'mesh-a.example.com:14002', raftBind: '0.0.0.0:4002', httpAddr: '127.0.0.1:4001'
      });
      expect(certificateCoversHost(fs.readFileSync(path.join(root, 'mesh', 'node.crt'), 'utf8'), 'mesh-a.example.com')).toBe(true);
      expect(startPeerServer).toHaveBeenCalledWith(4747, expect.anything());
    }, 30_000);

    it('will not create a mesh on a machine that cannot run the mesh database', async () => {
      jest.mocked(rqliteProblem).mockReturnValueOnce('rqlited at /opt/aasm/rqlited could not run: spawnSync ENOEXEC');

      await expect(service.createMesh({ name: 'Here' })).rejects.toThrow('could not run: spawnSync ENOEXEC');
      expect(supervisorStarts()).toEqual([]);
    });

    it('says why this machine cannot run a mesh before anyone tries', async () => {
      jest.mocked(rqliteProblem).mockReturnValueOnce('rqlited was not found.');
      fs.rmSync(path.join(root, 'mesh', 'node.json'));

      expect((await service.status()).blocker).toBe('rqlited was not found.');
    });

    // A machine admin the creating machine brought arrived with no machine, so it looked after none.
    it('keeps the machine each machine admin it brings looks after', async () => {
      jest.mocked(userDatabaseService.exportCredentialRows).mockReturnValue([{
        id: 'ma1', username: 'admin2-pc-1', displayName: 'Admin 2, PC 1', passwordHash: '$2b$12$' + 'm'.repeat(53), roleId: 'machine-admin',
        active: true, ownerUserId: null, cliLocked: false, machineNodeId: 'pc-1-node', updatesAnyMachine: true
      }]);

      await service.createMesh({ name: 'Brought' });

      expect(await repo.listMachineAdmins()).toEqual([{ userId: 'ma1', nodeId: 'pc-1-node', updatesAny: true }]);
    }, 30_000);

    it('creates a mesh at the address typed in, listening on its own ports', async () => {
      await service.createMesh({ name: 'Public', address: { host: 'mesh-a.example.com', peerPort: 14747, raftPort: 14002 } });

      expect((await repo.getNode(LOCAL))?.endpoints).toMatchObject({
        peerUrl: 'https://mesh-a.example.com:14747', raftAddr: 'mesh-a.example.com:14002'
      });
      expect(supervisorStarts()[0]).toMatchObject({ raftAddr: 'mesh-a.example.com:14002', raftBind: '0.0.0.0:4002' });
      expect(certificateCoversHost(fs.readFileSync(path.join(root, 'mesh', 'node.crt'), 'utf8'), 'mesh-a.example.com')).toBe(true);
      expect(startPeerServer).toHaveBeenCalledWith(4747, expect.anything());
    }, 30_000);

    it('keeps the addresses it joined with when it restarts', async () => {
      fs.writeFileSync(path.join(root, 'mesh', 'rqlite-auth.json'), JSON.stringify({
        httpUser: 'aasm', httpPass: 'p', peerPort: 4747, advertiseHost: '127.0.0.1',
        peerUrl: 'https://mesh-a.example.com', raftAddr: 'mesh-a.example.com:14002'
      }));

      await service.resumeIfJoined();

      expect(supervisorStarts()[0]).toMatchObject({ raftAddr: 'mesh-a.example.com:14002', raftBind: '0.0.0.0:4002', httpAddr: '127.0.0.1:4001' });
    });
  });

  // A removal whose Raft step failed left the machine a voter: the mesh counted it towards a majority.
  describe('voters of machines that were removed', () => {
    const GONE = '33333333-3333-4333-8333-333333333333';

    beforeEach(async () => {
      await repo.upsertNode(nodeRow(LOCAL));
      await repo.upsertNode({ ...nodeRow(GONE, '3', 'https://10.0.0.3:4747'), status: 'removed' });
      rqlite.raftMembers = [{ id: LOCAL, addr: '127.0.0.1:4002', voter: true }, { id: GONE, addr: '10.0.0.3:4002', voter: true }];
    });

    it('takes a removed machine that is still a voter out of Raft, on the leader', async () => {
      view.leader = true;
      await service.resumeIfJoined();
      await jest.advanceTimersByTimeAsync(5_000);

      expect(rqlite.removed).toEqual([GONE]);
    });

    it('leaves that to the leader', async () => {
      view.leader = false;
      await service.resumeIfJoined();
      await jest.advanceTimersByTimeAsync(5_000);

      expect(rqlite.removed).toEqual([]);
    });
  });

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

    function command(operation: 'start' | 'stop' | 'restart', serverId: string, targetNode = LOCAL) {
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

    // Without callbacks the runtime broadcasts the server's states and log; with its own it would
    // keep them, and every client would show the server as starting until it was reloaded.
    it('starts a server for a remote command the way a local start does', async () => {
      await place('s1', 'stopped');
      await service.resumeIfJoined();
      await tick();

      await service.executeLocalCommand(command('start', 's1'));

      expect(jest.mocked(localRuntime.start).mock.calls).toEqual([['s1']]);
    });

    it('restarts a server for a remote command the way a local start does', async () => {
      await place('s1', 'running');
      states.set('s1', 'running');
      await service.resumeIfJoined();
      await tick();

      await service.executeLocalCommand(command('restart', 's1'));

      expect(jest.mocked(localRuntime.start).mock.calls).toEqual([['s1']]);
    });

    // After a restart this machine's copy of the mesh is old until it catches up: a server it reads
    // as running there may have been stopped since. Started on that and stopped five seconds later.
    it('starts and stops nothing on what it reads before its copy of the mesh has caught up', async () => {
      await place('s1', 'running');
      rqlite.synced = false;
      await service.resumeIfJoined();
      await tick();
      await tick();
      expect(localRuntime.start).not.toHaveBeenCalled();

      rqlite.synced = true;
      await tick();

      expect(jest.mocked(localRuntime.start).mock.calls).toEqual([['s1']]);
    });

    // Alone, cut off from the others, it never catches up: its servers still have to run.
    it('goes by what it has once it has waited a minute for its copy to catch up', async () => {
      await place('s1', 'running');
      rqlite.synced = false;
      await service.resumeIfJoined();

      await jest.advanceTimersByTimeAsync(65_000);

      expect(jest.mocked(localRuntime.start).mock.calls).toEqual([['s1']]);
    });

    it('starts a server another node set running the way a local start does', async () => {
      await place('s1', 'stopped');
      await service.resumeIfJoined();
      await tick();

      await place('s1', 'running');
      await tick();

      expect(jest.mocked(localRuntime.start).mock.calls).toEqual([['s1']]);
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

    /**
     * A destination that keeps what it is sent, as a current node does: it answers a resumed begin
     * with what it holds, and carries a file on from an offset. An older one wipes and holds nothing.
     */
    function stagingDestination(initial: Record<string, string> = {}, resumable = true) {
      const staged = new Map(Object.entries(initial));
      const sha = (text: string) => createHash('sha256').update(text).digest('hex');
      const uploads: Array<{ rel: string; offset: number; start: number }> = [];
      const begins: Array<{ resume?: boolean; rels?: string[] }> = [];
      jest.mocked(peerRequest).mockImplementation(async options => {
        if (options.url.endsWith('/v1/checkpoint/begin')) {
          const body = options.body as { resume?: boolean; rels?: string[] };
          begins.push(body);
          if (!resumable || !body.resume) staged.clear();
          if (!resumable) return { status: 200, body: { ok: true } };
          const held = [...staged].filter(([rel]) => !body.rels || body.rels.includes(rel))
            .map(([rel, text]) => ({ rel, size: text.length, sha256: sha(text) }));
          return { status: 200, body: { ok: true, held } };
        }
        if (options.url.endsWith('/v1/checkpoint/finish')) {
          const rels = (options.body as { rels: string[] }).rels;
          for (const rel of [...staged.keys()]) if (!rels.includes(rel)) staged.delete(rel);
          return { status: 200, body: { checksum: checksumOf([...staged.entries()]) } };
        }
        return { status: 200, body: { ok: true } };
      });
      jest.mocked(peerUpload).mockImplementation(async options => {
        const url = new URL(options.url);
        const rel = url.searchParams.get('rel') || '';
        const offset = Number(url.searchParams.get('offset') || 0);
        const start = options.start ?? 0;
        uploads.push({ rel, offset, start });
        const rest = fs.readFileSync(options.file, 'utf8').slice(start);
        options.onProgress?.(rest.length);
        staged.set(rel, (offset ? (staged.get(rel) || '').slice(0, offset) : '') + rest);
        return { status: 200, body: { ok: true } };
      });
      return { staged, uploads, begins };
    }

    async function offServerHere(): Promise<void> {
      await repo.upsertNode(nodeRow(REMOTE, '2', 'https://10.0.0.2:4747'));
      await place('isle', LOCAL, 'stopped');
      writeInstance('isle');
      await service.resumeIfJoined();
    }

    /**
     * Runs fake time on until `promise` settles. A move reads real files before it reaches a retry
     * delay, so each step first lets real I/O finish.
     */
    async function untilSettled<T>(promise: Promise<T>, stepMs = 1_000, maxSteps = 200): Promise<T> {
      let settled = false;
      void promise.then(() => { settled = true; }, () => { settled = true; });
      const realImmediate = jest.requireActual<typeof import('timers')>('timers').setImmediate;
      for (let step = 0; step < maxSteps && !settled; step++) {
        await new Promise(resolve => realImmediate(resolve));
        await jest.advanceTimersByTimeAsync(stepMs);
      }
      return promise;
    }

    /** The move fails a file the way a dropped connection does. */
    function dropUploadsOf(rel: string, times: number, keep?: (staged: Map<string, string>) => void, staged?: Map<string, string>): () => number {
      const upload = jest.mocked(peerUpload).getMockImplementation()!;
      let attempts = 0;
      jest.mocked(peerUpload).mockImplementation(async options => {
        if (new URL(options.url).searchParams.get('rel') !== rel) return upload(options);
        attempts++;
        if (attempts > times) return upload(options);
        if (keep && staged) keep(staged);
        throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      });
      return () => attempts;
    }

    describe('carrying on an interrupted move', () => {
      it('sends only what the destination does not already hold, carrying a cut-off file on where it ends', async () => {
        await offServerHere();
        const destination = stagingDestination({ 'config.json': '{"id":"isle"}', [SAVE]: 'wo' });

        const result = await service.move('isle', REMOTE, 'ada');

        expect(result).toMatchObject({ success: true });
        expect(destination.uploads).toEqual([{ rel: SAVE, offset: 2, start: 2 }]);
        expect(destination.staged.get(SAVE)).toBe('world');
        expect((await repo.getServer('isle'))?.nodeId).toBe(REMOTE);
      });

      it('sends a file whole again when what the destination holds of it is not the same', async () => {
        await offServerHere();
        const destination = stagingDestination({ [SAVE]: 'xx', 'gone.bak': 'old' });

        const result = await service.move('isle', REMOTE, 'ada');

        expect(result).toMatchObject({ success: true });
        expect(destination.uploads).toEqual([{ rel: SAVE, offset: 0, start: 0 }, { rel: 'config.json', offset: 0, start: 0 }]);
        expect([...destination.staged.keys()].sort()).toEqual([SAVE, 'config.json'].sort());
      });

      it('copies everything to a destination too old to keep what it was sent', async () => {
        await offServerHere();
        const destination = stagingDestination({}, false);

        const result = await service.move('isle', REMOTE, 'ada');

        expect(result).toMatchObject({ success: true });
        expect(destination.uploads.every(upload => upload.offset === 0 && upload.start === 0)).toBe(true);
      });
    });

    describe('a dropped connection', () => {
      it('retries the file, carrying it on from where the destination\'s copy ends', async () => {
        await offServerHere();
        const destination = stagingDestination();
        dropUploadsOf(SAVE, 1, staged => staged.set(SAVE, 'wor'), destination.staged);

        const result = await untilSettled(service.move('isle', REMOTE, 'ada'));

        expect(result).toMatchObject({ success: true });
        expect(destination.begins).toContainEqual({ serverId: 'isle', resume: true, rels: [SAVE] });
        expect(destination.uploads.filter(upload => upload.rel === SAVE)).toEqual([{ rel: SAVE, offset: 3, start: 3 }]);
        expect(destination.staged.get(SAVE)).toBe('world');
      });

      it('retries a destination that cannot carry a file on from the start of that file, without wiping the rest', async () => {
        await offServerHere();
        const destination = stagingDestination({}, false);
        dropUploadsOf(SAVE, 1);

        const result = await untilSettled(service.move('isle', REMOTE, 'ada'));

        expect(result).toMatchObject({ success: true });
        expect(destination.begins).toHaveLength(1);
        expect(destination.uploads.filter(upload => upload.rel === SAVE)).toEqual([{ rel: SAVE, offset: 0, start: 0 }]);
      });

      it('gives up after three retries and leaves the server where it was, off', async () => {
        await offServerHere();
        stagingDestination();
        const attempts = dropUploadsOf(SAVE, 99);

        const result = await untilSettled(service.move('isle', REMOTE, 'ada'));

        expect(result).toEqual(expect.objectContaining({ success: false, error: expect.stringContaining('socket hang up') }));
        expect(attempts()).toBe(4);
        expect((await repo.getServer('isle'))?.nodeId).toBe(LOCAL);
        expect(localRuntime.start).not.toHaveBeenCalled();
      });

      it('does not retry a file the destination refused', async () => {
        await offServerHere();
        stagingDestination();
        let attempts = 0;
        jest.mocked(peerUpload).mockImplementation(async () => {
          attempts++;
          return { status: 400, body: { error: 'Checkpoint path is not inside the instance.' } };
        });

        const result = await service.move('isle', REMOTE, 'ada');

        expect(result).toEqual(expect.objectContaining({ success: false, error: 'Checkpoint path is not inside the instance.' }));
        expect(attempts).toBe(1);
      });
    });

    it('reports how far it has got to every screen showing the server', async () => {
      await offServerHere();
      stagingDestination({ 'config.json': '{"id":"isle"}', [SAVE]: 'wo' });
      jest.mocked(messagingService.sendToAll).mockClear();

      await service.move('isle', REMOTE, 'ada');

      const reports = jest.mocked(messagingService.sendToAll).mock.calls
        .filter(([channel]) => channel === 'server-move-progress').map(([, data]) => data as Record<string, unknown>);
      expect(reports.map(report => report.phase)).toEqual(['preparing', 'checking', 'copying', 'copying', 'verifying']);
      expect(reports[2]).toEqual({ instanceId: 'isle', destinationName: REMOTE.slice(0, 4), phase: 'copying', bytesDone: 15, bytesTotal: 18, resumedBytes: 15 });
      expect(reports[3]).toMatchObject({ phase: 'copying', bytesDone: 18, bytesTotal: 18 });
    });

    it('keeps the files of an interrupted move it is receiving, and carries them on', async () => {
      await service.resumeIfJoined();
      const peer = jest.mocked(startPeerServer).mock.calls[0][1];
      await peer.onCheckpointBegin!({ serverId: 'isle' });
      await peer.onCheckpointFile!('isle', SAVE, Readable.from(Buffer.from('wor')), 0);

      const held = await peer.onCheckpointBegin!({ serverId: 'isle', resume: true });
      await peer.onCheckpointFile!('isle', SAVE, Readable.from(Buffer.from('ld')), 3);

      expect(held).toEqual([{ rel: SAVE, size: 3, sha256: createHash('sha256').update('wor').digest('hex') }]);
      expect(fs.readFileSync(path.join(root, 'AASMServer', 'ShooterGame', 'Saved', 'MeshIncoming', 'isle', SAVE), 'utf8')).toBe('world');
    });

    it('moves a server that is off: streams its files, commits, sets its copy aside, and it arrives off', async () => {
      await repo.upsertNode(nodeRow(REMOTE, '2', 'https://10.0.0.2:4747'));
      await place('isle', LOCAL, 'stopped');
      writeInstance('isle');
      await service.resumeIfJoined();
      await jest.advanceTimersByTimeAsync(5_000);
      const uploaded = destination();
      await repo.setDesiredState('isle', LOCAL, 'running'); // left over from a crash, say

      const result = await service.move('isle', REMOTE, 'ada');
      await jest.advanceTimersByTimeAsync(5_000);

      expect(result).toMatchObject({ success: true });
      expect(checkpointCalls()[0]).toBe('https://10.0.0.2:4747/v1/checkpoint/begin');
      expect(checkpointCalls()).toContain('https://10.0.0.2:4747/v1/checkpoint/finish');
      expect(Object.fromEntries(uploaded)).toEqual({ 'config.json': '{"id":"isle"}', [SAVE]: 'world' });
      expect(await repo.getServer('isle')).toMatchObject({ nodeId: REMOTE, desiredState: 'stopped' });
      expect(fs.existsSync(path.join(servers, 'isle'))).toBe(false);
      expect(localRuntime.start).not.toHaveBeenCalled();
    });

    it('refuses to move a server that is not off, and leaves it running', async () => {
      await repo.upsertNode(nodeRow(REMOTE, '2', 'https://10.0.0.2:4747'));
      await place('isle', LOCAL);
      writeInstance('isle');
      await service.resumeIfJoined();
      destination();

      for (const state of ['running', 'starting', 'stopping', 'queued']) {
        states.set('isle', state);
        expect(await service.move('isle', REMOTE, 'ada')).toEqual({ success: false, error: 'Stop the server before moving it.' });
      }

      expect(localRuntime.stop).not.toHaveBeenCalled();
      expect(checkpointCalls()).toEqual([]);
      expect((await repo.getServer('isle'))?.nodeId).toBe(LOCAL);
    });

    it('keeps the server here, and off, when the destination computes a different checksum', async () => {
      await repo.upsertNode(nodeRow(REMOTE, '2', 'https://10.0.0.2:4747'));
      await place('isle', LOCAL, 'stopped');
      writeInstance('isle');
      await service.resumeIfJoined();
      destination('not-the-same');

      const result = await service.move('isle', REMOTE, 'ada');

      expect(result.success).toBe(false);
      expect((await repo.getServer('isle'))?.nodeId).toBe(LOCAL);
      expect(fs.existsSync(path.join(servers, 'isle', 'config.json'))).toBe(true);
      expect(localRuntime.start).not.toHaveBeenCalled();
    });

    // A start from anywhere while the files are on their way would leave two diverging copies.
    it('marks the server as being moved while its files are copied, and not after', async () => {
      await repo.upsertNode(nodeRow(REMOTE, '2', 'https://10.0.0.2:4747'));
      await place('isle', LOCAL, 'stopped');
      writeInstance('isle');
      await service.resumeIfJoined();
      destination();
      const duringCopy: boolean[] = [];
      const upload = jest.mocked(peerUpload).getMockImplementation()!;
      jest.mocked(peerUpload).mockImplementation(async options => {
        duringCopy.push(isServerMoving('isle'));
        return upload(options);
      });

      await service.move('isle', REMOTE, 'ada');

      expect(duringCopy.length).toBeGreaterThan(0);
      expect(duringCopy.every(Boolean)).toBe(true);
      expect(isServerMoving('isle')).toBe(false);
    });

    it('refuses a second move of a server that is already being moved', async () => {
      await repo.upsertNode(nodeRow(REMOTE, '2', 'https://10.0.0.2:4747'));
      await repo.upsertNode(nodeRow(THIRD, '3', 'https://10.0.0.3:4747'));
      await place('isle', LOCAL, 'stopped');
      writeInstance('isle');
      await service.resumeIfJoined();
      destination();
      let finishCopy: () => void = () => undefined;
      const upload = jest.mocked(peerUpload).getMockImplementation()!;
      jest.mocked(peerUpload).mockImplementation(async options => {
        await new Promise<void>(resolve => { finishCopy = resolve; });
        return upload(options);
      });

      const first = service.move('isle', REMOTE, 'ada');
      await jest.advanceTimersByTimeAsync(0);
      const second = await service.move('isle', THIRD, 'ada');
      finishCopy();
      await jest.advanceTimersByTimeAsync(0);
      jest.mocked(peerUpload).mockImplementation(upload);
      finishCopy();

      expect(second).toEqual({ success: false, error: 'That server is already being moved.' });
      expect(await first).toMatchObject({ success: true });
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
      for (const [rel, text] of contents) await peer.onCheckpointFile!('isle', rel, Readable.from(Buffer.from(text)), 0);
      expect(await peer.onCheckpointFinish!({ serverId: 'isle', rels: contents.map(([rel]) => rel) })).toEqual({ checksum: checksumOf(contents) });
      await jest.advanceTimersByTimeAsync(5_000);
      expect(fs.existsSync(path.join(servers, 'isle'))).toBe(false);

      await place('isle', LOCAL); // the source commits the placement
      await jest.advanceTimersByTimeAsync(5_000);

      expect(fs.readFileSync(path.join(servers, 'isle', SAVE), 'utf8')).toBe('world');
      expect(jest.mocked(localRuntime.start).mock.calls).toEqual([['isle']]);
    });

    it('clears out the files of a move that was abandoned more than a day ago', async () => {
      const stale = path.join(root, 'AASMServer', 'ShooterGame', 'Saved', 'MeshIncoming', 'isle');
      fs.mkdirSync(stale, { recursive: true });
      fs.writeFileSync(path.join(stale, 'config.json'), '{}');
      const dayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
      fs.utimesSync(path.join(stale, 'config.json'), dayAgo, dayAgo);
      fs.utimesSync(stale, dayAgo, dayAgo);

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

    // Each machine counts down and restarts its own servers, at the same time as the others.
    describe('restarts with a warning', () => {
      const command = (operation: string, extra: Record<string, unknown> = {}) => ({
        commandId: `r-${operation}`, correlationId: 'c', actor: 'ada', targetNode: LOCAL, operation, serverId: 'a',
        expiry: Date.now() + 60_000, issuedAt: Date.now(), expectedRevision: null, ...extra
      }) as never;

      beforeEach(async () => {
        await place('a', LOCAL);
        await place('b', LOCAL);
        await service.resumeIfJoined();
        jest.mocked(restartCountdowns.begin).mockClear();
        jest.mocked(localRuntime.stop).mockClear();
      });

      it('counts down a restart sent with minutes of warning, rather than restarting now', async () => {
        const result = await service.executeLocalCommand(command('restart', { args: { warningMinutes: 15 } }));

        expect(restartCountdowns.begin).toHaveBeenCalledWith(['a'], 15, false, expect.any(Function));
        expect(localRuntime.stop).not.toHaveBeenCalled();
        expect(result).toMatchObject({ success: true, detail: { dueAt: 900_000 } });
      });

      it('cancels a server\'s restart', async () => {
        const result = await service.executeLocalCommand(command('cancel-restart'));

        expect(restartCountdowns.cancel).toHaveBeenCalledWith('a');
        expect(result.success).toBe(true);
      });

      it('counts down the listed servers that are running, then stops them and starts them in order', async () => {
        jest.mocked(localRuntime.state).mockImplementation(id => (id === 'a' ? 'running' : 'stopped'));
        jest.mocked(localRuntime.stopAll).mockResolvedValue({ stopped: ['a'], failed: [] });
        jest.mocked(localRuntime.startAll).mockResolvedValue({ started: ['a'], failed: [] });

        const result = await service.executeLocalCommand(command('restart-all', { serverId: LOCAL, serverIds: ['a', 'b'], args: { warningMinutes: 15 } }));
        expect(restartCountdowns.begin).toHaveBeenCalledWith(['a'], 15, true, expect.any(Function));
        expect(result.success).toBe(true);

        await jest.mocked(restartCountdowns.begin).mock.calls[0][3](['a']);
        expect(localRuntime.stopAll).toHaveBeenCalledWith(['a']);
        expect(localRuntime.startAll).toHaveBeenCalledWith(['a']);
        expect((await repo.getServer('a'))?.desiredState).toBe('running');
      });

      it('restarts them at once when there is to be no warning', async () => {
        jest.mocked(localRuntime.state).mockImplementation(() => 'running');
        jest.mocked(localRuntime.stopAll).mockResolvedValue({ stopped: ['a', 'b'], failed: [] });
        jest.mocked(localRuntime.startAll).mockResolvedValue({ started: ['a', 'b'], failed: [] });

        await service.executeLocalCommand(command('restart-all', { serverId: LOCAL, serverIds: ['a', 'b'], args: { warningMinutes: 0 } }));

        expect(restartCountdowns.begin).not.toHaveBeenCalled();
        expect(localRuntime.startAll).toHaveBeenCalledWith(['a', 'b']);
      });

      it('cancels a restart of all', async () => {
        const result = await service.executeLocalCommand(command('cancel-restart-all', { serverId: LOCAL }));

        expect(restartCountdowns.cancelAll).toHaveBeenCalled();
        expect(result).toMatchObject({ success: true, detail: { cancelled: ['a'] } });
      });

      it('sends the minutes of warning to each other machine', async () => {
        await service.commandHosts('restart-all', new Map([[REMOTE, ['c']]]), 'ada', { warningMinutes: 15 });

        expect(commands()[0].body).toMatchObject({ operation: 'restart-all', serverIds: ['c'], args: { warningMinutes: 15 } });
      });
    });

    // A machine that is lost must not take its servers' backups with it.
    describe('a copy of the latest backup on another machine', () => {
      const THIRD = '33333333-3333-4333-8333-333333333333';
      const backup = (instanceId = 'isle') => ({
        id: 'b1', instanceId, name: 'backup', createdAt: new Date(), size: 5, type: 'manual' as const,
        filePath: path.join(root, 'backups', instanceId, 'backup_manual_1.zip')
      });
      const fromNodes = (operation: string) => commands().filter(command => (command.body as { operation: string }).operation === operation);
      const peer = () => jest.mocked(startPeerServer).mock.calls[0][1];

      beforeEach(async () => {
        await repo.upsertNode({ ...nodeRow(REMOTE, '2', 'https://10.0.0.2:4747'), capabilities: { ...nodeRow(REMOTE).capabilities, freeDiskBytes: 100 } });
        await repo.upsertNode({ ...nodeRow(THIRD, '3', 'https://10.0.0.3:4747'), capabilities: { ...nodeRow(THIRD).capabilities, freeDiskBytes: 900 } });
        await place('isle', LOCAL);
        await service.resumeIfJoined();
        peer().onHeartbeat(REMOTE, Date.now());
        peer().onHeartbeat(THIRD, Date.now());
        jest.mocked(peerRequest).mockClear();
        jest.mocked(peerRequest).mockResolvedValue({ status: 200, body: { success: true } });
        jest.mocked(backupCopies.recordSent).mockClear();
      });

      const backupMade = async (made = backup()) => {
        await jest.mocked(backupService.onBackupCreated).mock.calls.at(-1)![0](made);
        await jest.advanceTimersByTimeAsync(0);
      };

      it('asks the reachable machine with the most free disk to keep a copy of each new backup', async () => {
        await backupMade();

        expect(fromNodes('take-backup-copy')).toHaveLength(1);
        expect(fromNodes('take-backup-copy')[0].url).toBe('https://10.0.0.3:4747/v1/command');
        expect(fromNodes('take-backup-copy')[0].body).toMatchObject({
          serverId: 'isle', targetNode: THIRD, args: { fileName: 'backup_manual_1.zip', size: 5, fromNodeId: LOCAL }
        });
        expect(backupCopies.recordSent).toHaveBeenCalledWith('isle', expect.objectContaining({ nodeId: THIRD, fileName: 'backup_manual_1.zip', size: 5 }));
      });

      // Only the latest: a copy an earlier backup left on another machine goes.
      it('has the other machines drop a copy an earlier backup left there', async () => {
        await backupMade();

        expect(fromNodes('drop-backup-copy').map(command => command.url)).toEqual(['https://10.0.0.2:4747/v1/command']);
      });

      it('keeps no copy when no other machine can be reached', async () => {
        // The others go quiet: nothing answers this machine's heartbeats either.
        jest.mocked(peerRequest).mockRejectedValue(new Error('ECONNREFUSED'));
        await jest.advanceTimersByTimeAsync(10 * 60_000);
        jest.mocked(peerRequest).mockClear();

        await backupMade();

        expect(fromNodes('take-backup-copy')).toEqual([]);
        expect(backupCopies.recordSent).not.toHaveBeenCalled();
      });

      it('fetches a copy from the machine that made the backup, when asked to keep one', async () => {
        jest.mocked(peerDownload).mockResolvedValue(true);
        const result = await service.executeLocalCommand({
          commandId: 'c1', correlationId: 'c', actor: 'backup', targetNode: LOCAL, operation: 'take-backup-copy', serverId: 'far',
          args: { serverName: 'Far', fileName: 'backup_manual_1.zip', size: 5, fromNodeId: REMOTE, fromNodeName: 'asa-1' },
          expiry: Date.now() + 60_000, issuedAt: Date.now(), expectedRevision: null
        } as never);

        expect(result.success).toBe(true);
        const [copy, fetch] = jest.mocked(backupCopies.hold).mock.calls.at(-1)!;
        expect(copy).toEqual({ serverId: 'far', serverName: 'Far', fileName: 'backup_manual_1.zip', size: 5, fromNodeId: REMOTE, fromNodeName: 'asa-1' });
        await fetch('/tmp/part');
        expect(jest.mocked(peerDownload).mock.calls.at(-1)![0]).toMatchObject({
          url: 'https://10.0.0.2:4747/v1/backup-file?serverId=far&fileName=backup_manual_1.zip', dest: '/tmp/part'
        });
      });

      it('drops a copy when asked', async () => {
        await service.executeLocalCommand({
          commandId: 'c2', correlationId: 'c', actor: 'backup', targetNode: LOCAL, operation: 'drop-backup-copy', serverId: 'far',
          expiry: Date.now() + 60_000, issuedAt: Date.now(), expectedRevision: null
        } as never);

        expect(backupCopies.drop).toHaveBeenCalledWith('far');
      });

      it('lets another machine fetch only the backups of servers it hosts', async () => {
        // Known to be hosted here once the first check of the servers has run.
        await jest.advanceTimersByTimeAsync(5_000);
        const dir = BackupPathUtils.getInstanceBackupDir(path.join(root, 'servers', 'isle'));
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'backup_manual_1.zip'), '12345');

        expect(peer().onBackupFile!('isle', 'backup_manual_1.zip')).toBe(path.join(dir, 'backup_manual_1.zip'));
        expect(peer().onBackupFile!('isle', '../../secret.zip')).toBeNull();
        expect(peer().onBackupFile!('isle', 'missing.zip')).toBeNull();
        expect(peer().onBackupFile!('far', 'backup_manual_1.zip')).toBeNull();
      });

      it('lets another machine fetch the copy it keeps', () => {
        jest.mocked(backupCopies.heldPath).mockReturnValueOnce('/copies/far/backup_manual_1.zip');

        expect(peer().onBackupCopyFile!('far')).toBe('/copies/far/backup_manual_1.zip');
      });

      it('brings the copy back from the machine keeping it, into the server\'s backups', async () => {
        jest.mocked(backupCopies.sent).mockReturnValue({ nodeId: REMOTE, nodeName: 'asa-1', fileName: 'backup_manual_1.zip', size: 5, copiedAt: 1 });
        jest.mocked(peerDownload).mockResolvedValue(true);

        const result = await service.executeLocalCommand({
          commandId: 'c3', correlationId: 'c', actor: 'ada', targetNode: LOCAL, operation: 'fetch-backup-copy', serverId: 'isle',
          expiry: Date.now() + 60_000, issuedAt: Date.now(), expectedRevision: null
        } as never);

        expect(result.success).toBe(true);
        expect(jest.mocked(peerDownload).mock.calls.at(-1)![0]).toMatchObject({
          url: 'https://10.0.0.2:4747/v1/backup-copy-file?serverId=isle',
          dest: path.join(BackupPathUtils.getInstanceBackupDir(path.join(root, 'servers', 'isle')), 'backup_manual_1.zip')
        });
      });

      it('says where the latest copy of a server it hosts is', async () => {
        jest.mocked(backupCopies.sent).mockReturnValue({ nodeId: REMOTE, nodeName: 'asa-1', fileName: 'backup_manual_1.zip', size: 5, copiedAt: 1 });

        expect(await peer().onQuery!({ serverId: 'isle', query: 'backup-copy', args: {} }))
          .toEqual({ copy: { nodeId: REMOTE, nodeName: 'asa-1', fileName: 'backup_manual_1.zip', size: 5, copiedAt: 1 } });
      });
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

    function command(operation: 'rcon' | 'save-ini' | 'set-ownership' | 'connect-rcon' | 'ark-api', args: Record<string, unknown>) {
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

    // The pages of a server on another machine (backups, automation and the rest) act there.
    describe('requests about a server on another machine', () => {
      const sender = { send: jest.fn() } as never;

      beforeEach(async () => {
        jest.mocked(peerRequest).mockReset();
        jest.mocked(peerRequest).mockResolvedValue({ status: 200, body: { success: true } });
        await place('isle', LOCAL);
        await place('far', REMOTE);
        await service.resumeIfJoined();
      });

      /** What the machine hosting far answers, by the route asked. */
      const answers = (query: unknown, command: unknown) => jest.mocked(peerRequest).mockImplementation(async options =>
        ({ status: 200, body: options.url.endsWith('/v1/query') ? query : options.url.endsWith('/v1/command') ? command : { success: true } }) as never);

      // Opened in Windows Firewall with the server ports, while this machine is in a mesh.
      it('says which ports it listens on for the mesh, and forgets them when it leaves', async () => {
        expect(meshListenPorts()).toEqual({ peer: 4747, raft: 4002 });

        await service.leaveWithoutQuorum();

        expect(meshListenPorts()).toBeNull();
      });

      it('passes a read to the machine hosting the server as a query, and answers with its reply', async () => {
        answers({ backups: ['b1'] }, null);

        const reply = await routeToHost('get-backup-list', 'far', { instanceId: 'far' }, true, sender);

        expect(reply).toEqual({ backups: ['b1'] });
        const sent = jest.mocked(peerRequest).mock.calls.map(([options]) => options).filter(options => options.url.endsWith('/v1/query')).at(-1)!;
        expect(sent.url).toBe('https://10.0.0.2:4747/v1/query');
        expect(sent.body).toEqual({ serverId: 'far', query: 'server-request', args: { channel: 'get-backup-list', payload: { instanceId: 'far' } } });
      });

      it('passes a change as a command, and answers with the reply the handler gave there', async () => {
        answers(null, { success: true, detail: { success: true, backupId: 'b2' } });

        const reply = await routeToHost('create-backup', 'far', { instanceId: 'far', type: 'manual' }, false, sender);

        expect(reply).toEqual({ success: true, backupId: 'b2' });
        const sent = jest.mocked(peerRequest).mock.calls.map(([options]) => options).filter(options => options.url.endsWith('/v1/command')).at(-1)!;
        expect(sent.url).toBe('https://10.0.0.2:4747/v1/command');
        expect(sent.body).toMatchObject({ operation: 'server-request', serverId: 'far', args: { channel: 'create-backup', payload: { instanceId: 'far', type: 'manual' } } });
      });

      it('leaves a server hosted here to this machine', async () => {
        await expect(routeToHost('get-backup-list', 'isle', { instanceId: 'isle' }, true, sender)).resolves.toBeNull();
      });

      it('runs the request another machine passed here, for a server it hosts', async () => {
        registerForwardable('get-test-list', true, async payload => ({ items: [payload.instanceId] }));
        registerForwardable('make-test', false, async payload => ({ success: true, made: payload.instanceId }));
        const peer = jest.mocked(startPeerServer).mock.calls[0][1];

        expect(await peer.onQuery!({ serverId: 'isle', query: 'server-request', args: { channel: 'get-test-list', payload: { instanceId: 'isle' } } }))
          .toEqual({ items: ['isle'] });
        const result = await service.executeLocalCommand({
          commandId: 'sr-1', correlationId: 'c', actor: 'ada', targetNode: LOCAL, operation: 'server-request', serverId: 'isle',
          args: { channel: 'make-test', payload: { instanceId: 'isle' } }, expiry: Date.now() + 60_000, issuedAt: Date.now(), expectedRevision: null
        } as never);
        expect(result).toMatchObject({ success: true, detail: { success: true, made: 'isle' } });
      });

      // Download on the desktop shows the file in the file explorer: it has to be on this machine.
      it('fetches a backup of a server on another machine here, to download', async () => {
        answers({ success: true, fileName: 'backup_manual_3.zip' }, null);
        jest.mocked(peerDownload).mockResolvedValue(true);

        const result = await service.fetchBackupForDownload('far', 'b3');

        const asked = jest.mocked(peerRequest).mock.calls.map(([options]) => options).filter(options => options.url.endsWith('/v1/query')).at(-1)!;
        expect(asked.body).toEqual({ serverId: 'far', query: 'server-request', args: { channel: 'locate-backup', payload: { instanceId: 'far', backupId: 'b3' } } });
        const dest = path.join(root, 'downloads', 'far', 'backup_manual_3.zip');
        expect(jest.mocked(peerDownload).mock.calls.at(-1)![0]).toMatchObject({
          url: 'https://10.0.0.2:4747/v1/backup-file?serverId=far&fileName=backup_manual_3.zip', dest
        });
        expect(result).toEqual({ success: true, filePath: dest, fileName: 'backup_manual_3.zip' });
      });

      it('leaves a backup of a server here alone', async () => {
        await expect(service.fetchBackupForDownload('isle', 'b1')).resolves.toBeNull();
      });

      it('refuses to run a change that came as a read', async () => {
        registerForwardable('change-test', false, async () => ({ success: true }));
        const peer = jest.mocked(startPeerServer).mock.calls[0][1];

        await expect(peer.onQuery!({ serverId: 'isle', query: 'server-request', args: { channel: 'change-test', payload: {} } }))
          .rejects.toThrow('change-test cannot be run for another machine.');
      });
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

    it('answers with the settings a server it hosts started with', async () => {
      await place('isle', LOCAL);
      await service.resumeIfJoined();
      const peer = jest.mocked(startPeerServer).mock.calls[0][1];

      expect(await peer.onQuery!({ serverId: 'isle', query: 'started-config', args: {} })).toEqual({ config: { id: 'isle', maxPlayers: 70 } });
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

    // The host's activity named nobody: the name came with the command and went no further.
    describe('crediting what another machine asked for, in this machine\'s activity', () => {
      beforeEach(async () => {
        await place('isle', LOCAL);
        await service.resumeIfJoined();
        jest.mocked(localRuntime.rcon).mockResolvedValue({ instanceId: 'isle', response: '' } as never);
      });

      it('credits whoever sent it, once however often the command arrives', async () => {
        await service.executeLocalCommand(command('rcon', { command: 'ListPlayers' }));
        await service.executeLocalCommand(command('rcon', { command: 'ListPlayers' }));

        expect(messagingService.noteForwardedAction).toHaveBeenCalledTimes(1);
        expect(messagingService.noteForwardedAction)
          .toHaveBeenCalledWith('rcon-command', expect.objectContaining({ instanceId: 'isle', command: 'ListPlayers' }), 'ada');
      });

      it('credits nobody for the desktop before anyone signed in, or for the app\'s own copies', async () => {
        await service.executeLocalCommand({ ...command('rcon', { command: 'ListPlayers' }), commandId: 'c-desktop', actor: 'desktop' });
        await service.executeLocalCommand({ ...command('rcon', { command: 'ListPlayers' }), commandId: 'c-backup', actor: 'backup' });

        expect(jest.mocked(messagingService.noteForwardedAction).mock.calls.map(call => call[2])).toEqual([null, null]);
      });

      it('credits a page\'s request under the page\'s own channel', async () => {
        await service.executeLocalCommand({
          ...command('rcon', {}), commandId: 'c-request', operation: 'server-request',
          args: { channel: 'delete-backup', payload: { instanceId: 'isle', backupId: 'b1' } }
        } as never);

        expect(messagingService.noteForwardedAction).toHaveBeenCalledWith('delete-backup', { instanceId: 'isle', backupId: 'b1' }, 'ada');
      });

      it('credits a stop under the channel the activity knows', async () => {
        jest.mocked(localRuntime.stop).mockResolvedValue({ success: true, instanceId: 'isle' } as never);

        await service.executeLocalCommand({ ...command('rcon', {}), commandId: 'c-stop', operation: 'stop' } as never);

        expect(messagingService.noteForwardedAction).toHaveBeenCalledWith('stop-server-instance', expect.objectContaining({ instanceId: 'isle' }), 'ada');
      });
    });

    // The ArkApi tab acted on the machine it was opened on, wherever the server ran.
    it('answers an ArkApi read about a server it hosts, and refuses a change sent as a read', async () => {
      await place('isle', LOCAL);
      await service.resumeIfJoined();
      jest.mocked(runArkApiAction).mockResolvedValue({ success: true, plugins: [] });
      const peer = jest.mocked(startPeerServer).mock.calls[0][1];

      expect(await peer.onQuery!({ serverId: 'isle', query: 'ark-api', args: { action: 'list' } })).toEqual({ success: true, plugins: [] });
      expect(runArkApiAction).toHaveBeenCalledWith('isle', 'list', { action: 'list' });
      await expect(peer.onQuery!({ serverId: 'isle', query: 'ark-api', args: { action: 'remove', folderName: 'x' } })).rejects.toThrow(/not a read/);
    });

    it('makes an ArkApi change on the host and returns what came of it', async () => {
      await place('isle', LOCAL);
      await service.resumeIfJoined();
      jest.mocked(runArkApiAction).mockResolvedValue({ success: true, folderName: 'Permissions' });

      const result = await service.executeLocalCommand(command('ark-api', { action: 'remove', folderName: 'Permissions' }));

      expect(runArkApiAction).toHaveBeenCalledWith('isle', 'remove', { action: 'remove', folderName: 'Permissions' });
      expect(result).toMatchObject({ success: true, detail: { success: true, folderName: 'Permissions' } });
    });

    it('says why the host could not make an ArkApi change', async () => {
      await place('isle', LOCAL);
      await service.resumeIfJoined();
      jest.mocked(runArkApiAction).mockResolvedValue({ success: false, error: 'That ZIP is larger than 50 MB.' });

      const result = await service.executeLocalCommand(command('ark-api', { action: 'install-zip', zipData: 'x' }));

      expect(result).toMatchObject({ success: false, error: 'That ZIP is larger than 50 MB.' });
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
      // The other machine is up: it has just sent a heartbeat.
      jest.mocked(startPeerServer).mock.calls[0][1].onHeartbeat(REMOTE, Date.now());
    });

    // The move dialog may be open on another node than the one running the move.
    it('relays how far a move of a server it hosts has got', async () => {
      const progress = { instanceId: 'isle', phase: 'copying', bytesDone: 1, bytesTotal: 2, resumedBytes: 0 };

      messagingService.broadcastTap!('server-move-progress', progress);

      expect(await peerBroadcast()).toHaveBeenCalledWith({ type: 'server-event', nodeId: LOCAL, channel: 'server-move-progress', data: progress });
    });

    it('relays the live events of a server it hosts to the other nodes', async () => {
      messagingService.broadcastTap!('server-instance-log', { instanceId: 'isle', log: 'Server started' });

      expect(await peerBroadcast()).toHaveBeenCalledWith({
        type: 'server-event', nodeId: LOCAL, channel: 'server-instance-log', data: { instanceId: 'isle', log: 'Server started' }
      });
    });

    // A countdown on a server hosted here shows on every machine.
    it('relays a restart counting down on a server it hosts', async () => {
      messagingService.broadcastTap!('server-restart-pending', { instanceId: 'isle', dueAt: 900_000, all: false });

      expect(await peerBroadcast()).toHaveBeenCalledWith({
        type: 'server-event', nodeId: LOCAL, channel: 'server-restart-pending', data: { instanceId: 'isle', dueAt: 900_000, all: false }
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
      jest.mocked(localRuntime.startedAt).mockImplementation(id => (id === 'isle' ? 1_000 : null));
      const peer = jest.mocked(startPeerServer).mock.calls[0][1];

      expect(peer.onSubscribe!()).toEqual([
        { type: 'server-event', nodeId: LOCAL, channel: 'server-instance-state', data: { instanceId: 'isle', state: 'running', startedAt: 1_000 } }
      ]);
    });

    it('sends when a server it hosts started along with its running state, so other nodes show its uptime', async () => {
      jest.mocked(localRuntime.startedAt).mockReturnValue(1_000);

      messagingService.broadcastTap!('server-instance-state', { instanceId: 'isle', state: 'running' });

      expect(await peerBroadcast()).toHaveBeenCalledWith({
        type: 'server-event', nodeId: LOCAL, channel: 'server-instance-state', data: { instanceId: 'isle', state: 'running', startedAt: 1_000 }
      });
    });

    it('lists a remote server with the state its host last reported', async () => {
      subscriptions[0].onEvent({ type: 'server-event', nodeId: REMOTE, channel: 'server-instance-state', data: { instanceId: 'far', state: 'running' } });

      const listed = await service.withMeshServers([]);

      expect(listed.find(instance => instance.id === 'far')?.state).toBe('running');
    });

    it('lists a remote server with the uptime, players, CPU and memory its host last reported', async () => {
      const event = (channel: string, data: Record<string, unknown>) =>
        subscriptions[0].onEvent({ type: 'server-event', nodeId: REMOTE, channel, data: { instanceId: 'far', ...data } });
      event('server-instance-state', { state: 'running', startedAt: 1_000 });
      event('server-instance-players', { players: 5, count: 5 });
      event('server-instance-cpu', { cpu: 12 });
      event('server-instance-memory', { memory: 900 });

      const far = (await service.withMeshServers([])).find(instance => instance.id === 'far');

      expect(far).toMatchObject({ state: 'running', startedAt: 1_000, players: 5, cpu: 12, memory: 900 });
    });

    it('drops a remote server\'s figures once its host reports it stopped', async () => {
      const event = (channel: string, data: Record<string, unknown>) =>
        subscriptions[0].onEvent({ type: 'server-event', nodeId: REMOTE, channel, data: { instanceId: 'far', ...data } });
      event('server-instance-state', { state: 'running', startedAt: 1_000 });
      event('server-instance-players', { players: 5 });

      event('server-instance-state', { state: 'stopped' });

      const far = (await service.withMeshServers([])).find(instance => instance.id === 'far') as Record<string, unknown>;
      expect(far.state).toBe('stopped');
      expect(far.startedAt).toBeUndefined();
      expect(far.players).toBeUndefined();
    });

    // A machine that went quiet kept showing its servers as running, with players and uptime.
    describe('on a machine it cannot hear from', () => {
      const farListed = async () => (await service.withMeshServers([])).find(instance => instance.id === 'far') as Record<string, unknown>;

      beforeEach(() => {
        const event = (channel: string, data: Record<string, unknown>) =>
          subscriptions[0].onEvent({ type: 'server-event', nodeId: REMOTE, channel, data: { instanceId: 'far', ...data } });
        event('server-instance-state', { state: 'running', startedAt: 1_000 });
        event('server-instance-players', { players: 5 });
        // From here it answers nothing: not this machine's heartbeats either.
        jest.mocked(peerRequest).mockRejectedValue(new Error('connect ETIMEDOUT'));
      });

      it('lists the server as unreachable, without the figures it last reported', async () => {
        await jest.advanceTimersByTimeAsync(30_000);

        const far = await farListed();
        expect(far.state).toBe('unreachable');
        expect(far.players).toBeUndefined();
        expect(far.startedAt).toBeUndefined();
      });

      it('lists it as its host reports again once the machine is heard from', async () => {
        await jest.advanceTimersByTimeAsync(30_000);

        jest.mocked(startPeerServer).mock.calls[0][1].onHeartbeat(REMOTE, Date.now());

        expect(await farListed()).toMatchObject({ state: 'running', players: 5 });
      });

      it('tells the screens when the machine stops answering', async () => {
        await jest.advanceTimersByTimeAsync(10_000);
        jest.mocked(serverInstanceService.broadcastInstances).mockClear();

        await jest.advanceTimersByTimeAsync(10_000);
        expect(serverInstanceService.broadcastInstances).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(10_000);
        expect(serverInstanceService.broadcastInstances).toHaveBeenCalled();
      });
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

  describe('clusters', () => {
    const REMOTE = '22222222-2222-4222-8222-222222222222';
    const PLAYER = 'clusters/Islands/0002a1b2c3d4e5f60718293a4b5c6d7e';

    async function place(serverId: string, nodeId = LOCAL): Promise<void> {
      await repo.upsertServer({
        serverId, name: serverId === 'isle' ? 'The Isle' : serverId, nodeId, mapName: '', desiredState: 'stopped',
        configRevision: 1, configJson: '{}', clusterId: null, operatorUserId: null, managerUserId: null
      });
    }

    function folderOf(clusterId: string): string {
      return path.join(root, 'AASMServer', 'ShooterGame', 'Saved', 'AASMClusters', clusterId);
    }

    /** Fake time for the sync's timer, with real time between steps for its file reads. */
    async function letTimePass(ms: number): Promise<void> {
      const realImmediate = jest.requireActual<typeof import('timers')>('timers').setImmediate;
      for (let passed = 0; passed < ms; passed += 100) {
        await new Promise(resolve => realImmediate(resolve));
        await jest.advanceTimersByTimeAsync(100);
      }
      for (let turn = 0; turn < 20; turn++) await new Promise(resolve => realImmediate(resolve));
    }

    /**
     * Steps fake time, with real time between steps for the sync's file reads, until `check` holds.
     * With `advance` off only real time passes: whatever happens is not the sync's timer.
     */
    async function waitFor(check: () => boolean | Promise<boolean>, { advance = true, maxSteps = 400 } = {}): Promise<void> {
      const realImmediate = jest.requireActual<typeof import('timers')>('timers').setImmediate;
      for (let step = 0; step < maxSteps; step++) {
        if (await check()) return;
        await new Promise(resolve => realImmediate(resolve));
        if (advance) await jest.advanceTimersByTimeAsync(50);
      }
    }

    beforeEach(async () => {
      await repo.upsertNode(nodeRow(LOCAL, '1', 'https://127.0.0.1:4747'));
      await repo.upsertNode(nodeRow(REMOTE, '2', 'https://10.0.0.2:4747'));
      await place('isle');
      await place('ragnarok', REMOTE);
    });

    describe('managing them', () => {
      beforeEach(async () => {
        await service.resumeIfJoined();
      });

      it('creates a cluster whose files the app keeps on every machine', async () => {
        const created = await service.createCluster({ name: 'Islands', arkClusterId: 'Islands' });

        expect(await repo.getCluster(created.clusterId)).toMatchObject({ name: 'Islands', arkClusterId: 'Islands' });
        expect(await repo.getStorage(created.storageProfileId!)).toMatchObject({ mode: 'managed' });
        expect(await service.listClusters()).toEqual([expect.objectContaining({ clusterId: created.clusterId, managed: true })]);
      });

      it('has no shared folder to check for a cluster whose files the app keeps', async () => {
        const created = await service.createCluster({ name: 'Islands', arkClusterId: 'Islands' });

        const storage = await service.validateCluster(created.clusterId);

        expect(storage?.health).toMatchObject({ ok: true, degraded: false });
        expect((await repo.getStorage(created.storageProfileId!))?.health).toMatchObject({ ok: true, degraded: false });
      });

      it('holds more than one cluster', async () => {
        await service.createCluster({ name: 'Islands', arkClusterId: 'Islands' });
        await service.createCluster({ name: 'Wilds', arkClusterId: 'Wilds' });

        expect((await repo.listClusters()).map(cluster => cluster.name)).toEqual(['Islands', 'Wilds']);
      });

      it('refuses a name or a cluster ID ARK and every machine\'s folders cannot take, or one already used', async () => {
        await expect(service.createCluster({ name: '  ', arkClusterId: 'Islands' })).rejects.toThrow('Enter a name for the cluster.');
        await expect(service.createCluster({ name: 'Islands', arkClusterId: 'my cluster' }))
          .rejects.toThrow('A cluster ID can use letters, digits, dots, dashes and underscores');
        await service.createCluster({ name: 'Islands', arkClusterId: 'Islands' });
        await expect(service.createCluster({ name: 'Other', arkClusterId: 'Islands' }))
          .rejects.toThrow('Another cluster already uses the ID Islands.');
      });

      it('renames a cluster, keeping its ID', async () => {
        const created = await service.createCluster({ name: 'Islands', arkClusterId: 'Islands' });

        await service.renameCluster(created.clusterId, 'Isles');

        expect(await repo.getCluster(created.clusterId)).toMatchObject({ name: 'Isles', arkClusterId: 'Islands' });
      });

      it('removes a cluster, and keeps its files on every machine', async () => {
        const created = await service.createCluster({ name: 'Islands', arkClusterId: 'Islands' });
        fs.mkdirSync(path.join(folderOf(created.clusterId), 'clusters', 'Islands'), { recursive: true });
        fs.writeFileSync(path.join(folderOf(created.clusterId), PLAYER), 'kept');

        await service.deleteCluster(created.clusterId);

        expect(await repo.getCluster(created.clusterId)).toBeNull();
        expect(fs.readFileSync(path.join(folderOf(created.clusterId), PLAYER), 'utf8')).toBe('kept');
      });

      it('needs quorum to change clusters', async () => {
        view.hasQuorum = false;
        view.leaderNodeId = null;
        await jest.advanceTimersByTimeAsync(5_000);

        await expect(service.createCluster({ name: 'Islands', arkClusterId: 'Islands' })).rejects.toThrow();
      });

      it('keeps a copy of the mesh\'s clusters on this machine, which its servers start with', async () => {
        const created = await service.createCluster({ name: 'Islands', arkClusterId: 'Islands' });

        await jest.advanceTimersByTimeAsync(5_000);

        expect(knownClusters()).toEqual([{ clusterId: created.clusterId, name: 'Islands', arkClusterId: 'Islands' }]);
      });

      it('tells this machine\'s screens when another machine changes the clusters', async () => {
        await jest.advanceTimersByTimeAsync(5_000);
        jest.mocked(messagingService.sendToAll).mockClear();
        await repo.upsertCluster({ clusterId: 'c-remote', name: 'Wilds', arkClusterId: 'Wilds', storageProfileId: null, members: [] });

        await jest.advanceTimersByTimeAsync(5_000);
        await jest.advanceTimersByTimeAsync(5_000);

        expect(jest.mocked(messagingService.sendToAll).mock.calls.filter(([channel]) => channel === 'clusters-changed')).toHaveLength(1);
      });

      it('brings a mesh made by an older version up to date', async () => {
        db.exec('DROP TABLE cluster_files');
        db.exec('DROP TABLE machine_admins');
        db.exec("UPDATE meta SET value = '1' WHERE key = 'schema_version'");

        await jest.advanceTimersByTimeAsync(5_000);

        expect(await repo.listClusterFiles('any')).toEqual([]);
        expect(await repo.listMachineAdmins()).toEqual([]);
        expect(db.all("SELECT name FROM sqlite_master WHERE name = 'machine_admins'")).toHaveLength(1);
        expect(await repo.schemaVersion()).toBe(3);
      });
    });

    describe('this machine\'s own clusters, when it creates or joins a mesh', () => {
      const marker = () => path.join(root, 'mesh', 'adopt-clusters');

      it('are brought into the mesh', async () => {
        rememberClusters([{ clusterId: 'c-local', name: 'Local', arkClusterId: 'LocalCluster' }]);
        fs.writeFileSync(marker(), '');

        await service.resumeIfJoined();
        await jest.advanceTimersByTimeAsync(5_000);

        expect(await repo.getCluster('c-local')).toMatchObject({ name: 'Local', arkClusterId: 'LocalCluster' });
        expect(fs.existsSync(marker())).toBe(false);
        expect(knownClusters().map(cluster => cluster.clusterId)).toEqual(['c-local']);
      });

      it('link to the mesh\'s cluster with the same ID, bringing their servers and files', async () => {
        await repo.upsertStorage({
          storageProfileId: 'p-mesh', mode: 'managed', authorityNodeId: null, metadata: {},
          health: { ok: true, degraded: false, detail: '', checkedAt: 0, perNode: {} }
        });
        await repo.upsertCluster({ clusterId: 'c-mesh', name: 'Islands', arkClusterId: 'Islands', storageProfileId: 'p-mesh', members: [] });
        rememberClusters([{ clusterId: 'c-local', name: 'My Islands', arkClusterId: 'Islands' }]);
        fs.mkdirSync(path.join(folderOf('c-local'), 'clusters', 'Islands'), { recursive: true });
        fs.writeFileSync(path.join(folderOf('c-local'), PLAYER), 'uploaded before joining');
        jest.mocked(localRuntime.listInstances).mockResolvedValue({ instances: [{ id: 'isle', clusterRef: 'c-local' }] } as never);
        jest.mocked(localRuntime.patchConfig).mockResolvedValue({} as never);
        fs.writeFileSync(marker(), '');

        await service.resumeIfJoined();
        await jest.advanceTimersByTimeAsync(5_000);

        expect(localRuntime.patchConfig).toHaveBeenCalledWith('isle', { clusterRef: 'c-mesh' });
        expect(fs.readFileSync(path.join(folderOf('c-mesh'), PLAYER), 'utf8')).toBe('uploaded before joining');
        expect(await repo.getCluster('c-local')).toBeNull();
      });

      it('never bring back a cluster removed from the mesh while this machine was away', async () => {
        rememberClusters([{ clusterId: 'c-old', name: 'Old', arkClusterId: 'Old' }]);

        await service.resumeIfJoined();
        await jest.advanceTimersByTimeAsync(5_000);

        expect(await repo.getCluster('c-old')).toBeNull();
        expect(knownClusters()).toEqual([]);
      });
    });

    describe('keeping their files in step', () => {
      beforeEach(async () => {
        await service.resumeIfJoined();
      });

      it('records a finished change to a cluster file on its own, and tells the other machines', async () => {
        const created = await service.createCluster({ name: 'Islands', arkClusterId: 'Islands' });
        fs.mkdirSync(path.join(folderOf(created.clusterId), 'clusters', 'Islands'), { recursive: true });
        fs.writeFileSync(path.join(folderOf(created.clusterId), PLAYER), 'uploaded here');

        await waitFor(async () => (await repo.listClusterFiles(created.clusterId)).length > 0);

        expect(await repo.listClusterFiles(created.clusterId)).toEqual([expect.objectContaining({ path: PLAYER, originNode: LOCAL })]);
        const broadcast = (await jest.mocked(startPeerServer).mock.results[0].value as { broadcast: jest.Mock }).broadcast;
        expect(broadcast).toHaveBeenCalledWith({ type: 'cluster-changed', nodeId: LOCAL, clusterId: created.clusterId });
      });

      it('fetches what another machine recorded from that machine, and places it here', async () => {
        const created = await service.createCluster({ name: 'Islands', arkClusterId: 'Islands' });
        const contents = 'uploaded on the other machine';
        const hash = createHash('sha256').update(contents).digest('hex');
        await repo.commitClusterFile({ clusterId: created.clusterId, path: PLAYER, sha256: hash, size: contents.length, deleted: false, originNode: REMOTE }, 0);
        jest.mocked(peerDownload).mockImplementation(async options => { fs.writeFileSync(options.dest, contents); return true; });

        await waitFor(() => fs.existsSync(path.join(folderOf(created.clusterId), PLAYER)));

        expect(jest.mocked(peerDownload).mock.calls[0][0].url).toBe(`https://10.0.0.2:4747/v1/cluster-object?sha256=${hash}`);
        expect(fs.readFileSync(path.join(folderOf(created.clusterId), PLAYER), 'utf8')).toBe(contents);
      });

      it('hands another machine the contents of what it recorded', async () => {
        const created = await service.createCluster({ name: 'Islands', arkClusterId: 'Islands' });
        fs.mkdirSync(path.join(folderOf(created.clusterId), 'clusters', 'Islands'), { recursive: true });
        fs.writeFileSync(path.join(folderOf(created.clusterId), PLAYER), 'served');
        await waitFor(async () => (await repo.listClusterFiles(created.clusterId)).length > 0);
        const [row] = await repo.listClusterFiles(created.clusterId);

        const served = jest.mocked(startPeerServer).mock.calls[0][1].onClusterObject!(row.sha256);

        expect(served && fs.readFileSync(served, 'utf8')).toBe('served');
      });

      it('looks at once when another machine says it recorded a change', async () => {
        await jest.advanceTimersByTimeAsync(5_000);
        const subscription = jest.mocked(subscribeEvents).mock.calls.at(-1)![0];
        const created = await service.createCluster({ name: 'Islands', arkClusterId: 'Islands' });
        const contents = 'just uploaded';
        const hash = createHash('sha256').update(contents).digest('hex');
        await repo.commitClusterFile({ clusterId: created.clusterId, path: PLAYER, sha256: hash, size: contents.length, deleted: false, originNode: REMOTE }, 0);
        jest.mocked(peerDownload).mockImplementation(async options => { fs.writeFileSync(options.dest, contents); return true; });

        subscription.onEvent({ type: 'cluster-changed', nodeId: REMOTE, clusterId: created.clusterId });
        await waitFor(() => fs.existsSync(path.join(folderOf(created.clusterId), PLAYER)), { advance: false });

        expect(fs.readFileSync(path.join(folderOf(created.clusterId), PLAYER), 'utf8')).toBe(contents);
      });

      describe('telling a player their upload is ready', () => {
        const EOS = '0002a1b2c3d4e5f60718293a4b5c6d7e';
        const MESSAGE = `ServerChatTo "${EOS}" Your upload is ready on every server in the cluster. You can transfer now.`;
        let clusterId: string;

        /** The other machine says it has this version of the player's file, over the subscription this one holds to it. */
        function remoteHas(version: number): void {
          for (const [options] of jest.mocked(subscribeEvents).mock.calls) {
            options.onEvent({ type: 'cluster-placed', nodeId: REMOTE, clusterId, path: PLAYER, version });
          }
        }

        async function uploadHere(contents: string): Promise<void> {
          fs.mkdirSync(path.join(folderOf(clusterId), 'clusters', 'Islands'), { recursive: true });
          fs.writeFileSync(path.join(folderOf(clusterId), PLAYER), contents);
          await waitFor(async () => (await repo.listClusterFiles(clusterId)).some(row => row.path === PLAYER && row.size === contents.length));
        }

        beforeEach(async () => {
          await jest.advanceTimersByTimeAsync(5_000);
          clusterId = (await service.createCluster({ name: 'Islands', arkClusterId: 'Islands' })).clusterId;
          // A server of the cluster on each machine.
          for (const [serverId, nodeId] of [['isle', LOCAL], ['ragnarok', REMOTE]] as const) {
            await repo.upsertServer({
              serverId, name: serverId, nodeId, mapName: '', desiredState: 'running', configRevision: 1,
              configJson: JSON.stringify({ clusterRef: clusterId }), clusterId: null, operatorUserId: null, managerUserId: null
            });
          }
          jest.mocked(startPeerServer).mock.calls[0][1].onHeartbeat(REMOTE, Date.now());
          jest.mocked(localRuntime.state).mockImplementation(id => (id === 'isle' ? 'running' : 'stopped'));
          jest.mocked(localRuntime.onlinePlayers).mockResolvedValue([{ name: 'Jared', playerId: EOS, steamId: EOS }] as never);
          jest.mocked(localRuntime.rcon).mockResolvedValue({ success: true, response: 'ok' } as never);
        });

        it('tells the player on the server they uploaded from, privately, once the other machine has it', async () => {
          await uploadHere('dino');
          expect(localRuntime.rcon).not.toHaveBeenCalled();

          remoteHas(1);
          await waitFor(() => jest.mocked(localRuntime.rcon).mock.calls.length > 0);

          expect(localRuntime.rcon).toHaveBeenCalledWith('isle', MESSAGE);
        });

        it('finds a player who has already travelled to a server on another machine', async () => {
          jest.mocked(localRuntime.onlinePlayers).mockResolvedValue([] as never);
          jest.mocked(peerRequest).mockImplementation(async options => {
            if (options.url.endsWith('/v1/query')) return { status: 200, body: { players: [{ name: 'Jared', steamId: EOS }] } };
            return { status: 200, body: { success: true } };
          });
          await uploadHere('dino');

          remoteHas(1);
          await waitFor(() => jest.mocked(peerRequest).mock.calls.some(([options]) => options.url.endsWith('/v1/command')));

          const command = jest.mocked(peerRequest).mock.calls.map(([options]) => options).find(options => options.url.endsWith('/v1/command'))!;
          expect(command.url).toBe('https://10.0.0.2:4747/v1/command');
          expect(command.body).toMatchObject({ operation: 'rcon', serverId: 'ragnarok', args: { command: MESSAGE } });
          expect(localRuntime.rcon).not.toHaveBeenCalled();
        });

        it('says nothing in a cluster where it is turned off', async () => {
          await service.setUploadNotices(clusterId, false);

          await uploadHere('dino');
          remoteHas(1);
          await waitFor(() => false, { maxSteps: 40 });

          expect(localRuntime.rcon).not.toHaveBeenCalled();
          expect(await service.listClusters()).toEqual([expect.objectContaining({ clusterId, notifyUploads: false })]);
        });

        it('is on for a new cluster', async () => {
          expect(await service.listClusters()).toEqual([expect.objectContaining({ clusterId, notifyUploads: true })]);
        });

        it('tells the other machines what this one has placed', async () => {
          const contents = 'from the other machine';
          const hash = createHash('sha256').update(contents).digest('hex');
          await repo.commitClusterFile({ clusterId, path: PLAYER, sha256: hash, size: contents.length, deleted: false, originNode: REMOTE }, 0);
          jest.mocked(peerDownload).mockImplementation(async options => { fs.writeFileSync(options.dest, contents); return true; });

          await waitFor(() => fs.existsSync(path.join(folderOf(clusterId), PLAYER)));
          const broadcast = (await jest.mocked(startPeerServer).mock.results[0].value as { broadcast: jest.Mock }).broadcast;

          expect(broadcast).toHaveBeenCalledWith({ type: 'cluster-placed', nodeId: LOCAL, clusterId, path: PLAYER, version: 1 });
        });
      });

      it('reports how each machine\'s copy stands', async () => {
        const created = await service.createCluster({ name: 'Islands', arkClusterId: 'Islands' });
        await waitFor(async () => !!(await service.status()).nodes.find(node => node.nodeId === LOCAL)?.clusterSync?.[created.clusterId]);
        jest.mocked(startPeerServer).mock.calls[0][1].onHeartbeat(REMOTE, Date.now(), undefined, {
          [created.clusterId]: { files: 3, pendingSend: 1, pendingReceive: 0, conflicts: 0, lastSyncAt: 5, error: null }
        });

        const nodes = (await service.status()).nodes;

        expect(nodes.find(node => node.nodeId === LOCAL)?.clusterSync?.[created.clusterId]).toMatchObject({ files: 0, pendingSend: 0 });
        expect(nodes.find(node => node.nodeId === REMOTE)?.clusterSync?.[created.clusterId]).toMatchObject({ files: 3, pendingSend: 1 });
      });
    });
  });

  // A container goes by its container id until someone names it.
  describe('the address other machines use to reach it', () => {
    const REMOTE = '22222222-2222-4222-8222-222222222222';
    const NEW = { host: 'mesh.example.org', peerPort: 14747, raftPort: 14002 };
    let supervisor: { start: jest.Mock; stop: jest.Mock };
    /** Whether the cluster takes this machine back under the address it rejoins with. */
    let rejoinTaken: boolean;
    /** What the other machine answers when asked to reach this one at the new address. */
    let probeAnswer: { status: number; body: unknown } | Error;

    const secretsFile = () => path.join(root, 'mesh', 'rqlite-auth.json');
    const nodeCert = () => fs.readFileSync(path.join(root, 'mesh', 'node.crt'), 'utf8');
    const sent = (suffix: string) => jest.mocked(peerRequest).mock.calls.map(([options]) => options).filter(options => options.url.endsWith(suffix));

    /** Runs the change's waits on the fake clock until it is done. */
    async function settled<T>(pending: Promise<T>): Promise<T> {
      let done = false;
      void pending.then(() => { done = true; }, () => { done = true; });
      for (let step = 0; step < 400 && !done; step++) await jest.advanceTimersByTimeAsync(500);
      return pending;
    }

    beforeEach(async () => {
      const ca = createMeshCa('mesh');
      const keys = generateKeyPair();
      const current = signNodeCertificate(ca.certPem, ca.keyPem, keys.publicKeyPem, LOCAL, ['127.0.0.1']);
      fs.writeFileSync(path.join(root, 'mesh', 'node.key'), keys.privateKeyPem);
      fs.writeFileSync(path.join(root, 'mesh', 'node.crt'), current.certPem);
      fs.writeFileSync(path.join(root, 'mesh', 'ca.crt'), ca.certPem);
      await repo.saveMesh({ meshId: 'mesh-1', name: 'Test', schemaVersion: 1, securityEpoch: 1, caCert: ca.certPem, caKey: ca.keyPem, createdAt: 1 });
      await repo.upsertNode(nodeRow(LOCAL, current.serial));
      await repo.upsertNode({
        ...nodeRow(REMOTE, '2', 'https://10.0.0.2:4747'),
        name: 'Basement',
        endpoints: { peerUrl: 'https://10.0.0.2:4747', raftAddr: '10.0.0.2:4002', httpAddr: '' }
      });
      rqlite.raftMembers = [{ id: LOCAL, addr: '127.0.0.1:4002', voter: true }, { id: REMOTE, addr: '10.0.0.2:4002', voter: true }];
      rejoinTaken = true;
      probeAnswer = { status: 200, body: { peer: { ok: true }, raft: { ok: true } } };
      jest.mocked(peerRequest).mockImplementation(async options => {
        if (options.url.endsWith('/v1/probe-address')) {
          if (probeAnswer instanceof Error) throw probeAnswer;
          return probeAnswer;
        }
        return { status: 200, body: { success: true } };
      });
      supervisor = jest.mocked(RqliteSupervisor).mock.results.at(-1)!.value;
      // As rqlite does: a member on its own reads peers.json; otherwise the leader replaces the
      // record of a member that rejoins under a new address.
      supervisor.start.mockImplementation(async (options: { nodeId: string; raftAddr: string; join?: string; dataDir: string }) => {
        const peersFile = path.join(options.dataDir, 'raft', 'peers.json');
        if (fs.existsSync(peersFile)) {
          rqlite.raftMembers = (JSON.parse(fs.readFileSync(peersFile, 'utf8')) as Array<{ id: string; address: string }>)
            .map(peer => ({ id: peer.id, addr: peer.address, voter: true }));
          fs.renameSync(peersFile, path.join(options.dataDir, 'raft', 'peers.info'));
        } else if (options.join && rejoinTaken) {
          rqlite.raftMembers = rqlite.raftMembers.map(member => (member.id === options.nodeId ? { ...member, addr: options.raftAddr } : member));
        }
      });
      await service.resumeIfJoined();
    });

    it('moves to a new address once every other machine has reached it there', async () => {
      const result = await settled(service.changeAddress(LOCAL, NEW, 'admin'));

      expect(result).toMatchObject({ success: true });
      expect(sent('/v1/probe-address')).toEqual([expect.objectContaining({
        url: 'https://10.0.0.2:4747/v1/probe-address',
        body: { peerUrl: 'https://mesh.example.org:14747', raftAddr: 'mesh.example.org:14002' }
      })]);
      expect((await repo.getNode(LOCAL))?.endpoints).toMatchObject({ peerUrl: 'https://mesh.example.org:14747', raftAddr: 'mesh.example.org:14002' });
      expect(JSON.parse(fs.readFileSync(secretsFile(), 'utf8'))).toMatchObject({ peerUrl: 'https://mesh.example.org:14747', raftAddr: 'mesh.example.org:14002' });
    });

    // The others still dial the old address until they read the new one.
    it('presents a certificate for the old address and the new, with its serial recorded for every member', async () => {
      const before = (await repo.getNode(LOCAL))!.certSerial;

      await settled(service.changeAddress(LOCAL, NEW, 'admin'));

      expect(certificateCoversHost(nodeCert(), 'mesh.example.org')).toBe(true);
      expect(certificateCoversHost(nodeCert(), '127.0.0.1')).toBe(true);
      const peer = await (jest.mocked(startPeerServer).mock.results[0].value as Promise<{ useCertificate: jest.Mock }>);
      expect(peer.useCertificate).toHaveBeenCalledWith(nodeCert(), expect.stringContaining('PRIVATE KEY'));
      const after = (await repo.getNode(LOCAL))!.certSerial;
      expect(after).not.toBe(before);
      expect(after).toBe(certificateSerial(nodeCert()));
    });

    it('rejoins the mesh database under the new address, through the other members', async () => {
      await settled(service.changeAddress(LOCAL, NEW, 'admin'));

      expect(supervisor.start).toHaveBeenLastCalledWith(expect.objectContaining({ raftAddr: 'mesh.example.org:14002', join: '10.0.0.2:4002' }));
      expect(rqlite.raftMembers.find(member => member.id === LOCAL)?.addr).toBe('mesh.example.org:14002');
    });

    it('changes nothing when another machine cannot reach it there, and says which, where and why', async () => {
      probeAnswer = { status: 200, body: { peer: { ok: false, error: 'Connection refused.' }, raft: { ok: true } } };
      const starts = supervisor.start.mock.calls.length;
      const certificate = nodeCert();

      const result = await settled(service.changeAddress(LOCAL, NEW, 'admin'));

      expect(result.success).toBe(false);
      expect(result.error).toContain('Basement could not reach this machine at mesh.example.org:14747 (Connection refused.)');
      expect((await repo.getNode(LOCAL))?.endpoints.peerUrl).toBe('https://127.0.0.1:4747');
      expect(nodeCert()).toBe(certificate);
      expect(supervisor.start.mock.calls.length).toBe(starts);
    });

    it('says when another machine is too old to check a new address', async () => {
      probeAnswer = { status: 404, body: { error: 'Not found' } };

      const result = await settled(service.changeAddress(LOCAL, NEW, 'admin'));

      expect(result).toMatchObject({ success: false, error: expect.stringContaining('Basement runs an older version of Cerious AASM') });
    });

    it('goes ahead without a machine that cannot be asked at all, and names it', async () => {
      probeAnswer = new Error('connect ECONNREFUSED 10.0.0.2:4747');

      const result = await settled(service.changeAddress(LOCAL, NEW, 'admin'));

      expect(result).toMatchObject({ success: true, detail: expect.objectContaining({ notAsked: ['Basement'] }) });
    });

    it('goes back to its old address when the mesh database does not take the new one', async () => {
      rejoinTaken = false;
      const secretsBefore = JSON.parse(fs.readFileSync(secretsFile(), 'utf8'));

      const result = await settled(service.changeAddress(LOCAL, NEW, 'admin'));

      expect(result).toMatchObject({ success: false, error: expect.stringContaining('kept its old address') });
      expect((await repo.getNode(LOCAL))?.endpoints).toMatchObject({ peerUrl: 'https://127.0.0.1:4747', raftAddr: '127.0.0.1:4002' });
      expect(JSON.parse(fs.readFileSync(secretsFile(), 'utf8'))).toEqual(secretsBefore);
      expect(supervisor.start).toHaveBeenLastCalledWith(expect.objectContaining({ raftAddr: '127.0.0.1:4002', join: '10.0.0.2:4002' }));
    });

    it('on its own, rewrites its own membership to the new address', async () => {
      await repo.upsertNode({ ...(await repo.getNode(REMOTE))!, status: 'removed' });
      rqlite.raftMembers = [{ id: LOCAL, addr: '127.0.0.1:4002', voter: true }];

      const result = await settled(service.changeAddress(LOCAL, NEW, 'admin'));

      expect(result).toMatchObject({ success: true });
      expect(sent('/v1/probe-address')).toEqual([]);
      expect(supervisor.start).toHaveBeenLastCalledWith(expect.objectContaining({ raftAddr: 'mesh.example.org:14002', join: undefined }));
      expect(rqlite.raftMembers).toEqual([{ id: LOCAL, addr: 'mesh.example.org:14002', voter: true }]);
    });

    it('needs quorum', async () => {
      view.hasQuorum = false;
      view.leaderNodeId = null;
      await jest.advanceTimersByTimeAsync(5_000);

      const result = await settled(service.changeAddress(LOCAL, NEW, 'admin'));

      expect(result.success).toBe(false);
      expect(sent('/v1/probe-address')).toEqual([]);
    });

    it('refuses something that is not an address', async () => {
      await expect(service.changeAddress(LOCAL, { host: 'my mesh', peerPort: 1, raftPort: 2 }, 'admin'))
        .resolves.toEqual({ success: false, error: '"my mesh" is not an IPv4 address or a host name.' });
    });

    it('asks another machine to change its own address', async () => {
      await settled(service.changeAddress(REMOTE, NEW, 'admin'));

      const [command] = sent('/v1/command');
      expect(command.url).toBe('https://10.0.0.2:4747/v1/command');
      expect(command.body).toMatchObject({ operation: 'set-address', targetNode: REMOTE, args: NEW });
    });

    it('answers another machine asking whether it can be reached at a new address, by the certificate found there', async () => {
      jest.mocked(probeTls).mockImplementation(async ({ port }) => (port === 14747 ? { commonName: REMOTE } : { commonName: LOCAL }));
      const handlers = jest.mocked(startPeerServer).mock.calls[0][1];

      const answer = await handlers.onProbeAddress!(REMOTE, { peerUrl: 'https://mesh.example.org:14747', raftAddr: 'mesh.example.org:14002' });

      expect(probeTls).toHaveBeenCalledWith(expect.objectContaining({ host: 'mesh.example.org', port: 14747 }));
      expect(probeTls).toHaveBeenCalledWith(expect.objectContaining({ host: 'mesh.example.org', port: 14002 }));
      expect(answer).toEqual({ peer: { ok: true }, raft: { ok: false, error: 'Another machine answers there.' } });
    });

    it('reports where each machine is reached, and the address this one uses', async () => {
      const status = await service.status();

      expect(status.nodes.find(node => node.nodeId === REMOTE)?.address).toEqual({ host: '10.0.0.2', peerPort: 4747, raftPort: 4002 });
      expect(status.advertise).toEqual({ host: '127.0.0.1', peerPort: 4747, raftPort: 4002 });
    });
  });

  // A second machine reused the first one's token and was told only that it was "invalid or expired".
  describe('a machine joining with a token', () => {
    const request = (token: string) => ({
      token, nodeName: 'B', publicKeyPem: '', raftAddr: '10.0.0.2:4002', peerUrl: 'https://10.0.0.2:4747', protocolVersion: PROTOCOL_VERSION
    });

    beforeEach(async () => {
      await service.resumeIfJoined();
    });

    it('says a token another machine already used was used', async () => {
      await repo.insertToken(hashToken('used-token'), Date.now() + 60_000);
      await repo.consumeToken(hashToken('used-token'), Date.now());

      await expect(service.acceptJoin(request('used-token')))
        .rejects.toThrow('This token was already used by another machine. Make a new token on a member for each machine you add.');
    });

    it('says a token that ran out expired', async () => {
      await repo.insertToken(hashToken('old-token'), Date.now() - 1);

      await expect(service.acceptJoin(request('old-token')))
        .rejects.toThrow('This token expired: a token lasts 15 minutes. Make a new one on a member.');
    });

    it('says a token this mesh never issued is not its own', async () => {
      await expect(service.acceptJoin(request('typo-token')))
        .rejects.toThrow('This mesh did not issue that token. Check it was copied whole, or make a new one on a member.');
    });
  });

  // "Update ARK Server fires blind": nothing showed how an update on another machine was going,
  // and two machines could update at once.
  describe('updating ARK machine by machine', () => {
    const REMOTE = '22222222-2222-4222-8222-222222222222';
    const warning = { phase: 'warning', message: 'Warning players: update in 12 min', minutesLeft: 12, at: 1 };

    beforeEach(async () => {
      await repo.upsertNode(nodeRow(LOCAL, '1'));
      await repo.upsertNode({ ...nodeRow(REMOTE, '2', 'https://10.0.0.2:4747'), name: 'Dallas01' });
      jest.mocked(peerRequest).mockResolvedValue({ status: 200, body: { success: true } });
      await service.resumeIfJoined();
    });

    it('shows how the update on each machine is going', async () => {
      jest.mocked(arkUpdateProgress).mockReturnValue({ phase: 'updating', message: 'Updating ARK server files', percent: 40, at: 2 } as never);
      jest.mocked(startPeerServer).mock.calls[0][1].onHeartbeat(REMOTE, Date.now(), undefined, undefined, warning);

      const nodes = (await service.status()).nodes;

      expect(nodes.find(node => node.nodeId === REMOTE)?.arkUpdate).toMatchObject({ phase: 'warning', minutesLeft: 12 });
      expect(nodes.find(node => node.nodeId === LOCAL)?.arkUpdate).toMatchObject({ phase: 'updating', percent: 40 });
    });

    it('tells the other machines how its own update is going', async () => {
      jest.mocked(arkUpdateProgress).mockReturnValue(warning as never);
      jest.mocked(peerRequest).mockClear();

      await jest.advanceTimersByTimeAsync(5_000);

      const [heartbeat] = jest.mocked(peerRequest).mock.calls.map(([options]) => options).filter(options => options.url.endsWith('/v1/heartbeat'));
      expect(heartbeat.body).toMatchObject({ arkUpdate: warning });
    });

    it('updates one machine at a time', async () => {
      jest.mocked(startPeerServer).mock.calls[0][1].onHeartbeat(REMOTE, Date.now(), undefined, undefined, warning);

      await expect(service.requestNodeUpdate(LOCAL, 'ark', 'admin'))
        .resolves.toEqual({ success: false, error: 'Dallas01 is updating ARK. Update one machine at a time.' });
      expect(beginClusterUpdate).not.toHaveBeenCalled();
    });
  });

  describe('a server moved here', () => {
    // It kept 7777 on a machine whose server already used 7777, and could not start.
    it('takes free ports once its files are in, when a server here uses its own', async () => {
      const staged = path.join(root, 'AASMServer', 'ShooterGame', 'Saved', 'MeshIncoming', 'arrived');
      fs.mkdirSync(staged, { recursive: true });
      fs.writeFileSync(path.join(staged, 'config.json'), JSON.stringify({ id: 'arrived', name: 'Arrived', gamePort: 7777 }));
      await repo.upsertNode(nodeRow(LOCAL, '1'));
      await repo.upsertServer({
        serverId: 'arrived', name: 'Arrived', nodeId: LOCAL, mapName: '', desiredState: 'stopped', configRevision: 1,
        configJson: '{}', clusterId: null, operatorUserId: null, managerUserId: null
      });

      await service.resumeIfJoined();
      await jest.advanceTimersByTimeAsync(5_000);

      expect(fs.existsSync(path.join(root, 'AASMServer', 'ShooterGame', 'Saved', 'Servers', 'arrived', 'config.json'))).toBe(true);
      expect(localRuntime.takeFreePortsIfNeeded).toHaveBeenCalledWith('arrived');
    });
  });

  // A machine that stops sending heartbeats shows as unreachable everywhere. With PC 1 down the
  // other two lost quorum, stopped heartbeating, and each saw only itself as connected.
  describe('telling the other machines it is up', () => {
    const REMOTE = '22222222-2222-4222-8222-222222222222';
    const heartbeats = () => jest.mocked(peerRequest).mock.calls.filter(([options]) => options.url === 'https://10.0.0.2:4747/v1/heartbeat');

    beforeEach(async () => {
      await repo.upsertNode(nodeRow(LOCAL, '1'));
      await repo.upsertNode(nodeRow(REMOTE, '2', 'https://10.0.0.2:4747'));
      jest.mocked(peerRequest).mockResolvedValue({ status: 200, body: { ok: true } });
      await service.resumeIfJoined();
    });

    it('keeps sending heartbeats while the mesh has no quorum', async () => {
      view.hasQuorum = false;
      view.leaderNodeId = null;
      await jest.advanceTimersByTimeAsync(5_000);
      jest.mocked(peerRequest).mockClear();

      await jest.advanceTimersByTimeAsync(20_000);

      expect(heartbeats().length).toBeGreaterThanOrEqual(3);
    });

    it('keeps sending heartbeats when another part of its check fails', async () => {
      jest.mocked(localRuntime.listInstances).mockRejectedValue(new Error('disk unavailable'));
      jest.mocked(peerRequest).mockClear();

      await jest.advanceTimersByTimeAsync(20_000);

      expect(heartbeats().length).toBeGreaterThanOrEqual(3);
    });

    // A Docker machine 4 minutes behind showed no clock line: the answer to this machine's own
    // heartbeat set the difference back to 0 every few seconds.
    it("reports the other machine's clock from the answer to its heartbeat", async () => {
      jest.mocked(peerRequest).mockImplementation(async options => options.url.endsWith('/v1/heartbeat')
        ? { status: 200, body: { ok: true, now: Date.now() - 237_000 } }
        : { status: 200, body: { ok: true } });

      await jest.advanceTimersByTimeAsync(20_000);

      const { skew } = await service.diagnostics();
      expect(skew.map(entry => [entry.nodeId, Math.round(entry.skewMs / 1000)])).toEqual([[REMOTE, -237]]);
    });

    it('keeps the difference it measured when an answer carries no time', async () => {
      jest.mocked(peerRequest).mockImplementation(async options => options.url.endsWith('/v1/heartbeat')
        ? { status: 200, body: { ok: true, now: Date.now() + 5_000 } }
        : { status: 200, body: { ok: true } });
      await jest.advanceTimersByTimeAsync(10_000);
      jest.mocked(peerRequest).mockResolvedValue({ status: 200, body: { ok: true } });

      await jest.advanceTimersByTimeAsync(10_000);

      expect((await service.diagnostics()).skew.map(entry => Math.round(entry.skewMs / 1000))).toEqual([5]);
    });
  });

  describe('naming machines', () => {
    const REMOTE = '22222222-2222-4222-8222-222222222222';

    beforeEach(async () => {
      await repo.upsertNode(nodeRow(LOCAL, '1', 'https://127.0.0.1:4747'));
      await repo.upsertNode(nodeRow(REMOTE, '2', 'https://10.0.0.2:4747'));
      await service.resumeIfJoined();
    });

    function identityName(): string {
      return JSON.parse(fs.readFileSync(path.join(root, 'mesh', 'node.json'), 'utf8')).name;
    }

    it('renames another member for every member', async () => {
      await service.renameNode(REMOTE, '  Game   Box  ');

      expect((await repo.getNode(REMOTE))?.name).toBe('Game Box');
      expect((await service.status()).nodes.find(node => node.nodeId === REMOTE)?.name).toBe('Game Box');
    });

    // A heartbeat that read the row before a rename wrote the old name back with everything else.
    it('records a heartbeat without touching the name or Skip new servers', async () => {
      await repo.upsertNode({ ...nodeRow(REMOTE, '2', 'https://10.0.0.2:4747'), name: 'Game Box', maintenance: true, status: 'maintenance' });

      await repo.recordHeartbeat(REMOTE, { version: '9.9.9', protocolVersion: 2, certSerial: '7', capabilities: nodeRow(REMOTE).capabilities, lastSeen: 42 });

      expect(await repo.getNode(REMOTE)).toEqual(expect.objectContaining({
        name: 'Game Box', maintenance: true, status: 'maintenance', version: '9.9.9', certSerial: '7', lastSeen: 42
      }));
    });

    it('renames this machine, and keeps the name for when it joins a mesh again', async () => {
      await service.renameNode(LOCAL, 'Desk');

      expect((await service.status()).nodeName).toBe('Desk');
      expect(identityName()).toBe('Desk');
    });

    it('takes the name another member gave it', async () => {
      await repo.upsertNode({ ...nodeRow(LOCAL, '1', 'https://127.0.0.1:4747'), name: 'Given' });

      await jest.advanceTimersByTimeAsync(5_000);

      expect(identityName()).toBe('Given');
      expect((await service.status()).nodeName).toBe('Given');
    });

    it('refuses an empty name and one that is too long', async () => {
      await expect(service.renameNode(REMOTE, '   ')).rejects.toThrow('Enter a name for the machine.');
      await expect(service.renameNode(REMOTE, 'x'.repeat(65))).rejects.toThrow('64 characters');
      expect((await repo.getNode(REMOTE))?.name).toBe(REMOTE.slice(0, 4));
    });

    it('refuses a machine that is not a member', async () => {
      await expect(service.renameNode('33333333-3333-4333-8333-333333333333', 'Ghost')).rejects.toThrow('That node was not found.');
    });
  });

  describe('resources of each node', () => {
    const REMOTE = '22222222-2222-4222-8222-222222222222';
    const here = { cpuPercent: 10, memory: { used: 4, total: 16 }, disk: { used: 100, total: 500 } };
    const there = { cpuPercent: 55, memory: { used: 20, total: 32 }, disk: null };

    beforeEach(async () => {
      jest.mocked(sampleHostResources).mockResolvedValue(here);
      await repo.upsertNode(nodeRow(LOCAL, '1', 'https://127.0.0.1:4747'));
      await repo.upsertNode(nodeRow(REMOTE, '2', 'https://10.0.0.2:4747'));
      await service.resumeIfJoined();
      await jest.advanceTimersByTimeAsync(5_000);
    });

    function heartbeat(resources: unknown): void {
      jest.mocked(startPeerServer).mock.calls[0][1].onHeartbeat(REMOTE, Date.now(), resources);
    }

    async function listed(nodeId: string) {
      return (await service.status()).nodes.find(node => node.nodeId === nodeId)!;
    }

    it('sends this machine\'s resources with each heartbeat', async () => {
      const sent = jest.mocked(peerRequest).mock.calls.map(([options]) => options).find(options => options.url.endsWith('/v1/heartbeat'))!;

      expect(sent.url).toBe('https://10.0.0.2:4747/v1/heartbeat');
      expect(sent.body).toMatchObject({ nodeId: LOCAL, resources: here });
    });

    it('lists each node with its resources and the host other nodes reach it at', async () => {
      heartbeat(there);

      expect(await listed(LOCAL)).toMatchObject({ host: '127.0.0.1', resources: here });
      expect(await listed(REMOTE)).toMatchObject({ host: '10.0.0.2', resources: there });
    });

    it('stops listing what a node reported once its heartbeats stop', async () => {
      heartbeat(there);

      await jest.advanceTimersByTimeAsync(30_000);

      expect((await listed(REMOTE)).resources).toBeNull();
    });

    it('ignores resources that are not figures', async () => {
      heartbeat({ cpuPercent: 'lots', memory: { used: 1, total: 2 }, disk: null });

      expect((await listed(REMOTE)).resources).toBeNull();
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

    it('pushes the server list to open pages when a server on another node is edited there', async () => {
      const row = {
        serverId: 'isle', name: 'isle', nodeId: '22222222-2222-4222-8222-222222222222', mapName: '', desiredState: 'stopped' as const,
        configRevision: 1, configJson: '{}', clusterId: null, operatorUserId: null, managerUserId: null
      };
      await repo.upsertServer(row);
      await service.resumeIfJoined();
      await jest.advanceTimersByTimeAsync(5_000);
      jest.mocked(serverInstanceService.broadcastInstances).mockClear();

      await repo.upsertServer({ ...row, name: 'Renamed', configRevision: 2 });
      await jest.advanceTimersByTimeAsync(5_000);

      expect(serverInstanceService.broadcastInstances).toHaveBeenCalled();
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
    function supervisorCalls(method: 'start' | 'stop'): number {
      return jest.mocked(RqliteSupervisor).mock.results
        .reduce((sum, result) => sum + jest.mocked((result.value as Record<string, jest.Mock>)[method]).mock.calls.length, 0);
    }

    // Before its first snapshot a restarted node's copy stays empty until a leader replays the
    // log, and in a mesh of two that leader cannot be elected without this node's vote.
    it('keeps rqlited running while its copy is empty, so the members can elect a leader to fill it', async () => {
      rqlite.loaded = false;
      view.hasQuorum = false;
      view.leaderNodeId = null;

      await service.resumeIfJoined();
      await jest.advanceTimersByTimeAsync(30_000);
      expect(service.isEnabled()).toBe(false);

      rqlite.loaded = true;
      view.hasQuorum = true;
      view.leaderNodeId = LOCAL;
      await jest.advanceTimersByTimeAsync(5_000);

      expect(service.isEnabled()).toBe(true);
      expect(supervisorCalls('start')).toBe(1);
      expect(supervisorCalls('stop')).toBe(0);
    });

    it('says it is reconnecting, not standalone, while it waits for its copy', async () => {
      rqlite.loaded = false;

      await service.resumeIfJoined();

      expect(await service.status()).toMatchObject({ enabled: false, reconnecting: true, meshId: 'mesh-1', nodeId: LOCAL });
    });

    it('stops waiting for its copy, and stops rqlited, when the app stops the mesh', async () => {
      rqlite.loaded = false;
      await service.resumeIfJoined();

      await service.stop();
      rqlite.loaded = true;
      await jest.advanceTimersByTimeAsync(60_000);

      expect(service.isEnabled()).toBe(false);
      expect(supervisorCalls('start')).toBe(1);
    });

    // A member's web interface reaches every node, so it needs a mesh account from the start.
    it('requires a mesh account on the web from the start, before it reaches the mesh', async () => {
      rqlite.loaded = false;

      await service.resumeIfJoined();

      expect(meshSignInRequired()).toBe(true);
    });

    it('knows it is a member before anything is served, from its identity file alone', () => {
      service.noteMembership();

      expect(meshSignInRequired()).toBe(true);
      expect(meshDesktopIdentity()).toEqual(expect.objectContaining({ user: null, isAdmin: false }));
    });

    it('keeps the desktop signed out, not the local owner, while a failed resume is retried', async () => {
      supervisorFailure = 'rqlited exited before it was ready';

      await service.resumeIfJoined();

      expect(service.isEnabled()).toBe(false);
      expect(meshDesktopIdentity()).not.toBe('standalone');
    });

    describe('signing in on the desktop while it reconnects', () => {
      const ada = {
        id: 'u1', username: 'ada', displayName: 'Ada', roleId: 'admin', roleName: 'Admin', permissions: [],
        active: true, ownerUserId: null, cliLocked: false, createdAt: 0, updatedAt: 0, lastLoginAt: null
      };

      beforeEach(async () => {
        rqlite.loaded = false;
        await service.resumeIfJoined();
      });

      it('checks this machine\'s copy of the mesh accounts', async () => {
        jest.mocked(userDatabaseService.verifyCredentials).mockResolvedValue(ada as never);

        expect(await service.loginDesktop('ada', 'pw')).toEqual(ada);

        expect(userDatabaseService.verifyCredentials).toHaveBeenCalledWith('ada', 'pw');
        expect(meshDesktopIdentity()).toEqual(expect.objectContaining({ user: ada }));
      });

      it('refuses an account set from the command line, which is not a mesh account', async () => {
        jest.mocked(userDatabaseService.verifyCredentials).mockResolvedValue({ ...ada, cliLocked: true } as never);

        expect(await service.loginDesktop('ada', 'pw')).toBeNull();
        expect(meshDesktopIdentity()).toEqual(expect.objectContaining({ user: null }));
      });

      it('signs the desktop out again', async () => {
        jest.mocked(userDatabaseService.verifyCredentials).mockResolvedValue(ada as never);
        await service.loginDesktop('ada', 'pw');

        service.logoutDesktop();

        expect(meshDesktopIdentity()).toEqual(expect.objectContaining({ user: null }));
      });
    });

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
