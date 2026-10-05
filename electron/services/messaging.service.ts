import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type { ChildProcess } from 'child_process';
import type { IncomingMessage, Server as HttpServer } from 'http';
import type { WebContents } from 'electron';
import { RawData, WebSocket, WebSocketServer } from 'ws';
import { authorizeChannel, identifySender } from './auth/permission-gate';
import { LEGACY_ADMIN_ID } from '../types/auth.types';
import {
  ApiProcessSender,
  BroadcastAudience,
  ChildToMainMessage,
  MainToChildMessage,
  MessageSender,
  SOCKET_CLOSE,
  SocketIdentity,
  WebSocketClient
} from '../types/messaging.types';

/** The activity feed's view of the bus. Set from main only, so its database never loads in the web server child. */
export interface BusObserver {
  noteAction(channel: string, payload: unknown, username: string | null): void;
  recordFromBroadcast(channel: string, data: unknown): void;
}

type Socket = WebSocket & WebSocketClient;

/** Narrows one broadcast to the views each pool may see; see auth/pool-broadcast. */
export type BroadcastScoper = (channel: string, data: unknown) => Array<{ data: unknown; audience?: BroadcastAudience }>;

const SESSION_SWEEP_MS = 60_000;
// Bounds the memory a stream of made-up origins can take; past it refusals are no longer logged.
const MAX_LOGGED_REFUSALS = 50;

export class MessagingService extends EventEmitter {
  private wsServer: WebSocketServer | null = null;
  private readonly webContentsList = new Set<WebContents>();
  private apiProcess: ChildProcess | null = null;
  private observer: BusObserver | null = null;
  private sessionSweep: NodeJS.Timeout | null = null;
  private readonly loggedRefusals = new Set<string>();

  /**
   * Resolves the account behind a WebSocket handshake. Installed by the web server child, which
   * owns the session store; unset in the main process, where no sockets are accepted.
   */
  resolveSocketUser: ((request: IncomingMessage) => SocketIdentity) | null = null;

  /**
   * Whether a socket's session still exists (not expired, signed out or dropped). Installed by the
   * web server child; the account behind a socket is only checked again when a message arrives.
   */
  isSessionLive: ((token: string) => boolean) | null = null;

  /**
   * Decides which web clients a broadcast is for. Installed by main, which owns the user
   * database; unset in the web server child, which only matches sockets against the audience.
   */
  scopeBroadcast: BroadcastScoper | null = null;

  /** The web server child that relays web clients, or null while it is not running. */
  setApiProcess(child: ChildProcess | null): void {
    this.apiProcess = child;
  }

  getApiProcess(): ChildProcess | null {
    return this.apiProcess;
  }

  setObserver(observer: BusObserver | null): void {
    this.observer = observer;
  }

  /**
   * Emit an event to all listeners, refusing it if the sender may not use that channel.
   *
   * This is the app's authorization boundary: the web UI can reach every channel over the
   * WebSocket, so the check has to live where all of them converge rather than in each
   * handler. A call with no sender comes from main-process code itself and is trusted.
   */
  emit(event: string, ...args: unknown[]): boolean {
    const [payload, sender] = args as [unknown, MessageSender];

    if (sender) {
      const decision = authorizeChannel(event, sender, payload);
      if (!decision.allowed) {
        console.warn(`[messaging] Refused "${event}": ${decision.error}`);
        this.sendToOriginator(event, {
          success: false,
          error: decision.error,
          forbidden: true,
          requestId: (payload as { requestId?: unknown } | null)?.requestId
        }, sender);
        return false;
      }
      // After authorization, so a refused call is never credited to anyone.
      this.notifyObserver(observer => observer.noteAction(event, payload, identifySender(sender).user?.username || null));
    }

    return super.emit(event, ...args);
  }

  /**
   * Ask the web server to drop sessions whose rights just changed, so a demoted or deleted
   * user stops acting with their old permissions immediately rather than at next sign-in.
   */
  invalidateWebSessions(filter: { userId?: string; roleId?: string }): void {
    this.sendToChild({ type: 'invalidate-sessions', ...filter });
  }

  addWebContents(webContents: WebContents): void {
    this.webContentsList.add(webContents);
    webContents.on('destroyed', () => {
      this.webContentsList.delete(webContents);
    });
  }

  attachWebSocketServer(httpServer: HttpServer): void {
    this.wsServer = new WebSocketServer({
      server: httpServer,
      path: '/ws',
      verifyClient: ({ req }: { req: IncomingMessage }) => this.verifyUpgrade(req)
    });
    this.wsServer.on('connection', (ws: Socket, request: IncomingMessage) => this.acceptSocket(ws, request));
    // ws re-emits the HTTP server's errors here (EADDRINUSE among them); unheard, one would be
    // thrown and kill the child after it has already reported the failure.
    this.wsServer.on('error', (error: Error) => {
      console.error('[messaging] WebSocket server error:', error.message);
    });

    // A session is otherwise only checked when its socket sends something, so an idle socket
    // would keep receiving broadcasts long after the session expired or was signed out.
    this.stopSessionSweep();
    this.sessionSweep = setInterval(() => this.closeEndedSessions(), SESSION_SWEEP_MS);
    this.sessionSweep.unref();
    this.wsServer.on('close', () => this.stopSessionSweep());
  }

  private verifyUpgrade(request: IncomingMessage): boolean {
    if (isSameOriginUpgrade(request)) return true;
    const { origin, host } = request.headers;
    const key = `${origin} ${host}`;
    if (!this.loggedRefusals.has(key) && this.loggedRefusals.size < MAX_LOGGED_REFUSALS) {
      this.loggedRefusals.add(key);
      console.warn(`[messaging] Refused a WebSocket from origin "${origin}" to host "${host ?? ''}". ` +
        'A reverse proxy must pass the Host header or set X-Forwarded-Host.');
    }
    return false;
  }

  private closeEndedSessions(): void {
    const isSessionLive = this.isSessionLive;
    if (!isSessionLive) return;
    this.closeWebSockets(SOCKET_CLOSE.UNAUTHORIZED, 'Session ended',
      socket => !!socket._sessionToken && !isSessionLive(socket._sessionToken));
  }

  private stopSessionSweep(): void {
    if (this.sessionSweep) {
      clearInterval(this.sessionSweep);
      this.sessionSweep = null;
    }
  }

  private acceptSocket(ws: Socket, request: IncomingMessage): void {
    ws._cid = randomUUID();

    // The socket never passes through Express, so this is the only place a web client's
    // identity can be established. Without a resolver nobody can vouch for it: refuse.
    const identity = this.resolveSocketUser?.(request) ?? { user: null, authEnabled: true, allowed: false };
    ws._authEnabled = identity.authEnabled;
    ws._user = identity.user;
    ws._sessionToken = identity.sessionToken;

    if (!identity.allowed) {
      ws.send(JSON.stringify({ channel: 'unauthorized', error: 'Sign in to use this connection.' }));
      ws.close(SOCKET_CLOSE.UNAUTHORIZED, 'Unauthorized');
      return;
    }

    ws.send(JSON.stringify({ channel: 'welcome', cid: ws._cid }));
    ws.on('message', (data: RawData) => this.relayToMain(ws, data));
    // An 'error' event without a listener is thrown, and would take the web server down.
    ws.on('error', () => {});
  }

  private relayToMain(ws: Socket, data: RawData): void {
    let message: { channel?: unknown; payload?: unknown } | null;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (typeof message?.channel !== 'string' || typeof process.send !== 'function') {
      return;
    }
    if (ws._sessionToken && this.isSessionLive?.(ws._sessionToken) === false) {
      ws.close(SOCKET_CLOSE.UNAUTHORIZED, 'Session ended');
      return;
    }
    const event: ChildToMainMessage = {
      type: 'messaging-event',
      channel: message.channel,
      payload: message.payload,
      cid: ws._cid,
      user: ws._user || null,
      authEnabled: ws._authEnabled !== false
    };
    process.send(event);
  }

  /** Send to the one web client with this connection id; without a match the reply is dropped. */
  sendToWebSocket(cid: string | undefined, channel: string, data: unknown): void {
    const client = cid ? this.openSockets().find(socket => socket._cid === cid) : undefined;
    if (!client) {
      // The client disconnected before its answer arrived, or never had an id. A broadcast
      // would hand one client's reply to all of them.
      console.debug(`[messaging] No socket for cid ${cid}; dropping "${channel}" reply.`);
      return;
    }
    client.send(JSON.stringify({ channel, data }));
  }

  /** Close the open sockets that `matches` selects (all by default). Returns how many were closed. */
  closeWebSockets(code: number, reason: string, matches: (client: WebSocketClient) => boolean = () => true): number {
    const doomed = this.openSockets().filter(matches);
    for (const client of doomed) {
      client.close(code, reason);
    }
    return doomed.length;
  }

  /** Reply to whoever sent a message. With no sender (main-process code) there is nobody to answer. */
  sendToOriginator(channel: string, data: unknown, sender: MessageSender): void {
    if (!sender) {
      console.debug(`[messaging] No sender for "${channel}"; dropping the reply.`);
      return;
    }
    if (isWebSocketClient(sender)) {
      sender.send(JSON.stringify({ channel, data }));
      return;
    }
    sender.send(channel, data);
  }

  broadcastToWebClients(channel: string, data: unknown, excludeCid?: string): void {
    const views = this.scopeBroadcast ? this.scopeBroadcast(channel, data) : [{ data }];
    for (const view of views) {
      this.sendToChild({ type: 'broadcast-web', channel, data: view.data, excludeCid, audience: view.audience });
    }
  }

  sendToAllRenderers(channel: string, data: unknown): void {
    for (const webContents of this.webContentsList) {
      webContents.send(channel, data);
    }
  }

  sendToAllWebSockets(channel: string, data: unknown, excludeCid?: string, audience?: BroadcastAudience): void {
    const message = JSON.stringify({ channel, data });
    for (const client of this.openSockets()) {
      if (excludeCid && client._cid === excludeCid) continue;
      if (audience && !inAudience(client, audience)) continue;
      client.send(message);
    }
  }

  sendToAll(channel: string, data: unknown): void {
    // The activity feed is built from the events the app already broadcasts, so this is the
    // one place it needs to observe.
    this.notifyObserver(observer => observer.recordFromBroadcast(channel, data));
    this.sendToAllRenderers(channel, data);
    this.broadcastToWebClients(channel, data);
  }

  /** Send to every renderer and web client except the sender. */
  sendToAllOthers(channel: string, data: unknown, sender: MessageSender): void {
    for (const webContents of this.webContentsList) {
      if (webContents !== sender) {
        webContents.send(channel, data);
      }
    }
    const excludeCid = senderCid(sender);
    this.sendToAllWebSockets(channel, data, excludeCid);
    this.broadcastToWebClients(channel, data, excludeCid);
  }

  private sendToChild(message: MainToChildMessage): void {
    if (this.apiProcess?.connected) {
      this.apiProcess.send(message);
    }
  }

  private openSockets(): Socket[] {
    if (!this.wsServer) return [];
    return Array.from(this.wsServer.clients as Set<Socket>).filter(client => client.readyState === WebSocket.OPEN);
  }

  private notifyObserver(call: (observer: BusObserver) => void): void {
    if (!this.observer) return;
    try {
      call(this.observer);
    } catch (error) {
      // The feed is a convenience; it must never stop a message.
      console.debug('[messaging] Activity feed failed:', error);
    }
  }
}

/**
 * Refuses a browser upgrade whose Origin names another host, so a page the operator happens to
 * visit cannot drive the socket (with authentication off it would act as the desktop owner).
 * No Origin means a non-browser client, which the session cookie still gates. X-Forwarded-Host
 * covers a reverse proxy that rewrites Host; a page cannot set that header on a WebSocket.
 */
export function isSameOriginUpgrade(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  const forwarded = request.headers['x-forwarded-host'];
  const forwardedHost = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0].trim();
  return [request.headers.host, forwardedHost].some(host => !!host && hostMatches(originUrl, host));
}

// Parsing the Host value under the origin's scheme normalises case and default ports alike.
function hostMatches(origin: URL, host: string): boolean {
  try {
    return new URL(`${origin.protocol}//${host}`).host === origin.host;
  } catch {
    return false;
  }
}

/** A socket with no account was opened with authentication off; the legacy login acts as admin. */
function inAudience(client: WebSocketClient, audience: BroadcastAudience): boolean {
  const user = client._user;
  if (!user || user.id === LEGACY_ADMIN_ID) return audience.owners;
  return audience.userIds.includes(user.id);
}

function isWebSocketClient(sender: NonNullable<MessageSender>): sender is WebSocketClient {
  return 'readyState' in sender;
}

function senderCid(sender: MessageSender): string | undefined {
  if (!sender) return undefined;
  if (isWebSocketClient(sender)) return sender._cid;
  return (sender as ApiProcessSender).type === 'api-process' ? (sender as ApiProcessSender).cid : undefined;
}

export const messagingService = new MessagingService();
