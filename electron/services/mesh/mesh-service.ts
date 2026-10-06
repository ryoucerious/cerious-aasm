import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { ALL_PERMISSIONS, AuthenticatedUser, Permission, ROLE_IDS } from '../../types/auth.types';
import {
  COMMAND_PROTOCOL, PROTOCOL_VERSION, QUERY_PROTOCOL, protocolError, type ClusterRecord, type MeshQuery, type CommandResult, type ControlCommand, type DesiredState, type MeshStatus,
  type NodeRecord, type ServerRecord, type StorageProfileRecord, type UserRecord
} from '../../types/mesh.types';
import { getDefaultInstallDir, isRunningInDocker } from '../../utils/platform.utils';
import { getInstanceDir } from '../../utils/ark/instance.utils';
import { appVersion } from '../../utils/app-version';
import { userDatabaseService } from '../auth/user-database.service';
import { poolDirectory } from '../auth/pool-directory';
import { messagingService } from '../messaging.service';
import { autoUpdateService } from '../auto-update.service';
import { beginClusterUpdate } from '../ark-update.service';
import { relaunchInPlace } from '../docker-runtime-update';
import { setMeshDesktopMode, setMeshDesktopUser } from '../auth/desktop-session';
import type { SenderIdentity } from '../auth/permission-gate';
import { collectCapabilities, ensureNodeIdentity, nodeIdentityPath, readNodeIdentity, writeNodeIdentity, type NodeIdentityFile } from '../runtime/node-identity';
import type { InstanceConfig } from '../../types/server-instance.types';
import { localRuntime } from '../runtime/local-runtime';
import { serverInstanceService, setInventoryMerge } from '../server-instance/server-instance.service';
import { createMeshCa, generateKeyPair, signNodeCertificate, certificateCoversHost, certificateFingerprint, certificateIssuedBy, certificateSerial, normalizeSerial, hostsFromEndpoint, publicKeyFromPrivatePem } from './certificates';
import { executeCommand } from './command-router';
import { meshTransferStore } from './managed-storage';
import { providerForProfile } from './cluster-storage';
import { clockSkewMs, probeTcp, wgInstalled, wireguardConfig, wireguardPrivateKey, applyWireguard } from './diagnostics';
import { meshServer, meshServers, registerMeshAuth, setMeshWriteBlock, noteMeshServers, noteSecurityVersion, type MeshWriteOp } from './mesh-hooks';
import { MeshRepository } from './mesh-repository';
import { hashArgon2id, hashToken, newEnrollmentToken, verifyArgon2id, verifyBcrypt } from './passwords';
import {
  archiveInstance, beginStage, checkpointManifest, checksumTree, finishStage, promoteStaged, pruneMeshFolders, writeStagedFile
} from './checkpoint';
import { chooseNode, moveServer, type PlacementInput } from './placement';
import { partitionDecision } from './partition-policy';
import { peerRequest, peerUpload, startPeerServer, subscribeEvents, type JoinRequest, type JoinResponse, type PeerServer } from './peer-server';
import { reconcile, type ReconcileMemory } from './reconciler';
import { DesiredIntents } from './desired-intent';
import { PendingConfigs } from './pending-configs';
import { RqliteClient } from './rqlite-client';
import { RqliteSupervisor } from './rqlite-supervisor';

const HTTP_USER = 'aasm';
const PEER_PORT = envPort('AASM_PEER_PORT', 4747);
const HTTP_PORT = envPort('AASM_HTTP_PORT', 4001);
const RAFT_PORT = envPort('AASM_RAFT_PORT', 4002);
const RESUME_RETRY_MS = 30_000;
/** A move copies saves over the network; a large world takes a while. */
const MOVE_TIMEOUT_MS = 60 * 60_000;
/** Start All staggers its starts, so a node with many servers takes a while to answer. */
const ALL_TIMEOUT_MS = 60 * 60_000;
const PRUNE_INTERVAL_MS = 60 * 60_000;
const QUERY_TIMEOUT_MS = 15_000;
/** Live per-server events the hosting node relays, so another node can show the server live. */
const RELAY_CHANNELS = new Set([
  'server-instance-log', 'server-instance-state', 'server-instance-players', 'server-instance-memory',
  'server-instance-cpu', 'rcon-status', 'clear-server-instance-logs'
]);
/** Commands about one server. The node running one must be the node hosting that server. */
const SERVER_COMMANDS = new Set<ControlCommand['operation']>([
  'start', 'stop', 'force-stop', 'restart', 'delete', 'move', 'rcon', 'connect-rcon', 'disconnect-rcon', 'save-ini', 'set-ownership'
]);
const UP_STATES = new Set(['running', 'starting']);
/** A node that has not answered or sent a heartbeat for this long shows as unreachable. */
const HEARTBEAT_FRESH_MS = 25_000;

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
  /** Starts and stops decided here that the mesh has not stored yet. Open while attached. */
  private intents: DesiredIntents | null = null;
  /** Configs saved here that the mesh has not stored yet. Open while attached. */
  private pendingConfigs: PendingConfigs | null = null;
  private readonly reconcileMemory: ReconcileMemory = new Map();
  /** This node's id while attached; read on every relayed log line, so not from disk. */
  private localNodeId: string | null = null;
  /** One live-event subscription to each other member, by node id. */
  private readonly subscriptions = new Map<string, { close(): void }>();
  /** The state each other node last reported for its servers, while its subscription is open. */
  private readonly liveStates = new Map<string, { nodeId: string; state: string }>();

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
      await this.startRqlite(identity.nodeId, secrets);
      const client = new RqliteClient(`http://127.0.0.1:${HTTP_PORT}`, secrets.httpUser, secrets.httpPass, identity.nodeId);
      if (!await waitReady(client, this.supervisor, 40, false)) throw new Error(this.supervisor.failure() || 'rqlite did not become ready');
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

  private resumeTimer: ReturnType<typeof setTimeout> | null = null;

  private scheduleResume(): void {
    if (this.resumeTimer) return;
    this.resumeTimer = setTimeout(() => { void this.resumeIfJoined(); }, RESUME_RETRY_MS);
  }

  /** A write that can wait for quorum. Without a leader it fails; the node carries on. */
  private async bestEffort(what: string, write: () => Promise<void>): Promise<void> {
    try {
      await write();
    } catch (error) {
      console.warn(`[mesh] Could not ${what} yet:`, error instanceof Error ? error.message : error);
    }
  }

  async createMesh(input: { name: string; adminUsername?: string; adminPassword?: string }): Promise<MeshStatus> {
    if (this.isEnabled()) return this.status();
    const identity = ensureNodeIdentity();
    const ca = createMeshCa(input.name || 'cerious-aasm-mesh');
    const keys = generateKeyPair();
    const secrets = freshSecrets();
    const signed = signNodeCertificate(ca.certPem, ca.keyPem, keys.publicKeyPem, identity.nodeId, advertisedHosts(secrets));
    writeCerts(keys.privateKeyPem, signed.certPem, ca.certPem);
    writeSecrets(secrets);
    fs.rmSync(rqliteDir(), { recursive: true, force: true });
    await this.startRqlite(identity.nodeId, secrets);
    const client = new RqliteClient(`http://127.0.0.1:${HTTP_PORT}`, secrets.httpUser, secrets.httpPass, identity.nodeId);
    if (!await waitReady(client, this.supervisor)) throw new Error(this.supervisor.failure() || 'rqlite did not become ready');
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
  async joinMesh(input: { memberUrl: string; token: string; name?: string; adminPassword?: string; adminUsername?: string }): Promise<MeshStatus> {
    if (this.isEnabled()) throw new Error('This node is already in a mesh. Leave it before joining another.');
    const [secret, pinned] = String(input.token || '').trim().split('.');
    if (!secret || !pinned) throw new Error('This token does not name the mesh it is for. Create a new token on a member.');
    const memberUrl = input.memberUrl.replace(/\/$/, '');
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
        raftAddr: advertisedRaftAddr(),
        peerUrl: advertisedPeerUrl(),
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
      ...freshSecrets(),
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
      throw new Error(this.supervisor.detail() || this.supervisor.failure() || 'Joined, but rqlite did not become ready');
    }
    this.repo = new MeshRepository(client);
    this.rqlite = client;
    this.secrets = secrets;
    // The mesh's accounts replace the ones this machine had; those are kept in a copy.
    try {
      userDatabaseService.snapshotTo(path.join(meshRoot(), `accounts-before-join-${Date.now()}.db`));
    } catch (error) {
      console.warn('[mesh] Could not keep a copy of the accounts on this machine:', error instanceof Error ? error.message : error);
    }
    const joinedIdentity = { ...identity, nodeId, meshId: joined.meshId, name: input.name || identity.name };
    writeNodeIdentity(joinedIdentity);
    await this.attach(joinedIdentity);
    await this.importLocalServers(nodeId);
    if (input.adminPassword) {
      const user = await this.verifyLogin(input.adminUsername || 'admin', input.adminPassword);
      if (user) this.adoptDesktop(user);
    }
    this.publishStatus();
    return this.status();
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
    const consumed = await repo.consumeToken(hashToken(request.token), Date.now());
    if (!consumed) throw new Error('Enrollment token is invalid or expired.');
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
    else this.publishStatus();
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
    const user = await this.verifyLogin(username, password);
    if (user) this.adoptDesktop(user);
    return user;
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
    if (this.isEnabled()) setMeshDesktopUser(null);
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
        const started = await localRuntime.start(current.serverId, () => undefined, () => undefined);
        if (started.started) await this.noteDesired(current.serverId, 'running');
        return { success: started.started, error: started.portError };
      }
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
        const started = await localRuntime.start(current.serverId, () => undefined, () => undefined);
        if (started.started) await this.noteDesired(current.serverId, 'running');
        return { success: started.started, error: started.portError };
      }
      if (current.operation === 'move') return this.moveOut(current.serverId, current.destinationNodeId);
      if (current.operation === 'save-config') return this.saveHosted(current.instance || {});
      if (current.operation === 'start-all' || current.operation === 'stop-all') return this.allHere(current.operation, current.serverIds || []);
      if (current.operation === 'delete') {
        const deleted = await this.deleteHostedServer(current.serverId, () => localRuntime.deleteInstance(current.serverId));
        if (deleted.success) void serverInstanceService.broadcastInstances();
        return { success: deleted.success, error: deleted.error };
      }
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
        // The state its host last reported; the stored desired state until it reports one.
        const instance = instanceFromMeshServer(server);
        const live = this.liveStates.get(server.serverId);
        return live ? { ...instance, state: live.state } as InstanceConfig : instance;
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
    operation: 'start-all' | 'stop-all',
    remote: Map<string, string[]>,
    actor: string
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
        expiry: Date.now() + 60_000,
        issuedAt: Date.now(),
        expectedRevision: null
      }, ALL_TIMEOUT_MS);
      return { nodeId, nodeName, result };
    }));
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
    void serverInstanceService.broadcastInstances();
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

  async createCluster(input: { name: string; arkClusterId: string; members: string[]; path?: string }): Promise<ClusterRecord> {
    this.requireQuorum('placement');
    const cluster: ClusterRecord = {
      clusterId: randomUUID(),
      name: input.name,
      arkClusterId: input.arkClusterId,
      storageProfileId: null,
      members: input.members
    };
    if (input.path) {
      const profile: StorageProfileRecord = {
        storageProfileId: randomUUID(),
        mode: 'shared-path',
        authorityNodeId: null,
        metadata: { path: input.path },
        health: { ok: false, degraded: true, detail: 'Not validated yet', checkedAt: 0, perNode: {} }
      };
      await this.repo!.upsertStorage(profile);
      cluster.storageProfileId = profile.storageProfileId;
    }
    await this.repo!.upsertCluster(cluster);
    return cluster;
  }

  async validateCluster(clusterId: string): Promise<StorageProfileRecord | null> {
    if (!this.repo) return null;
    const clusters = await this.repo.listClusters();
    const cluster = clusters.find(item => item.clusterId === clusterId);
    if (!cluster?.storageProfileId) return null;
    const profile = await this.repo.getStorage(cluster.storageProfileId);
    if (!profile) return null;
    const dir = String(profile.metadata.path || '');
    const localId = this.identity()?.nodeId || '';
    if (profile.mode === 'managed') {
      const authorityHere = !profile.authorityNodeId || profile.authorityNodeId === localId;
      const authoritySeen = !!profile.authorityNodeId && this.seenHeartbeats.has(profile.authorityNodeId);
      meshTransferStore.authorityAvailable = authorityHere || authoritySeen;
    }
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
      transfer: async id => this.deliverCheckpoint(id, destination, rels),
      commitPlacement: async (id, dest, keepRunning) => {
        const moved = await this.repo!.commitPlacement(id, localId, dest, keepRunning ? 'running' : undefined);
        if (!moved) throw new Error('That server was moved or deleted while it was being packed.');
      },
      release: async id => {
        archiveInstance(id);
        void serverInstanceService.broadcastInstances();
      },
      restart: async id => { await localRuntime.start(id, () => undefined, () => undefined); }
    });
    return { success: result.success, error: result.error, detail: result.warning ? { warning: result.warning } : undefined };
  }

  /**
   * Streams a checkpoint to the destination one file at a time and returns the checksum it
   * computed over what it stored. Nothing is held in memory whole.
   */
  private async deliverCheckpoint(serverId: string, destination: NodeRecord, rels: string[]): Promise<string> {
    const certs = readCertPaths();
    if (!certs) throw new Error('This node has no mesh certificate.');
    const tls = {
      ca: fs.readFileSync(certs.caCert, 'utf8'),
      cert: fs.readFileSync(certs.nodeCert, 'utf8'),
      key: fs.readFileSync(certs.nodeKey, 'utf8')
    };
    const base = `${destination.endpoints.peerUrl.replace(/\/$/, '')}/v1/checkpoint`;
    const refused = (response: { status: number; body: unknown }, what: string): Error =>
      new Error((response.body as { error?: string })?.error || `The destination did not accept ${what}.`);

    const begun = await peerRequest({ url: `${base}/begin`, method: 'POST', body: { serverId }, ...tls, timeoutMs: 60_000 });
    if (begun.status !== 200) throw refused(begun, 'the move');
    const dir = getInstanceDir(serverId);
    for (const rel of rels) {
      const query = `serverId=${encodeURIComponent(serverId)}&rel=${encodeURIComponent(rel)}`;
      const sent = await peerUpload({ url: `${base}/file?${query}`, file: path.join(dir, rel), ...tls, timeoutMs: MOVE_TIMEOUT_MS });
      if (sent.status !== 200) throw refused(sent, rel);
    }
    const finished = await peerRequest({ url: `${base}/finish`, method: 'POST', body: { serverId, rels }, ...tls, timeoutMs: MOVE_TIMEOUT_MS });
    const checksum = (finished.body as { checksum?: string })?.checksum;
    if (finished.status !== 200 || !checksum) throw refused(finished, 'the files');
    return checksum;
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
    const accessChanged = !existing || existing.passwordHash !== row.passwordHash || existing.enabled !== row.active
      || existing.roleId !== row.roleId || (existing.ownerUserId || null) !== (row.ownerUserId || null);
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
    if (!this.repo || !identity?.meshId) {
      return emptyStatus(identity?.nodeId || null, identity?.name || null);
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
      ? 'A mesh of fewer than 3 voting nodes cannot elect a new leader if one node stops. Local ARK servers keep running either way.'
      : null;
    return {
      enabled: true,
      degraded: !quorum,
      meshId: mesh?.meshId || identity.meshId,
      meshName: mesh?.name || null,
      nodeId: identity.nodeId,
      nodeName: identity.name,
      leaderNodeId: leader,
      voterCount: voters,
      hasQuorum: quorum,
      protocolVersion: PROTOCOL_VERSION,
      warning,
      hasAccounts: users.length > 0,
      nodes: nodes.map(node => ({
        ...node,
        connected: node.status !== 'removed' && (
          node.nodeId === identity.nodeId
          || this.reachable(node.nodeId)
        )
      })),
      clusters,
      storage
    };
  }

  async stop(): Promise<void> {
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.resumeTimer = null;
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
    this.accountsFingerprint = '';
    messagingService.broadcastTap = null;
    this.localNodeId = null;
    this.attachedIdentity = null;
    this.intents = null;
    this.pendingConfigs = null;
    this.reconcileMemory.clear();
    registerMeshAuth(null);
    setMeshWriteBlock(() => null);
    setMeshDesktopMode(false);
    this.noteDesktopAuth();
  }

  /** Forgets mesh membership on this machine. Local servers and accounts stay. */
  private async leaveLocally(): Promise<void> {
    const identity = this.identity();
    if (identity?.meshId) writeNodeIdentity({ ...identity, meshId: '' });
    await this.stop();
    this.publishStatus();
    void serverInstanceService.broadcastInstances();
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
    if (!await waitReady(client, this.supervisor, 40, false)) throw new Error(this.supervisor.failure() || 'rqlite did not become ready');
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
        onHeartbeat: (id, sentAt) => {
          this.seenHeartbeats.set(id, { at: Date.now(), skewMs: clockSkewMs(sentAt) });
          this.publishStatus();
        },
        // A move's destination stages the streamed files; they become the server when its placement arrives.
        onCheckpointBegin: body => beginStage(String(body.serverId || '')),
        onCheckpointFile: (serverId, rel, body) => writeStagedFile(serverId, rel, body),
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
    setMeshDesktopMode(true);
    this.noteDesktopAuth();
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => { void this.reconcileLocal(nodeId); }, 5000);
    void this.reconcileLocal(nodeId);
  }

  private inventoryFingerprint = '';

  /** Pushes the combined server list when a machine's servers join or leave the mesh. */
  private async publishInventoryIfChanged(): Promise<void> {
    if (!this.isEnabled()) return;
    const { instances } = await localRuntime.listInstances();
    const merged = await this.withMeshServers(instances);
    const fingerprint = merged
      .map(instance => `${instance.id}:${instance.nodeId || ''}:${String((instance as { state?: string }).state || '')}`)
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

  /** Writes this node's version and asks every other node for a heartbeat, so the list can show who is up. */
  private async announce(nodeId: string): Promise<void> {
    if (this.announcing || !this.repo) return;
    this.announcing = true;
    try {
      const self = await this.repo.getNode(nodeId);
      const version = appVersion();
      const certs = readCertPaths();
      // A certificate re-signed without quorum is recorded here, so removing this node revokes it.
      const presented = certs ? presentedSerial(certs.nodeCert) : null;
      const serial = presented || self?.certSerial || '';
      // Every 15 s at most: lastSeen, the build this node runs, and what Auto-select scores it on.
      const outdated = self && (self.version !== version || self.protocolVersion !== PROTOCOL_VERSION || self.certSerial !== serial);
      if (self && (outdated || Date.now() - self.lastSeen > 15_000)) {
        await this.repo.upsertNode({
          ...self, version, protocolVersion: PROTOCOL_VERSION, certSerial: serial, capabilities: collectCapabilities(), lastSeen: Date.now()
        });
      }
      if (!certs) return;
      const nodes = await this.repo.listNodes(this.identity()?.meshId);
      await Promise.all(nodes.filter(node => node.nodeId !== nodeId && node.status !== 'removed').map(async node => {
        try {
          const response = await peerRequest({
            url: `${node.endpoints.peerUrl.replace(/\/$/, '')}/v1/heartbeat`,
            method: 'POST',
            body: { nodeId, sentAt: Date.now() },
            ca: fs.readFileSync(certs.caCert, 'utf8'),
            cert: fs.readFileSync(certs.nodeCert, 'utf8'),
            key: fs.readFileSync(certs.nodeKey, 'utf8'),
            timeoutMs: 3000
          });
          if (response.status === 200) this.seenHeartbeats.set(node.nodeId, { at: Date.now(), skewMs: 0 });
        } catch {
          // A node that does not answer shows as unreachable until the next heartbeat.
        }
      }));
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
    if (changed) void serverInstanceService.broadcastInstances();
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
    this.peer.broadcast({ type: 'server-event', nodeId: this.localNodeId, channel, data });
  }

  /** An event from another node, shown here only if that node hosts the server it is about. */
  private relayIn(fromNodeId: string, event: unknown): void {
    const frame = event as { type?: unknown; nodeId?: unknown; channel?: unknown; data?: { instanceId?: unknown } } | null;
    if (frame?.type !== 'server-event' || frame.nodeId !== fromNodeId || typeof frame.channel !== 'string') return;
    if (!RELAY_CHANNELS.has(frame.channel)) return;
    const serverId = frame.data?.instanceId;
    if (typeof serverId !== 'string' || meshServer(serverId)?.nodeId !== fromNodeId) return;
    const state = (frame.data as { state?: unknown }).state;
    if (frame.channel === 'server-instance-state' && typeof state === 'string') this.liveStates.set(serverId, { nodeId: fromNodeId, state });
    messagingService.sendToAll(frame.channel, frame.data);
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
      data: { instanceId: server.serverId, state: localRuntime.state(server.serverId) }
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
      const roles = await this.repo.listRoles();
      const accounts = {
        users: users.map(user => ({
          userId: user.userId, username: user.username, displayName: user.displayName, passwordHash: user.passwordHash,
          enabled: user.enabled, roleId: user.roleId, ownerUserId: user.ownerUserId, createdAt: user.createdAt, updatedAt: user.updatedAt
        })),
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
    if (!await waitReady(client, this.supervisor, 40, false)) throw new Error(this.supervisor.failure() || 'rqlite did not become ready');
    console.log('[mesh] Switched to the database password set when a node was removed.');
    return true;
  }

  private async reconcileLocal(nodeId: string): Promise<void> {
    if (!this.repo) return;
    try {
      if (await this.adoptClusterCredential(nodeId)) return;
      this.quorum = await this.repo.hasQuorum();
      if (this.quorum) {
        await this.flushIntents(nodeId);
        await this.flushPendingConfigs();
      }
      const [servers, users, clusters, storage, nodes] = await Promise.all([
        this.repo.listServers(),
        this.repo.listUsers(),
        this.repo.listClusters(),
        this.repo.listStorage(),
        this.repo.listNodes(this.identity()?.meshId)
      ]);
      // A server moved here arrives as staged files; they become the server once its placement does.
      for (const server of servers) {
        if (server.nodeId !== nodeId) continue;
        try {
          if (promoteStaged(server.serverId)) void serverInstanceService.broadcastInstances();
        } catch (error) {
          console.error(`[mesh] Could not take in the files for ${server.serverId}:`, error);
        }
      }
      this.syncSubscriptions(nodeId, nodes);
      const { instances } = await localRuntime.listInstances();
      this.setAsideStrayCopies(nodeId, servers, nodes, instances);
      if (this.quorum) await this.publishLocalConfigs(nodeId, servers, instances);
      this.pruneMoveFolders();
      for (const user of users) noteSecurityVersion(user.userId, user.securityVersion);
      await this.mirrorAccounts(users);
      noteMeshServers(servers.map(server => ({
        serverId: server.serverId, nodeId: server.nodeId, operatorUserId: server.operatorUserId, managerUserId: server.managerUserId
      })));
      const clusterByServer = new Map<string, { arkClusterId: string; clusterDirOverride: string }>();
      for (const cluster of clusters) {
        const profile = storage.find(item => item.storageProfileId === cluster.storageProfileId);
        const clusterDirOverride = String(profile?.metadata?.path || '');
        for (const member of cluster.members) {
          clusterByServer.set(member, { arkClusterId: cluster.arkClusterId, clusterDirOverride });
        }
      }
      await reconcile(nodeId, servers.map(server => ({
        serverId: server.serverId,
        nodeId: server.nodeId,
        desiredState: this.intents?.get(server.serverId) ?? server.desiredState,
        configRevision: server.configRevision,
        configJson: server.configJson,
        ...clusterByServer.get(server.serverId)
      })), {
        state: id => localRuntime.state(id),
        start: async id => { await localRuntime.start(id, () => undefined, () => undefined); },
        stop: async id => { await localRuntime.stop(id); },
        appliedRevision: id => localRuntime.appliedRevision(id),
        applyConfig: (id, revision, configJson) => localRuntime.applyConfig(id, revision, JSON.parse(configJson)),
        applyCluster: (id, arkClusterId, clusterDirOverride) => localRuntime.applyCluster(id, arkClusterId, clusterDirOverride)
      }, this.reconcileMemory);
      this.peer?.broadcast({ type: 'status', nodeId, at: Date.now(), quorum: this.quorum });
      await this.announce(nodeId);
      this.publishStatus();
      void this.publishInventoryIfChanged();
    } catch (error) {
      console.error('[mesh] Reconcile failed:', error);
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
      void serverInstanceService.broadcastInstances();
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
    const role = await this.repo.getRole(row.roleId);
    const permissions = row.roleId === ROLE_IDS.ADMIN ? [...ALL_PERMISSIONS] : ((role?.permissions || []) as Permission[]);
    return {
      id: row.userId,
      username: row.username,
      displayName: row.displayName,
      roleId: row.roleId,
      roleName: role?.name || row.roleId,
      ownerUserId: row.ownerUserId,
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

function freshSecrets(): LocalSecrets {
  return {
    httpUser: HTTP_USER, httpPass: randomUUID(), peerPort: PEER_PORT, advertiseHost: advertiseHost(),
    peerUrl: advertisedPeerUrl(), raftAddr: advertisedRaftAddr()
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

/** The addresses are fixed when the node joins; a later change needs leaving and joining again. */
function warnIfAdvertiseChanged(secrets: LocalSecrets): void {
  const wanted = [process.env.AASM_ADVERTISE_PEER_URL ? advertisedPeerUrl() : null, process.env.AASM_ADVERTISE_RAFT_ADDR ? advertisedRaftAddr() : null];
  if ((wanted[0] && wanted[0] !== peerUrlOf(secrets)) || (wanted[1] && wanted[1] !== raftAddrOf(secrets))) {
    console.warn(`[mesh] This node joined advertising ${peerUrlOf(secrets)} and ${raftAddrOf(secrets)}. New advertise settings take effect after leaving the mesh and joining again.`);
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
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      const family = entry.family as string | number;
      if ((family === 'IPv4' || family === 4) && !entry.internal) return entry.address;
    }
  }
  return '127.0.0.1';
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
