import { Injectable } from '@angular/core';
import { Observable, from, map } from 'rxjs';
import { IpcService } from '../ipc.service';
import { MessageTransport } from './message-transport.interface';

/** What main answers on 'message': whether the message reached the bus, not the reply itself. */
interface DeliveryAck {
  status?: 'received' | 'error';
  error?: string;
}

@Injectable()
export class IpcMessageTransport implements MessageTransport {
  constructor(private ipc: IpcService) {}

  /**
   * Resolves once the main process has the message; the reply comes back as an event on `channel`.
   * Errors if main refused it (a bad channel name), since no reply will follow.
   */
  sendMessage(channel: string, payload: unknown): Observable<unknown> {
    return from(this.ipc.invoke('message', { channel, payload })).pipe(map(ack => {
      const { status, error } = (ack ?? {}) as DeliveryAck;
      if (status === 'error') throw new Error(error || `The main process refused the message on ${channel}`);
      return ack;
    }));
  }

  receiveMessage<T>(channel: string): Observable<T> {
    return new Observable<T>(subscriber => this.ipc.on(channel, (_event, data) => subscriber.next(data as T)));
  }
}
