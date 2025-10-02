import { Injectable } from '@angular/core';
import { Observable, Subject, BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class WebSocketService {
  private ws: WebSocket | null = null;
  private subjects: { [channel: string]: Subject<any> } = {};
  private isConnected: boolean = false;
  private myCid: string | null = null;
  private connectionState$ = new BehaviorSubject<boolean>(false);

  /**
   * Emits true when connected, false when disconnected. Subscribe to this in web mode to know when to send messages.
   */
  public get connected$(): Observable<boolean> {
    return this.connectionState$.asObservable();
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
      this.connectionState$.next(true);
    };
    this.ws.onclose = () => {
      this.isConnected = false;
      this.connectionState$.next(false);
      this.ws = null;
    };
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
