import * as https from 'https';
import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { normalizeSerial } from './certificates';
import type { CommandResult, ControlCommand } from '../../types/mesh.types';

export interface JoinRequest {
  token: string;
  nodeName: string;
  publicKeyPem: string;
  raftAddr: string;
  peerUrl: string;
  protocolVersion: number;
}

export interface JoinResponse {
  meshId: string;
  nodeId: string;
  caCert: string;
  nodeCert: string;
  httpAuthUser: string;
  httpAuthPass: string;
  joinUrl: string;
  raftAddr: string;
}

export interface PeerHandlers {
  certPem: string;
  keyPem: string;
  caPem: string;
  isRevoked(serial: string): Promise<boolean>;
  onJoin(body: JoinRequest): Promise<JoinResponse>;
  onCommand(body: ControlCommand): Promise<CommandResult>;
  onHeartbeat(nodeId: string, sentAt: number): void;
  onCheckpoint?(body: { serverId: string; checksum: string; files: Array<{ rel: string; data: string }> }): Promise<{ checksum: string }>;
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
    const tls = req.socket as import('tls').TLSSocket;
    if (!serial || !tls.authorized) {
      socket.close(4001, 'A mesh client certificate is required.');
      return;
    }
    void handlers.isRevoked(serial).then(revoked => {
      if (revoked) socket.close(4001, 'This node certificate has been revoked.');
    });
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('message', raw => {
      try {
        const body = JSON.parse(raw.toString()) as { type?: string; nodeId?: string; sentAt?: number };
        if (body.type === 'heartbeat' && body.nodeId && typeof body.sentAt === 'number') {
          handlers.onHeartbeat(body.nodeId, body.sentAt);
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
    if (req.method === 'POST' && url.pathname === '/v1/join') {
      const body = await readJson<JoinRequest>(req);
      const result = await handlers.onJoin(body);
      send(res, 200, result);
      return;
    }
    const serial = peerSerial(req);
    const socket = req.socket as import('tls').TLSSocket;
    if (!serial || !socket.authorized) {
      send(res, 401, { error: 'A mesh client certificate is required.' });
      return;
    }
    if (await handlers.isRevoked(serial)) {
      send(res, 401, { error: 'This node certificate has been revoked.' });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/command') {
      const body = await readJson<ControlCommand>(req);
      send(res, 200, await handlers.onCommand(body));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/heartbeat') {
      const body = await readJson<{ nodeId: string; sentAt: number }>(req);
      handlers.onHeartbeat(body.nodeId, body.sentAt);
      send(res, 200, { ok: true, now: Date.now() });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/checkpoint' && handlers.onCheckpoint) {
      const body = await readJson<{ serverId: string; checksum: string; files: Array<{ rel: string; data: string }> }>(req);
      send(res, 200, await handlers.onCheckpoint(body));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/health') {
      send(res, 200, { ok: true, now: Date.now() });
      return;
    }
    send(res, 404, { error: 'Not found' });
  } catch (error) {
    send(res, 400, { error: error instanceof Error ? error.message : 'Bad request' });
  }
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
  /** Join only: the joiner does not yet have a certificate to present. */
  insecure?: boolean;
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
      ca: options.ca,
      cert: options.cert,
      key: options.key,
      rejectUnauthorized: !options.insecure,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : undefined
    }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body: unknown = text;
        try { body = text ? JSON.parse(text) : {}; } catch { /* leave text */ }
        resolve({ status: res.statusCode || 0, body });
      });
    });
    req.on('error', reject);
    if (options.timeoutMs) {
      req.setTimeout(options.timeoutMs, () => req.destroy(new Error('The node did not answer in time.')));
    }
    if (payload) req.write(payload);
    req.end();
  });
}
