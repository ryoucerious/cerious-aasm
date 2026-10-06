import { Injectable, Inject } from '@angular/core';
import { AsyncSubject, Observable, merge } from 'rxjs';
import { filter, take, timeout } from 'rxjs/operators';
import { MESSAGE_TRANSPORT, MessageTransport } from './message-transport.interface';

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** Backup create, restore and import reply only once the archive is written or unpacked. */
export const BACKUP_TIMEOUT_MS = 30 * 60_000;
/** Installing or updating the ARK server downloads several gigabytes through SteamCMD. */
export const INSTALL_TIMEOUT_MS = 60 * 60_000;
/** Fetching a plugin from the internet, or packing files into the reply for the browser to save. */
export const FILE_TRANSFER_TIMEOUT_MS = 10 * 60_000;
/** Moving a server copies its saves to another machine; the mesh allows a large world an hour. */
export const MOVE_TIMEOUT_MS = 60 * 60_000;

export interface RequestOptions {
  /** How long to wait for the reply before erroring with a TimeoutError. Defaults to 30 s. */
  timeoutMs?: number;
}

@Injectable({ providedIn: 'root' })
export class MessagingService {
  constructor(@Inject(MESSAGE_TRANSPORT) private transport: MessageTransport) {}

  /**
   * Sends a request immediately, subscribed or not, and returns its reply: the first message on
   * `channel` carrying the request's id. Errors if the transport fails or the reply is late.
   */
  sendMessage<T = any>(channel: string, payload: object = {}, options: RequestOptions = {}): Observable<T> {
    const requestId = this.generateRequestId();
    const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const deliveryFailure = new AsyncSubject<never>();
    this.transport.sendMessage(channel, { ...payload, requestId }, { timeoutMs }).subscribe({
      error: error => deliveryFailure.error(error)
    });

    return merge(
      this.receiveMessage<T>(channel).pipe(filter(reply => (reply as { requestId?: unknown } | null)?.requestId === requestId)),
      deliveryFailure
    ).pipe(
      take(1),
      timeout(timeoutMs)
    );
  }

  receiveMessage<T = any>(channel: string): Observable<T> {
    return this.transport.receiveMessage<T>(channel);
  }

  /** Fire and forget: no requestId, no reply expected. */
  sendNotification(channel: string, payload: object): void {
    this.transport.sendMessage(channel, payload).subscribe({
      error: error => console.error(`[messaging] Could not send ${channel}:`, error)
    });
  }

  // Not crypto.randomUUID: it is missing on plain-HTTP origins, which is how the LAN web UI is served.
  private generateRequestId(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }
}
