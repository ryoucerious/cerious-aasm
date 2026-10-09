import { messagingService } from '../services/messaging.service';
import type { MessageSender } from '../types/messaging.types';
import { registerForwardable, routeToHost } from '../services/host-routing';

export type RequestPayload = Record<string, any>;

export interface RequestContext {
  sender: MessageSender;
  requestId: unknown;
  /** Runs after the reply is sent, for broadcasts that must follow it. Errors are logged. */
  afterReply(fn: () => void | Promise<void>): void;
}

export interface RequestOptions {
  /** Shape of the error reply; defaults to `{ success: false, error }`. requestId is added. */
  onError?: (message: string, payload: RequestPayload) => Record<string, unknown>;
  fallbackError?: string;
  /**
   * The request is about the server whose id is payload[idKey]: in a mesh it runs on the machine
   * hosting that server. `read` when it changes nothing, so it can go without quorum.
   */
  host?: { idKey: string; read?: boolean };
}

/** Stands in for the sender of a request another machine passed here; handlers that may run so do not use it. */
const FORWARDED: MessageSender = { type: 'api-process' } as unknown as MessageSender;

export function errorMessage(error: unknown, fallback = 'Unexpected error'): string {
  if (error instanceof Error) {
    return error.message || fallback;
  }
  if (typeof error === 'string') {
    return error || fallback;
  }
  return fallback;
}

/** A client payload as a record: anything else (missing, null, a primitive, an array) reads as `{}`. */
export function asPayload(raw: unknown): RequestPayload {
  return isRecord(raw) ? raw : {};
}

/**
 * Request/response handler on `channel`. The handler's return value (an object) is sent back to the
 * sender with the caller's `requestId`; `undefined` sends nothing. A non-object payload is treated as `{}`.
 */
export function onRequest(
  channel: string,
  handler: (payload: RequestPayload, context: RequestContext) => unknown,
  options: RequestOptions = {}
): void {
  const host = options.host;
  if (host) {
    registerForwardable(channel, !!host.read, async forwarded => {
      const followUps: Array<() => void | Promise<void>> = [];
      const reply = await handler(asPayload(forwarded), { sender: FORWARDED, requestId: undefined, afterReply: fn => { followUps.push(fn); } });
      for (const followUp of followUps) void Promise.resolve().then(followUp).catch(error => logError(channel, error));
      return reply;
    });
  }
  messagingService.on(channel, async (rawPayload: unknown, sender: MessageSender) => {
    const payload = asPayload(rawPayload);
    const requestId = payload.requestId;
    const serverId = host ? payload[host.idKey] : undefined;
    if (host && typeof serverId === 'string' && serverId) {
      const { requestId: _requestId, ...forwarded } = payload;
      let remote: unknown;
      try {
        remote = await routeToHost(channel, serverId, forwarded, !!host.read, sender);
      } catch (error) {
        logError(channel, error);
        send(channel, { ...buildErrorReply(channel, errorMessage(error, options.fallbackError), payload, options.onError), requestId }, sender);
        return;
      }
      if (remote !== null) {
        send(channel, { ...(remote as object), requestId }, sender);
        return;
      }
    }
    const followUps: Array<() => void | Promise<void>> = [];
    const context: RequestContext = {
      sender,
      requestId,
      afterReply: fn => { followUps.push(fn); },
    };

    let reply: unknown;
    try {
      reply = await handler(payload, context);
    } catch (error) {
      logError(channel, error);
      const message = errorMessage(error, options.fallbackError);
      send(channel, { ...buildErrorReply(channel, message, payload, options.onError), requestId }, sender);
      return;
    }

    if (reply !== undefined) {
      send(channel, { ...(reply as object), requestId }, sender);
    }
    for (const followUp of followUps) {
      try {
        await followUp();
      } catch (error) {
        logError(channel, error);
      }
    }
  });
}

function isRecord(value: unknown): value is RequestPayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildErrorReply(
  channel: string,
  message: string,
  payload: RequestPayload,
  onError: RequestOptions['onError']
): Record<string, unknown> {
  if (onError) {
    try {
      return onError(message, payload);
    } catch (error) {
      logError(channel, error);
    }
  }
  return { success: false, error: message };
}

// Sending to a window that closed mid-request throws; the handler's work is already done.
function send(channel: string, data: Record<string, unknown>, sender: MessageSender): void {
  try {
    messagingService.sendToOriginator(channel, data, sender);
  } catch (error) {
    logError(channel, error);
  }
}

// The stack, not the object: axios errors carry the request URL and headers.
function logError(channel: string, error: unknown): void {
  console.error(`[${channel}]`, error instanceof Error ? error.stack ?? error.message : error);
}
