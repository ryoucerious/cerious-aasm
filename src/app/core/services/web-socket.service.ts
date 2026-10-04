import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subject, firstValueFrom, of } from 'rxjs';
import { filter, timeout } from 'rxjs/operators';
import { IpcService } from './ipc.service';
import { DEFAULT_REQUEST_TIMEOUT_MS } from './messaging/messaging.service';

/** The code the server closes a socket with when the session is missing or expired. */
const UNAUTHORIZED = 4401;
const FIRST_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30_000;
/** Messages sent while the socket is down wait here; past this the oldest is dropped. */
const MAX_QUEUED_MESSAGES = 100;
/** The server's first frame on a socket it accepted. One it refuses gets `unauthorized` and a 4401 close instead. */
const WELCOME_CHANNEL = 'welcome';

interface QueuedMessage {
  data: string;
  /** When the caller stops waiting for the reply. */
  expiresAt: number;
}

/** Same origin as the page, so it works on any port and behind a TLS proxy on 443. */
export function socketUrl(location: Pick<Location, 'protocol' | 'host'>): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

/** The web UI's connection to the backend. Unused in the desktop app, which talks over IPC. */
@Injectable({ providedIn: 'root' })
export class WebSocketService implements OnDestroy {
  private ws: WebSocket | null = null;
  private readonly subjects = new Map<string, Subject<unknown>>();
  private readonly connectionState = new BehaviorSubject<boolean>(false);
  private readonly unauthorizedSubject = new Subject<void>();
  private readonly outbox: QueuedMessage[] = [];
  private readonly disabled: boolean;
  /** Set by a 4401 close. Nothing reconnects until reconnectNow() is called after signing in. */
  private refused = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onOnline = () => {
    if (this.ws) return;
    this.reconnectAttempts = 0;
    this.connect();
  };

  constructor(ipc: IpcService) {
    this.disabled = ipc.isElectron;
    if (this.disabled) return;
    window.addEventListener('online', this.onOnline);
    this.connect();
  }

  /**
   * Emits true once the server has accepted the session (its welcome frame) and false when the
   * socket closes. Starts false. Opening alone does not count: the server opens a socket it will
   * refuse and closes it a moment later, and nothing sent in between is answered.
   */
  get connected$(): Observable<boolean> {
    return this.connectionState.asObservable();
  }

  /** Emits when the server refused the socket because nobody is signed in, or on endSession(). */
  get unauthorized$(): Observable<void> {
    return this.unauthorizedSubject.asObservable();
  }

  /** Resolves true once the server has accepted the session, or false after `timeoutMs`. */
  whenConnected(timeoutMs = 4000): Promise<boolean> {
    return firstValueFrom(this.connectionState.pipe(
      filter(connected => connected),
      timeout({ first: timeoutMs, with: () => of(false) })
    ));
  }

  /**
   * Closes the socket as the server does when a session ends (4401): unauthorized$ fires and
   * nothing reconnects until reconnectNow(). For signing out without waiting for that close.
   */
  endSession(): void {
    if (this.disabled) return;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.connectionState.next(false);
    this.refuse();
  }

  /** Opens the socket again now. Needed after signing in: a socket refused for want of a session stops retrying. */
  reconnectNow(): void {
    this.refused = false;
    this.reconnectAttempts = 0;
    this.connect();
  }

  /**
   * Sends now if the connection is up, otherwise once it is, unless `timeoutMs` (how long the
   * caller waits for a reply) runs out first. Dropped while the session is refused.
   */
  sendMessage(channel: string, payload: unknown, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): void {
    if (this.disabled || this.refused) return;
    const message = JSON.stringify({ channel, payload });
    // Not before the welcome, when the server may be about to close the socket for want of a
    // session, and not while CLOSING: the socket still exists then, but anything sent on it is lost.
    if (this.connectionState.value && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(message);
      return;
    }
    // No connect() here: every close schedules the next attempt, and connecting per send would
    // turn each poll into a new socket against a backend that is down.
    this.enqueue(message, timeoutMs);
  }

  receiveMessage<T>(channel: string): Observable<T> {
    let subject = this.subjects.get(channel);
    if (!subject) {
      subject = new Subject<unknown>();
      this.subjects.set(channel, subject);
    }
    return subject.asObservable() as Observable<T>;
  }

  ngOnDestroy(): void {
    window.removeEventListener('online', this.onOnline);
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  private connect(): void {
    if (this.disabled || this.refused || this.ws) return;
    this.clearReconnectTimer();

    const ws = new WebSocket(socketUrl(window.location));
    ws.onmessage = event => this.dispatch(ws, event.data);
    ws.onclose = event => {
      this.ws = null;
      this.connectionState.next(false);

      // Refused for want of a sign-in: reconnecting would only be refused again, and the
      // app would sit on "Connection Lost" with no way to the login form.
      if (event.code === UNAUTHORIZED) {
        this.refuse();
        return;
      }

      this.scheduleReconnect();
    };
    this.ws = ws;
  }

  private refuse(): void {
    this.refused = true;
    this.outbox.length = 0;
    this.clearReconnectTimer();
    this.unauthorizedSubject.next();
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    const ceiling = Math.min(FIRST_RECONNECT_DELAY_MS * 2 ** Math.min(this.reconnectAttempts, 5), MAX_RECONNECT_DELAY_MS);
    // Jitter, so every browser that lost the same server does not come back in the same instant.
    const delay = ceiling / 2 + Math.random() * (ceiling / 2);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private enqueue(message: string, timeoutMs: number): void {
    if (this.outbox.length >= MAX_QUEUED_MESSAGES) {
      this.outbox.shift();
      console.warn(`[web-socket] More than ${MAX_QUEUED_MESSAGES} messages waiting for the connection; dropped the oldest`);
    }
    this.outbox.push({ data: message, expiresAt: Date.now() + timeoutMs });
  }

  /**
   * Sends what is still wanted. A request past its timeout has already failed for its caller, so
   * replaying it would apply a change the user was told did not happen.
   */
  private flush(ws: WebSocket): void {
    const now = Date.now();
    const queued = this.outbox.splice(0);
    const wanted = queued.filter(message => message.expiresAt >= now);
    if (wanted.length < queued.length) {
      console.warn(`[web-socket] Dropped ${queued.length - wanted.length} queued message(s) whose callers had stopped waiting`);
    }
    wanted.forEach(message => ws.send(message.data));
  }

  private dispatch(ws: WebSocket, raw: unknown): void {
    let message: { channel?: unknown; data?: unknown };
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (typeof message?.channel !== 'string') return;
    if (message.channel === WELCOME_CHANNEL) this.welcome(ws);
    this.subjects.get(message.channel)?.next(message.data);
  }

  /** The connection counts as up from here, not from the socket opening. */
  private welcome(ws: WebSocket): void {
    if (ws !== this.ws || this.connectionState.value) return;
    this.reconnectAttempts = 0;
    this.flush(ws);
    this.connectionState.next(true);
  }
}
