
import { Injectable } from '@angular/core';
import { Observable, from } from 'rxjs';
import { IpcService } from '../ipc.service';
import { MessageTransport } from './message-transport.interface';
import { Observable as RxObservable } from 'rxjs';

@Injectable()
export class IpcMessageTransport implements MessageTransport {
  constructor(private ipc: IpcService) {}

  sendMessage(channel: string, payload: any): Observable<any> {
    // Always call the generic 'message' channel and pass { channel, payload }
    return from(this.ipc.invoke('message', { channel, payload }));
  }

  receiveMessage<T = any>(channel: string): Observable<T> {
    return new RxObservable<T>((subscriber) => {
      const listener = (_event: any, data: T) => {
        subscriber.next(data);
      };
      this.ipc.on(channel, listener);
      return () => this.ipc.removeListener(channel, listener);
    });
  }
}
