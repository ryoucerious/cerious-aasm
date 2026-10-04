import type { Socket } from 'net';
import Rcon from 'rcon';
import { parsePort } from './validation.utils';

/** How long a command may wait, queued or in flight, before it rejects. */
export const DEFAULT_RCON_COMMAND_TIMEOUT_MS = 30000;

/** A command that failed before it was written to the socket, so the server never saw it. */
export class RconCommandNotSentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RconCommandNotSentError';
  }
}

// IPv4 loopback: on Linux 'localhost' can resolve to ::1, which ARK under Wine does not bind.
const RCON_HOST = '127.0.0.1';
const DEFAULT_RCON_PORT = 27020;
// 30 attempts x 3 s = a 90 s window. ARK under Proton can take 60+ s after the "advertising" log
// line before the RCON port is actually bound.
const MAX_CONNECT_ATTEMPTS = 30;
const RETRY_DELAY_MS = 3000;
// node-rcon's error for a password the server rejected. Retrying cannot fix it.
const AUTH_FAILED = 'Authentication failed';

export interface RconConfig {
  rconPort?: unknown;
  rconPassword?: unknown;
  serverAdminPassword?: unknown;
}

interface Connection {
  client: Rcon;
  /** Fails the command waiting on this client, if there is one. */
  abort?: (reason: Error) => void;
}

/** One per instance: later connect requests join it instead of starting a second chain. */
interface ConnectLoop {
  port: number;
  password: string;
  maxAttempts: number;
  cancelled: boolean;
  client?: Rcon;
  retryTimer?: NodeJS.Timeout;
  callbacks: Array<(connected: boolean) => void>;
}

const connections = new Map<string, Connection>();
const connectLoops = new Map<string, ConnectLoop>();
// Commands run one at a time per instance: node-rcon tags every packet with the same id, so a
// response cannot be matched to anything but the single command in flight.
const commandQueues = new Map<string, Promise<void>>();

/** ARK authenticates RCON with ServerAdminPassword; older configs only carry rconPassword. */
export function getRconPassword(config: RconConfig): string {
  return String(config.serverAdminPassword || config.rconPassword || '');
}

/**
 * Connects RCON for an instance, retrying every 3 s (up to `maxAttempts`) while the server brings
 * its port up. `onStatus` is always called once.
 */
export function connectRcon(
  instanceId: string,
  config: RconConfig,
  onStatus?: (connected: boolean) => void,
  maxAttempts = MAX_CONNECT_ATTEMPTS
): void {
  const report = onStatus ?? (() => undefined);
  if (connections.has(instanceId)) {
    report(true);
    return;
  }
  const running = connectLoops.get(instanceId);
  if (running) {
    running.callbacks.push(report);
    return;
  }

  const port = config.rconPort ? parsePort(config.rconPort) : DEFAULT_RCON_PORT;
  if (port === undefined) {
    console.error(`[rcon] ${instanceId} has an invalid RCON port: ${String(config.rconPort)}`);
    report(false);
    return;
  }
  const password = getRconPassword(config);
  if (!password) {
    console.error(`[rcon] No admin password configured for ${instanceId}; authentication will fail`);
  }

  const loop: ConnectLoop = { port, password, maxAttempts, cancelled: false, callbacks: [report] };
  connectLoops.set(instanceId, loop);
  tryConnect(instanceId, loop, 1);
}

function tryConnect(instanceId: string, loop: ConnectLoop, attempt: number): void {
  if (loop.cancelled) return;

  const client = new Rcon(RCON_HOST, loop.port, loop.password);
  loop.client = client;
  let settled = false;

  // False when this attempt already settled or the connect was cancelled.
  const settle = (): boolean => {
    if (settled) return false;
    settled = true;
    loop.client = undefined;
    return !loop.cancelled;
  };

  const fail = (reason: string) => {
    const proceed = settle();
    destroyClient(client);
    if (!proceed) return;
    if (reason === AUTH_FAILED) {
      console.error(`[rcon] ${instanceId} rejected the admin password`);
      finishLoop(instanceId, loop, false);
      return;
    }
    if (attempt >= loop.maxAttempts) {
      console.warn(`[rcon] Gave up connecting to ${instanceId} after ${attempt} attempt(s): ${reason}`);
      finishLoop(instanceId, loop, false);
      return;
    }
    // The first and every fifth attempt only, while the server is still starting.
    if (attempt === 1 || attempt % 5 === 0) {
      console.log(`[rcon] Waiting for ${instanceId} (attempt ${attempt}/${loop.maxAttempts}): ${reason}`);
    }
    loop.retryTimer = setTimeout(() => tryConnect(instanceId, loop, attempt + 1), RETRY_DELAY_MS);
  };

  client.on('auth', () => {
    if (!settle()) {
      destroyClient(client);
      return;
    }
    adoptClient(instanceId, client);
    finishLoop(instanceId, loop, true);
  });
  client.on('error', (error: NodeJS.ErrnoException) => fail(error.code || error.message));
  client.on('end', () => fail('connection closed'));
  try {
    client.connect();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function finishLoop(instanceId: string, loop: ConnectLoop, connected: boolean): void {
  if (connectLoops.get(instanceId) === loop) connectLoops.delete(instanceId);
  for (const callback of loop.callbacks.splice(0)) {
    try {
      callback(connected);
    } catch (error) {
      console.error(`[rcon] Connect callback for ${instanceId} failed:`, error);
    }
  }
}

function adoptClient(instanceId: string, client: Rcon): void {
  const connection: Connection = { client };
  client.removeAllListeners();
  client.on('error', (error: Error) => dropConnection(instanceId, connection, error));
  client.on('end', () => dropConnection(instanceId, connection, new Error('RCON connection closed before response')));
  connections.set(instanceId, connection);
}

function dropConnection(instanceId: string, connection: Connection, reason: Error): void {
  if (connections.get(instanceId) !== connection) return;
  connections.delete(instanceId);
  connection.abort?.(reason);
  destroyClient(connection.client);
}

function destroyClient(client: Rcon): void {
  client.removeAllListeners();
  // node-rcon re-emits socket errors; without a listener a late one would throw in the main process.
  client.on('error', () => undefined);
  try {
    client.disconnect();
  } catch {
    // Socket never opened
  }
  // node-rcon has no destroy(), and disconnect() only half-closes: a hung server would keep it open.
  (client as unknown as { _tcpSocket?: Socket })._tcpSocket?.destroy();
}

export function disconnectRcon(instanceId: string): void {
  const loop = connectLoops.get(instanceId);
  if (loop) {
    loop.cancelled = true;
    clearTimeout(loop.retryTimer);
    if (loop.client) destroyClient(loop.client);
    finishLoop(instanceId, loop, false);
  }
  const connection = connections.get(instanceId);
  if (connection) {
    dropConnection(instanceId, connection, new Error('RCON connection closed before response'));
  }
}

/**
 * Sends a command once the ones queued before it have finished. Rejects when the connection drops
 * or `timeoutMs` passes (queued time included), with RconCommandNotSentError if it never went out.
 * A timeout on a sent command drops the connection: a server that stopped answering keeps its
 * socket open, and dropping it lets polling reconnect.
 */
export function sendRconCommand(
  instanceId: string,
  command: string,
  timeoutMs: number = DEFAULT_RCON_COMMAND_TIMEOUT_MS
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let inFlight: Connection | undefined;

    const settle = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      outcome();
    };

    const timer = setTimeout(() => {
      const message = `RCON command timed out after ${timeoutMs}ms`;
      settle(() => reject(inFlight ? new Error(message) : new RconCommandNotSentError(message)));
      if (inFlight) dropConnection(instanceId, inFlight, new Error('RCON command timed out'));
    }, timeoutMs);

    enqueue(instanceId, () => new Promise<void>(done => {
      const connection = connections.get(instanceId);
      if (settled || !connection) {
        settle(() => reject(new RconCommandNotSentError('RCON not connected')));
        done();
        return;
      }
      inFlight = connection;
      const { client } = connection;
      const finish = (outcome: () => void) => {
        client.removeListener('response', onResponse);
        connection.abort = undefined;
        inFlight = undefined;
        settle(outcome);
        done();
      };
      const onResponse = (response: string) => finish(() => resolve(response));
      connection.abort = reason => finish(() => reject(reason));
      client.once('response', onResponse);
      try {
        client.send(command);
      } catch (error) {
        finish(() => reject(error));
      }
    }));
  });
}

function enqueue(instanceId: string, task: () => Promise<void>): void {
  const next = (commandQueues.get(instanceId) ?? Promise.resolve()).then(task);
  commandQueues.set(instanceId, next);
  void next.then(() => {
    if (commandQueues.get(instanceId) === next) commandQueues.delete(instanceId);
  });
}

export function isRconConnected(instanceId: string): boolean {
  return connections.has(instanceId);
}

export function isRconConnecting(instanceId: string): boolean {
  return connectLoops.has(instanceId);
}

/** Closes every client and cancels every pending connect. For app shutdown. */
export function cleanupAllRconConnections(): void {
  for (const instanceId of new Set([...connections.keys(), ...connectLoops.keys()])) {
    disconnectRcon(instanceId);
  }
}
