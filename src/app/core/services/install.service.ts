import { Injectable } from '@angular/core';
import { MessagingService } from './messaging/messaging.service';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class InstallService {
  constructor(private messaging: MessagingService) {}

  install(target: string, extraPayload: any = {}): Observable<any> {
    return this.messaging.sendMessage('install', { target, ...extraPayload });
  }

  cancelInstall(target: string): Observable<any> {
    return this.messaging.sendMessage('cancel-install', { target });
  }

}
