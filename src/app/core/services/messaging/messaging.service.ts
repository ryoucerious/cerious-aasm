

import { Injectable, Inject } from '@angular/core';
import { Observable } from 'rxjs';
import { filter, take, timeout } from 'rxjs/operators';
import { MessageTransport } from './message-transport.interface';

@Injectable({ providedIn: 'root' })
export class MessagingService {
  constructor(@Inject('MessageTransport') private transport: MessageTransport) {}

  /**
   * Send a message and expect a direct response on the same channel
   * This automatically handles request/response pattern with requestId matching
   */
  sendMessage<T = any>(channel: string, payload: any): Observable<T> {
    const requestId = this.generateRequestId();
    const requestPayload = { ...payload, requestId };
    
    // Start listening for the response before sending the request
    const response$ = this.receiveMessage<T>(channel).pipe(
      filter((res: any) => res && res.requestId === requestId),
      take(1),
      timeout(30000) // 30 second timeout
    );
    
    // Send the request
    this.transport.sendMessage(channel, requestPayload).subscribe();
    
    return response$;
  }

  /**
   * Listen for messages on a channel (for notifications and responses)
   */
  receiveMessage<T = any>(channel: string): Observable<T> {
    return this.transport.receiveMessage<T>(channel);
  }

  /**
   * Send a one-way message (fire and forget, no response expected)
   */
  sendNotification(channel: string, payload: any): void {
    this.transport.sendMessage(channel, payload).subscribe();
  }

  private generateRequestId(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }
}
