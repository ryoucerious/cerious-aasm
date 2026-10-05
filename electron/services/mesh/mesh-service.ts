import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { ALL_PERMISSIONS, AuthenticatedUser, Permission, ROLE_IDS } from '../../types/auth.types';
import {
  PROTOCOL_VERSION, protocolError, type ClusterRecord, type CommandResult, type ControlCommand, type MeshStatus,
  type NodeRecord, type ServerRecord, type StorageProfileRecord
} from '../../types/mesh.types';
import { getDefaultInstallDir, isRunningInDocker } from '../../utils/platform.utils';
import { appVersion } from '../../utils/app-version';
import { userDatabaseService } from '../auth/user-database.service';
import { messagingService } from '../messaging.service';
import { autoUpdateService } from '../auto-update.service';
import { beginClusterUpdate } from '../ark-update.service';
import { relaunchInPlace } from '../docker-runtime-update';
import { setMeshDesktopMode, setMeshDesktopUser } from '../auth/desktop-session';
import type { SenderIdentity } from '../auth/permission-gate';
import { collectCapabilities, ensureNodeIdentity, readNodeIdentity, writeNodeIdentity } from '../runtime/node-identity';
import { localRuntime } from '../runtime/local-runtime';
import { createMeshCa, generateKeyPair, signNodeCertificate } from './certificates';
import { executeCommand } from './command-router';
import { meshTransferStore } from './managed-storage';
import { providerForProfile } from './cluster-storage';
import { clockSkewMs, probeTcp, wgInstalled, wireguardConfig, wireguardPrivateKey, applyWireguard } from './diagnostics';
import { registerMeshAuth, setMeshWriteBlock, noteSecurityVersion, type MeshWriteOp } from './mesh-hooks';
import { MeshRepository } from './mesh-repository';
import { hashArgon2id, hashToken, newEnrollmentToken, verifyArgon2id, verifyBcrypt } from './passwords';
import { checkpointInstance, restoreCheckpoint, type InstanceCheckpoint } from './checkpoint';
import { chooseNode, moveServer, type PlacementInput } from './placement';
import { partitionDecision } from './partition-policy';
import { peerRequest, startPeerServer, type JoinRequest, type JoinResponse, type PeerServer } from './peer-server';
import { reconcile } from './reconciler';
import { RqliteClient } from './rqlite-client';
import { RqliteSupervisor } from './rqlite-supervisor';

const HTTP_USER = 'aasm';
const PEER_PORT = 4747;
const HTTP_PORT = 4001;
const RAFT_PORT = 4002;

interface LocalSecrets {
  httpUser: string;
  httpPass: string;
  peerPort: number;
  advertiseHost: string;
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

  isEnabled(): boolean {
    return !!this.repo && !!readNodeIdentity()?.meshId;
  }

  async resumeIfJoined(): Promise<void> {
    const identity = readNodeIdentity();
    if (!identity?.meshId) return;
    const secrets = readSecrets();
    const certs = readCertPaths();
    if (!secrets || !certs) return;
    try {
      await this.supervisor.start({
        nodeId: identity.nodeId,
        dataDir: rqliteDir(),
        httpAddr: `0.0.0.0:${HTTP_PORT}`,
        raftAddr: `${secrets.advertiseHost}:${RAFT_PORT}`,
        authUser: secrets.httpUser,
        authPass: secrets.httpPass,
        cert: certs
      });
      const client = new RqliteClient(`http://127.0.0.1:${HTTP_PORT}`, secrets.httpUser, secrets.httpPass, identity.nodeId);
      if (!await waitReady(client, this.supervisor)) throw new Error(this.supervisor.failure() || 'rqlite did not become ready');
      this.repo = new MeshRepository(client);
      this.rqlite = client;
      this.secrets = secrets;
      const self = await this.repo.getNode(identity.nodeId);
      if (self?.status === 'removed') {
        await this.leaveLocally();
        return;
      }
      await this.attach(identity.nodeId);
      await this.importLocalServers(identity.nodeId);
    } catch (error) {
      console.error('[mesh] Could not resume the mesh:', error);
    }
  }

  async createMesh(input: { name: string; adminUsername?: string; adminPassword?: string }): Promise<MeshStatus> {
    if (this.isEnabled()) return this.status();
    const identity = ensureNodeIdentity();
    const ca = createMeshCa(input.name || 'cerious-aasm-mesh');
    const keys = generateKeyPair();
    const signed = signNodeCertificate(ca.certPem, ca.keyPem, keys.publicKeyPem, identity.nodeId);
    writeCerts(keys.privateKeyPem, signed.certPem, ca.certPem);
    const secrets = freshSecrets();
    writeSecrets(secrets);
    await this.supervisor.start({
      nodeId: identity.nodeId,
      dataDir: rqliteDir(),
      httpAddr: `0.0.0.0:${HTTP_PORT}`,
      raftAddr: `${secrets.advertiseHost}:${RAFT_PORT}`,
      authUser: secrets.httpUser,
      authPass: secrets.httpPass,
      cert: readCertPaths() || undefined
    });
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
    await this.attach(identity.nodeId);
    if (input.adminPassword) {
      const user = await this.verifyLogin(input.adminUsername || 'admin', input.adminPassword);
      if (user) this.adoptDesktop(user);
    }
    return this.status();
  }

  async joinMesh(input: { memberUrl: string; token: string; name?: string; adminPassword?: string; adminUsername?: string }): Promise<MeshStatus> {
    const identity = ensureNodeIdentity(input.name);
    const keys = generateKeyPair();
    const response = await peerRequest({
      url: `${input.memberUrl.replace(/\/$/, '')}/v1/join`,
      method: 'POST',
      insecure: true,
      body: {
        token: input.token,
        nodeName: identity.name,
        publicKeyPem: keys.publicKeyPem,
        raftAddr: `${advertiseHost()}:${RAFT_PORT}`,
        peerUrl: `https://${advertiseHost()}:${PEER_PORT}`,
        protocolVersion: PROTOCOL_VERSION
      } satisfies JoinRequest
    });
    if (response.status !== 200) {
      const message = (response.body as { error?: string })?.error || `Join failed (${response.status})`;
      throw new Error(message);
    }
    const joined = response.body as JoinResponse;
    writeCerts(keys.privateKeyPem, joined.nodeCert, joined.caCert);
    const secrets: LocalSecrets = {
      httpUser: joined.httpAuthUser,
      httpPass: joined.httpAuthPass,
      peerPort: PEER_PORT,
      advertiseHost: advertiseHost()
    };
    writeSecrets(secrets);
    await this.supervisor.start({
      nodeId: identity.nodeId,
      dataDir: rqliteDir(),
      httpAddr: `0.0.0.0:${HTTP_PORT}`,
      raftAddr: `${secrets.advertiseHost}:${RAFT_PORT}`,
      authUser: secrets.httpUser,
      authPass: secrets.httpPass,
      join: joined.raftAddr,
      cert: readCertPaths() || undefined
    });
    const client = new RqliteClient(`http://127.0.0.1:${HTTP_PORT}`, secrets.httpUser, secrets.httpPass, identity.nodeId);
    if (!await waitReady(client, this.supervisor)) throw new Error(this.supervisor.failure() || 'Joined, but rqlite did not become ready');
    this.repo = new MeshRepository(client);
    this.rqlite = client;
    this.secrets = secrets;
    writeNodeIdentity({ ...identity, meshId: joined.meshId, name: input.name || identity.name });
    await this.attach(identity.nodeId);
    if (input.adminPassword) {
      const user = await this.verifyLogin(input.adminUsername || 'admin', input.adminPassword);
      if (user) this.adoptDesktop(user);
    }
    return this.status();
  }

  async createEnrollmentToken(): Promise<{ token: string; expiresAt: number }> {
    this.requireQuorum('enroll');
    const created = newEnrollmentToken();
    const expiresAt = Date.now() + 15 * 60 * 1000;
    await this.repo!.insertToken(created.hash, expiresAt);
    return { token: created.token, expiresAt };
  }

  async acceptJoin(request: JoinRequest): Promise<JoinResponse> {
    this.requireQuorum('enroll');
    if (protocolError(request.protocolVersion)) {
      throw new Error(protocolError(request.protocolVersion)!);
    }
    const repo = this.repo!;
    const consumed = await repo.consumeToken(hashToken(request.token), Date.now());
    if (!consumed) throw new Error('Enrollment token is invalid or expired.');
    const mesh = await repo.getMesh();
    const secrets = this.secrets;
    if (!mesh || !secrets) throw new Error('This node is not in a mesh.');
    const nodeId = randomUUID();
    const signed = signNodeCertificate(mesh.caCert, mesh.caKey, request.publicKeyPem, nodeId);
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
    return {
      meshId: mesh.meshId,
      nodeId,
      caCert: mesh.caCert,
      nodeCert: signed.certPem,
      httpAuthUser: secrets.httpUser,
      httpAuthPass: secrets.httpPass,
      joinUrl: `http://${secrets.advertiseHost}:${HTTP_PORT}`,
      raftAddr: `${secrets.advertiseHost}:${RAFT_PORT}`
    };
  }

  async removeNode(nodeId: string): Promise<void> {
    this.requireQuorum('remove-node');
    const node = await this.repo!.getNode(nodeId);
    if (!node) throw new Error('That node was not found.');
    if (node.certSerial) await this.repo!.revokeSerial(node.certSerial, Date.now());
    await this.repo!.upsertNode({ ...node, status: 'removed' });
    const localId = readNodeIdentity()?.nodeId;
    const others = (await this.repo!.listNodes()).filter(item => item.status !== 'removed' && item.nodeId !== nodeId);
    const leaving = nodeId === localId || others.length === 0;
    try { await this.rqlite?.removeMember(nodeId); } catch { /* the cert denylist still rejects the node */ }
    // Leaving, or removing the last member, drops this install back to standalone.
    // The servers on this machine stay where they are.
    if (leaving) await this.leaveLocally();
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
      const upgraded = await hashArgon2id(password);
      row.passwordHash = upgraded.hash;
      row.passwordParameters = upgraded.parameters;
      row.hashAlg = 'argon2id';
      row.securityVersion += 1;
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

  async forwardIfRemote(operation: ControlCommand['operation'], serverId: string, actor: string): Promise<CommandResult | null> {
    if (!this.repo) return null;
    const server = await this.repo.getServer(serverId);
    const localId = readNodeIdentity()?.nodeId;
    if (!server || !localId || server.nodeId === localId) return null;
    const decision = partitionDecision(await this.repo.hasQuorum(), 'remote-command');
    if (!decision.allow) return { success: false, error: decision.reason };
    const target = await this.repo.getNode(server.nodeId);
    if (!target || target.status === 'removed') return { success: false, error: 'The hosting node is not available.' };
    const command: ControlCommand = {
      commandId: randomUUID(),
      correlationId: randomUUID(),
      actor,
      targetNode: server.nodeId,
      operation,
      serverId,
      expiry: Date.now() + 60_000,
      issuedAt: Date.now(),
      expectedRevision: server.configRevision
    };
    const secrets = this.secrets;
    const certs = readCertPaths();
    if (!secrets || !certs) return { success: false, error: 'This node has no mesh certificate.' };
    const response = await peerRequest({
      url: `${target.endpoints.peerUrl.replace(/\/$/, '')}/v1/command`,
      method: 'POST',
      body: command,
      ca: fs.readFileSync(certs.caCert, 'utf8'),
      cert: fs.readFileSync(certs.nodeCert, 'utf8'),
      key: fs.readFileSync(certs.nodeKey, 'utf8')
    });
    if (response.status !== 200) {
      return { success: false, error: (response.body as { error?: string })?.error || 'Remote command failed' };
    }
    return response.body as CommandResult;
  }

  /** Starts an ARK or app update on this node, or asks another node to start it on itself. */
  async requestNodeUpdate(nodeId: string, kind: 'ark' | 'app', actor: string): Promise<CommandResult> {
    if (!this.repo) return { success: false, error: 'Mesh is not enabled.' };
    const localId = readNodeIdentity()?.nodeId;
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
    const secrets = this.secrets;
    const certs = readCertPaths();
    if (!secrets || !certs) return { success: false, error: 'This node has no mesh certificate.' };
    try {
      const response = await peerRequest({
        url: `${target.endpoints.peerUrl.replace(/\/$/, '')}/v1/command`,
        method: 'POST',
        body: command,
        ca: fs.readFileSync(certs.caCert, 'utf8'),
        cert: fs.readFileSync(certs.nodeCert, 'utf8'),
        key: fs.readFileSync(certs.nodeKey, 'utf8'),
        timeoutMs: 10 * 60_000
      });
      if (response.status !== 200) {
        return { success: false, error: (response.body as { error?: string })?.error || 'That node did not accept the update.' };
      }
      return response.body as CommandResult;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'That node could not be reached.' };
    }
  }

  async executeLocalCommand(command: ControlCommand): Promise<CommandResult> {
    if (!this.repo) return { success: false, error: 'Mesh is not enabled.' };
    const result = await executeCommand(this.repo, command, async current => {
      if (current.operation === 'start') {
        const started = await localRuntime.start(current.serverId, () => undefined, () => undefined);
        return { success: started.started, error: started.portError };
      }
      if (current.operation === 'stop' || current.operation === 'restart') {
        const stopped = await localRuntime.stop(current.serverId);
        if (current.operation === 'stop') return { success: stopped.success, error: stopped.error };
      }
      if (current.operation === 'force-stop') {
        const stopped = await localRuntime.forceStop(current.serverId);
        return { success: stopped.success, error: stopped.error };
      }
      if (current.operation === 'restart') {
        const started = await localRuntime.start(current.serverId, () => undefined, () => undefined);
        return { success: started.started, error: started.portError };
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

  async recordServer(server: { id: string; name?: string; mapName?: string; configRevision?: number; nodeId?: string; operatorUserId?: string | null; managerUserId?: string | null; clusterId?: string }): Promise<void> {
    if (!this.repo) return;
    const localId = readNodeIdentity()?.nodeId || '';
    const existing = await this.repo.getServer(server.id);
    let nodeId = server.nodeId || existing?.nodeId || '';
    if (!nodeId) {
      try { nodeId = (await this.suggestPlacement()) || localId; } catch { nodeId = localId; }
    }
    if (server.nodeId && server.nodeId !== existing?.nodeId) {
      const decision = partitionDecision(await this.repo.hasQuorum(), 'placement', nodeId === localId);
      if (!decision.allow) throw new Error(decision.reason);
    }
    const record: ServerRecord = {
      serverId: server.id,
      name: server.name || server.id,
      nodeId,
      mapName: server.mapName || '',
      desiredState: existing?.desiredState || 'stopped',
      configRevision: Number(server.configRevision) || existing?.configRevision || 1,
      configJson: JSON.stringify(server),
      clusterId: server.clusterId || existing?.clusterId || null,
      operatorUserId: server.operatorUserId ?? existing?.operatorUserId ?? null,
      managerUserId: server.managerUserId ?? existing?.managerUserId ?? null
    };
    await this.repo.upsertServer(record);
  }

  async noteDesired(serverId: string, desiredState: 'running' | 'stopped'): Promise<void> {
    if (!this.repo) return;
    const existing = await this.repo.getServer(serverId);
    if (!existing) return;
    try {
      await this.repo.upsertServer({ ...existing, desiredState });
    } catch {
      // A partition must not block the local start that already happened.
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
    const localId = readNodeIdentity()?.nodeId || '';
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

  async move(serverId: string, destinationNodeId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.repo) return { success: false, error: 'Mesh is not enabled.' };
    this.requireQuorum('placement');
    const server = await this.repo.getServer(serverId);
    if (!server) return { success: false, error: 'That server was not found.' };
    const source = server.nodeId;
    const localId = readNodeIdentity()?.nodeId || '';
    let packed: InstanceCheckpoint | null = null;
    let received = '';
    return moveServer(serverId, source, destinationNodeId, {
      saveWorld: async id => { try { await localRuntime.rcon(id, 'SaveWorld'); } catch { /* an offline server still moves */ } },
      stop: async (_node, id) => { await localRuntime.stop(id); },
      checkpoint: async id => {
        packed = checkpointInstance(id);
        return { checksum: packed.checksum };
      },
      transfer: async (id, checksum) => {
        if (!packed) throw new Error('No checkpoint.');
        received = await this.deliverCheckpoint(id, destinationNodeId, localId, packed, checksum);
      },
      verify: async (_id, checksum) => received === checksum && checksum.length > 0,
      commitPlacement: async (id, dest) => {
        const current = await this.repo!.getServer(id);
        if (current) await this.repo!.upsertServer({ ...current, nodeId: dest });
      },
      rollbackPlacement: async (id, src) => {
        const current = await this.repo!.getServer(id);
        if (current) await this.repo!.upsertServer({ ...current, nodeId: src });
      },
      start: async (_node, id) => { await localRuntime.start(id, () => undefined, () => undefined); }
    });
  }

  async audit(): Promise<unknown[]> {
    if (!this.repo) return [];
    return this.repo.listAudit();
  }

  acceptCheckpoint(body: { serverId: string; checksum: string; files: Array<{ rel: string; data: string }> }): { checksum: string } {
    const files = body.files.map(file => ({ rel: file.rel, bytes: Buffer.from(file.data, 'base64') }));
    const checksum = restoreCheckpoint(body.serverId, files);
    if (checksum !== body.checksum) throw new Error('Checkpoint checksum mismatch');
    return { checksum };
  }

  private async deliverCheckpoint(serverId: string, destinationNodeId: string, localId: string, packed: InstanceCheckpoint, checksum: string): Promise<string> {
    if (destinationNodeId === localId) {
      const restored = restoreCheckpoint(serverId, packed.files);
      if (restored !== checksum) throw new Error('Checkpoint checksum mismatch');
      return restored;
    }
    const dest = await this.repo!.getNode(destinationNodeId);
    if (!dest) throw new Error('Destination node was not found.');
    const certs = readCertPaths();
    if (!certs) throw new Error('This node has no mesh certificate.');
    const response = await peerRequest({
      url: `${dest.endpoints.peerUrl.replace(/\/$/, '')}/v1/checkpoint`,
      method: 'POST',
      ca: fs.readFileSync(certs.caCert, 'utf8'),
      cert: fs.readFileSync(certs.nodeCert, 'utf8'),
      key: fs.readFileSync(certs.nodeKey, 'utf8'),
      body: {
        serverId,
        checksum,
        files: packed.files.map(file => ({ rel: file.rel, data: file.bytes.toString('base64') }))
      }
    });
    const body = response.body as { checksum?: string; error?: string };
    if (response.status !== 200 || body.checksum !== checksum) {
      throw new Error(body.error || 'Destination rejected the checkpoint.');
    }
    return body.checksum;
  }

  async setMaintenance(nodeId: string, maintenance: boolean): Promise<void> {
    this.requireQuorum('placement');
    const node = await this.repo!.getNode(nodeId);
    if (!node) throw new Error('That node was not found.');
    await this.repo!.upsertNode({ ...node, maintenance, status: maintenance ? 'maintenance' : 'alive' });
  }

  async diagnostics(): Promise<{ probes: Array<{ target: string; ok: boolean; rttMs: number; error?: string }>; skew: Array<{ nodeId: string; skewMs: number }> }> {
    const nodes = this.repo ? await this.repo.listNodes() : [];
    const probes = [];
    for (const node of nodes) {
      if (node.nodeId === readNodeIdentity()?.nodeId) continue;
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

  async syncUser(userId: string): Promise<void> {
    if (!this.repo) return;
    const row = userDatabaseService.exportCredentialRows().find(user => user.id === userId);
    if (!row) return;
    const existing = await this.repo.getUser(userId);
    await this.repo.upsertUser({
      userId: row.id,
      username: row.username,
      displayName: row.displayName,
      passwordHash: row.passwordHash,
      passwordParameters: existing?.passwordParameters || 'bcrypt',
      hashAlg: existing?.hashAlg === 'argon2id' ? 'argon2id' : 'bcrypt',
      enabled: row.active,
      securityVersion: (existing?.securityVersion || 1) + 1,
      roleId: row.roleId,
      ownerUserId: row.ownerUserId,
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now()
    });
  }

  async forgetUser(userId: string): Promise<void> {
    if (!this.repo) return;
    const existing = await this.repo.getUser(userId);
    if (!existing) return;
    await this.repo.upsertUser({ ...existing, enabled: false, securityVersion: existing.securityVersion + 1, updatedAt: Date.now() });
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
    const identity = readNodeIdentity();
    if (!this.repo || !identity?.meshId) {
      return emptyStatus(identity?.nodeId || null, identity?.name || null);
    }
    const [mesh, nodes, clusters, storage, users, quorum, voters, leader] = await Promise.all([
      this.repo.getMesh(),
      this.repo.listNodes(),
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
    const freshAfter = Date.now() - 25_000;
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
          || (this.seenHeartbeats.get(node.nodeId)?.at ?? 0) >= freshAfter
        )
      })),
      clusters,
      storage
    };
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.peer) await new Promise<void>(resolve => this.peer!.close(() => resolve()));
    this.peer = null;
    await this.supervisor.stop();
    this.repo = null;
    this.rqlite = null;
    registerMeshAuth(null);
    setMeshWriteBlock(() => null);
    setMeshDesktopMode(false);
    this.noteDesktopAuth();
  }

  /** Forgets mesh membership on this machine. Local servers and accounts stay. */
  private async leaveLocally(): Promise<void> {
    const identity = readNodeIdentity();
    if (identity?.meshId) writeNodeIdentity({ ...identity, meshId: '' });
    await this.stop();
  }

  private async attach(nodeId: string): Promise<void> {
    const certs = readCertPaths();
    if (certs && !this.peer) {
      this.peer = await startPeerServer(this.secrets?.peerPort || PEER_PORT, {
        certPem: fs.readFileSync(certs.nodeCert, 'utf8'),
        keyPem: fs.readFileSync(certs.nodeKey, 'utf8'),
        caPem: fs.readFileSync(certs.caCert, 'utf8'),
        isRevoked: serial => this.repo?.isRevoked(serial) ?? Promise.resolve(false),
        onJoin: body => this.acceptJoin(body),
        onCommand: body => this.executeLocalCommand(body),
        onHeartbeat: (id, sentAt) => this.seenHeartbeats.set(id, { at: Date.now(), skewMs: clockSkewMs(sentAt) }),
        onCheckpoint: body => Promise.resolve(this.acceptCheckpoint(body))
      });
    }
    registerMeshAuth({
      enabled: () => this.isEnabled(),
      verify: (username, password) => this.verifyLogin(username, password),
      resolve: userId => this.toAuthenticated(userId).then(user => user ? { user, securityVersion: user.securityVersion || 1 } : null),
      hasQuorum: () => true
    });
    setMeshWriteBlock(op => this.writeBlock(op));
    setMeshDesktopMode(true);
    this.noteDesktopAuth();
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => { void this.reconcileLocal(nodeId); }, 5000);
    void this.reconcileLocal(nodeId);
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
      if (self && (self.version !== version || Date.now() - self.lastSeen > 15_000)) {
        await this.repo.upsertNode({ ...self, version, lastSeen: Date.now() });
      }
      const certs = readCertPaths();
      if (!certs) return;
      const nodes = await this.repo.listNodes();
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

  private async reconcileLocal(nodeId: string): Promise<void> {
    if (!this.repo) return;
    try {
      this.quorum = await this.repo.hasQuorum();
      const [servers, users, clusters, storage] = await Promise.all([
        this.repo.listServers(),
        this.repo.listUsers(),
        this.repo.listClusters(),
        this.repo.listStorage()
      ]);
      for (const user of users) noteSecurityVersion(user.userId, user.securityVersion);
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
        desiredState: server.desiredState,
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
      });
      this.peer?.broadcast({ type: 'status', nodeId, at: Date.now(), quorum: this.quorum });
      void this.announce(nodeId);
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
        passwordParameters: 'bcrypt',
        hashAlg: 'bcrypt',
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
        peerUrl: `https://${secrets.advertiseHost}:${secrets.peerPort}`,
        raftAddr: `${secrets.advertiseHost}:${RAFT_PORT}`,
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

  private async placementInputs(): Promise<PlacementInput[]> {
    if (!this.repo) return [];
    const [nodes, servers] = await Promise.all([this.repo.listNodes(), this.repo.listServers()]);
    return nodes.filter(node => node.status !== 'removed').map(node => ({
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
  return { httpUser: HTTP_USER, httpPass: randomUUID(), peerPort: PEER_PORT, advertiseHost: advertiseHost() };
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
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      const family = entry.family as string | number;
      if ((family === 'IPv4' || family === 4) && !entry.internal) return entry.address;
    }
  }
  return '127.0.0.1';
}

async function waitReady(client: RqliteClient, supervisor: RqliteSupervisor): Promise<boolean> {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (supervisor.failure()) return false;
    if (await client.ready()) return true;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return false;
}
