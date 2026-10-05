import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { MessagingService } from './messaging/messaging.service';

/** Auto-start, crash detection and scheduled restarts for a server. */
@Injectable({
  providedIn: 'root'
})
export class AutomationService {

  constructor(private messaging: MessagingService) {}

  configureAutoStart(serverId: string, settings: {
    autoStartOnAppLaunch: boolean;
    autoStartOnBoot: boolean;
  }): Observable<any> {
    return this.messaging.sendMessage('configure-autostart', {
      serverId,
      ...settings
    });
  }

  configureCrashDetection(serverId: string, settings: {
    enabled: boolean;
    checkInterval: number;
    maxRestartAttempts: number;
  }): Observable<any> {
    return this.messaging.sendMessage('configure-crash-detection', {
      serverId,
      ...settings
    });
  }

  configureScheduledRestart(serverId: string, settings: {
    enabled: boolean;
    frequency: 'none' | 'daily' | 'weekly' | 'custom';
    time: string;
    days: number[];
    warningMinutes: number;
  }): Observable<any> {
    return this.messaging.sendMessage('configure-scheduled-restart', {
      serverId,
      ...settings
    });
  }
}
