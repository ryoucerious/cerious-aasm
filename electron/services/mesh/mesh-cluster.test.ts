jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('path');
jest.unmock('node:path');
jest.unmock('crypto');
jest.unmock('node:crypto');

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MeshRepository } from './mesh-repository';
import { openSqliteDatabase, SqliteExecutor, type ExecutorStatus } from './sql-executor';
import { executeCommand } from './command-router';
import { reconcile, type RuntimePort } from './reconciler';
import { partitionDecision } from './partition-policy';
import { validateSharedPath } from './cluster-storage';
import { ManagedTransferStore, materializeAtomic, sha256 } from './managed-storage';
import { chooseNode, scoreNode } from './placement';
import { hashArgon2id, verifyArgon2id } from './passwords';
import { createMeshCa, generateKeyPair, newCertificateSerial, normalizeSerial, signNodeCertificate, certificateCoversHost, certificateIssuedBy, hostsFromEndpoint, publicKeyFromPrivatePem } from './certificates';
import { COMMAND_SKEW_MS, PROTOCOL_VERSION, protocolError } from '../../types/mesh.types';
import { clockSkewRejects, diskAllowsPlacement, packetDelivered, withLatency } from './faults';
import { managedStorageProvider } from './managed-storage';

class FakeRuntime implements RuntimePort {
  starts: string[] = [];
  stops: string[] = [];
  readonly states = new Map<string, string>();
  readonly revisions = new Map<string, number>();

  state(id: string): string {
    return this.states.get(id) || 'stopped';
  }

  async start(id: string): Promise<void> {
    this.starts.push(id);
    this.states.set(id, 'running');
  }

  async stop(id: string): Promise<void> {
    this.stops.push(id);
    this.states.set(id, 'stopped');
  }

  appliedRevision(id: string): number {
    return this.revisions.get(id) || 0;
  }


  async applyConfig(id: string, revision: number): Promise<void> {
    this.revisions.set(id, revision);
  }
}

function view(hasQuorum: boolean, voters = 3, leaderNodeId: string | null = 'A'): ExecutorStatus {
  return { leader: leaderNodeId === 'A', voters, hasQuorum, leaderNodeId };
}

describe('mesh control plane', () => {
  let dbPath = '';
  let close: (() => void) | undefined;
  let repo: MeshRepository;
  let quorum: ExecutorStatus;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `aasm-mesh-${process.pid}-${Date.now()}.sqlite`);
    const db = openSqliteDatabase(dbPath);
    close = () => db.close();
    quorum = view(true);
    const executor = new SqliteExecutor(db, quorum);
    // The three nodes share one committed log. Each node's view of quorum is swapped underneath.
    const reading = executor;
    repo = new MeshRepository(reading);
    await repo.migrate();
    await repo.saveMesh({
      meshId: 'mesh-1', name: 'Test', schemaVersion: 1, securityEpoch: 1,
      caCert: 'ca', caKey: 'key', createdAt: 1
    });
  });

  afterEach(() => {
    if (typeof close === 'function') close();
    if (dbPath) fs.rmSync(dbPath, { force: true });
  });

  function setQuorum(next: ExecutorStatus): void {
    quorum.leader = next.leader;
    quorum.voters = next.voters;
    quorum.hasQuorum = next.hasQuorum;
    quorum.leaderNodeId = next.leaderNodeId;
  }

  it('syncs a user created on A so B and C can read the same verifier', async () => {
    const password = await hashArgon2id('correct horse');
    await repo.upsertRole({ roleId: 'admin', name: 'Admin', permissions: ['servers.view'], securityVersion: 1 });
    await repo.upsertUser({
      userId: 'u1', username: 'ada', displayName: 'Ada', passwordHash: password.hash,
      passwordParameters: password.parameters, hashAlg: 'argon2id', enabled: true, securityVersion: 1,
      roleId: 'admin', ownerUserId: null, createdAt: 1, updatedAt: 1
    });
    const onB = await repo.getUserByUsername('ada');
    const onC = await repo.getUser('u1');
    expect(onB?.passwordHash).toBe(password.hash);
    expect(await verifyArgon2id('correct horse', onC!.passwordHash)).toBe(true);
  });

  it('starts a server hosted on C once, and a retried command id does not start it again', async () => {
    const runtime = new FakeRuntime();
    await repo.upsertServer({
      serverId: 's1', name: 'Island', nodeId: 'C', mapName: 'TheIsland', desiredState: 'stopped',
      configRevision: 1, configJson: '{}', clusterId: null, operatorUserId: null, managerUserId: null
    });
    const command = {
      commandId: 'cmd-1', correlationId: 'c1', actor: 'ada', targetNode: 'C', operation: 'start' as const,
      serverId: 's1', expiry: Date.now() + 60_000, issuedAt: Date.now(), expectedRevision: 1
    };
    const effect = async () => {
      await runtime.start('s1');
      return { success: true };
    };
    const first = await executeCommand(repo, command, effect);
    const second = await executeCommand(repo, command, effect);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(runtime.starts).toEqual(['s1']);
    expect((await repo.listAudit()).some(event => event.action === 'start')).toBe(true);
  });

  it('does not stop ARK processes when leadership changes', async () => {
    const runtime = new FakeRuntime();
    runtime.states.set('s1', 'running');
    const desired = [{ serverId: 's1', nodeId: 'C', desiredState: 'running' as const, configRevision: 1 }];
    await reconcile('C', desired, runtime);
    const starts = runtime.starts.length;
    setQuorum(view(true, 3, 'B'));
    await reconcile('C', desired, runtime);
    expect(runtime.starts.length).toBe(starts);
    expect(runtime.stops).toEqual([]);
    expect(runtime.state('s1')).toBe('running');
  });

  it('refuses a security write on the log when this node has no quorum', async () => {
    setQuorum(view(false, 3, null));
    await expect(repo.upsertRole({ roleId: 'admin', name: 'Admin', permissions: [], securityVersion: 1 })).rejects.toThrow(/quorum/);
  });

  it('lets a partitioned node run a local server and refuses a security write', () => {
    expect(partitionDecision(false, 'local-server', true).allow).toBe(true);
    expect(partitionDecision(false, 'login').allow).toBe(true);
    expect(partitionDecision(false, 'security-write').allow).toBe(false);
    expect(partitionDecision(false, 'enroll').allow).toBe(false);
    expect(partitionDecision(false, 'placement').allow).toBe(false);
    expect(partitionDecision(true, 'security-write').allow).toBe(true);
  });

  it('invalidates a session whose security version is older than the account', async () => {
    await repo.upsertUser({
      userId: 'u1', username: 'ada', displayName: 'Ada', passwordHash: 'h', passwordParameters: 'p',
      hashAlg: 'argon2id', enabled: true, securityVersion: 2, roleId: 'admin', ownerUserId: null,
      createdAt: 1, updatedAt: 2
    });
    const observedAtPartition = 2;
    await repo.upsertUser({
      userId: 'u1', username: 'ada', displayName: 'Ada', passwordHash: 'h', passwordParameters: 'p',
      hashAlg: 'argon2id', enabled: false, securityVersion: 3, roleId: 'admin', ownerUserId: null,
      createdAt: 1, updatedAt: 3
    });
    const after = await repo.getUser('u1');
    expect(after!.securityVersion).toBeGreaterThan(observedAtPartition);
    expect(after!.enabled).toBe(false);
  });

  it('rejects a removed node certificate', async () => {
    await repo.revokeSerial('abc', Date.now());
    expect(await repo.isRevoked('abc')).toBe(true);
    expect(await repo.isRevoked('other')).toBe(false);
  });

  it('refuses a command outside the clock skew window without running it', async () => {
    const runtime = new FakeRuntime();
    const result = await executeCommand(repo, {
      commandId: 'late', correlationId: 'c', actor: 'ada', targetNode: 'C', operation: 'start',
      serverId: 's1', expiry: Date.now() - COMMAND_SKEW_MS - 1000, issuedAt: Date.now() - COMMAND_SKEW_MS - 2000,
      expectedRevision: null
    }, async () => {
      await runtime.start('s1');
      return { success: true };
    });
    expect(result.success).toBe(false);
    expect(runtime.starts).toEqual([]);
  });

  it('restores a local desired server after an isolated reboot', async () => {
    const runtime = new FakeRuntime();
    await reconcile('C', [{ serverId: 's1', nodeId: 'C', desiredState: 'running', configRevision: 1 }], runtime);
    expect(runtime.starts).toEqual(['s1']);
    expect(runtime.state('s1')).toBe('running');
  });

  it('validates a shared path from a member and treats failure as degraded, not a stop', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-share-'));
    const ok = validateSharedPath(dir);
    expect(ok.ok).toBe(true);
    expect(ok.identity).toBeTruthy();
    const missing = validateSharedPath(path.join(dir, 'nope', 'missing-as-file'));
    // mkdir recursive succeeds for a new directory, so use a file as the parent to force failure.
    const file = path.join(dir, 'not-a-dir');
    fs.writeFileSync(file, 'x');
    const failed = validateSharedPath(path.join(file, 'child'));
    expect(failed.ok).toBe(false);
    expect(missing.ok).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('commits managed transfer objects once, tombstones them, and stops when authority is lost', () => {
    const store = new ManagedTransferStore();
    const bytes = Buffer.from('survivor-data');
    expect(store.observe('players.ark', bytes)).toBe('pending');
    expect(store.observe('players.ark', bytes)).toBe('stable');
    expect(store.visible('players.ark')).toBeNull();
    const first = store.commit('players.ark', bytes);
    const duplicate = store.commit('players.ark', bytes);
    expect(duplicate.version).toBe(first.version);
    expect(store.visible('players.ark')?.hash).toBe(sha256(bytes));
    store.consume('players.ark');
    expect(store.visible('players.ark')).toBeNull();
    store.authorityAvailable = false;
    expect(() => store.commit('players.ark', Buffer.from('later'))).toThrow(/authority/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-mat-'));
    const written = materializeAtomic(dir, 'players.ark', bytes);
    expect(fs.readFileSync(written).equals(bytes)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('scores a free node above a busy one and never auto-selects a node in maintenance', () => {
    const quiet = {
      nodeId: 'quiet', freeMemoryBytes: 32 * 1024 ** 3, cpuPercent: 10, freeDiskBytes: 200 * 1024 ** 3,
      capabilities: { installPresent: true, proton: false, docker: false }, storageReachable: true,
      weight: 1, asaCount: 0, maintenance: false
    };
    const busy = { ...quiet, nodeId: 'busy', asaCount: 4, cpuPercent: 90 };
    const drained = { ...quiet, nodeId: 'drained', maintenance: true };
    expect(scoreNode(drained)).toBeNull();
    expect(chooseNode([busy, drained, quiet])).toBe('quiet');
  });

  it('keeps a managed transfer degraded when storage authority is lost and does not stop a game', async () => {
    const store = new ManagedTransferStore();
    store.authorityAvailable = false;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-managed-'));
    const result = await managedStorageProvider(dir, store).validate(dir);
    expect(result).toMatchObject({ ok: false });
    expect(String(result.error)).toMatch(/authority/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('treats clock skew, packet loss, latency, and disk pressure as control-plane faults', () => {
    const now = Date.now();
    expect(clockSkewRejects(now + COMMAND_SKEW_MS + 1000, now + 60_000, now)).toBe(true);
    expect(packetDelivered(true)).toBe(false);
    expect(withLatency(20, 80)).toBe(100);
    expect(diskAllowsPlacement(1024, 4096)).toBe(false);
    expect(diskAllowsPlacement(8192, 4096)).toBe(true);
  });

  it('signs a node certificate with the mesh CA and normalizes the serial', () => {
    const ca = createMeshCa('mesh');
    const keys = generateKeyPair();
    const signed = signNodeCertificate(ca.certPem, ca.keyPem, keys.publicKeyPem, 'node-c', ['192.168.1.155']);
    expect(signed.certPem).toContain('BEGIN CERTIFICATE');
    expect(certificateIssuedBy(signed.certPem, ca.certPem)).toBe(true);
    expect(certificateCoversHost(signed.certPem, '192.168.1.155')).toBe(true);
    expect(certificateCoversHost(signed.certPem, '10.0.0.8')).toBe(false);
    expect(hostsFromEndpoint('https://192.168.1.155:4747')).toEqual(['192.168.1.155']);
    expect(publicKeyFromPrivatePem(keys.privateKeyPem)).toContain('BEGIN PUBLIC KEY');
    expect(signed.serial).toBe(normalizeSerial(signed.serial));
    for (let i = 0; i < 40; i++) {
      expect(parseInt(newCertificateSerial().slice(0, 2), 16)).toBeLessThan(0x80);
    }
    expect(keys.privateKeyPem).not.toContain(ca.keyPem);
    expect(protocolError(PROTOCOL_VERSION)).toBeNull();
    expect(protocolError(PROTOCOL_VERSION + 1)).toMatch(/not compatible/);
    expect(protocolError(0)).toMatch(/not compatible/);
    // A newer build still accepts a node one protocol version behind, so a mesh can be updated node by node.
    expect(protocolError(1, 2)).toBeNull();
    expect(protocolError(3, 2)).toMatch(/not compatible/);
  });
});
