import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';

export interface MessageTransport {
  /**
   * Hands one message to the backend. Errors if it could not be delivered; replies arrive via receiveMessage.
   * `timeoutMs` is how long the caller waits for a reply: a transport that holds messages while offline drops them after it.
   */
  sendMessage(channel: string, payload: unknown, options?: { timeoutMs?: number }): Observable<unknown>;
  receiveMessage<T>(channel: string): Observable<T>;
}

/** IPC in the desktop app, the WebSocket in the web UI; chosen in app.config.ts. */
export const MESSAGE_TRANSPORT = new InjectionToken<MessageTransport>('MessageTransport');
