jest.unmock('fs');
jest.unmock('node:fs');
jest.unmock('path');
jest.unmock('node:path');
jest.unmock('crypto');
jest.unmock('node:crypto');

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';
import * as net from 'net';
import type { AddressInfo } from 'net';
import { certificateSerial, createMeshCa, generateKeyPair, signNodeCertificate } from './certificates';
import { peerDownload, peerRequest, peerUpload, probeTls, startPeerServer, subscribeEvents, type PeerServer } from './peer-server';

describe('peer server checkpoint uploads', () => {
  let dir: string;
  let server: PeerServer;
  let port = 0;
  let caPem = '';
  let client: { cert: string; key: string };
  let revoked = false;
  let ca: ReturnType<typeof createMeshCa>;
  const trustChecks: Array<{ serial: string; nodeId: string }> = [];
  /** How long the revocation lookup takes; a slow one opens the window the server must not leak through. */
  let revocationDelayMs = 0;
  /** What the server tells each new subscriber first. */
  let greeting: unknown[] = [];
  const received: Array<{ serverId: string; rel: string; bytes: Buffer; offset: number }> = [];
  /** What the destination says it already holds when a move begins. */
  let held: unknown = null;
  /** Cluster file contents this node keeps, by sha256. */
  const clusterObjects = new Map<string, string>();
  /** serverId/fileName → the backup file this machine would hand out. */
  const backupFiles = new Map<string, string>();
  const heldCopies = new Map<string, string>();
  const onHeartbeat = jest.fn();
  const onProbeAddress = jest.fn();

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aasm-peer-'));
    ca = createMeshCa('mesh');
    caPem = ca.certPem;
    const serverKeys = generateKeyPair();
    const serverCert = signNodeCertificate(ca.certPem, ca.keyPem, serverKeys.publicKeyPem, 'server', ['127.0.0.1']);
    const clientKeys = generateKeyPair();
    client = { cert: signNodeCertificate(ca.certPem, ca.keyPem, clientKeys.publicKeyPem, 'client', ['127.0.0.1']).certPem, key: clientKeys.privateKeyPem };
    server = await startPeerServer(0, {
      certPem: serverCert.certPem,
      keyPem: serverKeys.privateKeyPem,
      caPem: ca.certPem,
      // The mesh decides; here only 'client' is a member, and only until it is revoked.
      isTrusted: async (serial, nodeId) => {
        trustChecks.push({ serial, nodeId });
        if (revocationDelayMs) await new Promise(resolve => setTimeout(resolve, revocationDelayMs));
        return !revoked && nodeId === 'client';
      },
      onSubscribe: () => greeting,
      onJoin: jest.fn(),
      onCommand: jest.fn(),
      onHeartbeat,
      onProbeAddress,
      onCheckpointBegin: async () => held as never,
      onClusterObject: sha256 => clusterObjects.get(sha256) ?? null,
      onBackupFile: (serverId, fileName) => backupFiles.get(`${serverId}/${fileName}`) ?? null,
      onBackupCopyFile: serverId => heldCopies.get(serverId) ?? null,
      onCheckpointFile: async (serverId, rel, body, offset) => {
        const chunks: Buffer[] = [];
        for await (const chunk of body) chunks.push(chunk as Buffer);
        received.push({ serverId, rel, bytes: Buffer.concat(chunks), offset });
      }
    });
    port = (server.address() as AddressInfo).port;
  }, 60_000);

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    received.length = 0;
    revoked = false;
    trustChecks.length = 0;
    revocationDelayMs = 0;
    greeting = [];
    held = null;
  });

  function upload(file: string, rel: string, tls: { cert?: string; key?: string } = client) {
    return peerUpload({
      url: `https://127.0.0.1:${port}/v1/checkpoint/file?serverId=isle&rel=${encodeURIComponent(rel)}`,
      file,
      ca: caPem,
      ...tls
    });
  }

  it('streams an uploaded file to the checkpoint handler with its path', async () => {
    const file = path.join(dir, 'world.ark');
    fs.writeFileSync(file, randomBytes(3 * 1024 * 1024 + 11));

    const response = await upload(file, 'SavedArks/The Island/world.ark');

    expect(response.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0].serverId).toBe('isle');
    expect(received[0].rel).toBe('SavedArks/The Island/world.ark');
    expect(received[0].bytes.equals(fs.readFileSync(file))).toBe(true);
  });

  it('starts a file at the byte it is carried on from, sending only the rest, and says how much it sent', async () => {
    const file = path.join(dir, 'world.ark');
    fs.writeFileSync(file, 'world');
    const progress: number[] = [];

    const response = await peerUpload({
      url: `https://127.0.0.1:${port}/v1/checkpoint/file?serverId=isle&rel=world.ark&offset=3`,
      file,
      start: 3,
      onProgress: bytes => progress.push(bytes),
      ca: caPem,
      ...client
    });

    expect(response.status).toBe(200);
    expect(received).toEqual([{ serverId: 'isle', rel: 'world.ark', bytes: Buffer.from('ld'), offset: 3 }]);
    expect(progress.reduce((sum, bytes) => sum + bytes, 0)).toBe(2);
  });

  it('refuses an offset that is not a whole number of bytes', async () => {
    const file = path.join(dir, 'world.ark');
    fs.writeFileSync(file, 'world');

    const response = await peerUpload({ url: `https://127.0.0.1:${port}/v1/checkpoint/file?serverId=isle&rel=world.ark&offset=-1`, file, ca: caPem, ...client });

    expect(response.status).toBe(400);
    expect(received).toEqual([]);
  });

  describe('cluster file contents', () => {
    const url = (sha256: string) => `https://127.0.0.1:${port}/v1/cluster-object?sha256=${sha256}`;

    it('hands a member the contents with the sha256 it asks for', async () => {
      const kept = path.join(dir, 'kept-object');
      fs.writeFileSync(kept, 'player transfer data');
      clusterObjects.set('a'.repeat(64), kept);
      const dest = path.join(dir, 'fetched');

      expect(await peerDownload({ url: url('a'.repeat(64)), dest, ca: caPem, ...client })).toBe(true);

      expect(fs.readFileSync(dest, 'utf8')).toBe('player transfer data');
    });

    it('says it does not have contents it was never given', async () => {
      const dest = path.join(dir, 'never');

      expect(await peerDownload({ url: url('b'.repeat(64)), dest, ca: caPem, ...client })).toBe(false);
      expect(fs.existsSync(dest)).toBe(false);
    });

    it('gives nothing to a machine that is not a member', async () => {
      const kept = path.join(dir, 'secret-object');
      fs.writeFileSync(kept, 'x');
      clusterObjects.set('c'.repeat(64), kept);
      const dest = path.join(dir, 'stolen');

      expect(await peerDownload({ url: url('c'.repeat(64)), dest, ca: caPem })).toBe(false);
      expect(fs.existsSync(dest)).toBe(false);
    });
  });

  // The latest backup of each server is kept on a second machine as well.
  describe('backups and the copies kept of them', () => {
    it('hands a member a backup of a server here, and the copy it keeps', async () => {
      const backup = path.join(dir, 'backup_manual_1.zip');
      fs.writeFileSync(backup, 'zip bytes');
      backupFiles.set('isle/backup_manual_1.zip', backup);
      heldCopies.set('far', backup);

      const fetched = path.join(dir, 'fetched.zip');
      expect(await peerDownload({ url: `https://127.0.0.1:${port}/v1/backup-file?serverId=isle&fileName=backup_manual_1.zip`, dest: fetched, ca: caPem, ...client })).toBe(true);
      expect(fs.readFileSync(fetched, 'utf8')).toBe('zip bytes');

      const back = path.join(dir, 'back.zip');
      expect(await peerDownload({ url: `https://127.0.0.1:${port}/v1/backup-copy-file?serverId=far`, dest: back, ca: caPem, ...client })).toBe(true);
      expect(fs.readFileSync(back, 'utf8')).toBe('zip bytes');
    });

    it('says it has no such backup, or no copy', async () => {
      const dest = path.join(dir, 'nothing.zip');

      expect(await peerDownload({ url: `https://127.0.0.1:${port}/v1/backup-file?serverId=isle&fileName=other.zip`, dest, ca: caPem, ...client })).toBe(false);
      expect(await peerDownload({ url: `https://127.0.0.1:${port}/v1/backup-copy-file?serverId=nowhere`, dest, ca: caPem, ...client })).toBe(false);
      expect(fs.existsSync(dest)).toBe(false);
    });

    it('gives no backup to a machine that is not a member', async () => {
      const backup = path.join(dir, 'private.zip');
      fs.writeFileSync(backup, 'x');
      backupFiles.set('isle/private.zip', backup);
      const dest = path.join(dir, 'stolen.zip');

      expect(await peerDownload({ url: `https://127.0.0.1:${port}/v1/backup-file?serverId=isle&fileName=private.zip`, dest, ca: caPem })).toBe(false);
      expect(fs.existsSync(dest)).toBe(false);
    });
  });

  it('answers the start of a move with what this node already holds of it', async () => {
    held = [{ rel: 'world.ark', size: 3, sha256: 'abc' }];

    const response = await peerRequest({
      url: `https://127.0.0.1:${port}/v1/checkpoint/begin`, method: 'POST', body: { serverId: 'isle', resume: true }, ca: caPem, ...client
    });

    expect(response).toEqual({ status: 200, body: { ok: true, held: [{ rel: 'world.ark', size: 3, sha256: 'abc' }] } });
  });

  it('refuses an upload without a mesh client certificate', async () => {
    const file = path.join(dir, 'small.bin');
    fs.writeFileSync(file, 'x');

    const response = await upload(file, 'config.json', {});

    expect(response.status).toBe(401);
    expect(received).toEqual([]);
  });

  describe('event subscriptions', () => {
    // Closed whatever the test did, so a failed test cannot keep the server from shutting down.
    const live: Array<{ close(): void }> = [];
    afterEach(() => { for (const subscription of live.splice(0)) subscription.close(); });

    function subscribe(tls: { cert?: string; key?: string } = client) {
      const events: unknown[] = [];
      let closedWith: number | null = null;
      let opened!: () => void;
      const open = new Promise<void>(resolve => { opened = resolve; });
      const subscription = subscribeEvents({
        url: `wss://127.0.0.1:${port}/v1/events`,
        ca: caPem,
        ...tls,
        onEvent: event => events.push(event),
        onOpen: () => opened(),
        onClose: code => { closedWith = code; }
      });
      live.push(subscription);
      return { events, open, closed: () => closedWith, subscription };
    }

    async function until(check: () => boolean): Promise<void> {
      for (let i = 0; i < 100 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 20));
    }

    it('delivers what the server broadcasts to a subscribed node', async () => {
      const node = subscribe();
      await node.open;
      await new Promise(resolve => setTimeout(resolve, 50));

      server.broadcast({ type: 'server-event', channel: 'server-instance-log', data: { instanceId: 'isle', log: 'hi' } });
      await until(() => node.events.length > 0);

      expect(node.events).toEqual([{ type: 'server-event', channel: 'server-instance-log', data: { instanceId: 'isle', log: 'hi' } }]);
      node.subscription.close();
    });

    it('greets a new subscriber with how things stand now', async () => {
      greeting = [{ type: 'server-event', channel: 'server-instance-state', data: { instanceId: 'isle', state: 'running' } }];
      const node = subscribe();
      await until(() => node.events.length > 0);

      expect(node.events).toEqual(greeting);
      node.subscription.close();
    });

    it('closes a subscriber without a mesh client certificate', async () => {
      const stranger = subscribe({});
      await until(() => stranger.closed() !== null);

      expect(stranger.closed()).toBe(4001);
    });

    it('sends nothing to a revoked node, even before it is turned away', async () => {
      revoked = true;
      revocationDelayMs = 300;
      const node = subscribe();
      await node.open;
      await new Promise(resolve => setTimeout(resolve, 50));
      server.broadcast({ type: 'server-event', channel: 'server-instance-log', data: { instanceId: 'isle', log: 'secret' } });
      await until(() => node.closed() !== null);

      expect(node.closed()).toBe(4001);
      expect(node.events).toEqual([]);
    });
  });

  it('takes a heartbeat as from the node its certificate names, with the resources and cluster sync it reports', async () => {
    const resources = { cpuPercent: 12, memory: { used: 1, total: 2 }, disk: null };
    const clusterSync = { c1: { files: 1, pendingSend: 0, pendingReceive: 0, conflicts: 0, lastSyncAt: 1, error: null } };
    const arkUpdate = { phase: 'warning', message: 'Warning players: update in 12 min', minutesLeft: 12, at: 1 };

    const response = await peerRequest({
      url: `https://127.0.0.1:${port}/v1/heartbeat`,
      method: 'POST',
      body: { nodeId: 'someone-else', sentAt: 5, resources, clusterSync, arkUpdate },
      ca: caPem,
      ...client
    });

    expect(response.status).toBe(200);
    expect(onHeartbeat).toHaveBeenCalledWith('client', 5, resources, clusterSync, arkUpdate);
  });

  it('asks whether the certificate belongs to a member, by its serial and node id', async () => {
    const file = path.join(dir, 'small.bin');
    fs.writeFileSync(file, 'x');

    await upload(file, 'config.json');

    expect(trustChecks).toEqual([{ serial: certificateSerial(client.cert), nodeId: 'client' }]);
  });

  it('refuses a certificate the mesh CA signed for a node that is not a member', async () => {
    const strangerKeys = generateKeyPair();
    const stranger = signNodeCertificate(ca.certPem, ca.keyPem, strangerKeys.publicKeyPem, 'stranger', ['127.0.0.1']).certPem;
    const file = path.join(dir, 'small.bin');
    fs.writeFileSync(file, 'x');

    const response = await upload(file, 'config.json', { cert: stranger, key: strangerKeys.privateKeyPem });

    expect(response.status).toBe(401);
    expect(received).toEqual([]);
  }, 30_000);

  it('refuses an upload from a revoked node', async () => {
    const file = path.join(dir, 'small.bin');
    fs.writeFileSync(file, 'x');
    revoked = true;

    const response = await upload(file, 'config.json');

    expect(response.status).toBe(401);
    expect(received).toEqual([]);
  });

  describe('reaching a member at a new address', () => {
    /** A port nothing listens on. */
    async function closedPort(): Promise<number> {
      const probe = net.createServer();
      await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
      const free = (probe.address() as AddressInfo).port;
      await new Promise<void>(resolve => probe.close(() => resolve()));
      return free;
    }

    it('lets a member ask whether it can be reached at an address, only ever about itself', async () => {
      onProbeAddress.mockResolvedValue({ peer: { ok: true }, raft: { ok: true } });

      const response = await peerRequest({
        url: `https://127.0.0.1:${port}/v1/probe-address`,
        method: 'POST',
        body: { nodeId: 'someone-else', peerUrl: 'https://203.0.113.5:4747', raftAddr: '203.0.113.5:4002' },
        ca: caPem,
        ...client
      });

      expect(response).toEqual({ status: 200, body: { peer: { ok: true }, raft: { ok: true } } });
      expect(onProbeAddress).toHaveBeenCalledWith('client', { peerUrl: 'https://203.0.113.5:4747', raftAddr: '203.0.113.5:4002' });
    });

    it('names the machine it finds at an address, by its certificate', async () => {
      await expect(probeTls({ host: '127.0.0.1', port, ca: caPem, ...client })).resolves.toEqual({ commonName: 'server' });
    });

    it('says why nothing could be reached at an address', async () => {
      const probe = await probeTls({ host: '127.0.0.1', port: await closedPort(), ca: caPem, ...client, timeoutMs: 3000 });

      expect(probe.commonName).toBeNull();
      expect(probe.error).toMatch(/refused/i);
    });

    // Last: the server goes on with the new certificate.
    it('presents a certificate put in place to the connections that follow', async () => {
      const keys = generateKeyPair();
      const next = signNodeCertificate(ca.certPem, ca.keyPem, keys.publicKeyPem, 'server-moved', ['127.0.0.1', '203.0.113.5']);

      server.useCertificate(next.certPem, keys.privateKeyPem);

      await expect(probeTls({ host: '127.0.0.1', port, ca: caPem, ...client })).resolves.toEqual({ commonName: 'server-moved' });
    });
  });
});
