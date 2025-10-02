import { Injectable } from '@angular/core';
import { MessagingService } from './messaging/messaging.service';
import { Observable } from 'rxjs';

export interface ArkUpdateResponse {
  success: boolean;
  hasUpdate: boolean;
  buildId?: string | null;
  message?: string;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class ArkUpdateService {
  constructor(private messaging: MessagingService) {}

  /**
   * Check for ARK server updates
   * @returns Observable<ArkUpdateResponse>
   */
  checkForUpdate(): Observable<ArkUpdateResponse> {
    return this.messaging.sendMessage('check-ark-update', {});
  }
}
