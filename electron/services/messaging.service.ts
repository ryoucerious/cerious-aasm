


import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import type { Server as HttpServer } from 'http';

// Use CommonJS require for WebSocketServer to avoid TS type import issues
const WebSocketServer = require('ws').Server;

let ipcMain: typeof import('electron').ipcMain | undefined;
let BrowserWindow: typeof import('electron').BrowserWindow | undefined;

// Check if we're in the main Electron process (not a forked child process)
const isMainElectronProcess = !!(process && process.versions && process.versions.electron && !process.env.ELECTRON_RUN_AS_NODE);
if (isMainElectronProcess) {
  try {
    // Note: Using require() for conditional loading in different process contexts
    ({ ipcMain, BrowserWindow } = require('electron'));
  } catch (error) {
    console.warn('[MessagingService] Failed to import electron:', error);
  }
}

export class MessagingService extends EventEmitter {
  private wsServer: any = null;
  private webContentsList: Set<any> = new Set();

  // Public getters for handler access
  public getWebContentsList() {
    return this.webContentsList;
  }
  public getWsServer() {
    return this.wsServer;
  }

  constructor() {
    super();
  }

  private apiProcess: any = null;

  /**
   * Set the child process used for web client broadcasts.
   * @param apiProcess - The child process running the API server
   */
  setApiProcess(apiProcess: any) {
    this.apiProcess = apiProcess;
  }

  /**
   * Emit an event to all listeners, refusing it if the sender may not use that channel.
   *
   * This is the app's authorization boundary: the web UI can reach every channel over the
   * WebSocket, so the check has to live where all of them converge rather than in each
   * handler. A call with no sender comes from main-process code itself and is trusted.
   *
   * @param event - The event name
   * @param args - The event arguments; [payload, sender] by convention
   * @returns True if the event had listeners, false otherwise
   */
  emit(event: string, ...args: any[]): boolean {
    const [payload, sender] = args;

    if (sender) {
      const { authorizeChannel } = require('./auth/permission-gate');
      const decision = authorizeChannel(event, sender);
      if (!decision.allowed) {
        console.warn(`[messaging] Refused "${event}": ${decision.error}`);
        this.sendToOriginator(event, {
          success: false,
          error: decision.error,
          forbidden: true,
          requestId: payload?.requestId
        }, sender);
        return false;
      }
    }

    // Record who asked for what. This runs after authorization, so a refused call is never
    // credited to anyone, and only for messages that carry a sender (real clients).
    if (sender) {
      try {
        const { identifySender } = require('./auth/permission-gate');
        const { activityLogService } = require('./activity-log.service');
        activityLogService.noteAction(event, payload, identifySender(sender).user?.username || null);
      } catch {
        // The feed is a convenience; never let it stop a message.
      }
    }

    return super.emit(event, ...args);
  }

  /**
   * Ask the web server to drop sessions whose rights just changed, so a demoted or deleted
   * user stops acting with their old permissions immediately rather than at next sign-in.
   */
  invalidateWebSessions(filter: { userId?: string; roleId?: string }) {
    this.apiProcess?.send?.({ type: 'invalidate-sessions', ...filter });
  }

  /**
   * Add a webContents instance for IPC messaging.
   * @param webContents - The webContents to add for IPC messaging
   */
  addWebContents(webContents: any) {
    this.webContentsList.add(webContents);
    
    // Remove when destroyed
    webContents.on('destroyed', () => {
      this.webContentsList.delete(webContents);
    });
  }

  /**
   * Attach a WebSocket server to the HTTP server.
   * @param httpServer - The HTTP server to attach the WebSocket server to
   */
  /**
   * Resolves the account behind a WebSocket handshake. Installed by the web server child,
   * which owns the session store; unset in the main process, where no sockets are accepted.
   */
  public resolveSocketUser: ((request: any) => { user: any; authEnabled: boolean; allowed: boolean }) | null = null;

  attachWebSocketServer(httpServer: HttpServer) {
    this.wsServer = new WebSocketServer({ server: httpServer, path: '/ws' });
    this.wsServer.on('connection', (ws: any, request: any) => {
      ws._cid = randomUUID(); // assign a unique client id

      // Resolve the account from the session cookie. The socket never passes through
      // Express, so this is the only place a web client's identity can be established;
      // without it every message would arrive anonymous and be refused.
      const resolved = this.resolveSocketUser ? this.resolveSocketUser(request) : null;
      ws._authEnabled = resolved ? resolved.authEnabled : false;
      ws._user = resolved ? resolved.user : null;

      if (resolved && !resolved.allowed) {
        ws.send(JSON.stringify({ channel: 'unauthorized', error: 'Sign in to use this connection.' }));
        ws.close(4401, 'Unauthorized');
        return;
      }

      ws.send(JSON.stringify({ channel: 'welcome', cid: ws._cid }));
      ws.on('message', (data: any) => {
        try {
          const { channel, payload } = JSON.parse(data.toString());
          // Proxy all messages to Electron main process via IPC
          if (typeof process !== 'undefined' && typeof process.send === 'function') {
            process.send({
              type: 'messaging-event',
              channel,
              payload,
              cid: ws._cid,
              user: ws._user || null,
              authEnabled: ws._authEnabled !== false
            });
          } else {
            // Fallback: handle locally (for main process or test)
            this.handleMessage(channel, payload, ws).then((response) => {
              ws.send(JSON.stringify({ channel, response }));
            });
          }
        } catch (err) {
          // Ignore JSON parse errors
        }
      });
      ws.on('close', () => {});
      ws.on('error', (err: any) => {});
    });
  }

  /**
   * Send a message to one web client by its connection id, falling back to a broadcast when
   * the id is unknown — the HTTP /api/message route carries no id, so its replies still
   * have to reach everyone.
   * @param cid - The connection id of the intended recipient
   * @param channel - The channel to send on
   * @param data - The message data
   */
  sendToWebSocket(cid: string | undefined, channel: string, data: any) {
    if (!cid || !this.wsServer) {
      this.sendToAllWebSockets(channel, data);
      return;
    }
    // Same envelope the broadcast uses; the client reads `data`, so anything else is
    // silently dropped and the caller waits out its timeout.
    const message = JSON.stringify({ channel, data });
    let delivered = false;
    this.wsServer.clients.forEach((client: any) => {
      if (client.readyState === 1 && client._cid === cid) {
        client.send(message);
        delivered = true;
      }
    });
    if (!delivered) {
      // The client disconnected between asking and being answered; nothing to do.
      console.debug(`[messaging] No socket for cid ${cid}; dropping "${channel}" reply.`);
    }
  }

  /**
   * Handle incoming messages from clients.
   * @param channel - The channel the message was sent on
   * @param payload - The message payload
   * @param sender - The sender of the message
   * @returns A promise resolving to the response
   */
  async handleMessage(channel: string, payload: any, sender: any) {
    // Emit for listeners in main process with sender context
    this.emit(channel, payload, sender);
    // Optionally, handle and return a response
    return { status: 'received', channel, payload };
  }

  /**
   * Send a message to the originator of an event.
   * @param channel - The channel to send the message on
   * @param data - The message data
   * @param sender - The sender of the message
   */
  sendToOriginator(channel: string, data: any, sender: any) {
    if (sender && typeof sender.send === 'function') {
      // Electron IPC sender
      sender.send(channel, data);
    } else {
      // No valid sender (web API) - send to all WebSocket clients
      this.sendToAllWebSockets(channel, data);
    }
  }

  /**
   * Broadcast a message to all connected web clients via the API process.
   * @param channel - The channel to broadcast on
   * @param data - The message data
   * @param excludeCid - Optional client ID to exclude from the broadcast
   */
  broadcastToWebClients(channel: string, data: any, excludeCid?: string) {
    if (this.apiProcess) {
      this.apiProcess.send({ type: 'broadcast-web', channel, data, excludeCid });
    }
  }

  /**
   * Send a message to all renderer processes.
   * @param channel - The channel to send on
   * @param data - The message data
   */
  sendToAllRenderers(channel: string, data: any) {
    for (const wc of this.webContentsList) {
      if (wc && typeof wc.send === 'function') {
        wc.send(channel, data);
      }
    }
  }

  /**
   * Send a message to all WebSocket clients.
   * @param channel - The channel to send on
   * @param data - The message data
   * @param excludeCid - Optional client ID to exclude from the broadcast
   */
  sendToAllWebSockets(channel: string, data: any, excludeCid?: string) {
    if (!this.wsServer) {
      return;
    }
    let sent = 0;
    const clients = Array.from(this.wsServer.clients).filter((client: any) => client.readyState === WebSocket.OPEN);
    clients.forEach((client: any) => {
      if (excludeCid && client._cid === excludeCid) return;
      client.send(JSON.stringify({ channel, data }));
      sent++;
    });
  }

  /**
   * Send a message to all connected clients.
   * @param channel - The channel to send on
   * @param data - The message data
   */
  sendToAll(channel: string, data: any) {
    // The activity feed is built from the events the app already broadcasts, so this is the
    // one place it needs to observe. It ignores everything except the handful it records.
    try {
      const { activityLogService } = require('./activity-log.service');
      activityLogService.recordFromBroadcast(channel, data);
    } catch {
      // The feed is a convenience; a failure here must never stop a broadcast.
    }
    this.sendToAllRenderers(channel, data);
    this.broadcastToWebClients(channel, data);
  }

   /**
   * Send a message to all renderers and web clients except the sender.
   * @param channel The channel to send on
   * @param data The data to send
   * @param sender The sender to exclude (webContents or WebSocket)
   */
  sendToAllOthers(channel: string, data: any, sender: any) {
    // Exclude sender renderer if sender is a renderer
    if (sender && typeof sender.send === 'function' && this.webContentsList.has(sender)) {
      for (const wc of this.webContentsList) {
        if (wc && typeof wc.send === 'function' && wc !== sender) {
          wc.send(channel, data);
        }
      }
    } else {
      for (const wc of this.webContentsList) {
        if (wc && typeof wc.send === 'function') {
          wc.send(channel, data);
        }
      }
    }

    // Exclude sender WebSocket client if sender has a cid (ws._cid or sender.cid)
    let excludeCid = undefined;
    if (sender && sender._cid) {
      excludeCid = sender._cid;
    } else if (sender && sender.cid) {
      excludeCid = sender.cid;
    }
    this.sendToAllWebSockets(channel, data, excludeCid);
    this.broadcastToWebClients(channel, data, excludeCid);
  }
}


export const messagingService = new MessagingService();