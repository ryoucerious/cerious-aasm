import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { MessagingService } from './messaging/messaging.service';
import { WebSocketService } from './web-socket.service';
import { IpcService } from './ipc.service';

export interface AppUpdateStatus {
  status: 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error';
  version?: string;
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  releaseNotes?: string;
  releaseDate?: string;
  error?: string;
  /** Set when this client must be updated outside the app. */
  manual?: boolean;
  /** How to apply the update. Shown instead of downloading. */
  instructions?: string;
  instructionsUrl?: string;
}

/**
 * Whether a new version of the app itself is waiting.
 *
 * The sidebar version mark is the place to download and install it. This keeps that state
 * in one subscription so a late listener still sees an update found before it loaded.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateService implements OnDestroy {
  private readonly statusSubject = new BehaviorSubject<AppUpdateStatus | null>(null);
  private readonly subs: Subscription[] = [];

  constructor(private messaging: MessagingService, webSocket: WebSocketService, ipc: IpcService) {
    this.subs.push(this.messaging.receiveMessage<AppUpdateStatus>('app-update-status').subscribe(status => {
      if (status) this.statusSubject.next(status);
    }));

    // The main process may have found the update before the UI was listening. The web UI asks
    // whenever its socket comes up: before that, or while the session is refused, the request
    // is dropped and never repeated. The desktop app has no socket and asks once.
    this.subs.push(webSocket.connected$.pipe(filter(connected => connected)).subscribe(() => this.requestStatus()));
    if (ipc.isElectron) this.requestStatus();
    this.subs.push(this.messaging.receiveMessage('mesh-auth-changed').subscribe(() => this.requestStatus()));
  }

  ngOnDestroy(): void {
    this.subs.forEach(sub => sub.unsubscribe());
  }

  get status$(): Observable<AppUpdateStatus | null> {
    return this.statusSubject.asObservable();
  }

  get status(): AppUpdateStatus | null {
    return this.statusSubject.value;
  }

  /** True from the moment an update is found until it has been installed. */
  static isPending(status: AppUpdateStatus | null): boolean {
    return status?.status === 'available'
      || status?.status === 'downloading'
      || status?.status === 'downloaded'
      || status?.status === 'error';
  }

  download(): void {
    this.messaging.sendNotification('download-app-update', {});
  }

  install(): void {
    this.messaging.sendNotification('install-app-update', {});
  }

  private requestStatus(): void {
    this.messaging.sendNotification('get-app-update-status', {});
  }
}
