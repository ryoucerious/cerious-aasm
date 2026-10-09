import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { ALL_PERMISSIONS, AuthenticatedUser, BUILT_IN_ROLES, Permission, ROLE_IDS, effectivePermissions } from '../../types/auth.types';
import {
  COMMAND_PROTOCOL, PROTOCOL_VERSION, QUERY_PROTOCOL, protocolError, type ArkUpdateStatus, type ClusterRecord, type MeshAddress, type MeshQuery, type CommandResult, type ControlCommand, type DesiredState, type MeshStatus,
  type ForceRemoval, type NodeRecord, type NodeResources, type RaftMember, type ServerRecord, type StorageProfileRecord, type UserRecord
} from '../../types/mesh.types';
import { getDefaultInstallDir, isRunningInDocker } from '../../utils/platform.utils';
import { getInstanceDir, getInstancesBaseDir } from '../../utils/ark/instance.utils';
import { ClusterSync, importClusterData, type ClusterSyncSummary } from './cluster-sync';
import { TransferNotices } from './transfer-notices';
import { arkClusterIdOf, assertArkClusterIdFree, clusterFolder, clusterNameOf, knownClusters, rememberClusters } from '../clusters/cluster-registry';
import { isServerMoving, whileServerMoves } from '../../utils/ark/ark-server/ark-server-state.utils';
import { appVersion } from '../../utils/app-version';
import { userDatabaseService } from '../auth/user-database.service';
import { poolDirectory } from '../auth/pool-directory';
import { messagingService } from '../messaging.service';
import { autoUpdateService } from '../auto-update.service';
import { arkUpdateProgress, beginClusterUpdate } from '../ark-update.service';
import { relaunchInPlace } from '../docker-runtime-update';
import { sampleHostResources } from '../host-resources';
import { setMeshDesktopMode, setMeshDesktopUser } from '../auth/desktop-session';
import type { SenderIdentity } from '../auth/permission-gate';
import { collectCapabilities, ensureNodeIdentity, nodeIdentityPath, readNodeIdentity, writeNodeIdentity, type NodeIdentityFile } from '../runtime/node-identity';
import type { InstanceConfig } from '../../types/server-instance.types';
import { localRuntime } from '../runtime/local-runtime';
import { ArkApiAction, isReadOnlyArkApiAction, runArkApiAction } from '../ark-api-actions';
import { restartCountdowns } from '../automation/restart-countdown.service';
import { readStartedConfig } from '../../utils/ark/started-config.utils';
import { backupService } from '../backup/backup.service';
import { backupCopies } from '../backup/backup-copies.service';
import { BackupPathUtils } from '../../utils/backup.utils';
import type { BackupMetadata } from '../../types/backup.types';
import { runForwardedRequest, setHostRouter } from '../host-routing';
import { identifySender } from '../auth/permission-gate';
import type { MessageSender } from '../../types/messaging.types';
import { serverInstanceService, setInventoryMerge } from '../server-instance/server-instance.service';
import { createMeshCa, generateKeyPair, signNodeCertificate, certificateCoversHost, certificateFingerprint, certificateIssuedBy, certificateSerial, normalizeSerial, hostsFromEndpoint, publicKeyFromPrivatePem } from './certificates';
import { executeCommand } from './command-router';
import { providerForProfile } from './cluster-storage';
import { clockSkewMs, probeTcp, wgInstalled, wireguardConfig, wireguardPrivateKey, applyWireguard } from './diagnostics';
import { meshServer, meshServers, registerMeshAuth, setMeshMember, setMeshWriteBlock, noteLocalNode, noteMeshListenPorts, noteMeshServers, noteSecurityVersion, type MeshWriteOp } from './mesh-hooks';
import { latestAccountsBeforeJoin, localLoginToCarry, machineAdminName, readAccountsSnapshot, type CarriedLogin } from './machine-admin';
import { MeshRepository } from './mesh-repository';
import { SCHEMA_VERSION } from './schema';
import { hashArgon2id, hashToken, newEnrollmentToken, verifyArgon2id, verifyBcrypt } from './passwords';
import {
  archiveInstance, beginStage, checkpointManifest, checksumTree, fileDigest, finishStage, promoteStaged, pruneMeshFolders, writeStagedFile,
  type HeldFile
} from './checkpoint';
import { chooseNode, moveServer, type PlacementInput } from './placement';
import { partitionDecision } from './partition-policy';
import { peerDownload, peerRequest, peerUpload, probeTls, startPeerServer, subscribeEvents, type AddressProbe, type JoinRequest, type JoinResponse, type PeerServer } from './peer-server';
import { addressFromEndpoints, memberUrlOf, meshAddressOf, ownLanAddress, peerUrlFor, raftAddrFor } from './mesh-address';
import { reconcile, type ReconcileMemory } from './reconciler';
import { DesiredIntents } from './desired-intent';
import { PendingConfigs } from './pending-configs';
import { RqliteClient } from './rqlite-client';
import { RqliteSupervisor, rqliteProblem } from './rqlite-supervisor';

const HTTP_USER = 'aasm';
const PEER_PORT = envPort('AASM_PEER_PORT', 4747);
const HTTP_PORT = envPort('AASM_HTTP_PORT', 4001);
const RAFT_PORT = envPort('AASM_RAFT_PORT', 4002);
const RESUME_RETRY_MS = 30_000;
/** How often a restarted node looks again for its copy of the mesh while rqlited runs. */
const COPY_RETRY_MS = 5_000;
/** A move copies saves over the network; a large world takes a while. */
const MOVE_TIMEOUT_MS = 60 * 60_000;
/** Start All staggers its starts, so a node with many servers takes a while to answer. */
const ALL_TIMEOUT_MS = 60 * 60_000;
const PRUNE_INTERVAL_MS = 60 * 60_000;
const QUERY_TIMEOUT_MS = 15_000;
/** Live per-server events the hosting node relays, so another node can show the server live. */
const RELAY_CHANNELS = new Set([
  'server-instance-log', 'server-instance-state', 'server-instance-players', 'server-instance-memory',
  'server-instance-cpu', 'rcon-status', 'clear-server-instance-logs', 'server-move-progress', 'server-restart-pending'
]);
/** Commands about one server. The node running one must be the node hosting that server. */
const SERVER_COMMANDS = new Set<ControlCommand['operation']>([
  'start', 'stop', 'force-stop', 'restart', 'cancel-restart', 'delete', 'move', 'rcon', 'connect-rcon', 'disconnect-rcon', 'save-ini', 'set-ownership',
  'fetch-backup-copy', 'server-request'
]);
/** How long a restarted machine waits for its copy of the mesh to catch up before going by what it has. */
const CATCH_UP_WAIT_MS = 60_000;
/** A backup can be large: long enough for a few gigabytes over a slow link. */
const BACKUP_COPY_TIMEOUT_MS = 60 * 60_000;
/** The figure each live channel reports, kept for a server on another node. */
const LIVE_FIGURES: Record<string, 'players' | 'cpu' | 'memory'> = {
  'server-instance-players': 'players', 'server-instance-cpu': 'cpu', 'server-instance-memory': 'memory'
};
const UP_STATES = new Set(['running', 'starting']);
/** A server in one of these has no process: it can be moved. */
const OFF_STATES = new Set(['stopped', 'crashed', 'error']);
/** A node that has not answered or sent a heartbeat for this long shows as unreachable. */
const HEARTBEAT_FRESH_MS = 25_000;

/** What the node hosting a server last reported about it. */
interface LiveServer {
  nodeId: string;
  state?: string;
  startedAt?: number;
  players?: number;
  cpu?: number;
  memory?: number;
}

interface LocalSecrets {
  httpUser: string;
  httpPass: string;
  /** Where this node's peer API listens. */
  peerPort: number;
  advertiseHost: string;
  /** The URL other nodes use for this node's peer API. Behind a proxy or port forward its port differs from peerPort. */
  peerUrl?: string;
  /** The Raft address other nodes dial. */
  raftAddr?: string;
}

/** The request a command stands for, as this machine's activity feed knows it. */
const COMMAND_CHANNELS: Partial<Record<string, string>> = {
  start: 'start-server-instance',
  stop: 'stop-server-instance',
  'force-stop': 'force-stop-server-instance',
  restart: 'restart-server-instance',
  'cancel-restart': 'cancel-server-restart',
  rcon: 'rcon-command',
  'save-ini': 'save-ini-file',
  'save-config': 'save-server-instance',
  'start-all': 'start-all-instances',
  'stop-all': 'stop-all-instances',
  'restart-all': 'restart-all-instances'
};

/** Actors that are not a person: the desktop before anyone signed in, and the app's own backup copies. */
const UNNAMED_ACTORS = new Set(['desktop', 'backup']);

/**
 * Opt-in mesh. Standalone installs never start rqlite. When a mesh is on, this service is the
 * only place that turns a remote click into a command; the hosting node's reconciler is the
 * only place that starts or stops ARK.
 */
export class MeshService {
  private repo: MeshRepository | null = null;
  private supervisor = new RqliteSupervisor();
  private peer: PeerServer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private rqlite: RqliteClient | null = null;
  private secrets: LocalSecrets | null = null;
  private readonly seenHeartbeats = new Map<string, { at: number; skewMs: number }>();
  /** Renames of this machine made here: a check that read the nodes before one keeps its hands off the name. */
  private ownRenames = 0;
  /** This machine's copy of the mesh had caught up since it last started its part of the mesh. */
  private storeCaughtUp = false;
  private resumedAt = 0;
  /** Starts and stops decided here that the mesh has not stored yet. Open while attached. */
  private intents: DesiredIntents | null = null;
  /** Configs saved here that the mesh has not stored yet. Open while attached. */
  private pendingConfigs: PendingConfigs | null = null;
  private readonly reconcileMemory: ReconcileMemory = new Map();
  /** This node's id while attached; read on every relayed log line, so not from disk. */
  private localNodeId: string | null = null;
  /** One live-event subscription to each other member, by node id. */
  private readonly subscriptions = new Map<string, { close(): void }>();
  /** What each other node last reported about its servers, while its subscription is open. */
  private readonly liveStates = new Map<string, LiveServer>();
  /** This machine's CPU, memory and disk as of the last tick, sent with each heartbeat. */
  private localResources: NodeResources | null = null;
  /** What each other node sent with its last heartbeat. */
  private readonly nodeResources = new Map<string, { resources: NodeResources; at: number }>();
  /** How each other node's copy of the cluster files stands, from its last heartbeat. */
  private readonly nodeClusterSync = new Map<string, { summary: Record<string, ClusterSyncSummary>; at: number }>();
  /** How each other member's ARK update was going at its last heartbeat. */
  private readonly nodeArkUpdate = new Map<string, { progress: ArkUpdateStatus | null; at: number }>();

  /**
   * Who this node is. Read once while attached and kept in memory: it is consulted on every tick
   * and request, and a moment when the file is locked or being rewritten must not change it.
   */
  private identity(): NodeIdentityFile | null {
    return this.attachedIdentity ?? readNodeIdentity();
  }

  private attachedIdentity: NodeIdentityFile | null = null;

  isEnabled(): boolean {
    return !!this.repo && !!this.identity()?.meshId;
  }

  /**
   * Restarts this node's rqlited and attaches to the mesh. A node that comes back cut off from
   * the others has no leader, so it waits only for rqlited itself and serves logins and local
   * servers from its own copy. Anything else that stops it is retried every 30 s.
   */
  async resumeIfJoined(): Promise<void> {
    this.resumeTimer = null;
    if (this.repo) return;
    const identity = readNodeIdentity();
    // A file that is there but cannot be read now (locked, half written) is tried again later.
    if (!identity) {
      if (fs.existsSync(nodeIdentityPath())) this.scheduleResume();
      return;
    }
    if (!identity.meshId) return;
    this.claimMembership();
    const secrets = readSecrets();
    if (!secrets) {
      if (fs.existsSync(secretsPath())) this.scheduleResume();
      else console.error('[mesh] This node is in a mesh but its rqlite credentials are missing.');
      return;
    }
    const certs = readCertPaths();
    if (!certs) {
      console.error('[mesh] This node is in a mesh but its certificate files are missing.');
      return;
    }
    warnIfAdvertiseChanged(secrets);
    try {
      const client = this.waitingCopy ?? await this.startLocalCopy(identity.nodeId, secrets);
      // Before its first snapshot a restarted node's copy is empty until a leader replays the
      // log to it. rqlited keeps running meanwhile: in a mesh of two, that leader cannot be
      // elected without this node's vote.
      if (!await new MeshRepository(client).hasCopy()) {
        if (!this.waitingCopy) console.log('[mesh] Waiting for the other members to bring this node\'s copy of the mesh up to date.');
        this.waitingCopy = client;
        this.scheduleResume(COPY_RETRY_MS);
        return;
      }
      this.waitingCopy = null;
      this.repo = new MeshRepository(client);
      this.rqlite = client;
      this.secrets = secrets;
      const self = await this.repo.getNode(identity.nodeId);
      if (self?.status === 'removed') {
        await this.leaveLocally();
        return;
      }
      await this.ensurePresentedCertificate(identity.nodeId);
      const row = await this.repo?.getNode(identity.nodeId);
      if (row && row.meshId !== identity.meshId) {
        await this.bestEffort('record the mesh id for this node', () => this.repo!.upsertNode({ ...row, meshId: identity.meshId }));
      }
      await this.attach(identity);
      await this.importLocalServers(identity.nodeId);
    } catch (error) {
      console.error('[mesh] Could not resume the mesh; trying again in 30 s:', error);
      await this.stop();
      this.scheduleResume();
    }
  }

  /**
   * Called first at startup, before the web server or the window: a machine in a mesh asks for a
   * mesh account from the start, not only once it reaches the others.
   */
  noteMembership(): void {
    if (readNodeIdentity()?.meshId) this.claimMembership();
  }

  /** The web interface and the desktop window both need a mesh account from here on. */
  private claimMembership(): void {
    noteLocalNode(readNodeIdentity()?.nodeId || null);
    setMeshMember(true);
    setMeshDesktopMode(true);
  }

  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  /** rqlited, started and ready, while this node waits for its copy of the mesh to be filled in. */
  private waitingCopy: RqliteClient | null = null;

  private scheduleResume(delayMs = RESUME_RETRY_MS): void {
    if (this.resumeTimer) return;
    this.resumeTimer = setTimeout(() => this.quietly(this.resumeIfJoined(), 'rejoin the mesh'), delayMs);
  }

  /** Starts this node's rqlited and waits until it answers, with or without a leader. */
  private async startLocalCopy(nodeId: string, secrets: LocalSecrets): Promise<RqliteClient> {
    await this.startRqlite(nodeId, secrets);
    const client = new RqliteClient(`http://127.0.0.1:${HTTP_PORT}`, secrets.httpUser, secrets.httpPass, nodeId);
    if (!await waitReady(client, this.supervisor, 40, false)) throw new Error(this.supervisor.failure() || 'The mesh database did not start on this machine. Restart the app to try again.');
    return client;
  }

  /** A write that can wait for quorum. Without a leader it fails; the node carries on. */
  private async bestEffort(what: string, write: () => Promise<void>): Promise<void> {
    try {
      await write();
    } catch (error) {
      console.warn(`[mesh] Could not ${what} yet:`, error instanceof Error ? error.message : error);
    }
  }

  async createMesh(input: { name: string; adminUsername?: string; adminPassword?: string; address?: { host?: unknown; peerPort?: unknown; raftPort?: unknown } }): Promise<MeshStatus> {
    if (this.isEnabled()) return this.status();
    const address = input.address ? meshAddressOf(input.address) : null;
    // Before anything is recorded on a member for a machine that could never take part.
    const blocker = rqliteProblem();
    if (blocker) throw new Error(blocker);
    const identity = ensureNodeIdentity();
    const ca = createMeshCa(input.name || 'cerious-aasm-mesh');
    const keys = generateKeyPair();
    const secrets = freshSecrets(address);
    const signed = signNodeCertificate(ca.certPem, ca.keyPem, keys.publicKeyPem, identity.nodeId, advertisedHosts(secrets));
    writeCerts(keys.privateKeyPem, signed.certPem, ca.certPem);
    writeSecrets(secrets);
    fs.rmSync(rqliteDir(), { recursive: true, force: true });
    await this.startRqlite(identity.nodeId, secrets);
    const client = new RqliteClient(`http://127.0.0.1:${HTTP_PORT}`, secrets.httpUser, secrets.httpPass, identity.nodeId);
    if (!await waitReady(client, this.supervisor)) throw new Error(this.supervisor.failure() || 'The mesh database did not start on this machine. Restart the app to try again.');
    this.repo = new MeshRepository(client);
    this.rqlite = client;
    this.secrets = secrets;
    await this.repo.migrate();
    const meshId = randomUUID();
    await this.repo.saveMesh({
      meshId, name: input.name || 'Mesh', schemaVersion: 1, securityEpoch: 1,
      caCert: ca.certPem, caKey: ca.keyPem, createdAt: Date.now()
    });
    await this.importLocalAccounts(input.adminUsername, input.adminPassword);
    await this.repo.upsertNode(this.nodeRow(identity.nodeId, identity.name, meshId, signed.serial));
    writeNodeIdentity({ ...identity, meshId });
    await this.importLocalServers(identity.nodeId);
    // This machine's clusters go into the new mesh at its first check.
    fs.writeFileSync(adoptClustersMarker(), '');
    await this.attach({ ...identity, meshId });
    if (input.adminPassword) {
      const user = await this.verifyLogin(input.adminUsername || 'admin', input.adminPassword);
      if (user) this.adoptDesktop(user);
    }
    this.publishStatus();
    return this.status();
  }

  /**
   * Joins through a member. The token names the mesh CA, so the member's CA is checked against
   * it before the token is sent, and the join itself only trusts that CA: nothing in between
   * (a proxy that ends TLS, an impostor) can read the token or the credentials that come back.
   */
  async joinMesh(input: {
    memberUrl: string; token: string; name?: string; adminPassword?: string; adminUsername?: string;
    /** Where the others reach this machine, when they cannot reach it at its own address: outside their network, say. */
    address?: { host?: unknown; peerPort?: unknown; raftPort?: unknown };
  }): Promise<MeshStatus & { machineAdmin?: string }> {
    if (this.isEnabled()) throw new Error('This node is already in a mesh. Leave it before joining another.');
    const address = input.address ? meshAddressOf(input.address) : null;
    // Before anything is recorded on a member for a machine that could never take part.
    const blocker = rqliteProblem();
    if (blocker) throw new Error(blocker);
    const [secret, pinned] = String(input.token || '').trim().split('.');
    if (!secret || !pinned) throw new Error('This token does not name the mesh it is for. Create a new token on a member.');
    const memberUrl = memberUrlOf(input.memberUrl);
    const shown = await peerRequest({ url: `${memberUrl}/v1/ca`, method: 'GET', insecure: true, timeoutMs: 15_000 });
    const caCert = (shown.body as { caCert?: string })?.caCert || '';
    let matches = false;
    try { matches = !!caCert && certificateFingerprint(caCert) === pinned; } catch { matches = false; }
    if (!matches) {
      throw new Error('That member\'s certificate authority does not match the token. Check the address; if it is right, something between here and there is answering in its place.');
    }
    const identity = ensureNodeIdentity(input.name);
    const keys = generateKeyPair();
    const response = await peerRequest({
      url: `${memberUrl}/v1/join`,
      method: 'POST',
      pinnedCa: caCert,
      timeoutMs: 60_000,
      body: {
        token: secret,
        nodeName: identity.name,
        publicKeyPem: keys.publicKeyPem,
        raftAddr: address ? raftAddrFor(address) : advertisedRaftAddr(),
        peerUrl: address ? peerUrlFor(address) : advertisedPeerUrl(),
        protocolVersion: PROTOCOL_VERSION,
        nodeId: identity.nodeId
      } satisfies JoinRequest
    });
    if (response.status !== 200) {
      const message = (response.body as { error?: string })?.error || `Join failed (${response.status})`;
      throw new Error(message);
    }
    const joined = response.body as JoinResponse;
    if (joined.caCert?.trim() !== caCert.trim()) throw new Error('The member answered with a different certificate authority.');
    const nodeId = joined.nodeId || identity.nodeId;
    writeCerts(keys.privateKeyPem, joined.nodeCert, joined.caCert);
    const secrets: LocalSecrets = {
      ...freshSecrets(address),
      httpUser: joined.httpAuthUser,
      httpPass: joined.httpAuthPass
    };
    writeSecrets(secrets);
    await this.supervisor.stop();
    fs.rmSync(rqliteDir(), { recursive: true, force: true });
    await this.startRqlite(nodeId, secrets, joined.raftAddr);
    const client = new RqliteClient(`http://127.0.0.1:${HTTP_PORT}`, secrets.httpUser, secrets.httpPass, nodeId);
    if (!await waitReady(client, this.supervisor, 120)) {
      // The member recorded this node and handed it credentials; it takes both back.
      await peerRequest({
        url: `${memberUrl}/v1/abort-join`, method: 'POST', body: {}, pinnedCa: caCert,
        cert: joined.nodeCert, key: keys.privateKeyPem, timeoutMs: 15_000
      }).catch(error => console.warn('[mesh] Could not withdraw the unfinished join:', error instanceof Error ? error.message : error));
      await this.supervisor.stop();
      fs.rmSync(rqliteDir(), { recursive: true, force: true });
      throw new Error(this.supervisor.detail() || this.supervisor.failure() || 'Joined, but the mesh database did not start on this machine. Restart the app to try again.');
    }
    this.repo = new MeshRepository(client);
    this.rqlite = client;
    this.secrets = secrets;
    // Read before the mesh's accounts replace this machine's own.
    const carried = this.loginToCarry(userDatabaseService.exportCredentialRows());
    // The mesh's accounts replace the ones this machine had; those are kept in a copy.
    try {
      userDatabaseService.snapshotTo(path.join(meshRoot(), `accounts-before-join-${Date.now()}.db`));
    } catch (error) {
      console.warn('[mesh] Could not keep a copy of the accounts on this machine:', error instanceof Error ? error.message : error);
    }
    const joinedIdentity = { ...identity, nodeId, meshId: joined.meshId, name: input.name || identity.name };
    writeNodeIdentity(joinedIdentity);
    // This machine's clusters join the mesh's at its first check with quorum.
    fs.writeFileSync(adoptClustersMarker(), '');
    await this.attach(joinedIdentity);
    await this.importLocalServers(nodeId);
    fs.rmSync(carriedLoginMarker(), { force: true });
    let machineAdmin: string | null = null;
    try {
      const carriedAs = await this.carryLogin(nodeId, joinedIdentity.name, carried);
      if (carriedAs.created) machineAdmin = carriedAs.username;
    } catch (error) {
      // Tried again at each check until it is in.
      console.warn('[mesh] Could not yet bring this machine\'s admin password into the mesh:', messageOf(error));
    }
    if (input.adminPassword) {
      const user = await this.verifyLogin(input.adminUsername || 'admin', input.adminPassword);
      if (user) this.adoptDesktop(user);
    }
    this.publishStatus();
    const status = await this.status();
    return machineAdmin ? { ...status, machineAdmin } : status;
  }

  /** The admin password this machine had of its own, from its accounts (oldest first) and its web login. */
  private loginToCarry(accounts: Array<{ username: string; passwordHash: string; roleId: string; active: boolean; cliLocked?: boolean }>): CarriedLogin | null {
    try {
      return localLoginToCarry(accounts.map(account => ({ ...account, cliLocked: !!account.cliLocked })), readWebLogin());
    } catch (error) {
      console.warn('[mesh] Could not read this machine\'s own admin login:', messageOf(error));
      return null;
    }
  }

  /**
   * Makes this machine's own admin password a numbered machine admin for it, so whoever ran it can
   * still sign in once the mesh's accounts are the only way in. Nothing new when the mesh already
   * has that password, or a machine admin for it. The name signed in with, or null, and whether it
   * was made now. Throws while a write cannot be made; it is tried again then.
   */
  private async carryLogin(nodeId: string, nodeName: string, login: CarriedLogin | null): Promise<{ username: string | null; created: boolean }> {
    const repo = this.repo!;
    const done = (username: string | null, created = false) => {
      fs.writeFileSync(carriedLoginMarker(), JSON.stringify({ username, at: Date.now() }));
      return { username, created };
    };
    if (!login) return done(null);
    const [users, scopes] = await Promise.all([repo.listUsers(), repo.listMachineAdmins()]);
    // The password may be in the mesh already, brought by the machine that created it: the sign-in
    // page names that account instead.
    const holder = users.find(user => user.passwordHash === login.passwordHash && user.enabled);
    if (holder) return done(holder.username);
    if (scopes.some(scope => scope.nodeId === nodeId)) return done(null);
    this.requireQuorum('security-write');
    const { username, displayName } = machineAdminName(users.map(user => user.username), nodeName, isRunningInDocker() ? '' : os.hostname());
    if (!await repo.getRole(ROLE_IDS.MACHINE_ADMIN)) {
      const role = BUILT_IN_ROLES.find(builtIn => builtIn.id === ROLE_IDS.MACHINE_ADMIN)!;
      await repo.upsertRole({ roleId: role.id, name: role.name, permissions: [...role.permissions], securityVersion: 1 });
    }
    const userId = randomUUID();
    const now = Date.now();
    const hashAlg = hashAlgOf(login.passwordHash);
    await repo.upsertUser({
      userId, username, displayName, passwordHash: login.passwordHash, passwordParameters: hashAlg, hashAlg, enabled: true,
      securityVersion: 1, roleId: ROLE_IDS.MACHINE_ADMIN, ownerUserId: null, createdAt: now, updatedAt: now
    });
    await repo.setMachineAdmin(userId, nodeId, false);
    console.log(`[mesh] This machine's admin password (its ${login.source} "${login.username}") now signs in as "${username}", the machine admin for ${nodeName}.`);
    return done(username, true);
  }

  private carryWarned = false;

  /**
   * Once, for a machine that joined before machine admins existed: what it had is its command-line
   * login, the accounts it kept a copy of when it joined, and its web login.
   */
  private async carryLoginOnce(nodeId: string): Promise<void> {
    if (fs.existsSync(carriedLoginMarker())) return;
    try {
      const commandLine = userDatabaseService.exportCredentialRows().filter(row => row.cliLocked);
      const before = readAccountsSnapshot(latestAccountsBeforeJoin(meshRoot()) ?? '').filter(row => !row.cliLocked);
      await this.carryLogin(nodeId, this.identity()?.name || 'machine', this.loginToCarry([...commandLine, ...before]));
    } catch (error) {
      if (!this.carryWarned) console.warn('[mesh] Could not yet bring this machine\'s admin password into the mesh:', messageOf(error));
      this.carryWarned = true;
    }
  }

  async createEnrollmentToken(): Promise<{ token: string; expiresAt: number }> {
    this.requireQuorum('enroll');
    const certs = readCertPaths();
    if (!certs) throw new Error('This node has no mesh certificate.');
    const created = newEnrollmentToken();
    const expiresAt = Date.now() + 15 * 60 * 1000;
    await this.repo!.insertToken(created.hash, expiresAt);
    // The secret, then the CA fingerprint the joining node checks the member against.
    return { token: `${created.token}.${certificateFingerprint(fs.readFileSync(certs.caCert, 'utf8'))}`, expiresAt };
  }

  async acceptJoin(request: JoinRequest): Promise<JoinResponse> {
    this.requireQuorum('enroll');
    if (protocolError(request.protocolVersion)) {
      throw new Error(protocolError(request.protocolVersion)!);
    }
    const repo = this.repo!;
    const localId = this.identity()?.nodeId || '';
    const requestedId = request.nodeId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.nodeId)
      ? request.nodeId
      : '';
    if (requestedId && requestedId === localId) throw new Error('This machine is already in the mesh.');
    const tokenHash = hashToken(request.token);
    const consumed = await repo.consumeToken(tokenHash, Date.now());
    if (!consumed) throw new Error(tokenRefusal(await repo.tokenState(tokenHash, Date.now())));
    const mesh = await repo.getMesh(this.identity()?.meshId);
    const secrets = this.secrets;
    if (!mesh || !secrets) throw new Error('This node is not in a mesh.');
    const nodeId = requestedId || randomUUID();
    const signed = signNodeCertificate(
      mesh.caCert,
      mesh.caKey,
      request.publicKeyPem,
      nodeId,
      [...hostsFromEndpoint(request.peerUrl), ...hostsFromEndpoint(request.raftAddr)]
    );
    await repo.upsertNode({
      nodeId,
      meshId: mesh.meshId,
      name: request.nodeName,
      endpoints: { peerUrl: request.peerUrl, raftAddr: request.raftAddr, httpAddr: '' },
      capabilities: { platform: 'linux', docker: false, proton: false, installPresent: false, freeMemoryBytes: 0, freeDiskBytes: 0, cpuPercent: 0 },
      leaderEligible: true,
      status: 'alive',
      lastSeen: Date.now(),
      version: '0',
      protocolVersion: request.protocolVersion,
      certSerial: signed.serial,
      maintenance: false,
      weight: 1
    });
    this.publishStatus();
    return {
      meshId: mesh.meshId,
      nodeId,
      caCert: mesh.caCert,
      nodeCert: signed.certPem,
      httpAuthUser: secrets.httpUser,
      httpAuthPass: secrets.httpPass,
      raftAddr: raftAddrOf(secrets)
    };
  }

  async removeNode(nodeId: string): Promise<void> {
    this.requireQuorum('remove-node');
    const node = await this.repo!.getNode(nodeId);
    if (!node) throw new Error('That node was not found.');
    if (node.certSerial) await this.repo!.revokeSerial(node.certSerial, Date.now());
    await this.repo!.upsertNode({ ...node, status: 'removed' });
    await this.forgetServersOn([nodeId]);
    const localId = this.identity()?.nodeId;
    const others = (await this.repo!.listNodes(this.identity()?.meshId)).filter(item => item.status !== 'removed' && item.nodeId !== nodeId);
    const leaving = nodeId === localId || others.length === 0;
    try {
      await this.rqlite?.removeMember(nodeId);
    } catch (error) {
      // The peer API still refuses its certificate; the new password below keeps it out of Raft.
      console.warn('[mesh] Could not take the node out of Raft:', error instanceof Error ? error.message : error);
    }
    // The removed node knew the database password; it is out of Raft now, so it never sees the
    // new one, and rqlite refuses its old one. A node leaving on its own is trusted to go.
    if (!leaving) await this.repo!.setClusterCredential({ user: HTTP_USER, pass: randomUUID() });
    // Leaving, or removing the last member, drops this install back to standalone.
    // The servers on this machine stay where they are.
    if (leaving) await this.leaveLocally();
    else {
      this.publishStatus();
      await this.tellRemoved(node);
    }
  }

  /**
   * A removed machine's servers stay on that machine, where they are its own again, so the mesh
   * forgets them: kept, hidden, they were in the way of that machine joining again and of the
   * clusters they were in. A write, so it needs the mesh to agree.
   */
  private async forgetServersOn(nodeIds: string[]): Promise<void> {
    if (!this.repo || !nodeIds.length) return;
    const gone = new Set(nodeIds);
    const servers = (await this.repo.listServers()).filter(server => gone.has(server.nodeId));
    for (const server of servers) await this.repo.deleteServer(server.serverId);
    if (servers.length) console.log(`[mesh] Forgot ${servers.length} server(s) of machine(s) no longer in the mesh.`);
  }

  /**
   * Tells a removed machine, so it goes standalone on its own rather than finding out when the
   * others refuse it and waiting to be told to leave. One that cannot be reached is removed all
   * the same; it learns of it when it is back.
   */
  private async tellRemoved(node: NodeRecord): Promise<void> {
    const certs = readCertPaths();
    if (!certs) return;
    try {
      await peerRequest({
        url: `${node.endpoints.peerUrl.replace(/\/$/, '')}/v1/removed`,
        method: 'POST',
        body: {},
        ca: fs.readFileSync(certs.caCert, 'utf8'),
        cert: fs.readFileSync(certs.nodeCert, 'utf8'),
        key: fs.readFileSync(certs.nodeKey, 'utf8'),
        timeoutMs: 5_000
      });
    } catch (error) {
      console.warn(`[mesh] Could not tell ${node.name} it was removed:`, error instanceof Error ? error.message : error);
    }
  }

  /**
   * Another member removed this machine: it leaves the mesh, as Leave does. Its servers stay
   * here, and so do the accounts it knows. Only a member's word counts.
   */
  private async takeRemoval(askerId: string): Promise<{ ok: true }> {
    const asker = await this.repo?.getNode(askerId);
    if (!asker || asker.status === 'removed' || askerId === this.identity()?.nodeId) {
      throw new Error(`${asker?.name || 'That machine'} is not a member of the mesh, so it cannot say this one was removed.`);
    }
    console.warn(`[mesh] ${asker.name} removed this machine from the mesh; it is standalone again.`);
    this.removedFromMesh = false;
    // After the reply: leaving stops the peer server this request came in on.
    setTimeout(() => this.quietly(this.leaveLocally(), 'leave the mesh'), 0);
    return { ok: true };
  }

  /** Set while every machine this one reaches refuses it as no longer a member. */
  private removedFromMesh = false;
  /** The forced removal this machine agreed to, until the member that asked says to apply it. */
  private agreedForceRemoval: { key: string; at: number } | null = null;

  /**
   * Takes machines that cannot be reached out of a mesh that has lost its quorum, so the rest can
   * agree again. Raft cannot agree on a removal without a majority, so the machines that stay and
   * can be reached each take the new member list on their own (rqlite's peers.json), after all of
   * them have agreed to it: one that will not, or does not answer, leaves everything as it was.
   * Then the removal is finished as Remove does it. A machine that stays but cannot be reached
   * takes the new list from the others when it is back.
   */
  async forceRemoveNodes(nodeIds: string[], actor = 'desktop'): Promise<CommandResult> {
    const identity = this.identity();
    const localId = identity?.nodeId;
    if (!this.repo || !this.secrets || !localId) return { success: false, error: 'Mesh is not enabled.' };
    if (await this.repo.hasQuorum()) return { success: false, error: 'The mesh can agree on removing machines now: use Remove.' };
    const nodes = (await this.repo.listNodes(identity?.meshId)).filter(node => node.status !== 'removed');
    const removing = [...new Set(nodeIds.map(String))];
    if (removing.length === 0) return { success: false, error: 'Choose the machines to remove.' };
    for (const id of removing) {
      const node = nodes.find(item => item.nodeId === id);
      if (!node) return { success: false, error: 'That machine is not in the mesh.' };
      if (id === localId) return { success: false, error: 'This machine cannot force itself out. Use Leave anyway on it instead.' };
      if (this.reachable(id)) return { success: false, error: `${node.name} can be reached. Only machines that cannot be reached can be forced out.` };
    }
    const staying = nodes.filter(node => !removing.includes(node.nodeId));
    const reachable = staying.filter(node => this.reachable(node.nodeId));
    const needed = Math.floor(staying.length / 2) + 1;
    if (reachable.length < needed) {
      return {
        success: false,
        error: `That would still leave too few: ${reachable.length} of the ${staying.length} machines left can be reached, and they would need ${needed}. Remove more of the machines that cannot be reached.`
      };
    }
    const members: RaftMember[] = staying.map(node => ({ id: node.nodeId, address: node.endpoints.raftAddr }));
    const others = reachable.filter(node => node.nodeId !== localId);
    const names = removing.map(id => nodes.find(node => node.nodeId === id)?.name || id).join(', ');

    for (const node of others) {
      const refusal = await this.askForceRemoval(node, { phase: 'prepare', removing, members });
      if (refusal) return { success: false, error: `${node.name} ${refusal} Nothing was changed.` };
    }
    console.warn(`[mesh] ${actor} is forcing ${names} out of the mesh; ${staying.map(node => node.name).join(', ')} stay`);
    const applied = await Promise.all(others.map(async node => ({ node, refusal: await this.askForceRemoval(node, { phase: 'apply', removing, members }) })));

    this.changingAddress = true;
    try {
      await this.restartRaftWith(localId, members);
      if (!await waitReady(this.rqlite!, this.supervisor, 240)) {
        return { success: false, error: 'The machines took the new member list but have not agreed on a leader yet. Check that each of them is running; it can take a minute.' };
      }
    } finally {
      this.changingAddress = false;
    }

    // As Remove does it: the machines forced out are refused by every member from here on.
    for (const id of removing) {
      const node = await this.repo!.getNode(id);
      if (!node) continue;
      if (node.certSerial) await this.repo!.revokeSerial(node.certSerial, Date.now());
      await this.repo!.upsertNode({ ...node, status: 'removed' });
    }
    await this.forgetServersOn(removing);
    await this.repo!.setClusterCredential({ user: HTTP_USER, pass: randomUUID() });
    this.publishStatus();
    for (const { node, refusal } of applied) {
      if (refusal) console.warn(`[mesh] ${node.name} agreed but did not take the new member list: ${refusal}`);
    }
    return { success: true };
  }

  /** Asks a member to agree to, or take, a forced removal. Null when it did; otherwise why not. */
  private async askForceRemoval(node: NodeRecord, body: ForceRemoval): Promise<string | null> {
    const certs = readCertPaths();
    if (!certs) return 'could not be asked: this machine has no mesh certificate.';
    try {
      const response = await peerRequest({
        url: `${node.endpoints.peerUrl.replace(/\/$/, '')}/v1/force-remove`,
        method: 'POST',
        body,
        ca: fs.readFileSync(certs.caCert, 'utf8'),
        cert: fs.readFileSync(certs.nodeCert, 'utf8'),
        key: fs.readFileSync(certs.nodeKey, 'utf8'),
        timeoutMs: 60_000
      });
      if (response.status === 200) return null;
      return `would not take part: ${(response.body as { error?: string })?.error || `it answered ${response.status}.`}`;
    } catch (error) {
      return `did not answer: ${messageOf(error)}.`;
    }
  }

  /**
   * Another member forces machines out. This machine agrees only while it cannot agree either,
   * cannot reach those machines itself, and stays in the new member list; it takes the list only
   * once it has agreed to that very list, and does not wait for a leader, which needs the others.
   */
  private async takePartInForceRemoval(askerId: string, body: { phase?: unknown; removing?: unknown; members?: unknown }): Promise<{ ok: true }> {
    const localId = this.identity()?.nodeId;
    if (!this.repo || !this.secrets || !localId) throw new Error('This machine is not in a mesh.');
    const removing = Array.isArray(body.removing) ? body.removing.filter((id): id is string => typeof id === 'string') : [];
    const members = Array.isArray(body.members)
      ? body.members
        .filter((item): item is RaftMember => !!item && typeof (item as RaftMember).id === 'string' && typeof (item as RaftMember).address === 'string')
        .map(item => ({ id: item.id, address: item.address }))
      : [];
    const key = JSON.stringify([askerId, removing, members]);
    if (body.phase === 'prepare') {
      if (await this.repo.hasQuorum()) throw new Error('This machine can agree on removing machines now: use Remove.');
      if (!members.some(item => item.id === localId)) throw new Error('This machine is not in the new member list.');
      if (removing.length === 0 || removing.includes(localId)) throw new Error('This machine would be removed.');
      for (const id of removing) {
        if (this.reachable(id)) throw new Error(`This machine can still reach ${(await this.repo.getNode(id))?.name || id}.`);
      }
      this.agreedForceRemoval = { key, at: Date.now() };
      return { ok: true };
    }
    if (body.phase === 'apply') {
      const agreed = this.agreedForceRemoval;
      if (!agreed || agreed.key !== key || Date.now() - agreed.at > FORCE_REMOVAL_AGREEMENT_MS) {
        throw new Error('That member list was not agreed first.');
      }
      this.agreedForceRemoval = null;
      console.warn(`[mesh] Taking the member list another machine forced: ${members.map(item => item.id).join(', ')}`);
      this.changingAddress = true;
      try {
        await this.restartRaftWith(localId, members);
      } finally {
        this.changingAddress = false;
      }
      return { ok: true };
    }
    throw new Error('Unknown step.');
  }

  /** Restarts this machine's rqlited on a member list of its own, with rqlite's peers.json. */
  private async restartRaftWith(nodeId: string, members: RaftMember[]): Promise<void> {
    const secrets = this.secrets!;
    await this.supervisor.stop();
    const raftDir = path.join(rqliteDir(), 'raft');
    fs.mkdirSync(raftDir, { recursive: true });
    fs.writeFileSync(path.join(raftDir, 'peers.json'), JSON.stringify(members.map(item => ({ id: item.id, address: item.address, non_voter: false }))));
    await this.startRqlite(nodeId, secrets);
    const client = new RqliteClient(`http://127.0.0.1:${HTTP_PORT}`, secrets.httpUser, secrets.httpPass, nodeId);
    this.rqlite = client;
    this.repo = new MeshRepository(client);
  }

  /**
   * Leaves without the others' agreement: when they removed this machine while it was away, or
   * none of them can be reached. The others still count it until they remove it. Its servers and
   * its copy of the accounts stay.
   */
  async leaveWithoutQuorum(): Promise<void> {
    console.warn('[mesh] Leaving the mesh without the other machines');
    this.removedFromMesh = false;
    await this.leaveLocally();
  }

  async verifyLogin(username: string, password: string): Promise<AuthenticatedUser | null> {
    if (!this.repo) return null;
    const decision = partitionDecision(await this.repo.hasQuorum(), 'login');
    if (!decision.allow) return null;
    const row = await this.repo.getUserByUsername(username);
    if (!row || !row.enabled) return null;
    const ok = row.hashAlg === 'bcrypt'
      ? await verifyBcrypt(password, row.passwordHash)
      : await verifyArgon2id(password, row.passwordHash);
    if (!ok) return null;
    if (row.hashAlg === 'bcrypt') {
      // The same password, stored better: not a change of access, so no session ends over it.
      const upgraded = await hashArgon2id(password);
      row.passwordHash = upgraded.hash;
      row.passwordParameters = upgraded.parameters;
      row.hashAlg = 'argon2id';
      row.updatedAt = Date.now();
      try { await this.repo.upsertUser(row); } catch { /* partitioned upgrade waits for quorum */ }
    }
    return this.toAuthenticated(row.userId);
  }

  async loginDesktop(username: string, password: string): Promise<AuthenticatedUser | null> {
    const user = this.repo ? await this.verifyLogin(username, password) : await this.verifyMirroredLogin(username, password);
    if (user) this.adoptDesktop(user);
    return user;
  }

  /**
   * While this node reconnects: its own copy of the mesh accounts, which the web interface uses
   * then too. An account set from the command line stays local, so it is not a mesh account.
   */
  private async verifyMirroredLogin(username: string, password: string): Promise<AuthenticatedUser | null> {
    if (!readNodeIdentity()?.meshId) return null;
    const user = await userDatabaseService.verifyCredentials(username, password);
    return user && !user.cliLocked ? user : null;
  }

  /**
   * The first account, only when the mesh has none. A machine that created a mesh before it
   * had any users would otherwise have nothing to sign in with.
   */
  async bootstrapAdmin(username: string, password: string): Promise<AuthenticatedUser | null> {
    if (!this.repo) return null;
    const name = username.trim();
    if (!name) throw new Error('Enter a username.');
    if (password.length < 8) throw new Error('Password must be at least 8 characters.');
    if ((await this.repo.listUsers()).length > 0) return null;
    const verifier = await hashArgon2id(password);
    const userId = randomUUID();
    await this.repo.upsertRole({
      roleId: ROLE_IDS.ADMIN, name: 'Admin', permissions: [...ALL_PERMISSIONS], securityVersion: 1
    });
    await this.repo.upsertUser({
      userId,
      username: name,
      displayName: name,
      passwordHash: verifier.hash,
      passwordParameters: verifier.parameters,
      hashAlg: 'argon2id',
      enabled: true,
      securityVersion: 1,
      roleId: ROLE_IDS.ADMIN,
      ownerUserId: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    const user = await this.toAuthenticated(userId);
    if (user) this.adoptDesktop(user);
    return user;
  }

  logoutDesktop(): void {
    // A standalone desktop ignores it; a member, reconnecting or not, is signed out.
    setMeshDesktopUser(null);
    this.noteDesktopAuth();
  }

  /**
   * Sends a command about a server hosted on another node to that node and returns its result.
   * Null when the server is hosted here, or unknown to the mesh, and the caller acts locally.
   */
  async forwardIfRemote(
    operation: ControlCommand['operation'],
    serverId: string,
    actor: string,
    args?: Record<string, unknown>
  ): Promise<CommandResult | null> {
    if (!this.repo) return null;
    const server = await this.repo.getServer(serverId);
    const localId = this.identity()?.nodeId;
    if (!server || !localId || server.nodeId === localId) return null;
    const decision = partitionDecision(await this.repo.hasQuorum(), 'remote-command');
    if (!decision.allow) return { success: false, error: decision.reason };
    const target = await this.repo.getNode(server.nodeId);
    if (!target || target.status === 'removed') {
      // Nothing can run a command on a node that has left. Its servers can only be forgotten.
      if (operation !== 'delete') return { success: false, error: 'The hosting node is not available.' };
      await this.repo.deleteServer(serverId);
      return { success: true };
    }
    return this.sendCommand(target, {
      commandId: randomUUID(),
      correlationId: randomUUID(),
      actor,
      targetNode: server.nodeId,
      operation,
      serverId,
      args,
      expiry: Date.now() + 60_000,
      issuedAt: Date.now(),
      expectedRevision: server.configRevision
    });
  }

  /**
   * Asks the node hosting a server a read-only question: its live state, log, players, RCON
   * status or an INI file. Null when the server is hosted here. Not a command, so it is not
   * logged and needs no quorum, only a reachable host. Rejects with the reason it failed.
   */
  async queryRemote<T = Record<string, unknown>>(serverId: string, query: MeshQuery, args: Record<string, unknown> = {}): Promise<T | null> {
    if (!this.repo || !serverId) return null;
    const server = await this.repo.getServer(serverId);
    if (!server || server.nodeId === this.identity()?.nodeId) return null;
    const target = await this.repo.getNode(server.nodeId);
    if (!target || target.status === 'removed') throw new Error('The node hosting that server is not available.');
    if ((target.protocolVersion || 1) < QUERY_PROTOCOL) {
      throw new Error(`${target.name} runs an older version of Cerious AASM. Update it to see its servers from another node.`);
    }
    const certs = readCertPaths();
    if (!certs) throw new Error('This node has no mesh certificate.');
    const response = await peerRequest({
      url: `${target.endpoints.peerUrl.replace(/\/$/, '')}/v1/query`,
      method: 'POST',
      body: { serverId, query, args },
      ca: fs.readFileSync(certs.caCert, 'utf8'),
      cert: fs.readFileSync(certs.nodeCert, 'utf8'),
      key: fs.readFileSync(certs.nodeKey, 'utf8'),
      timeoutMs: QUERY_TIMEOUT_MS
    });
    if (response.status !== 200) throw new Error((response.body as { error?: string })?.error || `${target.name} did not answer.`);
    return response.body as T;
  }

  /** Host side of queryRemote. Only servers placed on this node are answered for. */
  private async answerQuery(body: { serverId: string; query: MeshQuery; args?: Record<string, unknown> }): Promise<unknown> {
    const serverId = String(body.serverId || '');
    const row = this.repo ? await this.repo.getServer(serverId) : null;
    if (!row || row.nodeId !== this.identity()?.nodeId) throw new Error('That server is not hosted on this node.');
    const args = body.args || {};
    switch (body.query) {
      case 'state': return { state: localRuntime.state(serverId), instanceId: serverId };
      case 'logs': return localRuntime.logs(serverId, typeof args.maxLines === 'number' ? args.maxLines : undefined);
      case 'players': return localRuntime.players(serverId);
      case 'rcon-status': return localRuntime.rconStatus(serverId);
      case 'online-players': return { instanceId: serverId, players: await localRuntime.onlinePlayers(serverId) };
      case 'ini': return { instanceId: serverId, content: localRuntime.readIni(serverId, String(args.filename || '')) };
      case 'started-config': return { config: readStartedConfig(serverId) };
      case 'backup-copy': return { copy: backupCopies.sent(serverId) };
      // A page of this server open on another machine: the handler runs here, as for a page here.
      case 'server-request': return runForwardedRequest(String(args.channel || ''), recordOf(args.payload), true);
      case 'ark-api': {
        // A query is not logged and needs no quorum, so only a read may come this way.
        const action = String(args.action || '');
        if (!isReadOnlyArkApiAction(action)) throw new Error('That ArkApi action is not a read.');
        return runArkApiAction(serverId, action as ArkApiAction, args);
      }
      default: throw new Error('Unknown query.');
    }
  }

  /**
   * Deletes a server hosted here. Its mesh row goes first: while the row exists the reconciler
   * would re-create the server from the stored config. If the local delete then fails, the row
   * is put back. A server the mesh does not know is only deleted locally.
   */
  async deleteHostedServer(
    serverId: string,
    deleteLocal: () => Promise<{ success: boolean; error?: string; id?: string }>
  ): Promise<{ success: boolean; error?: string; id?: string }> {
    const row = this.repo ? await this.repo.getServer(serverId) : null;
    if (!this.repo || !row) return deleteLocal();
    if (row.nodeId !== this.identity()?.nodeId) return { success: false, error: 'That server is not hosted on this node.' };
    const blocked = this.writeBlock('placement');
    if (blocked) return { success: false, error: blocked };
    await this.repo.deleteServer(serverId);
    const pending = this.intents?.get(serverId);
    if (pending) this.intents!.settle(serverId, pending);
    const result = await deleteLocal();
    if (!result.success) await this.bestEffort('put the server back in the mesh', () => this.repo!.upsertServer(row));
    return result;
  }

  /** Posts a command to another node over mTLS and waits for its result, or a failure. */
  private async sendCommand(target: NodeRecord, command: ControlCommand, timeoutMs = 10 * 60_000): Promise<CommandResult> {
    const outdated = outdatedNode(target, command.operation);
    if (outdated) return { success: false, error: outdated };
    const certs = readCertPaths();
    if (!certs) return { success: false, error: 'This node has no mesh certificate.' };
    try {
      const response = await peerRequest({
        url: `${target.endpoints.peerUrl.replace(/\/$/, '')}/v1/command`,
        method: 'POST',
        body: command,
        ca: fs.readFileSync(certs.caCert, 'utf8'),
        cert: fs.readFileSync(certs.nodeCert, 'utf8'),
        key: fs.readFileSync(certs.nodeKey, 'utf8'),
        timeoutMs
      });
      if (response.status !== 200) {
        return { success: false, error: (response.body as { error?: string })?.error || 'Remote command failed' };
      }
      return response.body as CommandResult;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'That node could not be reached.' };
    }
  }

  /** Starts an ARK or app update on this node, or asks another node to start it on itself. */
  async requestNodeUpdate(nodeId: string, kind: 'ark' | 'app', actor: string): Promise<CommandResult> {
    if (!this.repo) return { success: false, error: 'Mesh is not enabled.' };
    const localId = this.identity()?.nodeId;
    if (!localId) return { success: false, error: 'This install has no node identity.' };
    const target = await this.repo.getNode(nodeId);
    if (!target || target.status === 'removed') return { success: false, error: 'That node is not in the mesh.' };
    if (nodeId !== localId) {
      const decision = partitionDecision(await this.repo.hasQuorum(), 'remote-command');
      if (!decision.allow) return { success: false, error: decision.reason || 'The mesh has no quorum.' };
    }
    if (kind === 'ark') {
      // One machine at a time: its servers are down while it updates, and the others carry the players.
      for (const other of await this.repo.listNodes(this.identity()?.meshId)) {
        if (other.nodeId === nodeId || other.status === 'removed') continue;
        const progress = other.nodeId === localId ? arkUpdateProgress() : this.reportedArkUpdate(other.nodeId);
        if (progress && progress.phase !== 'complete' && progress.phase !== 'error') {
          return { success: false, error: `${other.name} is updating ARK. Update one machine at a time.` };
        }
      }
    }
    const command: ControlCommand = {
      commandId: randomUUID(),
      correlationId: randomUUID(),
      actor,
      targetNode: nodeId,
      operation: kind === 'ark' ? 'update-ark' : 'update-app',
      serverId: nodeId,
      expiry: Date.now() + 10 * 60_000,
      issuedAt: Date.now(),
      expectedRevision: null
    };
    if (nodeId === localId) return this.executeLocalCommand(command);
    return this.sendCommand(target, command);
  }

  /**
   * Changes where the other machines reach a member, such as a public address or a dynamic DNS
   * name for a machine outside their network. The member makes the change itself: this one, or
   * another asked by command.
   */
  async changeAddress(nodeId: string, input: { host?: unknown; peerPort?: unknown; raftPort?: unknown }, actor = 'desktop'): Promise<CommandResult> {
    let address: MeshAddress;
    try {
      address = meshAddressOf(input);
    } catch (error) {
      return { success: false, error: messageOf(error) };
    }
    if (!this.repo) return { success: false, error: 'Mesh is not enabled.' };
    const blocked = this.writeBlock('enroll');
    if (blocked) return { success: false, error: blocked };
    const target = await this.repo.getNode(nodeId);
    if (!target || target.status === 'removed') return { success: false, error: 'That machine is not in the mesh.' };
    const command: ControlCommand = {
      commandId: randomUUID(),
      correlationId: randomUUID(),
      actor,
      targetNode: nodeId,
      operation: 'set-address',
      serverId: nodeId,
      args: { ...address },
      expiry: Date.now() + 10 * 60_000,
      issuedAt: Date.now(),
      expectedRevision: null
    };
    if (nodeId === this.identity()?.nodeId) return this.executeLocalCommand(command);
    return this.sendCommand(target, command, 5 * 60_000);
  }

  /** While this machine changes its address: its rqlited restarts under the new one. */
  private changingAddress = false;

  /**
   * Moves this machine to a new address without leaving the mesh.
   *
   * 1. Every other member that can be asked must reach it there, on both ports, and find its
   *    certificate; otherwise nothing changes.
   * 2. A certificate naming the old address and the new is presented, and recorded with the new
   *    address: members dial the old one until they read the new.
   * 3. rqlited restarts under the new Raft address. With other members it rejoins through them
   *    and the leader replaces its record; on its own it rewrites its membership with peers.json.
   *    If the mesh database does not take it, it goes back to the old address.
   */
  private async changeOwnAddress(address: MeshAddress): Promise<CommandResult> {
    const identity = this.identity();
    const certs = readCertPaths();
    const secrets = this.secrets;
    if (!this.repo || !this.rqlite || !identity?.meshId || !certs || !secrets) return { success: false, error: 'This machine is not in a mesh.' };
    if (this.changingAddress) return { success: false, error: 'This machine is already changing its address.' };
    const blocked = this.writeBlock('enroll');
    if (blocked) return { success: false, error: blocked };
    const nodeId = identity.nodeId;
    const peerUrl = peerUrlFor(address);
    const raftAddr = raftAddrFor(address);
    if (peerUrl === peerUrlOf(secrets) && raftAddr === raftAddrOf(secrets)) return { success: true, detail: { address, unchanged: true } };
    this.changingAddress = true;
    try {
      const repo = this.repo;
      const [mesh, row, members] = await Promise.all([repo.getMesh(identity.meshId), repo.getNode(nodeId), this.rqlite.members()]);
      if (!mesh?.caKey || !row) return { success: false, error: 'This machine\'s record in the mesh was not found.' };

      const probed = await this.probeFromMembers(nodeId, address);
      if (probed.error) return { success: false, error: probed.error };

      const keyPem = fs.readFileSync(certs.nodeKey, 'utf8');
      const previousCert = fs.readFileSync(certs.nodeCert, 'utf8');
      const signed = signNodeCertificate(mesh.caCert, mesh.caKey, publicKeyFromPrivatePem(keyPem), nodeId, [...new Set([...advertisedHosts(secrets), address.host])]);
      fs.writeFileSync(certs.nodeCert, signed.certPem);
      this.peer?.useCertificate(signed.certPem, keyPem);
      try {
        await repo.upsertNode({ ...row, endpoints: { ...row.endpoints, peerUrl, raftAddr }, certSerial: signed.serial });
      } catch (error) {
        // The members still hold the old serial: present the certificate they know.
        fs.writeFileSync(certs.nodeCert, previousCert);
        this.peer?.useCertificate(previousCert, keyPem);
        throw error;
      }
      const next: LocalSecrets = { ...secrets, advertiseHost: address.host, peerUrl, raftAddr };
      writeSecrets(next);
      this.secrets = next;

      const others = members.filter(member => member.id !== nodeId).map(member => member.addr);
      if (await this.rejoinRaft(nodeId, next, others)) {
        console.log(`[mesh] This machine is now reached at ${peerUrl} and ${raftAddr}.`);
        this.publishStatus();
        return { success: true, detail: { address, notAsked: probed.notAsked } };
      }
      const why = this.supervisor.detail();
      // The certificate names both addresses, so it stays.
      writeSecrets(secrets);
      this.secrets = secrets;
      await this.rejoinRaft(nodeId, secrets, others);
      await this.bestEffort('record the old address again', () => this.repo!.upsertNode({ ...row, certSerial: signed.serial }));
      this.publishStatus();
      return { success: false, error: `The mesh database did not take this machine at ${raftAddr}${why ? ` (${why})` : ''}. It kept its old address.` };
    } catch (error) {
      return { success: false, error: messageOf(error) };
    } finally {
      this.changingAddress = false;
    }
  }

  /**
   * Asks each other member whether it reaches this machine at `address`. One that cannot be asked
   * at all is passed over and named; one that answers and cannot reach it stops the change.
   */
  private async probeFromMembers(nodeId: string, address: MeshAddress): Promise<{ error?: string; notAsked: string[] }> {
    const certs = readCertPaths();
    const others = (await this.repo!.listNodes(this.identity()?.meshId)).filter(node => node.nodeId !== nodeId && node.status !== 'removed');
    if (!certs || others.length === 0) return { notAsked: [] };
    const tls = {
      ca: fs.readFileSync(certs.caCert, 'utf8'),
      cert: fs.readFileSync(certs.nodeCert, 'utf8'),
      key: fs.readFileSync(certs.nodeKey, 'utf8')
    };
    const notAsked: string[] = [];
    const failures: string[] = [];
    await Promise.all(others.map(async node => {
      let response: { status: number; body: unknown };
      try {
        response = await peerRequest({
          url: `${node.endpoints.peerUrl.replace(/\/$/, '')}/v1/probe-address`,
          method: 'POST',
          body: { peerUrl: peerUrlFor(address), raftAddr: raftAddrFor(address) },
          ...tls,
          timeoutMs: 30_000
        });
      } catch {
        notAsked.push(node.name);
        return;
      }
      if (response.status === 404) {
        failures.push(`${node.name} runs an older version of Cerious AASM, which cannot check a new address. Update it first.`);
        return;
      }
      if (response.status !== 200) {
        failures.push(`${node.name} could not check the new address: ${(response.body as { error?: string })?.error || `error ${response.status}`}.`);
        return;
      }
      const probe = response.body as Partial<AddressProbe>;
      if (!probe.peer?.ok) failures.push(`${node.name} could not reach this machine at ${address.host}:${address.peerPort} (${probe.peer?.error || 'no answer'}).`);
      if (!probe.raft?.ok) failures.push(`${node.name} could not reach this machine at ${address.host}:${address.raftPort} (${probe.raft?.error || 'no answer'}).`);
    }));
    if (failures.length > 0) {
      return {
        error: `${failures.join(' ')} Nothing was changed. Check that TCP ports ${address.peerPort} and ${address.raftPort} reach this machine. `
          + 'A machine on the same network as this one reaches it by its public address only if the router supports NAT loopback.',
        notAsked
      };
    }
    return { notAsked: notAsked.sort() };
  }

  /**
   * Restarts this machine's rqlited under the Raft address in `secrets`: through the other
   * members, whose leader replaces its record, or on its own with peers.json. True once the
   * mesh database holds it at that address.
   */
  private async rejoinRaft(nodeId: string, secrets: LocalSecrets, others: string[]): Promise<boolean> {
    const raftAddr = raftAddrOf(secrets);
    await this.supervisor.stop();
    if (others.length === 0) {
      const raftDir = path.join(rqliteDir(), 'raft');
      fs.mkdirSync(raftDir, { recursive: true });
      fs.writeFileSync(path.join(raftDir, 'peers.json'), JSON.stringify([{ id: nodeId, address: raftAddr, non_voter: false }]));
    }
    await this.startRqlite(nodeId, secrets, others.length > 0 ? others.join(',') : undefined);
    const client = new RqliteClient(`http://127.0.0.1:${HTTP_PORT}`, secrets.httpUser, secrets.httpPass, nodeId);
    this.rqlite = client;
    this.repo = new MeshRepository(client);
    if (!await waitReady(client, this.supervisor, 120)) return false;
    for (let attempt = 0; attempt < 120; attempt++) {
      try {
        if ((await client.members()).some(member => member.id === nodeId && member.addr === raftAddr)) return true;
      } catch {
        /* rqlited is still settling */
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return false;
  }

  /** Another member asks whether this one reaches it at an address: its own certificate has to answer there. */
  private async probeAddress(askerId: string, body: { peerUrl: string; raftAddr: string }): Promise<AddressProbe> {
    const address = addressFromEndpoints(body.peerUrl, body.raftAddr);
    const certs = readCertPaths();
    if (!address || !certs) {
      const unusable = { ok: false, error: 'That is not an address.' };
      return { peer: unusable, raft: unusable };
    }
    const tls = {
      ca: fs.readFileSync(certs.caCert, 'utf8'),
      cert: fs.readFileSync(certs.nodeCert, 'utf8'),
      key: fs.readFileSync(certs.nodeKey, 'utf8')
    };
    const check = async (port: number): Promise<{ ok: boolean; error?: string }> => {
      const found = await probeTls({ host: address.host, port, ...tls, timeoutMs: 8000 });
      if (found.commonName === askerId) return { ok: true };
      return { ok: false, error: found.commonName ? 'Another machine answers there.' : (found.error || 'No answer.') };
    };
    const [peer, raft] = await Promise.all([check(address.peerPort), check(address.raftPort)]);
    return { peer, raft };
  }

  private blockerChecked: { at: number; problem: string | null } | null = null;

  /** Why this machine cannot run the mesh database, if it cannot. Checked at most once a minute: it runs rqlited. */
  private meshBlocker(): string | null {
    if (!this.blockerChecked || Date.now() - this.blockerChecked.at > 60_000) {
      this.blockerChecked = { at: Date.now(), problem: rqliteProblem() };
    }
    return this.blockerChecked.problem;
  }

  /** Where other machines reach this one: as it joined with, or as it would advertise if it created or joined a mesh now. */
  private advertisedAddress(): MeshAddress | undefined {
    const secrets = this.secrets ?? (this.identity()?.meshId ? readSecrets() : null);
    return addressFromEndpoints(
      secrets ? peerUrlOf(secrets) : advertisedPeerUrl(),
      secrets ? raftAddrOf(secrets) : advertisedRaftAddr()
    ) ?? undefined;
  }

  /**
   * Runs a command addressed to this node, once per CommandId. A start or stop that succeeds
   * becomes this node's desired state for the server, so the reconciler keeps it.
   */
  async executeLocalCommand(command: ControlCommand): Promise<CommandResult> {
    if (!this.repo) return { success: false, error: 'Mesh is not enabled.' };
    const localId = this.identity()?.nodeId;
    if (command.targetNode !== localId) {
      return { success: false, error: 'That command is addressed to another node.' };
    }
    if (SERVER_COMMANDS.has(command.operation)) {
      const row = await this.repo.getServer(command.serverId);
      if (row && row.nodeId !== localId) return { success: false, error: 'That server is not hosted on this node.' };
    }
    const result = await executeCommand(this.repo, command, async current => {
      // Here, once per command: a command sent again is not credited twice.
      this.creditCommand(current);
      const args = current.args || {};
      if (current.operation === 'rcon') {
        const answer = await localRuntime.rcon(current.serverId, String(args.command || ''));
        return answer.error ? { success: false, error: answer.error } : { success: true, detail: { response: answer.response } };
      }
      if (current.operation === 'connect-rcon') {
        const connected = await localRuntime.connectRcon(current.serverId);
        localRuntime.announceRcon(current.serverId, !!connected.connected);
        return connected.success
          ? { success: true, detail: { connected: !!connected.connected } }
          : { success: false, error: connected.error, detail: { connected: false } };
      }
      if (current.operation === 'disconnect-rcon') {
        const disconnected = await localRuntime.disconnectRcon(current.serverId);
        localRuntime.announceRconDown(current.serverId);
        return { success: disconnected.success, detail: { connected: false } };
      }
      if (current.operation === 'ark-api') {
        const outcome = await runArkApiAction(current.serverId, String(args.action || '') as ArkApiAction, args);
        return { success: outcome.success !== false, error: typeof outcome.error === 'string' ? outcome.error : undefined, detail: outcome };
      }
      if (current.operation === 'save-ini') {
        const saved = await localRuntime.saveIni(current.serverId, String(args.filename || ''), String(args.content ?? ''));
        if (saved) await this.recordSaved(saved);
        return { success: true, detail: { instance: saved } };
      }
      if (current.operation === 'set-ownership') {
        // Only the two ownership fields: the coordinator checked who may set them.
        const patch: Partial<InstanceConfig> = {};
        if ('operatorUserId' in args) patch.operatorUserId = (args.operatorUserId as string | null) ?? null;
        if ('managerUserId' in args) patch.managerUserId = (args.managerUserId as string | null) ?? null;
        const patched = await localRuntime.patchConfig(current.serverId, patch);
        if (!patched.instance) return { success: false, error: patched.error || 'That server was not saved.' };
        await this.recordSaved(patched.instance);
        return { success: true, detail: { instance: patched.instance } };
      }
      if (current.operation === 'start') {
        const started = await localRuntime.start(current.serverId);
        if (started.started) await this.noteDesired(current.serverId, 'running');
        return { success: started.started, error: started.portError };
      }
      // With minutes of warning, the players hear the countdown a scheduled restart gives them first.
      const warningMinutes = Math.max(0, Math.floor(Number(args.warningMinutes) || 0));
      if (current.operation === 'restart' && warningMinutes) {
        const dueAt = restartCountdowns.begin([current.serverId], warningMinutes, false, async ([id]) => { await this.restartHosted(id); });
        return { success: true, detail: { dueAt } };
      }
      if (current.operation === 'cancel-restart') return { success: restartCountdowns.cancel(current.serverId) };
      if (current.operation === 'stop' || current.operation === 'restart') {
        const stopped = await localRuntime.stop(current.serverId);
        if (!stopped.success) return { success: false, error: stopped.error };
        if (current.operation === 'stop') {
          await this.noteDesired(current.serverId, 'stopped');
          return { success: true };
        }
      }
      if (current.operation === 'force-stop') {
        const stopped = await localRuntime.forceStop(current.serverId);
        if (stopped.success) await this.noteDesired(current.serverId, 'stopped');
        return { success: stopped.success, error: stopped.error };
      }
      if (current.operation === 'restart') {
        const started = await localRuntime.start(current.serverId);
        if (started.started) await this.noteDesired(current.serverId, 'running');
        return { success: started.started, error: started.portError };
      }
      if (current.operation === 'move') return this.moveOut(current.serverId, current.destinationNodeId);
      if (current.operation === 'save-config') return this.saveHosted(current.instance || {});
      if (current.operation === 'start-all' || current.operation === 'stop-all') return this.allHere(current.operation, current.serverIds || []);
      if (current.operation === 'restart-all') return this.restartAllHere(current.serverIds || [], warningMinutes);
      if (current.operation === 'cancel-restart-all') return { success: true, detail: { cancelled: restartCountdowns.cancelAll() } };
      if (current.operation === 'server-request') {
        const reply = await runForwardedRequest(String(args.channel || ''), recordOf(args.payload), false) as { success?: unknown; error?: unknown } | null;
        return { success: reply?.success !== false, error: typeof reply?.error === 'string' ? reply.error : undefined, detail: reply ?? undefined };
      }
      if (current.operation === 'take-backup-copy') return this.takeBackupCopy(current.serverId, args);
      if (current.operation === 'drop-backup-copy') {
        backupCopies.drop(current.serverId);
        return { success: true };
      }
      if (current.operation === 'fetch-backup-copy') return this.fetchBackupCopy(current.serverId);
      if (current.operation === 'delete') {
        const deleted = await this.deleteHostedServer(current.serverId, () => localRuntime.deleteInstance(current.serverId));
        if (deleted.success) this.quietly(serverInstanceService.broadcastInstances(), 'send the server list to the pages');
        return { success: deleted.success, error: deleted.error };
      }
      if (current.operation === 'set-address') return this.changeOwnAddress(meshAddressOf(args));
      if (current.operation === 'update-ark') return beginClusterUpdate();
      if (current.operation === 'update-app') {
        const applied = await autoUpdateService.applyAvailableUpdate();
        return {
          success: applied.success,
          error: applied.error,
          detail: applied.relaunch ? { relaunch: true, version: applied.version } : undefined
        };
      }
      return { success: false, error: 'Unknown operation' };
    });
    this.scheduleAppRelaunch(result);
    return result;
  }

  async annotateInventory<T extends { id: string; nodeId?: string }>(instances: T[]): Promise<T[]> {
    if (!this.repo) return instances;
    const servers = await this.repo.listServers();
    const byId = new Map(servers.map(server => [server.serverId, server]));
    return instances.map(instance => {
      const row = byId.get(instance.id);
      return row ? { ...instance, nodeId: row.nodeId } : instance;
    });
  }

  /**
   * Local servers plus every server the mesh has placed on another machine.
   * A standalone install returns the local list unchanged.
   */
  async withMeshServers<T extends InstanceConfig>(local: T[]): Promise<Array<T | InstanceConfig>> {
    if (!this.isEnabled() || !this.repo) return local;
    const localId = this.identity()?.nodeId || '';
    let servers: ServerRecord[] = [];
    let removed = new Set<string>();
    try {
      const [rows, nodes] = await Promise.all([
        this.repo.listServers(),
        this.repo.listNodes(this.identity()?.meshId)
      ]);
      servers = rows;
      removed = new Set(nodes.filter(node => node.status === 'removed').map(node => node.nodeId));
    } catch {
      return local;
    }
    const byId = new Map(servers.map(server => [server.serverId, server]));
    const tagged = local.map(instance => {
      const row = byId.get(instance.id);
      return { ...instance, nodeId: row?.nodeId || instance.nodeId || localId };
    });
    const known = new Set(tagged.map(instance => instance.id));
    const remote = servers
      .filter(server => server.nodeId && server.nodeId !== localId && !known.has(server.serverId) && !removed.has(server.nodeId))
      .map(server => {
        const instance = instanceFromMeshServer(server);
        // A machine that has stopped sending heartbeats: what it last reported may no longer be
        // true, so its servers say so rather than show it. The heartbeat is what its card goes by.
        if (!this.reachable(server.nodeId)) return { ...instance, state: 'unreachable' } as InstanceConfig;
        // What its host last reported; the stored desired state until it reports one.
        const live = this.liveStates.get(server.serverId);
        if (!live) return instance;
        const reported = Object.fromEntries(Object.entries(live).filter(([key, value]) => key !== 'nodeId' && value !== undefined));
        return { ...instance, ...reported } as InstanceConfig;
      });
    return [...tagged, ...remote];
  }

  /** A server hosted on another machine, for the page that opens it. Null when it lives here or is unknown. */
  async remoteInstance(id: string): Promise<InstanceConfig | null> {
    if (!this.repo || !id) return null;
    const server = await this.repo.getServer(id);
    const localId = this.identity()?.nodeId;
    if (!server || !localId || server.nodeId === localId) return null;
    return instanceFromMeshServer(server);
  }

  /**
   * Records the config of a server saved on this node, as hosted here. Placement never changes
   * here: a server moves only through move(). Without quorum the save stays on disk, listed in
   * pending-configs.json, and is recorded on a later tick; the local save is not undone.
   */
  async recordServer(server: { id: string; name?: string; mapName?: string; configRevision?: number; nodeId?: string; operatorUserId?: string | null; managerUserId?: string | null; clusterId?: string }): Promise<void> {
    if (!this.repo) return;
    const localId = this.identity()?.nodeId || '';
    const existing = await this.repo.getServer(server.id);
    if (existing && existing.nodeId !== localId) throw new Error('That server is hosted on another node.');
    const { nodeId: _placement, ...config } = server;
    const live = (server as { state?: string }).state;
    const record: ServerRecord = {
      serverId: server.id,
      name: server.name || server.id,
      nodeId: localId,
      mapName: server.mapName || '',
      desiredState: existing?.desiredState || (live === 'running' || live === 'starting' ? 'running' : 'stopped'),
      configRevision: Number(server.configRevision) || existing?.configRevision || 1,
      configJson: JSON.stringify(config),
      clusterId: server.clusterId || existing?.clusterId || null,
      operatorUserId: server.operatorUserId ?? existing?.operatorUserId ?? null,
      managerUserId: server.managerUserId ?? existing?.managerUserId ?? null
    };
    try {
      await this.repo.upsertServer(record);
      this.pendingConfigs?.remove(server.id);
    } catch (error) {
      if (await this.repo.hasQuorum().catch(() => false)) throw error;
      this.pendingConfigs?.add(server.id);
    }
  }

  /**
   * Saves a server's config on the node that hosts it, or on the node chosen for a new server
   * (Auto-select decides that here, before anything is saved). Null when that node is this one
   * and the caller saves locally. No copy of a server hosted elsewhere is written here.
   */
  async saveElsewhere(instance: Partial<InstanceConfig>, actor: string): Promise<{ success: boolean; instance?: InstanceConfig; error?: string } | null> {
    if (!this.repo) return null;
    const localId = this.identity()?.nodeId || '';
    const existing = instance.id ? await this.repo.getServer(String(instance.id)) : null;
    let nodeId = existing?.nodeId || instance.nodeId || '';
    if (!nodeId) nodeId = (await this.suggestPlacement().catch(() => null)) || localId;
    if (nodeId === localId) return null;
    const decision = partitionDecision(this.quorum, existing ? 'remote-command' : 'placement');
    if (!decision.allow) return { success: false, error: decision.reason };
    const target = await this.repo.getNode(nodeId);
    if (!target || target.status === 'removed') return { success: false, error: 'That node is not available.' };
    const { nodeId: _placement, ...config } = { ...instance, id: instance.id || randomUUID() };
    const result = await this.sendCommand(target, {
      commandId: randomUUID(),
      correlationId: randomUUID(),
      actor,
      targetNode: nodeId,
      operation: 'save-config',
      serverId: String(config.id),
      instance: config as Record<string, unknown>,
      expiry: Date.now() + 60_000,
      issuedAt: Date.now(),
      expectedRevision: existing?.configRevision ?? null
    });
    const saved = (result.detail as { instance?: InstanceConfig } | undefined)?.instance;
    return { success: result.success, error: result.error, instance: saved ? { ...saved, nodeId } : undefined };
  }

  /**
   * Splits server ids by the node that hosts them. A server the mesh does not know, or any
   * server on a standalone install, is local. A server whose node has left the mesh is dropped.
   */
  async hostsOf(ids: string[]): Promise<{ local: string[]; remote: Map<string, string[]> }> {
    if (!this.repo) return { local: [...ids], remote: new Map() };
    const localId = this.identity()?.nodeId;
    const [servers, nodes] = await Promise.all([this.repo.listServers(), this.repo.listNodes(this.identity()?.meshId)]);
    const hostOf = new Map(servers.map(server => [server.serverId, server.nodeId]));
    const members = new Set(nodes.filter(node => node.status !== 'removed').map(node => node.nodeId));
    const local: string[] = [];
    const remote = new Map<string, string[]>();
    for (const id of ids) {
      const host = hostOf.get(id);
      if (!host || host === localId) local.push(id);
      else if (members.has(host)) remote.set(host, [...(remote.get(host) || []), id]);
    }
    return { local, remote };
  }

  /** Start All or Stop All on other nodes: one command per node, naming its servers. */
  async commandHosts(
    operation: 'start-all' | 'stop-all' | 'restart-all' | 'cancel-restart-all',
    remote: Map<string, string[]>,
    actor: string,
    args?: Record<string, unknown>
  ): Promise<Array<{ nodeId: string; nodeName: string; result: CommandResult }>> {
    if (!this.repo || remote.size === 0) return [];
    const decision = partitionDecision(this.quorum, 'remote-command');
    return Promise.all([...remote.entries()].map(async ([nodeId, serverIds]) => {
      const node = await this.repo!.getNode(nodeId);
      const nodeName = node?.name || nodeId;
      if (!decision.allow) return { nodeId, nodeName, result: { success: false, error: decision.reason } };
      if (!node) return { nodeId, nodeName, result: { success: false, error: 'That node is not available.' } };
      const result = await this.sendCommand(node, {
        commandId: randomUUID(),
        correlationId: randomUUID(),
        actor,
        targetNode: nodeId,
        operation,
        serverId: nodeId,
        serverIds,
        ...(args ? { args } : {}),
        expiry: Date.now() + 60_000,
        issuedAt: Date.now(),
        expectedRevision: null
      }, ALL_TIMEOUT_MS);
      return { nodeId, nodeName, result };
    }));
  }

  /** Work started and not waited for: a failure is logged rather than left unhandled. */
  private quietly(task: Promise<unknown>, what: string): void {
    task.catch(error => console.warn(`[mesh] Could not ${what}:`, messageOf(error)));
  }

  /** Requests about a server on another machine run there: see host-routing. */
  private readonly stopRoutingToHosts = (setHostRouter((channel, serverId, payload, read, sender) =>
    this.routeToHost(channel, serverId, payload, read, sender)), () => setHostRouter(null));

  /**
   * A request about a server hosted on another machine: a read as a query, which needs no quorum,
   * a change as a logged command. Null for a server hosted here, or outside a mesh.
   */
  private async routeToHost(channel: string, serverId: string, payload: Record<string, unknown>, read: boolean, sender: MessageSender): Promise<unknown | null> {
    if (!this.repo || !this.isEnabled()) return null;
    const row = await this.repo.getServer(serverId);
    const localId = this.identity()?.nodeId;
    if (!row || !localId || row.nodeId === localId) return null;
    if (read) return this.queryRemote(serverId, 'server-request', { channel, payload });
    const actor = identifySender(sender).user?.username || 'desktop';
    const result = await this.forwardIfRemote('server-request', serverId, actor, { channel, payload });
    if (!result) return null;
    return result.detail && typeof result.detail === 'object' ? result.detail : { success: result.success, error: result.error };
  }

  /** After each backup here, one other machine keeps a copy of it, in place of the copy before. */
  private readonly stopCopyingBackups = backupService.onBackupCreated(backup => {
    void this.copyLatestBackup(backup).catch(error => console.warn('[mesh] Could not copy a backup to another machine:', messageOf(error)));
  });

  /** The machine to keep a copy of a backup on: reachable now, with the most free disk. */
  private async backupHolder(): Promise<NodeRecord | null> {
    const localId = this.identity()?.nodeId;
    const nodes = (await this.repo!.listNodes(this.identity()?.meshId))
      .filter(node => node.nodeId !== localId && node.status !== 'removed' && this.reachable(node.nodeId))
      .sort((a, b) => (b.capabilities?.freeDiskBytes || 0) - (a.capabilities?.freeDiskBytes || 0));
    return nodes[0] ?? null;
  }

  private async copyLatestBackup(backup: BackupMetadata): Promise<void> {
    if (!this.repo || !this.isEnabled()) return;
    const localId = this.identity()?.nodeId || '';
    const row = await this.repo.getServer(backup.instanceId);
    if (!row || row.nodeId !== localId) return;
    const holder = await this.backupHolder();
    if (!holder) {
      console.warn(`[mesh] No other machine can be reached to keep a copy of the latest backup of ${row.name}.`);
      return;
    }
    const fileName = path.basename(backup.filePath);
    const self = await this.repo.getNode(localId);
    const command = (target: NodeRecord, operation: ControlCommand['operation'], args?: Record<string, unknown>): ControlCommand => ({
      commandId: randomUUID(), correlationId: randomUUID(), actor: 'backup', targetNode: target.nodeId, operation,
      serverId: backup.instanceId, ...(args ? { args } : {}), expiry: Date.now() + 60_000, issuedAt: Date.now(), expectedRevision: null
    });
    const taken = await this.sendCommand(holder, command(holder, 'take-backup-copy', {
      serverName: row.name, fileName, size: backup.size, fromNodeId: localId, fromNodeName: self?.name || ''
    }), BACKUP_COPY_TIMEOUT_MS);
    if (!taken.success) {
      console.warn(`[mesh] ${holder.name} could not keep a copy of the latest backup of ${row.name}: ${taken.error || 'no reason was given'}`);
      return;
    }
    backupCopies.recordSent(backup.instanceId, { nodeId: holder.nodeId, nodeName: holder.name, fileName, size: backup.size });
    console.log(`[mesh] ${holder.name} keeps a copy of the latest backup of ${row.name}.`);
    // Only the latest: a copy an earlier backup left on another machine goes.
    const others = (await this.repo.listNodes(this.identity()?.meshId))
      .filter(node => node.nodeId !== localId && node.nodeId !== holder.nodeId && node.status !== 'removed');
    await Promise.all(others.map(node => this.sendCommand(node, command(node, 'drop-backup-copy')).catch(() => null)));
  }

  /** Holder side: fetches the backup from the machine that made it, in place of the copy before. */
  private async takeBackupCopy(serverId: string, args: Record<string, unknown>): Promise<CommandResult> {
    const from = await this.repo!.getNode(String(args.fromNodeId || ''));
    const certs = readCertPaths();
    if (!from || !certs) return { success: false, error: 'The machine with that backup is not available.' };
    const fileName = String(args.fileName || '');
    const tls = { ca: fs.readFileSync(certs.caCert, 'utf8'), cert: fs.readFileSync(certs.nodeCert, 'utf8'), key: fs.readFileSync(certs.nodeKey, 'utf8') };
    const url = `${from.endpoints.peerUrl.replace(/\/$/, '')}/v1/backup-file?serverId=${encodeURIComponent(serverId)}&fileName=${encodeURIComponent(fileName)}`;
    return backupCopies.hold({
      serverId, serverName: String(args.serverName || serverId), fileName, size: Number(args.size) || 0,
      fromNodeId: from.nodeId, fromNodeName: String(args.fromNodeName || from.name)
    }, dest => peerDownload({ url, dest, ...tls, timeoutMs: BACKUP_COPY_TIMEOUT_MS }));
  }

  /** A backup of a server hosted here, by its own file name only: never a path out of its folder. */
  private backupFileHere(serverId: string, fileName: string): string | null {
    const hostedHere = !!serverId && meshServer(serverId)?.nodeId === this.identity()?.nodeId;
    if (!hostedHere || !/^[\w.-]+\.zip$/.test(fileName)) return null;
    const file = path.join(BackupPathUtils.getInstanceBackupDir(getInstanceDir(serverId)), fileName);
    return fs.existsSync(file) ? file : null;
  }

  /**
   * A backup of a server on another machine, fetched into this machine's downloads folder so it can
   * be shown and opened here. Null for a server hosted here, or outside a mesh.
   */
  async fetchBackupForDownload(serverId: string, backupId: string): Promise<{ success: boolean; filePath?: string; fileName?: string; error?: string } | null> {
    if (!this.repo || !this.isEnabled()) return null;
    const row = await this.repo.getServer(serverId);
    const localId = this.identity()?.nodeId;
    if (!row || !localId || row.nodeId === localId) return null;
    const located = await this.queryRemote<{ success?: boolean; fileName?: string; error?: string }>(serverId, 'server-request', {
      channel: 'locate-backup', payload: { instanceId: serverId, backupId }
    });
    const fileName = located?.fileName;
    if (!located?.success || !fileName || !/^[\w.-]+\.zip$/.test(fileName)) return { success: false, error: located?.error || 'That backup was not found.' };
    const host = await this.repo.getNode(row.nodeId);
    const certs = readCertPaths();
    if (!host || !certs) return { success: false, error: 'The machine with that backup is not available.' };
    const dir = path.join(getDefaultInstallDir(), 'downloads', serverId);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, fileName);
    const tls = { ca: fs.readFileSync(certs.caCert, 'utf8'), cert: fs.readFileSync(certs.nodeCert, 'utf8'), key: fs.readFileSync(certs.nodeKey, 'utf8') };
    const url = `${host.endpoints.peerUrl.replace(/\/$/, '')}/v1/backup-file?serverId=${encodeURIComponent(serverId)}&fileName=${encodeURIComponent(fileName)}`;
    const fetched = await peerDownload({ url, dest, ...tls, timeoutMs: BACKUP_COPY_TIMEOUT_MS });
    return fetched ? { success: true, filePath: dest, fileName } : { success: false, error: `Could not fetch ${fileName} from ${host.name}.` };
  }

  /** Host side: brings the latest copy back into the server's backups, from the machine keeping it. */
  async fetchBackupCopy(serverId: string): Promise<CommandResult> {
    const sent = backupCopies.sent(serverId);
    const holder = sent ? await this.repo?.getNode(sent.nodeId) : null;
    const certs = readCertPaths();
    if (!sent || !holder || holder.status === 'removed' || !certs) return { success: false, error: 'No other machine keeps a copy of this server\'s latest backup.' };
    const dir = BackupPathUtils.getInstanceBackupDir(getInstanceDir(serverId));
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, sent.fileName);
    if (fs.existsSync(dest)) return { success: true, detail: { fileName: sent.fileName, alreadyHere: true } };
    const tls = { ca: fs.readFileSync(certs.caCert, 'utf8'), cert: fs.readFileSync(certs.nodeCert, 'utf8'), key: fs.readFileSync(certs.nodeKey, 'utf8') };
    const url = `${holder.endpoints.peerUrl.replace(/\/$/, '')}/v1/backup-copy-file?serverId=${encodeURIComponent(serverId)}`;
    const fetched = await peerDownload({ url, dest, ...tls, timeoutMs: BACKUP_COPY_TIMEOUT_MS });
    return fetched
      ? { success: true, detail: { fileName: sent.fileName } }
      : { success: false, error: `Could not bring the copy back from ${holder.name}.` };
  }

  /**
   * On the leader: takes out of Raft each machine the mesh marked removed that is still a voter, so a
   * removal whose Raft step failed (a leadership change, say) is finished rather than left counting.
   */
  private async dropRemovedVoters(nodes: NodeRecord[]): Promise<void> {
    const rqlite = this.rqlite;
    if (!rqlite) return;
    const status = await rqlite.status().catch(() => null);
    if (!status?.leader) return;
    const removed = new Set(nodes.filter(node => node.status === 'removed').map(node => node.nodeId));
    if (!removed.size) return;
    for (const member of await rqlite.members().catch(() => [])) {
      if (!removed.has(member.id)) continue;
      try {
        await rqlite.removeMember(member.id);
        console.log(`[mesh] Took ${member.id}, which was removed from the mesh, out of Raft.`);
      } catch (error) {
        console.warn(`[mesh] Could not take ${member.id}, which was removed from the mesh, out of Raft yet:`, messageOf(error));
      }
    }
  }

  /** Stops a server hosted here and starts it again: the end of a restart's countdown. */
  private async restartHosted(id: string): Promise<void> {
    const stopped = await localRuntime.stop(id);
    if (!stopped.success) {
      console.error(`[mesh] Could not stop ${id} to restart it: ${stopped.error}`);
      return;
    }
    const started = await localRuntime.start(id);
    if (started.started) await this.noteDesired(id, 'running');
  }

  /**
   * Host side of restart-all: the listed servers running here stop together, then start again in
   * sidebar order, the start delay apart. After the countdown when there are minutes of warning.
   */
  private async restartAllHere(ids: string[], warningMinutes: number): Promise<CommandResult> {
    const running = ids.filter(id => UP_STATES.has(localRuntime.state(id)));
    const restart = async (restarting: string[]) => {
      await localRuntime.stopAll(restarting);
      const { started } = await localRuntime.startAll(restarting);
      for (const id of started) await this.noteDesired(id, 'running');
    };
    if (warningMinutes) {
      const dueAt = running.length ? restartCountdowns.begin(running, warningMinutes, true, restart) : null;
      return { success: true, detail: { restarting: running, dueAt } };
    }
    await restart(running);
    return { success: true, detail: { restarting: running } };
  }

  /** Host side of start-all and stop-all. Each server that changed is recorded as desired. */
  private async allHere(operation: 'start-all' | 'stop-all', ids: string[]): Promise<CommandResult> {
    if (operation === 'start-all') {
      const { started, failed } = await localRuntime.startAll(ids);
      for (const id of started) await this.noteDesired(id, 'running');
      return { success: failed.length === 0, error: failed.length ? `Could not start ${failed.join(', ')}.` : undefined, detail: { started, failed } };
    }
    const { stopped, failed } = await localRuntime.stopAll(ids);
    for (const id of stopped) await this.noteDesired(id, 'stopped');
    return { success: failed.length === 0, error: failed.length ? `Could not stop ${failed.join(', ')}.` : undefined, detail: { stopped, failed } };
  }

  /** Host side of save-config: the same save a local edit makes, recorded as hosted here. */
  private async saveHosted(config: Record<string, unknown>): Promise<CommandResult> {
    const { nodeId: _placement, ...instance } = config as Partial<InstanceConfig>;
    const result = await localRuntime.saveInstance(instance);
    if (!result.success || !result.instance) return { success: false, error: result.error || 'The server was not saved.' };
    await this.recordSaved(result.instance);
    return { success: true, detail: { instance: result.instance } };
  }

  /** A config saved here by a command: into the mesh, and to the clients of this node. */
  private async recordSaved(saved: InstanceConfig): Promise<void> {
    await this.recordServer(saved);
    messagingService.sendToAll('server-instance-updated', saved);
    this.quietly(serverInstanceService.broadcastInstances(), 'send the server list to the pages');
  }

  /** Records configs saved here while the mesh could not take them. */
  private async flushPendingConfigs(): Promise<void> {
    if (!this.pendingConfigs) return;
    for (const serverId of this.pendingConfigs.ids()) {
      try {
        const row = await this.repo?.getServer(serverId);
        const { instance } = await localRuntime.getInstance(serverId);
        if (!instance || (row && row.nodeId !== this.identity()?.nodeId)) {
          this.pendingConfigs.remove(serverId);
          continue;
        }
        await this.recordServer(instance);
      } catch (error) {
        console.warn(`[mesh] Could not record the config of ${serverId} yet:`, error instanceof Error ? error.message : error);
      }
    }
  }

  /**
   * Records a start or stop decided on this node for a server it hosts. The mesh row is updated
   * now if it can be. Without quorum the decision waits on disk, still wins over the row here,
   * and is written on a later tick. A partition never blocks or undoes the local action.
   */
  async noteDesired(serverId: string, desiredState: DesiredState): Promise<void> {
    const localId = this.identity()?.nodeId;
    if (!this.repo || !this.intents || !localId) return;
    const existing = await this.repo.getServer(serverId);
    if (!existing || existing.nodeId !== localId) return;
    this.intents.set(serverId, desiredState);
    await this.flushIntents(localId);
  }

  private async flushIntents(localId: string): Promise<void> {
    if (!this.repo || !this.intents) return;
    for (const [serverId, desiredState] of this.intents.entries()) {
      try {
        await this.repo.setDesiredState(serverId, localId, desiredState);
        this.intents.settle(serverId, desiredState);
      } catch {
        // No quorum. The decision stays on disk and is written on a later tick.
      }
    }
  }

  suggestPlacement(): Promise<string | null> {
    return this.placementInputs().then(chooseNode);
  }

  /**
   * A cluster: a name and the ID ARK is given. Each server chooses whether it is in one. Without a
   * path its transfer files are kept by the app on every machine (storage mode 'managed'); with
   * one, every member is expected to reach that shared folder.
   */
  async createCluster(input: { name: string; arkClusterId: string; path?: string; clusterId?: string }): Promise<ClusterRecord> {
    this.requireQuorum('placement');
    const name = clusterNameOf(input.name);
    const arkClusterId = arkClusterIdOf(input.arkClusterId);
    assertArkClusterIdFree(await this.repo!.listClusters(), arkClusterId);
    const profile: StorageProfileRecord = input.path
      ? {
        storageProfileId: randomUUID(),
        mode: 'shared-path',
        authorityNodeId: null,
        metadata: { path: input.path },
        health: { ok: false, degraded: true, detail: 'Not validated yet', checkedAt: 0, perNode: {} }
      }
      : {
        storageProfileId: randomUUID(),
        mode: 'managed',
        authorityNodeId: null,
        metadata: {},
        health: { ok: true, degraded: false, detail: 'Kept on every machine by Cerious AASM', checkedAt: Date.now(), perNode: {} }
      };
    await this.repo!.upsertStorage(profile);
    const cluster: ClusterRecord = {
      clusterId: input.clusterId || randomUUID(), name, arkClusterId, storageProfileId: profile.storageProfileId, members: []
    };
    await this.repo!.upsertCluster(cluster);
    this.publishStatus();
    return cluster;
  }

  /** Brings a mesh created by an older version up to this one's tables. Every statement can run twice. */
  private async ensureSchema(): Promise<void> {
    if (!this.repo || await this.repo.schemaVersion() >= SCHEMA_VERSION) return;
    await this.repo.migrate();
  }

  /** The mesh's clusters, with whether the app keeps their files on every machine. */
  async listClusters(): Promise<Array<ClusterRecord & { managed: boolean; notifyUploads: boolean }>> {
    if (!this.repo) return [];
    const [clusters, storage] = await Promise.all([this.repo.listClusters(), this.repo.listStorage()]);
    return clusters.map(cluster => {
      const profile = storage.find(item => item.storageProfileId === cluster.storageProfileId);
      return {
        ...cluster,
        managed: profile?.mode === 'managed',
        notifyUploads: profile?.metadata.notifyUploads !== false
      };
    });
  }

  /** Renames a cluster. Its ARK cluster ID stays: it names its folder on every machine. */
  async renameCluster(clusterId: string, name: string): Promise<ClusterRecord> {
    this.requireQuorum('placement');
    const cluster = await this.repo!.getCluster(clusterId);
    if (!cluster) throw new Error('That cluster was not found.');
    const next: ClusterRecord = { ...cluster, name: clusterNameOf(name) };
    await this.repo!.upsertCluster(next);
    this.publishStatus();
    return next;
  }

  /**
   * Brings this machine's clusters into the mesh it has just created or joined, so its servers
   * stay in them. A cluster with the same ARK ID already in the mesh is used instead: this
   * machine's servers are pointed at it and their transfer files are copied into its folder.
   * Done once, after a create or a join, never on a restart: a cluster removed from the mesh
   * while this machine was away must not come back from its copy here.
   */
  private async adoptLocalClusters(): Promise<void> {
    const marker = adoptClustersMarker();
    if (!fs.existsSync(marker) || !this.repo) return;
    const meshClusters = await this.repo.listClusters();
    const remap = new Map<string, string>();
    for (const cluster of knownClusters()) {
      const same = meshClusters.find(item => item.arkClusterId === cluster.arkClusterId);
      if (same) {
        if (same.clusterId !== cluster.clusterId) {
          remap.set(cluster.clusterId, same.clusterId);
          importClusterData(clusterFolder(cluster.clusterId), cluster.arkClusterId, clusterFolder(same.clusterId), same.arkClusterId);
        }
        continue;
      }
      await this.createCluster({ name: cluster.name, arkClusterId: cluster.arkClusterId, clusterId: cluster.clusterId });
    }
    if (remap.size) {
      const { instances } = await localRuntime.listInstances();
      for (const instance of instances) {
        const next = instance.clusterRef ? remap.get(instance.clusterRef) : undefined;
        if (next) await localRuntime.patchConfig(instance.id, { clusterRef: next });
      }
    }
    fs.rmSync(marker, { force: true });
  }

  /**
   * Removes a cluster. Its servers leave it at their host's next check; the transfer files stay
   * on every machine, no longer synced.
   */
  async deleteCluster(clusterId: string): Promise<void> {
    this.requireQuorum('placement');
    if (!await this.repo!.getCluster(clusterId)) throw new Error('That cluster was not found.');
    await this.repo!.deleteCluster(clusterId);
    this.publishStatus();
  }

  async validateCluster(clusterId: string): Promise<StorageProfileRecord | null> {
    if (!this.repo) return null;
    const clusters = await this.repo.listClusters();
    const cluster = clusters.find(item => item.clusterId === clusterId);
    if (!cluster?.storageProfileId) return null;
    const profile = await this.repo.getStorage(cluster.storageProfileId);
    if (!profile) return null;
    // The app keeps a managed cluster's files in step on every machine (ClusterSync), and each
    // machine reports how its copy stands in its heartbeat: there is no shared folder to check.
    if (profile.mode === 'managed') return profile;
    const dir = String(profile.metadata.path || '');
    const localId = this.identity()?.nodeId || '';
    const result = dir
      ? await providerForProfile(profile.mode, dir).validate(dir)
      : { ok: false, latencyMs: 0, identity: '', error: 'No path configured' };
    profile.health = {
      ok: result.ok,
      degraded: !result.ok,
      detail: result.ok ? 'Shared path validated' : (result.error || 'Validation failed'),
      checkedAt: Date.now(),
      perNode: { ...profile.health.perNode, [localId]: result }
    };
    if (!profile.authorityNodeId && result.ok) profile.authorityNodeId = localId;
    try { await this.repo.upsertStorage(profile); } catch { /* health is still returned locally */ }
    return profile;
  }

  /**
   * Moves a server to another node. The node hosting it runs the move (moveOut), so the stop,
   * the checkpoint and the placement write all happen where the server's files are; the
   * destination's reconciler starts it once the placement arrives. Audited as a command.
   */
  async move(serverId: string, destinationNodeId: string, actor = 'desktop'): Promise<CommandResult> {
    if (!this.repo) return { success: false, error: 'Mesh is not enabled.' };
    const blocked = this.writeBlock('placement');
    if (blocked) return { success: false, error: blocked };
    const server = await this.repo.getServer(serverId);
    if (!server) return { success: false, error: 'That server was not found.' };
    if (server.nodeId === destinationNodeId) return { success: false, error: 'That server is already on that node.' };
    const destination = await this.repo.getNode(destinationNodeId);
    const refusal = destinationRefusal(destination);
    if (refusal) return { success: false, error: refusal };
    const command: ControlCommand = {
      commandId: randomUUID(),
      correlationId: randomUUID(),
      actor,
      targetNode: server.nodeId,
      operation: 'move',
      serverId,
      destinationNodeId,
      expiry: Date.now() + 60_000,
      issuedAt: Date.now(),
      expectedRevision: server.configRevision
    };
    if (server.nodeId === this.identity()?.nodeId) return this.executeLocalCommand(command);
    const source = await this.repo.getNode(server.nodeId);
    if (!source || source.status === 'removed') return { success: false, error: 'The node hosting that server is not available.' };
    return this.sendCommand(source, command, MOVE_TIMEOUT_MS);
  }

  async audit(): Promise<unknown[]> {
    if (!this.repo) return [];
    return this.repo.listAudit();
  }

  /** Source side of a move. Runs as a command on the node hosting the server. */
  private async moveOut(serverId: string, destinationNodeId: string | undefined): Promise<CommandResult> {
    const localId = this.identity()?.nodeId || '';
    const destination = destinationNodeId ? await this.repo!.getNode(destinationNodeId) : null;
    const refusal = destinationRefusal(destination);
    if (refusal || !destination) return { success: false, error: refusal || 'That node is not in the mesh.' };
    // Checked and marked with no await between, so two moves, or a move and a start, cannot interleave.
    if (isServerMoving(serverId)) return { success: false, error: 'That server is already being moved.' };
    // Only a server that is off moves: nobody is playing on it and its saves are complete on disk.
    if (!OFF_STATES.has(localRuntime.state(serverId))) return { success: false, error: 'Stop the server before moving it.' };
    return whileServerMoves(serverId, () => this.copyAndHandOver(serverId, localId, destination));
  }

  /** The move itself, with starts of the server refused here until it settles. It arrives off. */
  private async copyAndHandOver(serverId: string, localId: string, destination: NodeRecord): Promise<CommandResult> {
    const progress = new MoveProgress(serverId, destination.name);
    progress.report('preparing');
    let rels: string[] = [];
    const result = await moveServer(serverId, localId, destination.nodeId, {
      isRunning: id => UP_STATES.has(localRuntime.state(id)),
      saveWorld: async id => { try { await localRuntime.rcon(id, 'SaveWorld'); } catch { /* the stop saves as well */ } },
      stop: async id => {
        const stopped = await localRuntime.stop(id);
        if (!stopped.success) throw new Error(stopped.error || 'The server did not stop.');
      },
      checkpoint: async id => {
        rels = checkpointManifest(id);
        if (!rels.includes('config.json')) throw new Error('That server has no files on this node.');
        return { checksum: await checksumTree(getInstanceDir(id), rels) };
      },
      transfer: async id => this.deliverCheckpoint(id, destination, rels, progress),
      commitPlacement: async (id, dest, keepRunning) => {
        // Off here, so off there, whatever desired state a crash or an outside stop left behind.
        const moved = await this.repo!.commitPlacement(id, localId, dest, keepRunning ? 'running' : 'stopped');
        if (!moved) throw new Error('That server was moved or deleted while it was being packed.');
      },
      release: async id => {
        archiveInstance(id);
        this.quietly(serverInstanceService.broadcastInstances(), 'send the server list to the pages');
      },
      restart: async id => { await localRuntime.start(id); }
    });
    return { success: result.success, error: result.error, detail: result.warning ? { warning: result.warning } : undefined };
  }

  /**
   * Streams a checkpoint to the destination one file at a time and returns the checksum it
   * computed over what it stored. Nothing is held in memory whole.
   */
  private async deliverCheckpoint(serverId: string, destination: NodeRecord, rels: string[], progress: MoveProgress): Promise<string> {
    const certs = readCertPaths();
    if (!certs) throw new Error('This node has no mesh certificate.');
    const dir = getInstanceDir(serverId);
    const transfer: Transfer = {
      serverId,
      dir,
      base: `${destination.endpoints.peerUrl.replace(/\/$/, '')}/v1/checkpoint`,
      tls: {
        ca: fs.readFileSync(certs.caCert, 'utf8'),
        cert: fs.readFileSync(certs.nodeCert, 'utf8'),
        key: fs.readFileSync(certs.nodeKey, 'utf8')
      },
      resumable: false,
      progress
    };
    const sizes = new Map(rels.map(rel => [rel, fs.statSync(path.join(dir, rel)).size]));
    progress.bytesTotal = [...sizes.values()].reduce((sum, size) => sum + size, 0);
    progress.report('checking');

    // Asks to carry on whatever an earlier attempt sent. An older destination wipes instead and
    // does not say what it holds; everything is then sent from the start.
    const begun = await peerRequest({
      url: `${transfer.base}/begin`, method: 'POST', body: { serverId, resume: true }, ...transfer.tls, timeoutMs: MOVE_TIMEOUT_MS
    });
    if (begun.status !== 200) throw refusedBy(begun, 'the move');
    const held = (begun.body as { held?: HeldFile[] } | null)?.held;
    transfer.resumable = Array.isArray(held);
    const toSend: Array<{ rel: string; offset: number }> = [];
    for (const rel of rels) {
      const have = held?.find(file => file.rel === rel);
      const offset = await alreadyThere(path.join(dir, rel), sizes.get(rel)!, have);
      progress.resumedBytes += offset;
      if (!have || offset < sizes.get(rel)!) toSend.push({ rel, offset });
    }
    progress.bytesDone = progress.resumedBytes;
    progress.report('copying');

    for (const { rel, offset } of toSend) await this.sendFile(transfer, rel, offset);
    progress.bytesDone = progress.bytesTotal;
    progress.report('copying', true);

    progress.report('verifying');
    const finished = await peerRequest({
      url: `${transfer.base}/finish`, method: 'POST', body: { serverId, rels }, ...transfer.tls, timeoutMs: MOVE_TIMEOUT_MS
    });
    const checksum = (finished.body as { checksum?: string })?.checksum;
    if (finished.status !== 200 || !checksum) throw refusedBy(finished, 'the files');
    return checksum;
  }

  /**
   * Sends one file, carried on from `offset`. A dropped connection is retried after each of
   * MOVE_RETRY_DELAYS_MS, carrying on from wherever the destination's copy then ends.
   */
  private async sendFile(transfer: Transfer, rel: string, offset: number): Promise<void> {
    const file = path.join(transfer.dir, rel);
    const otherFiles = transfer.progress.bytesDone - offset;
    for (let attempt = 0; ; attempt++) {
      transfer.progress.bytesDone = otherFiles + offset;
      const outcome = await this.uploadOnce(transfer, rel, file, offset);
      if (outcome.ok) return;
      if (!outcome.retry || attempt >= MOVE_RETRY_DELAYS_MS.length) throw outcome.error;
      await wait(MOVE_RETRY_DELAYS_MS[attempt]);
      offset = transfer.resumable ? await this.carriedOnFrom(transfer, rel, file) : 0;
    }
  }

  /**
   * One try at a file. No answer, a conflict (the destination's copy changed) or a fault on the
   * destination is worth trying again; a refusal is not.
   */
  private async uploadOnce(transfer: Transfer, rel: string, file: string, offset: number): Promise<{ ok: true } | { ok: false; retry: boolean; error: Error }> {
    const query = `serverId=${encodeURIComponent(transfer.serverId)}&rel=${encodeURIComponent(rel)}&offset=${offset}`;
    try {
      const sent = await peerUpload({
        url: `${transfer.base}/file?${query}`, file, start: offset, onProgress: bytes => transfer.progress.add(bytes),
        ...transfer.tls, timeoutMs: MOVE_TIMEOUT_MS
      });
      if (sent.status === 200) return { ok: true };
      return { ok: false, retry: sent.status === 409 || sent.status >= 500, error: refusedBy(sent, rel) };
    } catch (error) {
      return { ok: false, retry: true, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  /** Where the destination's copy of a file now ends, when it is the start of ours. 0 when it cannot say. */
  private async carriedOnFrom(transfer: Transfer, rel: string, file: string): Promise<number> {
    try {
      const asked = await peerRequest({
        url: `${transfer.base}/begin`, method: 'POST', body: { serverId: transfer.serverId, resume: true, rels: [rel] },
        ...transfer.tls, timeoutMs: MOVE_TIMEOUT_MS
      });
      if (asked.status !== 200) return 0;
      const have = (asked.body as { held?: HeldFile[] } | null)?.held?.find(held => held.rel === rel);
      return await alreadyThere(file, fs.statSync(file).size, have);
    } catch {
      return 0;
    }
  }

  /**
   * A member's name, as every member shows it: otherwise a container goes by its container id.
   * This machine keeps its own name for when it joins a mesh again.
   */
  async renameNode(nodeId: string, name: string): Promise<void> {
    const clean = nodeNameOf(name);
    this.requireQuorum('placement');
    const node = await this.repo!.getNode(nodeId);
    if (!node) throw new Error('That node was not found.');
    await this.repo!.setNodeName(nodeId, clean);
    if (nodeId === this.identity()?.nodeId) {
      this.ownRenames++;
      this.keepOwnName(clean);
    }
    this.publishStatus();
  }

  /** The name in this machine's identity file, which it joins a mesh with. */
  private keepOwnName(name: string): void {
    const identity = this.identity();
    if (!identity || identity.name === name) return;
    const renamed = { ...identity, name };
    writeNodeIdentity(renamed);
    if (this.attachedIdentity) this.attachedIdentity = renamed;
  }

  async setMaintenance(nodeId: string, maintenance: boolean): Promise<void> {
    this.requireQuorum('placement');
    const node = await this.repo!.getNode(nodeId);
    if (!node) throw new Error('That node was not found.');
    await this.repo!.upsertNode({ ...node, maintenance, status: maintenance ? 'maintenance' : 'alive' });
  }

  async diagnostics(): Promise<{ probes: Array<{ target: string; ok: boolean; rttMs: number; error?: string }>; skew: Array<{ nodeId: string; skewMs: number }> }> {
    const nodes = this.repo ? await this.repo.listNodes(this.identity()?.meshId) : [];
    const probes = [];
    for (const node of nodes) {
      if (node.nodeId === this.identity()?.nodeId) continue;
      try {
        const url = new URL(node.endpoints.peerUrl);
        probes.push({ target: node.name, ...(await probeTcp(url.hostname, Number(url.port) || PEER_PORT)) });
      } catch (error) {
        probes.push({ target: node.name, ok: false, rttMs: 0, error: error instanceof Error ? error.message : 'Unreachable' });
      }
    }
    const skew = [...this.seenHeartbeats.entries()].map(([nodeId, beat]) => ({ nodeId, skewMs: beat.skewMs }));
    return { probes, skew };
  }

  async wireguardSnippet(): Promise<{ config: string; wgInstalled: boolean }> {
    const installed = await wgInstalled();
    const config = wireguardConfig({
      privateKey: wireguardPrivateKey(),
      address: '10.44.0.1/24',
      listenPort: 51820,
      peers: []
    });
    return { config, wgInstalled: installed };
  }

  async applyWireguardOnHost(): Promise<{ applied: boolean; error?: string }> {
    const { config } = await this.wireguardSnippet();
    return applyWireguard(config);
  }

  async backupTo(dest: string): Promise<void> {
    if (!this.repo) throw new Error('Mesh is not enabled.');
    if (!this.rqlite) throw new Error('Backup is available when rqlite is the mesh store.');
    fs.writeFileSync(dest, await this.rqlite.backup());
  }

  /**
   * Writes an account changed on this machine to the mesh, which every node mirrors. The hash is
   * labelled by what it is, not by what the mesh held before. Sessions everywhere end only when
   * something that decides access changed: the password, enabled, role or pool.
   */
  async syncUser(userId: string): Promise<void> {
    if (!this.repo) return;
    const row = userDatabaseService.exportCredentialRows().find(user => user.id === userId);
    if (!row) return;
    const existing = await this.repo.getUser(userId);
    const hashAlg = hashAlgOf(row.passwordHash);
    const scope = (await this.repo.listMachineAdmins()).find(item => item.userId === userId) ?? null;
    const nextScope = row.roleId === ROLE_IDS.MACHINE_ADMIN && row.machineNodeId
      ? { nodeId: row.machineNodeId, updatesAny: !!row.updatesAnyMachine }
      : null;
    const scopeChanged = (scope?.nodeId ?? null) !== (nextScope?.nodeId ?? null) || !!scope?.updatesAny !== !!nextScope?.updatesAny;
    const accessChanged = !existing || existing.passwordHash !== row.passwordHash || existing.enabled !== row.active
      || existing.roleId !== row.roleId || (existing.ownerUserId || null) !== (row.ownerUserId || null) || scopeChanged;
    await this.repo.upsertUser({
      userId: row.id,
      username: row.username,
      displayName: row.displayName,
      passwordHash: row.passwordHash,
      passwordParameters: existing?.passwordHash === row.passwordHash ? existing.passwordParameters : hashAlg,
      hashAlg,
      enabled: row.active,
      securityVersion: (existing?.securityVersion || 0) + (accessChanged ? 1 : 0),
      roleId: row.roleId,
      ownerUserId: row.ownerUserId,
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now()
    });
    if (nextScope) await this.repo.setMachineAdmin(userId, nextScope.nodeId, nextScope.updatesAny);
    else if (scope) await this.repo.clearMachineAdmin(userId);
  }

  /** A deleted account leaves the mesh, so every node removes it and the name can be used again. */
  async forgetUser(userId: string): Promise<void> {
    if (!this.repo) return;
    await this.repo.deleteUser(userId);
  }

  async forgetRole(roleId: string): Promise<void> {
    if (!this.repo) return;
    await this.repo.deleteRole(roleId);
  }

  async syncRole(roleId: string, name: string, permissions: string[]): Promise<void> {
    if (!this.repo) return;
    const existing = await this.repo.getRole(roleId);
    await this.repo.upsertRole({
      roleId,
      name,
      permissions,
      securityVersion: (existing?.securityVersion || 1) + 1
    });
  }

  async status(): Promise<MeshStatus> {
    const identity = this.identity();
    if (!this.repo && identity?.meshId) {
      return {
        ...emptyStatus(identity.nodeId, identity.name),
        advertise: this.advertisedAddress(),
        blocker: this.meshBlocker(),
        meshId: identity.meshId,
        reconnecting: true,
        warning: 'This machine is in a mesh and is reconnecting to the other members. A mesh of two needs both machines running to get going again.'
      };
    }
    if (!this.repo || !identity?.meshId) {
      return { ...emptyStatus(identity?.nodeId || null, identity?.name || null), advertise: this.advertisedAddress(), blocker: this.meshBlocker() };
    }
    const [mesh, nodes, clusters, storage, users, quorum, voters, leader] = await Promise.all([
      this.repo.getMesh(identity.meshId),
      this.repo.listNodes(identity.meshId),
      this.repo.listClusters(),
      this.repo.listStorage(),
      this.repo.listUsers(),
      this.repo.hasQuorum(),
      this.repo.voterCount(),
      this.repo.leaderNodeId()
    ]);
    const warning = voters < 3
      ? 'With fewer than 3 machines, the mesh cannot make changes while any one of them is off. Servers keep running either way. A third machine avoids this.'
      : null;
    const carried = carriedLoginName();
    const ownLogin = carried && users.some(user => user.username === carried && user.enabled) ? carried : null;
    return {
      enabled: true,
      degraded: !quorum,
      meshId: mesh?.meshId || identity.meshId,
      meshName: mesh?.name || null,
      nodeId: identity.nodeId,
      // As the mesh names it: another member may have renamed it since this machine last synced.
      nodeName: nodes.find(node => node.nodeId === identity.nodeId)?.name || identity.name,
      leaderNodeId: leader,
      removedFromMesh: this.removedFromMesh,
      voterCount: voters,
      hasQuorum: quorum,
      protocolVersion: PROTOCOL_VERSION,
      warning,
      hasAccounts: users.length > 0,
      ...(ownLogin ? { ownLogin } : {}),
      nodes: nodes.map(node => ({
        ...node,
        connected: node.status !== 'removed' && (
          node.nodeId === identity.nodeId
          || this.reachable(node.nodeId)
        ),
        host: hostOf(node.endpoints.peerUrl),
        lastContactAt: this.lastContactAt(node, identity.nodeId),
        resources: node.nodeId === identity.nodeId ? this.localResources : this.reportedResources(node.nodeId),
        clusterSync: node.nodeId === identity.nodeId ? this.clusterSync?.summary() ?? {} : this.reportedClusterSync(node.nodeId),
        arkUpdate: node.nodeId === identity.nodeId ? arkUpdateProgress() : this.reportedArkUpdate(node.nodeId),
        address: addressFromEndpoints(node.endpoints.peerUrl, node.endpoints.raftAddr)
      })),
      advertise: this.advertisedAddress(),
      clusters,
      storage
    };
  }

  async stop(): Promise<void> {
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = null;
    this.waitingCopy = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.statusTimer = null;
    if (this.peer) await new Promise<void>(resolve => this.peer!.close(() => resolve()));
    this.peer = null;
    await this.supervisor.stop();
    this.repo = null;
    this.rqlite = null;
    for (const subscription of this.subscriptions.values()) subscription.close();
    this.subscriptions.clear();
    this.liveStates.clear();
    this.localResources = null;
    this.nodeResources.clear();
    this.nodeClusterSync.clear();
    this.nodeArkUpdate.clear();
    if (this.clusterTimer) clearInterval(this.clusterTimer);
    this.clusterTimer = null;
    this.clusterSync = null;
    this.notices = null;
    this.accountsFingerprint = '';
    messagingService.broadcastTap = null;
    this.localNodeId = null;
    this.attachedIdentity = null;
    this.intents = null;
    this.pendingConfigs = null;
    this.reconcileMemory.clear();
    registerMeshAuth(null);
    setMeshWriteBlock(() => null);
    // The desktop keeps asking for a mesh account: this machine is still a member while a resume
    // is retried, and only leaving makes it standalone again.
  }

  /** Forgets mesh membership on this machine. Local servers and accounts stay. */
  private async leaveLocally(): Promise<void> {
    noteMeshListenPorts(null);
    const identity = this.identity();
    if (identity?.meshId) writeNodeIdentity({ ...identity, meshId: '' });
    await this.stop();
    noteLocalNode(null);
    setMeshMember(false);
    setMeshDesktopMode(false);
    this.noteDesktopAuth();
    this.publishStatus();
    this.quietly(serverInstanceService.broadcastInstances(), 'send the server list to the pages');
  }

  /**
   * rqlite trusts the CA file on disk and presents the node certificate. Both have to be the CA
   * for this machine's mesh, and the node certificate has to name the address other nodes dial.
   * An older install can have several mesh rows left in rqlite; signing with the wrong one makes
   * a joiner fail with "unknown certificate authority".
   */
  private async ensurePresentedCertificate(nodeId: string): Promise<void> {
    const certs = readCertPaths();
    const meshId = this.identity()?.meshId;
    if (!certs || !this.repo || !this.secrets || !meshId) return;
    const hosts = advertisedHosts(this.secrets);
    const mesh = await this.repo.getMesh(meshId);
    if (!mesh?.caCert || !mesh.caKey) return;
    const nodePem = fs.readFileSync(certs.nodeCert, 'utf8');
    const caOnDisk = fs.readFileSync(certs.caCert, 'utf8');
    const caMatches = caOnDisk.trim() === mesh.caCert.trim();
    const issued = certificateIssuedBy(nodePem, mesh.caCert);
    const covers = hosts.every(host => certificateCoversHost(nodePem, host));
    if (caMatches && issued && covers) return;
    if (!caMatches) fs.writeFileSync(certs.caCert, mesh.caCert);
    if (!issued || !covers) {
      const signed = signNodeCertificate(
        mesh.caCert,
        mesh.caKey,
        publicKeyFromPrivatePem(fs.readFileSync(certs.nodeKey, 'utf8')),
        nodeId,
        hosts
      );
      fs.writeFileSync(certs.nodeCert, signed.certPem);
      const row = await this.repo.getNode(nodeId);
      // Without quorum the new serial is recorded later, by announce().
      if (row) await this.bestEffort('record the new certificate serial', () => this.repo!.upsertNode({ ...row, certSerial: signed.serial }));
    }
    console.log(`[mesh] Reloaded the mesh certificate for ${hosts.join(', ')}.`);
    const secrets = this.secrets;
    await this.supervisor.stop();
    await this.startRqlite(nodeId, secrets);
    const client = new RqliteClient(`http://127.0.0.1:${HTTP_PORT}`, secrets.httpUser, secrets.httpPass, nodeId);
    if (!await waitReady(client, this.supervisor, 40, false)) throw new Error(this.supervisor.failure() || 'The mesh database did not start on this machine. Restart the app to try again.');
    this.repo = new MeshRepository(client);
    this.rqlite = client;
  }

  /**
   * A peer is trusted when its certificate names a current member and that member is recorded
   * with exactly this serial. A certificate minted with the CA key for anyone else, or one that
   * was replaced or revoked, is refused, whoever signed it.
   */
  private async isTrusted(serial: string, nodeId: string): Promise<boolean> {
    if (!this.repo) return false;
    const node = await this.repo.getNode(nodeId);
    if (!node || node.status === 'removed' || normalizeSerial(node.certSerial) !== serial) return false;
    return !(await this.repo.isRevoked(serial));
  }

  /**
   * Starts this node's rqlited. Raft listens on this machine's port and advertises the address
   * other nodes dial; the HTTP API listens on loopback only, since nodes talk over Raft.
   */
  private startRqlite(nodeId: string, secrets: LocalSecrets, join?: string): Promise<void> {
    return this.supervisor.start({
      nodeId,
      dataDir: rqliteDir(),
      httpAddr: `127.0.0.1:${HTTP_PORT}`,
      raftAddr: raftAddrOf(secrets),
      raftBind: `0.0.0.0:${RAFT_PORT}`,
      authUser: secrets.httpUser,
      authPass: secrets.httpPass,
      join,
      cert: readCertPaths() || undefined
    });
  }

  private async attach(identity: NodeIdentityFile): Promise<void> {
    const nodeId = identity.nodeId;
    this.attachedIdentity = identity;
    const certs = readCertPaths();
    if (certs && !this.peer) {
      noteMeshListenPorts({ peer: this.secrets?.peerPort || PEER_PORT, raft: RAFT_PORT });
      this.peer = await startPeerServer(this.secrets?.peerPort || PEER_PORT, {
        certPem: fs.readFileSync(certs.nodeCert, 'utf8'),
        keyPem: fs.readFileSync(certs.nodeKey, 'utf8'),
        caPem: fs.readFileSync(certs.caCert, 'utf8'),
        isTrusted: (serial, nodeId) => this.isTrusted(serial, nodeId),
        onJoin: body => this.acceptJoin(body),
        onAbortJoin: nodeId => this.removeNode(nodeId),
        onCommand: body => this.executeLocalCommand(body),
        onQuery: body => this.answerQuery(body),
        onSubscribe: () => this.greeting(),
        onHeartbeat: (id, sentAt, resources, clusterSync, arkUpdate) => {
          this.nodeArkUpdate.set(id, { progress: arkUpdateOf(arkUpdate), at: Date.now() });
          this.seenHeartbeats.set(id, { at: Date.now(), skewMs: clockSkewMs(sentAt) });
          const reported = nodeResourcesOf(resources);
          if (reported) this.nodeResources.set(id, { resources: reported, at: Date.now() });
          const syncing = clusterSyncOf(clusterSync);
          if (syncing) this.nodeClusterSync.set(id, { summary: syncing, at: Date.now() });
          this.publishStatus();
        },
        // Cluster file contents, for another member that has to place a version this one recorded.
        onClusterObject: sha256 => this.clusterSync?.objectPath(sha256) ?? null,
        // A backup of a server here, and the copies this machine keeps of others' backups.
        onBackupFile: (serverId, fileName) => this.backupFileHere(serverId, fileName),
        onBackupCopyFile: serverId => backupCopies.heldPath(serverId),
        // Another member is about to change its address: whether this one reaches it there.
        onProbeAddress: (askerId, body) => this.probeAddress(askerId, body),
        onForceRemove: (askerId, body) => this.takePartInForceRemoval(askerId, body),
        onRemoved: askerId => this.takeRemoval(askerId),
        // A move's destination stages the streamed files; they become the server when its placement arrives.
        onCheckpointBegin: body => beginStage(String(body.serverId || ''), {
          resume: body.resume === true,
          rels: Array.isArray(body.rels) ? body.rels.map(String) : undefined
        }),
        onCheckpointFile: (serverId, rel, body, offset) => writeStagedFile(serverId, rel, body, offset),
        onCheckpointFinish: async body => ({ checksum: await finishStage(String(body.serverId || ''), Array.isArray(body.rels) ? body.rels : []) })
      });
    }
    registerMeshAuth({
      enabled: () => this.isEnabled(),
      verify: (username, password) => this.verifyLogin(username, password),
      resolve: userId => this.toAuthenticated(userId).then(user => user ? { user, securityVersion: user.securityVersion || 1 } : null),
      hasQuorum: () => true
    });
    this.localNodeId = nodeId;
    messagingService.broadcastTap = (channel, data) => this.relayOut(channel, data);
    this.intents = new DesiredIntents(intentsPath());
    this.pendingConfigs = new PendingConfigs(path.join(meshRoot(), 'pending-configs.json'));
    setMeshWriteBlock(op => this.writeBlock(op));
    noteLocalNode(nodeId);
    setMeshMember(true);
    setMeshDesktopMode(true);
    this.noteDesktopAuth();
    this.storeCaughtUp = false;
    this.resumedAt = Date.now();
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => { void this.reconcileLocal(nodeId); }, 5000);
    this.startClusterSync(nodeId);
    void this.reconcileLocal(nodeId);
  }

  private clusterSync: ClusterSync | null = null;
  private clusterTimer: ReturnType<typeof setInterval> | null = null;

  /** Keeps the transfer files of every cluster the app keeps the same on this machine as on the others. */
  private startClusterSync(nodeId: string): void {
    // Always the current repository: it is replaced when the database password changes.
    const repo = {
      listClusters: () => this.repo!.listClusters(),
      listStorage: () => this.repo!.listStorage(),
      listClusterFiles: (clusterId: string) => this.repo!.listClusterFiles(clusterId),
      commitClusterFile: (file: Parameters<MeshRepository['commitClusterFile']>[0], base: number) => this.repo!.commitClusterFile(file, base)
    };
    const notices = new TransferNotices({
      machinesFor: clusterId => this.machinesHosting(clusterId, nodeId),
      enabled: clusterId => this.uploadNoticesOn(clusterId),
      notify: (clusterId, playerId) => this.tellUploadReady(clusterId, playerId, nodeId)
    });
    this.notices = notices;
    this.clusterSync = new ClusterSync({
      nodeId,
      repo,
      rootOf: clusterFolder,
      workDir: path.join(meshRoot(), 'cluster-sync'),
      fetch: (sha256, originNode, dest) => this.fetchClusterObject(sha256, originNode, dest),
      announce: clusterId => this.peer?.broadcast({ type: 'cluster-changed', nodeId, clusterId }),
      // A player's upload here: they are told once the other machines have it.
      onRecorded: change => {
        void notices.recorded(change).catch(error => console.warn('[mesh] Could not follow an upload:', messageOf(error)));
      },
      // So the machine where a player uploaded knows this one has it.
      onPlaced: change => {
        notices.superseded(change);
        this.peer?.broadcast({ type: 'cluster-placed', nodeId, ...change });
      }
    });
    if (this.clusterTimer) clearInterval(this.clusterTimer);
    this.clusterTimer = setInterval(() => this.syncClusters(), CLUSTER_SYNC_MS);
  }

  private syncClusters(): void {
    if (!this.repo || !this.clusterSync || this.changingAddress) return;
    this.notices?.expire();
    void this.clusterSync.syncOnce().catch(error => console.warn('[mesh] Could not sync cluster files:', messageOf(error)));
  }

  /** Waits on players' uploads until the other machines have them. */
  private notices: TransferNotices | null = null;

  /** The servers in a cluster, on every machine, from the config the mesh holds for each. */
  private async clusterServers(clusterId: string): Promise<ServerRecord[]> {
    return (await this.repo!.listServers()).filter(server => clusterRefOf(server.configJson) === clusterId);
  }

  /** The other machines an upload has to reach: those hosting a server in the cluster, reachable now. */
  private async machinesHosting(clusterId: string, localId: string): Promise<string[]> {
    const hosts = new Set((await this.clusterServers(clusterId)).map(server => server.nodeId));
    return [...hosts].filter(nodeId => nodeId !== localId && this.reachable(nodeId));
  }

  /** On unless turned off for the cluster in Settings → Clusters. */
  private async uploadNoticesOn(clusterId: string): Promise<boolean> {
    const profile = await this.clusterProfile(clusterId);
    return profile?.metadata.notifyUploads !== false;
  }

  private async clusterProfile(clusterId: string): Promise<StorageProfileRecord | null> {
    const cluster = await this.repo!.getCluster(clusterId);
    return cluster?.storageProfileId ? this.repo!.getStorage(cluster.storageProfileId) : null;
  }

  /** Whether players in a cluster are told when their upload is ready on every machine. */
  async setUploadNotices(clusterId: string, enabled: boolean): Promise<void> {
    this.requireQuorum('placement');
    const profile = await this.clusterProfile(clusterId);
    if (!profile) throw new Error('That cluster was not found.');
    await this.repo!.upsertStorage({ ...profile, metadata: { ...profile.metadata, notifyUploads: enabled } });
    this.publishStatus();
  }

  /**
   * Finds the player on a running server of the cluster, this machine's first (where they
   * uploaded), then the other machines' (where they may already have gone), and tells them
   * privately that their upload is ready.
   */
  private async tellUploadReady(clusterId: string, playerId: string, localId: string): Promise<void> {
    const servers = (await this.clusterServers(clusterId))
      .sort((a, b) => Number(b.nodeId === localId) - Number(a.nodeId === localId));
    const command = `ServerChatTo "${playerId}" ${UPLOAD_READY_MESSAGE}`;
    for (const server of servers) {
      const here = server.nodeId === localId;
      const state = here ? localRuntime.state(server.serverId) : this.liveStates.get(server.serverId)?.state;
      if (here ? state !== 'running' : state && state !== 'running') continue;
      let players: Array<{ playerId?: string; steamId?: string }> = [];
      try {
        players = here
          ? await localRuntime.onlinePlayers(server.serverId)
          : (await this.queryRemote<{ players?: Array<{ playerId?: string; steamId?: string }> }>(server.serverId, 'online-players'))?.players ?? [];
      } catch {
        continue;
      }
      if (!players.some(player => (player.playerId || player.steamId || '').toLowerCase() === playerId)) continue;
      const sent = here
        ? await localRuntime.rcon(server.serverId, command)
        : await this.forwardIfRemote('rcon', server.serverId, 'cluster', { command });
      if (sent && 'error' in sent && sent.error) {
        console.warn(`[cluster] Could not tell ${playerId} on ${server.name} their upload is ready: ${sent.error}`);
      } else {
        console.log(`[cluster] Told ${playerId} on ${server.name} their upload is ready.`);
      }
      return;
    }
    console.log(`[cluster] ${playerId}'s upload is ready; they are not on a running server of the cluster to tell.`);
  }

  /** Fetches cluster file contents from the machine that recorded them, or from any other member that has them. */
  private async fetchClusterObject(sha256: string, originNode: string, dest: string): Promise<boolean> {
    const certs = readCertPaths();
    if (!certs || !this.repo) return false;
    const localId = this.identity()?.nodeId;
    const nodes = (await this.repo.listNodes(this.identity()?.meshId))
      .filter(node => node.nodeId !== localId && node.status !== 'removed')
      .sort((a, b) => Number(b.nodeId === originNode) - Number(a.nodeId === originNode));
    const tls = {
      ca: fs.readFileSync(certs.caCert, 'utf8'),
      cert: fs.readFileSync(certs.nodeCert, 'utf8'),
      key: fs.readFileSync(certs.nodeKey, 'utf8')
    };
    for (const node of nodes) {
      const url = `${node.endpoints.peerUrl.replace(/\/$/, '')}/v1/cluster-object?sha256=${sha256}`;
      if (await peerDownload({ url, dest, ...tls, timeoutMs: 60_000 })) return true;
    }
    return false;
  }

  private inventoryFingerprint = '';

  /** Pushes the combined server list when a server joins, leaves, moves, changes state or is edited on its node. */
  private async publishInventoryIfChanged(): Promise<void> {
    if (!this.isEnabled()) return;
    const { instances } = await localRuntime.listInstances();
    const merged = await this.withMeshServers(instances);
    const fingerprint = merged
      .map(instance => `${instance.id}:${instance.nodeId || ''}:${String((instance as { state?: string }).state || '')}:${instance.configRevision ?? ''}`)
      .sort()
      .join('|');
    if (fingerprint === this.inventoryFingerprint) return;
    this.inventoryFingerprint = fingerprint;
    await serverInstanceService.broadcastInstances();
  }

  private statusTimer: ReturnType<typeof setTimeout> | null = null;

  /** Tells every open mesh page on this machine that membership or reachability changed. */
  private publishStatus(): void {
    if (this.statusTimer) return;
    this.statusTimer = setTimeout(() => {
      this.statusTimer = null;
      void this.status().then(status => messagingService.sendToAll('mesh-status', status)).catch(error => {
        console.error('[mesh] Could not publish mesh status:', error);
      });
    }, 200);
  }

  private writeBlock(op: MeshWriteOp): string | null {
    if (!this.repo) return null;
    // hasQuorum is async; the registered hook is sync. The last observed quorum is cached on status polls
    // and on this flag, updated by the reconciler tick.
    const decision = partitionDecision(this.quorum, op === 'remote-command' ? 'remote-command' : op === 'enroll' ? 'enroll' : op === 'remove-node' ? 'remove-node' : op === 'placement' ? 'placement' : 'security-write');
    return decision.allow ? null : (decision.reason || null);
  }

  private quorum = true;
  private announcing = false;

  /** The app files are staged before this runs, so the reply can leave before the process restarts. */
  private scheduleAppRelaunch(result: CommandResult): void {
    const detail = result.detail as { relaunch?: boolean } | undefined;
    if (!result.success || !detail?.relaunch) return;
    setTimeout(() => {
      if (isRunningInDocker()) relaunchInPlace();
      else autoUpdateService.quitAndInstall();
    }, 1000);
  }

  /**
   * This machine's activity feed credits what a command causes here (a server stopping, an RCON
   * command run) to whoever sent it from another machine, as for a request made here.
   */
  private creditCommand(command: ControlCommand): void {
    const person = command.actor && !UNNAMED_ACTORS.has(command.actor) ? command.actor : null;
    const args = command.args || {};
    if (command.operation === 'server-request') {
      messagingService.noteForwardedAction(String(args.channel || ''), recordOf(args.payload), person);
      return;
    }
    const channel = COMMAND_CHANNELS[command.operation] || command.operation;
    messagingService.noteForwardedAction(channel, { ...args, ...(command.serverId ? { instanceId: command.serverId } : {}) }, person);
  }

  /** Writes this node's version and asks every other node for a heartbeat, so the list can show who is up. */
  private async announce(nodeId: string): Promise<void> {
    if (this.announcing || !this.repo) return;
    this.announcing = true;
    try {
      this.localResources = await sampleHostResources().catch(() => null);
      const self = await this.repo.getNode(nodeId);
      const version = appVersion();
      const certs = readCertPaths();
      // A certificate re-signed without quorum is recorded here, so removing this node revokes it.
      const presented = certs ? presentedSerial(certs.nodeCert) : null;
      const serial = presented || self?.certSerial || '';
      // Every 15 s at most: lastSeen, the build this node runs, and what Auto-select scores it on.
      const outdated = self && (self.version !== version || self.protocolVersion !== PROTOCOL_VERSION || self.certSerial !== serial);
      if (self && (outdated || Date.now() - self.lastSeen > 15_000)) {
        // A write: it needs quorum. Without it the heartbeats below still go out, so the members
        // that remain keep seeing each other; the record catches up once quorum is back.
        try {
          await this.repo.recordHeartbeat(nodeId, {
            version, protocolVersion: PROTOCOL_VERSION, certSerial: serial, capabilities: collectCapabilities(), lastSeen: Date.now()
          });
        } catch {
          /* recorded at a later heartbeat */
        }
      }
      if (!certs) return;
      const nodes = await this.repo.listNodes(this.identity()?.meshId);
      let accepted = 0;
      let refused = 0;
      await Promise.all(nodes.filter(node => node.nodeId !== nodeId && node.status !== 'removed').map(async node => {
        try {
          const sentAt = Date.now();
          const response = await peerRequest({
            url: `${node.endpoints.peerUrl.replace(/\/$/, '')}/v1/heartbeat`,
            method: 'POST',
            // nodeId is for an older receiver; a current one takes it from the certificate.
            body: { nodeId, sentAt, resources: this.localResources, clusterSync: this.clusterSync?.summary() ?? {}, arkUpdate: arkUpdateProgress() },
            ca: fs.readFileSync(certs.caCert, 'utf8'),
            cert: fs.readFileSync(certs.nodeCert, 'utf8'),
            key: fs.readFileSync(certs.nodeKey, 'utf8'),
            timeoutMs: 3000
          });
          if (response.status === 200) {
            // Its clock, from the time in its answer, taken as halfway through the round trip.
            const theirNow = (response.body as { now?: unknown } | null)?.now;
            const skewMs = typeof theirNow === 'number'
              ? clockSkewMs(theirNow, (sentAt + Date.now()) / 2)
              : this.seenHeartbeats.get(node.nodeId)?.skewMs ?? 0;
            this.seenHeartbeats.set(node.nodeId, { at: Date.now(), skewMs });
            accepted++;
          } else if (/does not belong to a member/i.test(String((response.body as { error?: unknown })?.error ?? ''))) {
            refused++;
          }
        } catch {
          // A node that does not answer shows as unreachable until the next heartbeat.
        }
      }));
      // Refused by every machine that answered: they removed this one, by force while it was away.
      const removed = refused > 0 && accepted === 0;
      if (removed !== this.removedFromMesh) {
        this.removedFromMesh = removed;
        if (removed) console.warn('[mesh] The other machines no longer take this one as a member: they removed it. Leave to make it standalone.');
        this.publishStatus();
      }
    } catch (error) {
      console.error('[mesh] Could not announce this node:', error);
    } finally {
      this.announcing = false;
    }
  }

  /**
   * A server directory here whose server another member hosts is a leftover: from a move, or
   * from an edit an older build saved here. It is set aside in Saved/MeshMoved, not deleted.
   * A server whose node has left the mesh is kept; this copy may be the only one.
   */
  private setAsideStrayCopies(nodeId: string, servers: ServerRecord[], nodes: NodeRecord[], instances: InstanceConfig[]): void {
    const members = new Set(nodes.filter(node => node.status !== 'removed').map(node => node.nodeId));
    const hostOf = new Map(servers.map(server => [server.serverId, server.nodeId]));
    let changed = false;
    for (const instance of instances) {
      const host = hostOf.get(instance.id);
      if (!host || host === nodeId || !members.has(host)) continue;
      try {
        if (archiveInstance(instance.id)) changed = true;
      } catch (error) {
        console.error(`[mesh] Could not set aside the local copy of ${instance.id}:`, error);
      }
    }
    if (changed) this.quietly(serverInstanceService.broadcastInstances(), 'send the server list to the pages');
  }

  /**
   * Records the config of each server hosted here that is newer on disk than in the mesh, whatever
   * saved it: an INI edit, an ownership change, a config import, the cluster flags the reconciler
   * wrote. Other nodes see the change within a tick. Without quorum it waits for a later one.
   */
  private async publishLocalConfigs(nodeId: string, servers: ServerRecord[], instances: InstanceConfig[]): Promise<void> {
    const rows = new Map(servers.map(server => [server.serverId, server]));
    for (const instance of instances) {
      const row = rows.get(instance.id);
      if (!row || row.nodeId !== nodeId || (Number(instance.configRevision) || 0) <= row.configRevision) continue;
      try {
        await this.recordServer(instance);
      } catch (error) {
        console.warn(`[mesh] Could not record the config of ${instance.id} yet:`, error instanceof Error ? error.message : error);
      }
    }
  }

  /** Host side: a live event about a server hosted here goes to every subscribed node. */
  private relayOut(channel: string, data: unknown): void {
    if (!RELAY_CHANNELS.has(channel) || !this.peer || !this.localNodeId) return;
    const serverId = (data as { instanceId?: unknown } | null)?.instanceId;
    if (typeof serverId !== 'string' || meshServer(serverId)?.nodeId !== this.localNodeId) return;
    this.peer.broadcast({ type: 'server-event', nodeId: this.localNodeId, channel, data: this.withStartTime(channel, data, serverId) });
  }

  /** A running state carries when the process started, so other nodes show the same uptime as this one. */
  private withStartTime(channel: string, data: unknown, serverId: string): unknown {
    if (channel !== 'server-instance-state' || (data as { state?: unknown }).state !== 'running') return data;
    const startedAt = localRuntime.startedAt(serverId);
    return startedAt == null ? data : { ...(data as object), startedAt };
  }

  /** An event from another node, shown here only if that node hosts the server it is about. */
  private relayIn(fromNodeId: string, event: unknown): void {
    const frame = event as { type?: unknown; nodeId?: unknown; channel?: unknown; data?: { instanceId?: unknown } } | null;
    // Another member recorded a change to a cluster file: look now rather than at the next check.
    if (frame?.type === 'cluster-changed' && frame.nodeId === fromNodeId) {
      this.syncClusters();
      return;
    }
    // Another member has a version of a cluster file: an upload here may now be ready everywhere.
    if (frame?.type === 'cluster-placed' && frame.nodeId === fromNodeId) {
      const placed = frame as { clusterId?: unknown; path?: unknown; version?: unknown };
      if (typeof placed.clusterId === 'string' && typeof placed.path === 'string' && typeof placed.version === 'number') {
        this.notices?.placed(fromNodeId, { clusterId: placed.clusterId, path: placed.path, version: placed.version });
      }
      return;
    }
    if (frame?.type !== 'server-event' || frame.nodeId !== fromNodeId || typeof frame.channel !== 'string') return;
    if (!RELAY_CHANNELS.has(frame.channel)) return;
    const serverId = frame.data?.instanceId;
    if (typeof serverId !== 'string' || meshServer(serverId)?.nodeId !== fromNodeId) return;
    this.noteLive(fromNodeId, serverId, frame.channel, frame.data as Record<string, unknown>);
    messagingService.sendToAll(frame.channel, frame.data);
  }

  /**
   * Keeps what a host reports about a server, so a page opened here later lists it as the host
   * does. Uptime, players, CPU and memory are dropped when it stops running.
   */
  private noteLive(nodeId: string, serverId: string, channel: string, data: Record<string, unknown>): void {
    const known = this.liveStates.get(serverId);
    const current: LiveServer = known?.nodeId === nodeId ? known : { nodeId };
    if (channel === 'server-instance-state') {
      if (typeof data.state !== 'string') return;
      const { state: _state, startedAt, ...figures } = current;
      this.liveStates.set(serverId, data.state === 'running'
        ? { ...figures, state: data.state, startedAt: typeof data.startedAt === 'number' ? data.startedAt : startedAt }
        : { nodeId, state: data.state });
      return;
    }
    const field = LIVE_FIGURES[channel];
    const value = field ? data[field] : undefined;
    if (field && typeof value === 'number') this.liveStates.set(serverId, { ...current, [field]: value });
  }

  /** A node that cannot be heard from: its servers show their stored state again. */
  private forgetLiveStates(nodeId: string): void {
    for (const [serverId, live] of this.liveStates) if (live.nodeId === nodeId) this.liveStates.delete(serverId);
  }

  /** What a node that has just subscribed hears first: the state of each server hosted here. */
  private greeting(): unknown[] {
    const localId = this.localNodeId;
    if (!localId) return [];
    return meshServers().filter(server => server.nodeId === localId).map(server => ({
      type: 'server-event', nodeId: localId, channel: 'server-instance-state',
      data: this.withStartTime('server-instance-state', { instanceId: server.serverId, state: localRuntime.state(server.serverId) }, server.serverId)
    }));
  }

  /** Keeps one live-event subscription open to every other member new enough to relay. */
  private syncSubscriptions(localId: string, nodes: NodeRecord[]): void {
    const certs = readCertPaths();
    if (!certs) return;
    const wanted = new Map(nodes
      .filter(node => node.nodeId !== localId && node.status !== 'removed' && (node.protocolVersion || 1) >= QUERY_PROTOCOL)
      .map(node => [node.nodeId, node]));
    for (const [nodeId, subscription] of this.subscriptions) {
      if (wanted.has(nodeId)) continue;
      subscription.close();
      this.subscriptions.delete(nodeId);
    }
    for (const [nodeId, node] of wanted) {
      if (this.subscriptions.has(nodeId)) continue;
      const subscription = subscribeEvents({
        url: `${node.endpoints.peerUrl.replace(/^https:/, 'wss:').replace(/\/$/, '')}/v1/events`,
        ca: fs.readFileSync(certs.caCert, 'utf8'),
        cert: fs.readFileSync(certs.nodeCert, 'utf8'),
        key: fs.readFileSync(certs.nodeKey, 'utf8'),
        onEvent: event => this.relayIn(nodeId, event),
        // Opened again on the next tick.
        onClose: () => {
          if (this.subscriptions.get(nodeId) === subscription) this.subscriptions.delete(nodeId);
          this.forgetLiveStates(nodeId);
        }
      });
      this.subscriptions.set(nodeId, subscription);
    }
  }

  private accountsFingerprint = '';

  /**
   * Makes this machine's account database match the mesh's accounts and custom roles, so the
   * Users page, pools and lookups here see every account in the mesh. Skipped while the mesh has
   * no account at all (before its first admin exists), so local accounts are never wiped for that.
   */
  private async mirrorAccounts(users: UserRecord[]): Promise<void> {
    if (!this.repo || users.length === 0) return;
    try {
      const [roles, scopes] = await Promise.all([this.repo.listRoles(), this.repo.listMachineAdmins()]);
      const accounts = {
        users: users.map(user => {
          const scope = scopes.find(item => item.userId === user.userId);
          return {
            userId: user.userId, username: user.username, displayName: user.displayName, passwordHash: user.passwordHash,
            enabled: user.enabled, roleId: user.roleId, ownerUserId: user.ownerUserId, createdAt: user.createdAt, updatedAt: user.updatedAt,
            machineNodeId: scope?.nodeId ?? null, updatesAnyMachine: !!scope?.updatesAny
          };
        }),
        roles: roles.map(role => ({ roleId: role.roleId, name: role.name, permissions: role.permissions }))
      };
      const fingerprint = JSON.stringify(accounts);
      if (fingerprint === this.accountsFingerprint) return;
      const { changedUserIds, changedRoleIds } = userDatabaseService.applyMeshAccounts(accounts);
      this.accountsFingerprint = fingerprint;
      if (changedUserIds.length || changedRoleIds.length) poolDirectory.invalidate();
      const changes = [
        ...changedUserIds.map(userId => ({ userId, roleId: undefined })),
        ...changedRoleIds.map(roleId => ({ userId: undefined, roleId }))
      ];
      for (const change of changes) {
        messagingService.sendToAll('users-changed', change);
        messagingService.invalidateWebSessions(change);
      }
    } catch (error) {
      console.error('[mesh] Could not bring the accounts on this machine up to date with the mesh:', error);
    }
  }

  private prunedAt = 0;

  /** At most hourly: abandoned move transfers, and copies set aside after MOVED_MAX_AGE_MS. */
  private pruneMoveFolders(): void {
    if (Date.now() - this.prunedAt < PRUNE_INTERVAL_MS) return;
    this.prunedAt = Date.now();
    try {
      for (const dir of pruneMeshFolders()) console.log(`[mesh] Removed ${dir}`);
    } catch (error) {
      console.error('[mesh] Could not clean up after earlier moves:', error);
    }
  }

  /**
   * Restarts this node's rqlited with the mesh's database password when it has changed, after a
   * node was removed. rqlited reads its credentials only at start. True when it restarted; the
   * rest of that tick is skipped. Writes forwarded between nodes can fail for the few seconds
   * the members take to switch; Raft itself does not use the password.
   */
  private async adoptClusterCredential(nodeId: string): Promise<boolean> {
    const credential = await this.repo?.getClusterCredential();
    const secrets = this.secrets;
    if (!credential || !secrets || (credential.user === secrets.httpUser && credential.pass === secrets.httpPass)) return false;
    const next: LocalSecrets = { ...secrets, httpUser: credential.user, httpPass: credential.pass };
    await this.supervisor.stop();
    await this.startRqlite(nodeId, next);
    // From here only the new password works against this node's rqlited.
    const client = new RqliteClient(`http://127.0.0.1:${HTTP_PORT}`, next.httpUser, next.httpPass, nodeId);
    this.repo = new MeshRepository(client);
    this.rqlite = client;
    this.secrets = next;
    writeSecrets(next);
    if (!await waitReady(client, this.supervisor, 40, false)) throw new Error(this.supervisor.failure() || 'The mesh database did not start on this machine. Restart the app to try again.');
    console.log('[mesh] Switched to the database password set when a node was removed.');
    return true;
  }

  private async reconcileLocal(nodeId: string): Promise<void> {
    // While this machine changes its address its rqlited restarts; the next check picks up after.
    if (!this.repo || this.changingAddress) return;
    // A rename here while this check reads the nodes would otherwise be undone with the name it read.
    const renames = this.ownRenames;
    try {
      if (await this.adoptClusterCredential(nodeId)) return;
      this.quorum = await this.repo.hasQuorum();
      if (this.quorum) {
        await this.ensureSchema();
        await this.carryLoginOnce(nodeId);
        await this.flushIntents(nodeId);
        await this.flushPendingConfigs();
        await this.adoptLocalClusters();
      }
      const [listed, users, clusters, storage, nodes] = await Promise.all([
        this.repo.listServers(),
        this.repo.listUsers(),
        this.repo.listClusters(),
        this.repo.listStorage(),
        this.repo.listNodes(this.identity()?.meshId)
      ]);
      let servers = listed;
      // A removal whose Raft step failed left that machine a voter, counted towards every majority.
      if (this.quorum) await this.dropRemovedVoters(nodes);
      // Left over from machines removed before Remove forgot their servers.
      const removedIds = new Set(nodes.filter(node => node.status === 'removed').map(node => node.nodeId));
      if (this.quorum && servers.some(server => removedIds.has(server.nodeId))) {
        await this.forgetServersOn([...removedIds]);
        servers = servers.filter(server => !removedIds.has(server.nodeId));
      }
      // A server moved here arrives as staged files; they become the server once its placement does.
      for (const server of servers) {
        if (server.nodeId !== nodeId) continue;
        try {
          if (promoteStaged(server.serverId)) {
            // Its ports were free on the machine it left; here a server may already use them, or
            // this machine's firewall may open other ranges.
            const ports = await localRuntime.takeFreePortsIfNeeded(server.serverId);
            if (ports) {
              console.log(`[mesh] ${server.name} moved here onto ports a server here uses, or outside this machine's server ports; it now uses game ${ports.gamePort}, query ${ports.queryPort}, RCON ${ports.rconPort}.`);
            }
            this.quietly(serverInstanceService.broadcastInstances(), 'send the server list to the pages');
          }
        } catch (error) {
          console.error(`[mesh] Could not take in the files for ${server.serverId}:`, error);
        }
      }
      this.syncSubscriptions(nodeId, nodes);
      // A name another member gave this machine, kept for when it joins a mesh again.
      const own = nodes.find(node => node.nodeId === nodeId);
      if (own?.name && renames === this.ownRenames) this.keepOwnName(own.name);
      const { instances } = await localRuntime.listInstances();
      this.setAsideStrayCopies(nodeId, servers, nodes, instances);
      if (this.quorum) await this.publishLocalConfigs(nodeId, servers, instances);
      this.pruneMoveFolders();
      for (const user of users) noteSecurityVersion(user.userId, user.securityVersion);
      await this.mirrorAccounts(users);
      noteMeshServers(servers.map(server => ({
        serverId: server.serverId, nodeId: server.nodeId, operatorUserId: server.operatorUserId, managerUserId: server.managerUserId
      })));
      // This machine's copy of the mesh's clusters: what its servers start with, even out of touch.
      // Not before its own clusters are in the mesh, or they would be forgotten here. A change made
      // on another machine reaches this machine's screens here.
      try {
        const copy = clusters.map(cluster => ({ clusterId: cluster.clusterId, name: cluster.name, arkClusterId: cluster.arkClusterId }));
        if (!fs.existsSync(adoptClustersMarker()) && rememberClusters(copy)) messagingService.sendToAll('clusters-changed', {});
      } catch (error) {
        console.warn('[mesh] Could not keep a copy of the clusters here:', messageOf(error));
      }
      // Just after a restart this machine's copy of the mesh can be old: a server it reads as running
      // may have been stopped since. Nothing starts or stops on it until it has caught up, or a minute
      // has passed (cut off from the others, it never does).
      if (!this.storeCaughtUp) {
        this.storeCaughtUp = (await this.repo.caughtUp().catch(() => false)) || Date.now() - this.resumedAt >= CATCH_UP_WAIT_MS;
      }
      if (this.storeCaughtUp) await reconcile(nodeId, servers.map(server => ({
        serverId: server.serverId,
        nodeId: server.nodeId,
        desiredState: this.intents?.get(server.serverId) ?? server.desiredState,
        configRevision: server.configRevision,
        configJson: server.configJson
      })), {
        state: id => localRuntime.state(id),
        start: async id => { await localRuntime.start(id); },
        stop: async id => { await localRuntime.stop(id); },
        appliedRevision: id => localRuntime.appliedRevision(id),
        applyConfig: (id, revision, configJson) => localRuntime.applyConfig(id, revision, JSON.parse(configJson))
      }, this.reconcileMemory);
      this.peer?.broadcast({ type: 'status', nodeId, at: Date.now(), quorum: this.quorum });
      this.publishStatus();
      void this.publishInventoryIfChanged().catch(error => console.warn('[mesh] Could not publish the server list:', messageOf(error)));
    } catch (error) {
      console.error('[mesh] Reconcile failed:', error);
    } finally {
      // Whatever else this check did: the others judge this machine up by its heartbeats alone.
      await this.announce(nodeId);
    }
  }

  private requireQuorum(op: MeshWriteOp): void {
    const reason = this.writeBlock(op);
    if (reason) throw new Error(reason);
  }

  private async importLocalAccounts(username?: string, password?: string): Promise<void> {
    let rows: ReturnType<typeof userDatabaseService.exportCredentialRows> = [];
    let roles: Array<{ id: string; name: string; permissions: string[] }> = [];
    try {
      rows = userDatabaseService.exportCredentialRows();
      roles = userDatabaseService.listRoles().map(role => ({ id: role.id, name: role.name, permissions: role.permissions }));
    } catch {
      rows = [];
    }
    for (const role of roles) {
      await this.repo!.upsertRole({ roleId: role.id, name: role.name, permissions: role.permissions, securityVersion: 1 });
    }
    for (const row of rows) {
      await this.repo!.upsertUser({
        userId: row.id,
        username: row.username,
        displayName: row.displayName,
        passwordHash: row.passwordHash,
        passwordParameters: hashAlgOf(row.passwordHash),
        hashAlg: hashAlgOf(row.passwordHash),
        enabled: row.active,
        securityVersion: 1,
        roleId: row.roleId,
        ownerUserId: row.ownerUserId,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      // A machine admin keeps the machine it looks after; without it, it looks after none.
      if (row.roleId === ROLE_IDS.MACHINE_ADMIN && row.machineNodeId) {
        await this.repo!.setMachineAdmin(row.id, row.machineNodeId, !!row.updatesAnyMachine);
      }
    }
    if (rows.length === 0 && password) {
      const verifier = await hashArgon2id(password);
      const userId = randomUUID();
      await this.repo!.upsertRole({
        roleId: ROLE_IDS.ADMIN, name: 'Admin', permissions: [...ALL_PERMISSIONS], securityVersion: 1
      });
      await this.repo!.upsertUser({
        userId,
        username: username || 'admin',
        displayName: username || 'admin',
        passwordHash: verifier.hash,
        passwordParameters: verifier.parameters,
        hashAlg: 'argon2id',
        enabled: true,
        securityVersion: 1,
        roleId: ROLE_IDS.ADMIN,
        ownerUserId: null,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    }
  }

  private async importLocalServers(nodeId: string): Promise<void> {
    if (!this.repo) return;
    try {
      const { instances } = await localRuntime.listInstances();
      for (const instance of instances) {
        // A server already in the mesh keeps its node. Recording it again would pull a
        // moved server back onto this machine.
        if (await this.repo.getServer(instance.id)) continue;
        await this.recordServer({ ...instance, nodeId });
      }
      this.quietly(serverInstanceService.broadcastInstances(), 'send the server list to the pages');
    } catch (error) {
      console.error('[mesh] Could not record local servers:', error);
    }
  }

  private nodeRow(nodeId: string, name: string, meshId: string, serial: string): NodeRecord {
    const secrets = this.secrets!;
    return {
      nodeId,
      meshId,
      name,
      endpoints: {
        peerUrl: peerUrlOf(secrets),
        raftAddr: raftAddrOf(secrets),
        httpAddr: `127.0.0.1:${HTTP_PORT}`
      },
      capabilities: collectCapabilities(),
      leaderEligible: true,
      status: 'alive',
      lastSeen: Date.now(),
      version: appVersion(),
      protocolVersion: PROTOCOL_VERSION,
      certSerial: serial,
      maintenance: false,
      weight: 1
    };
  }

  private async toAuthenticated(userId: string): Promise<AuthenticatedUser | null> {
    if (!this.repo) return null;
    const row = await this.repo.getUser(userId);
    if (!row) return null;
    const [role, scopes] = await Promise.all([
      this.repo.getRole(row.roleId),
      row.roleId === ROLE_IDS.MACHINE_ADMIN ? this.repo.listMachineAdmins() : Promise.resolve([])
    ]);
    const scope = scopes.find(item => item.userId === row.userId);
    const permissions = effectivePermissions({ id: row.roleId, permissions: (role?.permissions || []) as Permission[] });
    return {
      id: row.userId,
      username: row.username,
      displayName: row.displayName,
      roleId: row.roleId,
      roleName: role?.name || BUILT_IN_ROLES.find(builtIn => builtIn.id === row.roleId)?.name || row.roleId,
      ownerUserId: row.ownerUserId,
      machineNodeId: scope?.nodeId ?? null,
      updatesAnyMachine: !!scope?.updatesAny,
      active: row.enabled,
      cliLocked: false,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastLoginAt: null,
      permissions,
      securityVersion: Math.max(row.securityVersion, role?.securityVersion || 1)
    };
  }

  private adoptDesktop(user: AuthenticatedUser): void {
    const identity: SenderIdentity = {
      user,
      permissions: user.permissions,
      isAdmin: user.roleId === ROLE_IDS.ADMIN,
      isLocalDesktop: true
    };
    setMeshDesktopMode(true);
    setMeshDesktopUser(identity);
    this.noteDesktopAuth();
  }

  /** The window may already be open, so it has to hear that sign-in is now required or finished. */
  private noteDesktopAuth(): void {
    messagingService.sendToAll('mesh-auth-changed', {});
  }

  /** How a node said its ARK update was going at its last heartbeat; null once that is too old to show. */
  private reportedArkUpdate(nodeId: string): ArkUpdateStatus | null {
    const reported = this.nodeArkUpdate.get(nodeId);
    return reported && reported.at >= Date.now() - HEARTBEAT_FRESH_MS ? reported.progress : null;
  }

  /** How a node said its copy of the cluster files stood at its last heartbeat; null once that is too old to show. */
  private reportedClusterSync(nodeId: string): Record<string, ClusterSyncSummary> | null {
    const reported = this.nodeClusterSync.get(nodeId);
    return reported && reported.at >= Date.now() - HEARTBEAT_FRESH_MS ? reported.summary : null;
  }

  /** What a node sent with its last heartbeat; null once that is too old to show. */
  private reportedResources(nodeId: string): NodeResources | null {
    const reported = this.nodeResources.get(nodeId);
    return reported && reported.at >= Date.now() - HEARTBEAT_FRESH_MS ? reported.resources : null;
  }

  /**
   * When this machine last heard from a node: now for itself, else its latest heartbeat here or the
   * last time its own record was written, whichever is later. Null for one never heard from at all.
   */
  private lastContactAt(node: NodeRecord, localNodeId: string): number | null {
    if (node.nodeId === localNodeId) return Date.now();
    const latest = Math.max(this.seenHeartbeats.get(node.nodeId)?.at ?? 0, node.lastSeen || 0);
    return latest > 0 ? latest : null;
  }

  /** This machine, or a node that answered or sent a heartbeat recently. */
  private reachable(nodeId: string): boolean {
    return nodeId === this.identity()?.nodeId
      || (this.seenHeartbeats.get(nodeId)?.at ?? 0) >= Date.now() - HEARTBEAT_FRESH_MS;
  }

  /** Nodes a new server can be created on now: reachable, and able to take the save-config command. */
  private async placementInputs(): Promise<PlacementInput[]> {
    if (!this.repo) return [];
    const localId = this.identity()?.nodeId;
    const [nodes, servers] = await Promise.all([this.repo.listNodes(this.identity()?.meshId), this.repo.listServers()]);
    const candidates = nodes.filter(node => node.status !== 'removed' && this.reachable(node.nodeId)
      && (node.nodeId === localId || !outdatedNode(node, 'save-config')));
    return candidates.map(node => ({
      nodeId: node.nodeId,
      freeMemoryBytes: node.capabilities.freeMemoryBytes,
      cpuPercent: node.capabilities.cpuPercent,
      freeDiskBytes: node.capabilities.freeDiskBytes,
      capabilities: node.capabilities,
      storageReachable: true,
      weight: node.weight,
      asaCount: servers.filter(server => server.nodeId === node.nodeId).length,
      maintenance: node.maintenance
    }));
  }
}

export const meshService = new MeshService();

setInventoryMerge(instances => meshService.withMeshServers(instances));

function instanceFromMeshServer(server: ServerRecord): InstanceConfig {
  let parsed: Partial<InstanceConfig> = {};
  try {
    const value = JSON.parse(server.configJson) as Partial<InstanceConfig>;
    if (value && typeof value === 'object') parsed = value;
  } catch {
    // The row still carries a name and a map when the stored config is unreadable.
  }
  for (const field of ['state', 'status', 'players', 'cpu', 'memory', 'startedAt'] as const) {
    delete (parsed as Record<string, unknown>)[field];
  }
  return {
    ...parsed,
    id: server.serverId,
    name: server.name || parsed.name || server.serverId,
    mapName: server.mapName || parsed.mapName,
    nodeId: server.nodeId,
    operatorUserId: server.operatorUserId,
    managerUserId: server.managerUserId,
    configRevision: server.configRevision,
    state: server.desiredState
  } as InstanceConfig;
}

/** How long a machine keeps a forced removal it agreed to, waiting for the word to apply it. */
const FORCE_REMOVAL_AGREEMENT_MS = 5 * 60_000;

/** How often each machine compares its cluster files with the mesh record. */
const CLUSTER_SYNC_MS = 2_000;
/** Sent privately to a player once what they uploaded has reached every machine of the cluster. */
const UPLOAD_READY_MESSAGE = 'Your upload is ready on every server in the cluster. You can transfer now.';
/** A file of a move is tried again after each of these, so a brief drop does not end the move. */
const MOVE_RETRY_DELAYS_MS = [2_000, 5_000, 15_000];
/** How often a move says how far it has got. */
const MOVE_PROGRESS_EVERY_MS = 500;

type MovePhase = 'preparing' | 'checking' | 'copying' | 'verifying';

/** The files of one move on their way to the destination. */
interface Transfer {
  serverId: string;
  dir: string;
  base: string;
  tls: { ca: string; cert: string; key: string };
  /** The destination keeps what it was sent and says what it holds; an older one does not. */
  resumable: boolean;
  progress: MoveProgress;
}

/**
 * Tells every screen showing a server how far its move has got: on a change of phase, when
 * asked, and otherwise at most every MOVE_PROGRESS_EVERY_MS. Other nodes hear it relayed.
 */
class MoveProgress {
  bytesTotal = 0;
  bytesDone = 0;
  /** What the destination already held from an earlier attempt. */
  resumedBytes = 0;
  private phase: MovePhase | null = null;
  private reportedAt = 0;

  constructor(private readonly serverId: string, private readonly destinationName: string) {}

  report(phase: MovePhase, force = false): void {
    const now = Date.now();
    if (!force && phase === this.phase && now - this.reportedAt < MOVE_PROGRESS_EVERY_MS) return;
    this.phase = phase;
    this.reportedAt = now;
    messagingService.sendToAll('server-move-progress', {
      instanceId: this.serverId,
      destinationName: this.destinationName,
      phase,
      bytesDone: this.bytesDone,
      bytesTotal: this.bytesTotal,
      resumedBytes: this.resumedBytes
    });
  }

  add(bytes: number): void {
    this.bytesDone += bytes;
    this.report('copying');
  }
}

/**
 * How much of a file the destination already holds: all of it or the start of it, when its copy
 * matches ours byte for byte. 0 when it holds none, or something else.
 */
async function alreadyThere(file: string, size: number, have: HeldFile | undefined): Promise<number> {
  if (!have || have.size > size) return 0;
  return have.sha256 === await fileDigest(file, have.size) ? have.size : 0;
}

function refusedBy(response: { status: number; body: unknown }, what: string): Error {
  return new Error((response.body as { error?: string } | null)?.error || `The destination did not accept ${what}.`);
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const NODE_NAME_MAX = 64;

/** A machine name as typed, with its spaces tidied. Throws when it is empty or too long. */
function nodeNameOf(name: string): string {
  const clean = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('Enter a name for the machine.');
  if (clean.length > NODE_NAME_MAX) throw new Error(`A machine name can be at most ${NODE_NAME_MAX} characters.`);
  return clean;
}

/** The host in a peer URL, which is the machine's address as other nodes know it. */
function hostOf(peerUrl: string): string {
  try {
    return new URL(peerUrl).hostname;
  } catch {
    return '';
  }
}

/** A cluster sync summary another node reported, keeping only well-formed entries; null when there are none. */
/** The cluster a server chose, from the config the mesh holds for it. */
function clusterRefOf(configJson: string): string | null {
  try {
    const ref = (JSON.parse(configJson) as { clusterRef?: unknown }).clusterRef;
    return typeof ref === 'string' && ref ? ref : null;
  } catch {
    return null;
  }
}

/** An ARK update's progress as a member reported it, checked; null for anything else. */
function arkUpdateOf(value: unknown): ArkUpdateStatus | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.phase !== 'string') return null;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
  return {
    phase: raw.phase as ArkUpdateStatus['phase'],
    message: typeof raw.message === 'string' ? raw.message : '',
    minutesLeft: num(raw.minutesLeft),
    percent: num(raw.percent),
    at: num(raw.at) ?? Date.now()
  };
}

function clusterSyncOf(value: unknown): Record<string, ClusterSyncSummary> | null {
  if (!value || typeof value !== 'object') return null;
  const count = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0);
  const out: Record<string, ClusterSyncSummary> = {};
  for (const [clusterId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    out[clusterId] = {
      files: count(entry.files),
      pendingSend: count(entry.pendingSend),
      pendingReceive: count(entry.pendingReceive),
      conflicts: count(entry.conflicts),
      lastSyncAt: count(entry.lastSyncAt),
      error: typeof entry.error === 'string' ? entry.error.slice(0, 300) : null
    };
  }
  return out;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Resources another node reported, or null unless every figure is a number. */
function nodeResourcesOf(value: unknown): NodeResources | null {
  const figure = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
  const pair = (x: unknown): x is { used: number; total: number } =>
    !!x && typeof x === 'object' && figure((x as { used?: unknown }).used) && figure((x as { total?: unknown }).total);
  const reported = value as { cpuPercent?: unknown; memory?: unknown; disk?: unknown } | null;
  if (!reported || typeof reported !== 'object' || !figure(reported.cpuPercent) || !pair(reported.memory)) return null;
  if (reported.disk !== null && !pair(reported.disk)) return null;
  return {
    cpuPercent: reported.cpuPercent,
    memory: { used: reported.memory.used, total: reported.memory.total },
    disk: reported.disk ? { used: reported.disk.used, total: reported.disk.total } : null
  };
}

/** A stored password hash names its algorithm in its prefix. */
function hashAlgOf(hash: string): 'argon2id' | 'bcrypt' {
  return hash.startsWith('$argon2') ? 'argon2id' : 'bcrypt';
}

/** The serial of the certificate this node presents, or null when the file cannot be read. */
function presentedSerial(certFile: string): string | null {
  try {
    return certificateSerial(fs.readFileSync(certFile, 'utf8'));
  } catch {
    return null;
  }
}

/** Why a node cannot take a moved server, or null when it can. */
function destinationRefusal(node: NodeRecord | null): string | null {
  if (!node || node.status === 'removed') return 'That node is not in the mesh.';
  if (node.maintenance) return 'That node is in maintenance.';
  return outdatedNode(node, 'move');
}

/** Why `node` cannot take `operation` yet, or null. Its recorded protocol is refreshed as it announces. */
/** Why a joining machine's token was refused, in words that say what to do next. */
function tokenRefusal(state: 'used' | 'expired' | 'unknown' | 'valid'): string {
  if (state === 'used') return 'This token was already used by another machine. Make a new token on a member for each machine you add.';
  if (state === 'expired') return 'This token expired: a token lasts 15 minutes. Make a new one on a member.';
  return 'This mesh did not issue that token. Check it was copied whole, or make a new one on a member.';
}

function outdatedNode(node: NodeRecord, operation: ControlCommand['operation']): string | null {
  if ((node.protocolVersion || 1) >= COMMAND_PROTOCOL[operation]) return null;
  return `${node.name} runs an older version of Cerious AASM. Update it to ${operation} servers from another node.`;
}

function emptyStatus(nodeId: string | null, nodeName: string | null): MeshStatus {
  return {
    enabled: false, degraded: false, meshId: null, meshName: null, nodeId, nodeName,
    leaderNodeId: null, voterCount: 0, hasQuorum: false, protocolVersion: PROTOCOL_VERSION,
    warning: null, hasAccounts: false, nodes: [], clusters: [], storage: []
  };
}

function meshRoot(): string {
  return path.join(getDefaultInstallDir(), 'mesh');
}

function rqliteDir(): string {
  return path.join(meshRoot(), 'rqlite');
}

/** Written once this machine's own admin password is in the mesh, or it had none to bring. */
function carriedLoginMarker(): string {
  return path.join(meshRoot(), 'carried-login.json');
}

/** The account this machine's own admin password signs in as, as the marker recorded it; null for none or unreadable. */
function carriedLoginName(): string | null {
  try {
    const marker = JSON.parse(fs.readFileSync(carriedLoginMarker(), 'utf8')) as { username?: unknown };
    return typeof marker.username === 'string' && marker.username ? marker.username : null;
  } catch {
    return null;
  }
}

/** This machine's single web login, as the web server saved it: bcrypt, never the password. */
function readWebLogin(): { username?: string; passwordHash?: string } | null {
  const file = path.join(getDefaultInstallDir(), 'data', 'auth-config.json');
  if (!fs.existsSync(file)) return null;
  const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  return {
    username: typeof saved.username === 'string' ? saved.username : '',
    passwordHash: typeof saved.passwordHash === 'string' ? saved.passwordHash : ''
  };
}

/** Present from a create or join until this machine's own clusters are in the mesh. */
function adoptClustersMarker(): string {
  return path.join(meshRoot(), 'adopt-clusters');
}

function intentsPath(): string {
  return path.join(meshRoot(), 'desired-intents.json');
}

function secretsPath(): string {
  return path.join(meshRoot(), 'rqlite-auth.json');
}

function readSecrets(): LocalSecrets | null {
  try {
    return JSON.parse(fs.readFileSync(secretsPath(), 'utf8')) as LocalSecrets;
  } catch {
    return null;
  }
}

function writeSecrets(secrets: LocalSecrets): void {
  fs.mkdirSync(meshRoot(), { recursive: true });
  fs.writeFileSync(secretsPath(), JSON.stringify(secrets), { mode: 0o600 });
}

/** A new node's secrets. `address`, when typed in, is where the others reach it; otherwise the environment or this machine's own address. */
function freshSecrets(address?: MeshAddress | null): LocalSecrets {
  return {
    httpUser: HTTP_USER, httpPass: randomUUID(), peerPort: PEER_PORT,
    advertiseHost: address?.host ?? advertiseHost(),
    peerUrl: address ? peerUrlFor(address) : advertisedPeerUrl(),
    raftAddr: address ? raftAddrFor(address) : advertisedRaftAddr()
  };
}

/**
 * What other nodes dial. AASM_ADVERTISE_PEER_URL and AASM_ADVERTISE_RAFT_ADDR set them when the
 * node is reached through a proxy, a port forward or an overlay under another name or port;
 * otherwise the advertise host and this node's own ports. Read when the node creates or joins
 * a mesh, and kept with it after that.
 */
function advertisedPeerUrl(): string {
  return process.env.AASM_ADVERTISE_PEER_URL?.trim().replace(/\/$/, '') || `https://${advertiseHost()}:${PEER_PORT}`;
}

function advertisedRaftAddr(): string {
  return process.env.AASM_ADVERTISE_RAFT_ADDR?.trim() || `${advertiseHost()}:${RAFT_PORT}`;
}

/** Older installs stored only the advertise host; their ports were the defaults of that time. */
function peerUrlOf(secrets: LocalSecrets): string {
  return secrets.peerUrl || `https://${secrets.advertiseHost}:${secrets.peerPort}`;
}

function raftAddrOf(secrets: LocalSecrets): string {
  return secrets.raftAddr || `${secrets.advertiseHost}:${RAFT_PORT}`;
}

/** The names this node's certificate has to cover: the hosts other nodes dial. */
function advertisedHosts(secrets: LocalSecrets): string[] {
  return [...new Set([...hostsFromEndpoint(peerUrlOf(secrets)), ...hostsFromEndpoint(raftAddrOf(secrets))])];
}

/** The addresses are kept from the join; environment settings do not move a member, Settings → Mesh does. */
function warnIfAdvertiseChanged(secrets: LocalSecrets): void {
  const wanted = [process.env.AASM_ADVERTISE_PEER_URL ? advertisedPeerUrl() : null, process.env.AASM_ADVERTISE_RAFT_ADDR ? advertisedRaftAddr() : null];
  if ((wanted[0] && wanted[0] !== peerUrlOf(secrets)) || (wanted[1] && wanted[1] !== raftAddrOf(secrets))) {
    console.warn(`[mesh] This node joined advertising ${peerUrlOf(secrets)} and ${raftAddrOf(secrets)}. To move it, change its address in Settings → Mesh.`);
  }
}

function certPaths(): { nodeKey: string; nodeCert: string; caCert: string } {
  const root = meshRoot();
  return { nodeKey: path.join(root, 'node.key'), nodeCert: path.join(root, 'node.crt'), caCert: path.join(root, 'ca.crt') };
}

function writeCerts(keyPem: string, certPem: string, caPem: string): void {
  fs.mkdirSync(meshRoot(), { recursive: true });
  const paths = certPaths();
  fs.writeFileSync(paths.nodeKey, keyPem, { mode: 0o600 });
  fs.writeFileSync(paths.nodeCert, certPem);
  fs.writeFileSync(paths.caCert, caPem);
}

function readCertPaths(): { nodeKey: string; nodeCert: string; caCert: string } | null {
  const paths = certPaths();
  if (!fs.existsSync(paths.nodeKey) || !fs.existsSync(paths.nodeCert) || !fs.existsSync(paths.caCert)) return null;
  return paths;
}

function advertiseHost(): string {
  const configured = process.env.AASM_ADVERTISE_HOST?.trim();
  if (configured) return configured;
  return ownLanAddress(os.networkInterfaces()) ?? '127.0.0.1';
}

function envPort(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return fallback;
  return parsed;
}

async function waitReady(client: RqliteClient, supervisor: RqliteSupervisor, attempts = 40, requireLeader = true): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (supervisor.failure()) return false;
    if (await client.ready({ requireLeader })) return true;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return false;
}

/** A payload that arrived from another machine, as a record; anything else reads as {}. */
function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
