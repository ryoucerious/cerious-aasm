import { Injectable } from '@angular/core';
import { MessagingService } from './messaging/messaging.service';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class DirectoryService {
  constructor(private messaging: MessagingService) {}

  openConfigDirectory(): Observable<any> {
    return this.messaging.sendMessage('open-config-directory', {});
  }
}
