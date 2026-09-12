import { Injectable } from '@angular/core';
import { Observable, Subject, BehaviorSubject } from 'rxjs';

/** The code the server closes a socket with when the session is missing or expired. */
const UNAUTHORIZED = 4401;

@Injectable({ providedIn: 'root' })
export class WebSocketService {
  private ws: WebSocket | null = null;
  private subjects: { [channel: string]: Subject<any> } = {};
  private isConnected: boolean = false;
  private myCid: string | null = null;
  private connectionState$ = new BehaviorSubject<boolean>(false);
  private readonly unauthorizedSubject = new Subject<void>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 20;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Emits true when connected, false when disconnected. Subscribe to this in web mode to know when to send messages.
   */
  public get connected$(): Observable<boolean> {
    return this.connectionState$.asObservable();
  }

  /** Emits when the server refused the socket because nobody is signed in. */
  public get unauthorized$(): Subject<void> {
    return this.unauthorizedSubject;
  }

  /**
   * Open the socket again now, after signing in.
   *
   * A socket refused for want of a session stops retrying, so something has to ask for a
   * fresh one once there is a session to offer.
   */
  /**
   * Resolves once the socket is open, or after `timeoutMs` either way.
   *
   * Used after signing in: the pages behind the login ask for their data the moment they
   * load, and anything sent before the socket is up is lost.
   */
  public whenConnected(timeoutMs = 4000): Promise<boolean> {
    if (this.isConnected) return Promise.resolve(true);

    return new Promise<boolean>(resolve => {
      let done = false;
      const finish = (connected: boolean) => {
        if (done) return;
        done = true;
        sub.unsubscribe();
        clearTimeout(timer);
        resolve(connected);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      const sub = this.connectionState$.subscribe(connected => {
        if (connected) finish(true);
      });
    });
  }

  public reconnectNow(): void {
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connect();
  }

  constructor() {
    // Only auto-connect in browser (not Electron)
    if (!(window as any).require) {
      this.connect();
    }
  }

  private connect() {
    if (this.isConnected || this.ws) {
      return;
    }
    const hostname = window.location.hostname;
    const port = window.location.port || '3000';
    this.ws = new WebSocket(`ws://${hostname}:${port}/ws`);
    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.channel === 'welcome' && msg.cid) {
          this.myCid = msg.cid;
          return;
        }
        const { channel, data } = msg;
        if (channel && this.subjects[channel]) {
          this.subjects[channel].next(data);
        }
      } catch (e) {
        // Ignore malformed messages
      }
    };
    this.ws.onopen = () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.connectionState$.next(true);
    };
    this.ws.onclose = (event) => {
      this.isConnected = false;
      this.connectionState$.next(false);
      this.ws = null;

      // Refused for want of a sign-in: reconnecting would only be refused again, and the
      // app would sit on "Connection Lost" with no way to the login form.
      if (event.code === UNAUTHORIZED) {
        this.unauthorized$.next();
        return;
      }

      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  sendMessage(channel: string, payload: any) {
    this.connect();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg = { channel, payload };
    this.ws.send(JSON.stringify(msg));
  }

  receiveMessage<T = any>(channel: string): Observable<T> {
    // Only connect when actually needed
    this.connect();
    if (!this.subjects[channel]) {
      this.subjects[channel] = new Subject<T>();
    }
    return this.subjects[channel].asObservable();
  }
}
