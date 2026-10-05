import { Injectable } from '@angular/core';
import { EMPTY, Observable } from 'rxjs';
import { MessageTransport } from './message-transport.interface';
import { WebSocketService } from '../web-socket.service';

/** The web UI's transport: everything goes over the WebSocket, which holds messages until it is open. */
@Injectable()
export class ApiMessageTransport implements MessageTransport {
  constructor(private ws: WebSocketService) {}

  sendMessage(channel: string, payload: unknown, options?: { timeoutMs?: number }): Observable<never> {
    this.ws.sendMessage(channel, payload, options?.timeoutMs);
    return EMPTY;
  }

  receiveMessage<T>(channel: string): Observable<T> {
    return this.ws.receiveMessage<T>(channel);
  }
}
