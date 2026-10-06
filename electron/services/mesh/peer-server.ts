import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { normalizeSerial } from './certificates';
import type { HeldFile } from './checkpoint';
import type { CommandResult, ControlCommand, MeshQuery } from '../../types/mesh.types';

export interface JoinRequest {
  token: string;
  nodeName: string;
  publicKeyPem: string;
  raftAddr: string;
  peerUrl: string;
  protocolVersion: number;
  /** The joiner's existing node id, so Raft and the mesh registry name the same machine. */
  nodeId?: string;
}

export interface JoinResponse {
  meshId: string;
  nodeId: string;
  caCert: string;
  nodeCert: string;
  httpAuthUser: string;
  httpAuthPass: string;
  raftAddr: string;
}

export interface PeerHandlers {
  certPem: string;
  keyPem: string;
  caPem: string;
  /**
   * Whether a certificate the mesh CA signed belongs to a current member: the member named by
   * its node id is recorded with this serial. A certificate minted with the CA key for anyone
   * else, or one that was revoked or replaced, is refused.
   */
  isTrusted(serial: string, nodeId: string): Promise<boolean>;
  onJoin(body: JoinRequest): Promise<JoinResponse>;
  /** A node whose join could not finish asks to be taken back out. The id comes from its certificate. */
  onAbortJoin?(nodeId: string): Promise<void>;
  onCommand(body: ControlCommand): Promise<CommandResult>;
  /** `resources` is as the sender reported it, unchecked. */
  onHeartbeat(nodeId: string, sentAt: number, resources?: unknown): void;
  /** The frames a node that has just subscribed to /v1/events gets first: how things stand now. */
  onSubscribe?(): unknown[];
  /** A read-only question about a server this node hosts. */
  onQuery?(body: { serverId: string; query: MeshQuery; args?: Record<string, unknown> }): Promise<unknown>;
  /**
   * A move's destination: wipe the staging area for this server, or, to carry on an interrupted
   * move, keep it and say what it holds.
   */
  onCheckpointBegin?(body: { serverId: string; resume?: boolean; rels?: string[] }): Promise<HeldFile[] | null | void> | void;
  /** One file of a move, streamed, from byte `offset` of the file. The request body is the rest of it. */
  onCheckpointFile?(serverId: string, rel: string, body: NodeJS.ReadableStream, offset: number): Promise<void>;
  /** All files sent: check them against the list and return their checksum. */
  onCheckpointFinish?(body: { serverId: string; rels: string[] }): Promise<{ checksum: string }>;
}

export interface PeerServer extends https.Server {
  /** Ephemeral status. These frames are not Raft log entries. */
  broadcast(event: unknown): void;
}

/**
 * Node-to-node API. Join is authenticated by the one-time token (the joiner has no certificate
 * yet). Every later call requires a client certificate signed by the mesh CA and not revoked.
 * `/v1/events` is a WebSocket for heartbeats and live status.
 */
export function startPeerServer(port: number, handlers: PeerHandlers): Promise<PeerServer> {
  const server = https.createServer({
    cert: handlers.certPem,
    key: handlers.keyPem,
    ca: handlers.caPem,
    requestCert: true,
    rejectUnauthorized: false
  }, (req, res) => {
    void handle(req, res, handlers);
  }) as PeerServer;
  const sockets = new Set<WebSocket>();
  const events = new WebSocketServer({ server, path: '/v1/events' });
  events.on('connection', (socket, req) => {
    const serial = peerSerial(req);
    const nodeId = peerCommonName(req);
    const tls = req.socket as import('tls').TLSSocket;
    if (!serial || !nodeId || !tls.authorized) {
      socket.close(4001, 'A mesh client certificate is required.');
      return;
    }
    // Joins the broadcast list only once the certificate is known to be a member's.
    void handlers.isTrusted(serial, nodeId).then(trusted => {
      if (!trusted) {
        socket.close(4001, 'This certificate does not belong to a member of the mesh.');
        return;
      }
      if (socket.readyState !== WebSocket.OPEN) return;
      sockets.add(socket);
      for (const frame of handlers.onSubscribe?.() || []) socket.send(JSON.stringify(frame));
    }, () => socket.close(1011, 'Could not check this node certificate.'));
    socket.on('close', () => sockets.delete(socket));
    socket.on('message', raw => {
      try {
        const body = JSON.parse(raw.toString()) as { type?: string; sentAt?: number };
        // A frame on a socket counts only once the certificate is known to be a member's.
        if (body.type === 'heartbeat' && typeof body.sentAt === 'number' && sockets.has(socket)) {
          handlers.onHeartbeat(nodeId, body.sentAt);
        }
      } catch {
        /* ignore a malformed status frame */
      }
    });
  });
  server.broadcast = event => {
    const payload = JSON.stringify(event);
    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN) socket.send(payload);
    }
  };
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve(server));
  });
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse, handlers: PeerHandlers): Promise<void> {
  try {
    const url = new URL(req.url || '/', 'https://mesh.local');
    // Public: a joining node compares this CA with the fingerprint in its token before it sends the token.
    if (req.method === 'GET' && url.pathname === '/v1/ca') {
      send(res, 200, { caCert: handlers.caPem });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/join') {
      const body = await readJson<JoinRequest>(req);
      const result = await handlers.onJoin(body);
      send(res, 200, result);
      return;
    }
    const serial = peerSerial(req);
    const nodeId = peerCommonName(req);
    const socket = req.socket as import('tls').TLSSocket;
    if (!serial || !nodeId || !socket.authorized) {
      refuse(req, res, 'A mesh client certificate is required.');
      return;
    }
    if (!await handlers.isTrusted(serial, nodeId)) {
      refuse(req, res, 'This certificate does not belong to a member of the mesh.');
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/abort-join' && handlers.onAbortJoin) {
      req.resume();
      await handlers.onAbortJoin(nodeId);
      send(res, 200, { ok: true });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/command') {
      const body = await readJson<ControlCommand>(req);
      send(res, 200, await handlers.onCommand(body));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/query' && handlers.onQuery) {
      send(res, 200, await handlers.onQuery(await readJson<{ serverId: string; query: MeshQuery; args?: Record<string, unknown> }>(req)));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/heartbeat') {
      // From the node its certificate names, whatever the body says: one member must not be
      // able to report another as up, or report its resources.
      const body = await readJson<{ sentAt: number; resources?: unknown }>(req);
      handlers.onHeartbeat(nodeId, body.sentAt, body.resources);
      send(res, 200, { ok: true, now: Date.now() });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/checkpoint/begin' && handlers.onCheckpointBegin) {
      const held = await handlers.onCheckpointBegin(await readJson<{ serverId: string; resume?: boolean; rels?: string[] }>(req));
      // An older source never asks to resume, and an older destination never answers with this.
      send(res, 200, held ? { ok: true, held } : { ok: true });
      return;
    }
    if (req.method === 'PUT' && url.pathname === '/v1/checkpoint/file' && handlers.onCheckpointFile) {
      const offset = Number(url.searchParams.get('offset') ?? 0);
      if (!Number.isInteger(offset) || offset < 0) {
        req.resume();
        send(res, 400, { error: 'A file can only be carried on from a whole byte.' });
        return;
      }
      await handlers.onCheckpointFile(url.searchParams.get('serverId') || '', url.searchParams.get('rel') || '', req, offset);
      send(res, 200, { ok: true });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/checkpoint/finish' && handlers.onCheckpointFinish) {
      send(res, 200, await handlers.onCheckpointFinish(await readJson<{ serverId: string; rels: string[] }>(req)));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/health') {
      send(res, 200, { ok: true, now: Date.now() });
      return;
    }
    send(res, 404, { error: 'Not found' });
  } catch (error) {
    // A handler can name the status, such as 409 when a carried-on file no longer matches.
    const status = (error as { statusCode?: unknown } | null)?.statusCode;
    send(res, typeof status === 'number' ? status : 400, { error: error instanceof Error ? error.message : 'Bad request' });
  }
}

/** Answers 401 and discards whatever body the caller is still sending. */
function refuse(req: http.IncomingMessage, res: http.ServerResponse, error: string): void {
  req.resume();
  send(res, 401, { error });
}

/** The node id a peer's certificate names. Mesh certificates carry it as the common name. */
function peerCommonName(req: http.IncomingMessage): string | null {
  const cert = (req.socket as import('tls').TLSSocket).getPeerCertificate?.();
  const name = cert?.subject?.CN;
  return typeof name === 'string' && name ? name : null;
}

function peerSerial(req: http.IncomingMessage): string | null {
  const cert = (req.socket as import('tls').TLSSocket).getPeerCertificate?.();
  if (!cert || !cert.serialNumber) return null;
  return normalizeSerial(cert.serialNumber);
}

function readJson<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
      } catch {
        reject(new Error('Expected JSON'));
      }
    });
    req.on('error', reject);
  });
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

export function peerRequest(options: {
  url: string;
  method: 'GET' | 'POST';
  body?: unknown;
  ca?: string;
  cert?: string;
  key?: string;
  timeoutMs?: number;
  /** Only to fetch a member's CA before joining; nothing secret is sent that way. */
  insecure?: boolean;
  /**
   * Trust only this CA, and accept any host name it signed for: a member may be reached under
   * a proxy's name or an overlay address its certificate does not list.
   */
  pinnedCa?: string;
}): Promise<{ status: number; body: unknown }> {
  const target = new URL(options.url);
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: options.method,
      ca: options.pinnedCa ?? options.ca,
      cert: options.cert,
      key: options.key,
      rejectUnauthorized: !options.insecure,
      ...(options.pinnedCa ? { checkServerIdentity: () => undefined } : {}),
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : undefined
    }, res => readResponse(res, resolve));
    req.on('error', reject);
    if (options.timeoutMs) {
      req.setTimeout(options.timeoutMs, () => req.destroy(new Error('The node did not answer in time.')));
    }
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Streams a file to a peer with PUT, over the same mTLS as peerRequest. Memory use does not
 * grow with the file, so a large world save moves like a small one.
 */
export function peerUpload(options: {
  url: string;
  file: string;
  /** The byte to start from, when the peer already holds the file up to it. */
  start?: number;
  /** Hears each chunk as it is read for sending, in bytes. */
  onProgress?: (bytes: number) => void;
  ca?: string;
  cert?: string;
  key?: string;
  timeoutMs?: number;
}): Promise<{ status: number; body: unknown }> {
  const target = new URL(options.url);
  const start = options.start ?? 0;
  const size = Math.max(0, fs.statSync(options.file).size - start);
  return new Promise((resolve, reject) => {
    let answered = false;
    const req = https.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: 'PUT',
      ca: options.ca,
      cert: options.cert,
      key: options.key,
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': size }
    }, res => {
      answered = true;
      readResponse(res, resolve);
    });
    // A peer that refuses the upload answers before reading it; the broken pipe after that is expected.
    req.on('error', error => { if (!answered) reject(error); });
    if (options.timeoutMs) {
      req.setTimeout(options.timeoutMs, () => req.destroy(new Error('The node did not answer in time.')));
    }
    const source = fs.createReadStream(options.file, { start });
    source.on('error', error => req.destroy(error));
    if (options.onProgress) source.on('data', chunk => options.onProgress!(chunk.length));
    source.pipe(req);
  });
}

/**
 * Subscribes to another node's /v1/events with this node's certificate. Frames arrive as parsed
 * JSON. The caller re-subscribes after onClose; nothing here reconnects on its own.
 */
export function subscribeEvents(options: {
  url: string;
  ca?: string;
  cert?: string;
  key?: string;
  onEvent(event: unknown): void;
  onOpen?(): void;
  onClose?(code: number): void;
}): { close(): void } {
  const socket = new WebSocket(options.url, { ca: options.ca, cert: options.cert, key: options.key });
  socket.on('open', () => options.onOpen?.());
  socket.on('message', raw => {
    try {
      options.onEvent(JSON.parse(raw.toString()));
    } catch {
      /* ignore a malformed frame */
    }
  });
  socket.on('close', code => options.onClose?.(code));
  socket.on('error', () => { /* 'close' follows */ });
  return { close: () => socket.close() };
}

function readResponse(res: http.IncomingMessage, resolve: (value: { status: number; body: unknown }) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  res.on('end', () => {
    const text = Buffer.concat(chunks).toString('utf8');
    let body: unknown = text;
    try { body = text ? JSON.parse(text) : {}; } catch { /* leave text */ }
    resolve({ status: res.statusCode || 0, body });
  });
}
