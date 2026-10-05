import { messagingService } from '../services/messaging.service';
import type { MessageSender } from '../types/messaging.types';

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
}

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
  messagingService.on(channel, async (rawPayload: unknown, sender: MessageSender) => {
    const payload = asPayload(rawPayload);
    const requestId = payload.requestId;
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
