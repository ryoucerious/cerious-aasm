
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

import { MessageTransport } from './message-transport.interface';

import { ApiService } from '../api.service';
import { WebSocketService } from '../web-socket.service';

@Injectable()
export class ApiMessageTransport implements MessageTransport {

  constructor(private api: ApiService, private ws: WebSocketService) {}

  sendMessage(channel: string, payload: any): Observable<any> {
    // Use WebSocket for real-time/broadcast messages so excludeCid is respected
    // Fallback to HTTP POST for non-realtime or if ws is not available
    if (this.ws && (this.ws as any).sendMessage) {
      (this.ws as any).sendMessage(channel, payload);
      // Return an observable that completes immediately (no response expected)
      return new Observable<any>(observer => { observer.complete(); });
    } else {
      return this.api.post<any>(`/api/message`, { channel, payload });
    }
  }

  receiveMessage<T = any>(channel: string): Observable<T> {
    return this.ws.receiveMessage<T>(channel);
  }
}
