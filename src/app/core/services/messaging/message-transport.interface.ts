import { Observable } from 'rxjs';

export interface MessageTransport {
  sendMessage(channel: string, payload: any): Observable<any>;
  receiveMessage<T = any>(channel: string): Observable<T>;
}
